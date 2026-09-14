const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Course, Subject } = require('../models');
const { tierGate } = require('@study-partner/shared/tierGate');
const { requireMultipart } = require('@study-partner/shared/middleware');
const { deleteObjectivesForDocument } = require('../services/objectives');
const { publishCourseIngestionJob } = require('../services/ingestionJob');
const { buildInternalHeaders } = require('@study-partner/shared/auth');

const router = express.Router();

// INGEST-05: move freshly-uploaded files into a course-scoped directory so the
// async worker (INGEST-06) can find them via a single unambiguous fileRef.
// Stored paths are relative to the uploads root.
function stageCourseFiles(reqFiles, courseId) {
  const courseUploadDir = path.join('uploads', 'courses', courseId);
  fs.mkdirSync(courseUploadDir, { recursive: true });
  return reqFiles.map((file) => {
    const newPath = path.join(courseUploadDir, file.filename);
    fs.renameSync(file.path, newPath);
    return {
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      path: path.relative('uploads', newPath).replace(/\\/g, '/')
    };
  });
}

function courseFileRef(courseId) {
  return path.join('uploads', 'courses', courseId).replace(/\\/g, '/');
}

function cleanupCourseFiles(courseId) {
  const dir = path.join('uploads', 'courses', courseId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Failed to cleanup course files for ${courseId}:`, err.message);
  }
}

// SEC-11: storage filenames are server-generated and never echo the client
// name. The extension is whitelisted to a plain `[A-Za-z0-9]` suffix so no
// path separator, control char or traversal payload survives into the path.
const STORAGE_EXT_RE = /^\.[a-z0-9]{1,8}$/;

function sanitizeStoredFilename(file) {
  const safeSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const ext = (path.extname(file.originalname) || '').toLowerCase();
  return STORAGE_EXT_RE.test(ext) ? `${safeSuffix}${ext}` : `${safeSuffix}.bin`;
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, sanitizeStoredFilename(file));
  }
});

// INGEST-01: metadata (MIME + extension) allowlist, plus magic-byte sniffing.
// INGEST-02: 25MB per-file cap enforced by multer; excess → 413.
const {
  validateUploadMetadata,
  validateUploadFile,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  SNIFF_BYTES
} = require('@study-partner/shared/uploadValidation');

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    // Cheap first pass: declared MIME + extension must be allowed.
    const check = validateUploadMetadata(file);
    if (check.valid) return cb(null, true);
    const err = new Error(check.errors.join('; '));
    err.statusCode = 422; // sanitized message, no client-controlled content reflected
    return cb(err);
  }
});

// INGEST-02: multer size-limit violations surface as 413 (never a generic 500),
// and any file already written to disk by diskStorage is removed.
function cleanupRequestFiles(req) {
  if (!req.files) return;
  const fs = require('fs');
  const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
  for (const file of files) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {
      /* best-effort cleanup */
    }
  }
}

function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      cleanupRequestFiles(req);
      const sizeErr = new Error(`File too large - maximum allowed is ${MAX_UPLOAD_MB}MB per file`);
      sizeErr.statusCode = 413;
      return next(sizeErr);
    }
    return next(err);
  }
  return next(err);
}

const withUploadError = (mw) => (req, res, next) =>
  mw(req, res, (err) => handleUploadError(err, req, res, next));

// SEC-11: `fs.readFileSync` was blocking the event loop on every upload; the
// header is now read via a bounded stream (fast binary reject without loading
// a 25MB file) and the authoritative content check reads async (`fs.promises`).
function streamFileSlice(filePath, start, end) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function sniffUploadedFiles(req, res, next) {
  if (!req.files || req.files.length === 0) return next();

  const rejectAndCleanup = (files, message) => {
    for (const f of files) {
      try {
        fs.unlinkSync(f.path);
      } catch (_) {
        /* best-effort cleanup */
      }
    }
    const err = new Error(message);
    err.statusCode = 422;
    return err;
  };

  try {
    // Fast path: sniff only the header, reject binaries before any full read.
    for (const file of req.files) {
      const header = await streamFileSlice(file.path, 0, SNIFF_BYTES - 1);
      if (header.length > 0) {
        const { sniffMagicBytes } = require('@study-partner/shared/uploadValidation');
        if (sniffMagicBytes(header) === 'binary') {
          return next(
            rejectAndCleanup(req.files, 'Upload rejected: binary/script content is not allowed')
          );
        }
      }
    }

    // Authoritative check: ensure MIME/extension match the (async) full content.
    for (const file of req.files) {
      const buffer = await fs.promises.readFile(file.path);
      const check = validateUploadFile({
        originalname: file.originalname,
        mimetype: file.mimetype,
        buffer
      });

      if (!check.valid) {
        return next(rejectAndCleanup(req.files, 'Upload rejected: ' + check.errors.join('; ')));
      }
    }
  } catch (readErr) {
    return next(rejectAndCleanup(req.files, 'Failed to read uploaded file'));
  }

  return next();
}

// Get all courses for a user, optionally filtered by subject
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { subject_id } = req.query;

    const query = { userId };
    if (subject_id) {
      query.subjectId = subject_id;
    }

    console.log('Fetching courses for user:', userId, 'subject:', subject_id);

    const courses = await Course.find(query).sort({ createdAt: -1 }).lean();

    console.log('Found', courses.length, 'courses');

    const coursesWithDetails = courses.map((course) => ({
      id: course._id.toString(),
      title: course.title,
      description: course.description,
      subjectId: course.subjectId,
      status: course.status,
      topicsCount: course.topics?.length || 0,
      filesCount: course.files?.length || 0,
      aiCourseId: course.aiCourseId,
      processedAt: course.processedAt,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt
    }));

    res.json({ courses: coursesWithDetails });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses', details: error.message });
  }
});

// Create a new course (AI-powered, requires VIP+)
router.post(
  '/',
  tierGate('vip', 'vip_plus', 'trial'),
  requireMultipart,
  withUploadError(upload.array('files', 10)),
  sniffUploadedFiles,
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { title, description, subject_id } = req.body;

      if (!title || !subject_id) {
        return res.status(400).json({ error: 'title and subject_id are required' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'At least one file is required' });
      }

      // Verify subject exists and belongs to user
      const subject = await Subject.findOne({ _id: subject_id, userId });
      if (!subject) {
        return res.status(404).json({ error: 'Subject not found' });
      }

      // Create course record with processing status
      const course = new Course({
        title,
        description,
        subjectId: subject_id,
        userId,
        status: 'processing',
        files: req.files.map((file) => ({
          filename: file.filename,
          originalName: file.originalname,
          size: file.size
        }))
      });

      await course.save();

      // INGEST-05: stage files under a course-scoped dir, then enqueue the
      // async ingestion job. The request returns 202 { jobId } immediately —
      // the worker (INGEST-06) parses/embeds and resolves the course status.
      const staged = stageCourseFiles(req.files, course._id.toString());

      try {
        const { jobId, correlationId } = await publishCourseIngestionJob({
          userId,
          courseId: course._id.toString(),
          fileRef: courseFileRef(course._id.toString()),
          files: staged,
          requestId: req.get('X-Request-ID')
        });

        // INGEST-07: persist the job linkage so progress/result events can be
        // correlated back to this course document.
        course.jobId = jobId;
        course.correlationId = correlationId;
        await course.save();

        console.log('Ingestion job triggered:', jobId);
        return res.status(202).json({
          jobId,
          courseId: course._id.toString(),
          status: 'processing'
        });
      } catch (publishErr) {
        console.error('Ingestion job enqueue failed:', publishErr.message);

        // No job was enqueued → nothing will parse these files. Mark the course
        // failed and remove the staged files so nothing is orphaned.
        course.status = 'failed';
        course.warning = 'ingestion job could not be enqueued';
        await course.save();
        cleanupCourseFiles(course._id.toString());

        return res.status(503).json({ error: 'AI job bus unavailable, retry later' });
      }
    } catch (error) {
      console.error('Error creating course:', error);
      res.status(500).json({ error: 'Failed to create course' });
    }
  }
);

// Get a specific course
router.get('/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.userId;

    const course = await Course.findOne({ _id: courseId, userId });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({
      course: {
        id: course._id.toString(),
        title: course.title,
        description: course.description,
        subjectId: course.subjectId,
        status: course.status,
        topics: course.topics,
        files: course.files,
        aiCourseId: course.aiCourseId,
        processedAt: course.processedAt,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

// INGEST-07: current ingestion progress + status for a course
router.get('/:courseId/ingest-status', async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.userId;

    const course = await Course.findOne({ _id: courseId, userId });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const { buildIngestStatus } = require('../services/ingestStatus');
    res.json(buildIngestStatus(course));
  } catch (error) {
    console.error('Error fetching ingest status:', error);
    res.status(500).json({ error: 'Failed to fetch ingest status' });
  }
});

// Delete a course
router.delete('/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.userId;

    const course = await Course.findOneAndDelete({ _id: courseId, userId });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // BLOOM-06: remove learning objectives for deleted course
    try {
      await deleteObjectivesForDocument(course._id.toString());
    } catch (objErr) {
      console.warn('Learning objective cleanup failed (non-fatal):', objErr.message);
    }

    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// Add files to an existing course (AI re-processing)
router.post(
  '/:courseId/files',
  tierGate('vip', 'vip_plus', 'trial'),
  requireMultipart,
  withUploadError(upload.array('files', 10)),
  sniffUploadedFiles,
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const userId = req.user.userId;

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'At least one file is required' });
      }

      // Find the course
      const course = await Course.findOne({ _id: courseId, userId });
      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      // Add new files to the course
      const newFiles = req.files.map((file) => ({
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        uploadedAt: new Date()
      }));

      course.files.push(...newFiles);
      course.status = 'processing';
      await course.save();

      // INGEST-05: stage the newly added files and enqueue async re-processing.
      const staged = stageCourseFiles(req.files, course._id.toString());

      try {
        const { jobId, correlationId } = await publishCourseIngestionJob({
          userId,
          courseId: course._id.toString(),
          fileRef: courseFileRef(course._id.toString()),
          files: staged,
          requestId: req.get('X-Request-ID')
        });

        // INGEST-07: point this course at the new job and reset the previous
        // ingestion's progress/failure state.
        course.jobId = jobId;
        course.correlationId = correlationId;
        course.ingestStage = null;
        course.ingestProgress = 0;
        course.ingestDetail = '';
        course.ingestError = '';
        await course.save();

        return res.status(202).json({
          jobId,
          courseId: course._id.toString(),
          status: 'processing'
        });
      } catch (publishErr) {
        console.error('Ingestion job enqueue failed:', publishErr.message);
        course.status = 'failed';
        await course.save();
        cleanupCourseFiles(course._id.toString());

        return res.status(503).json({ error: 'AI job bus unavailable, retry later' });
      }
    } catch (error) {
      console.error('Error adding files to course:', error);
      res.status(500).json({ error: 'Failed to add files to course' });
    }
  }
);

// Create a manual course (no AI processing, available to all tiers including Normal)
router.post('/manual', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title, description, subject_id, topics } = req.body;

    if (!title || !subject_id) {
      return res.status(400).json({ error: 'title and subject_id are required' });
    }

    // Verify subject exists and belongs to user
    const subject = await Subject.findOne({ _id: subject_id, userId });
    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Create course record directly (no AI processing)
    const course = new Course({
      title,
      description: description || '',
      subjectId: subject_id,
      userId,
      status: 'completed',
      topics: (topics || []).map((t) => ({
        title: t.title,
        subtopics: (t.subtopics || []).map((sub) => ({
          id: sub.id || `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          title: sub.title,
          summary: sub.summary || '',
          key_concepts: sub.key_concepts || [],
          definitions: sub.definitions || [],
          formulas: sub.formulas || [],
          examples: sub.examples || [],
          tokenized_chunks: []
        }))
      })),
      files: [],
      processedAt: new Date()
    });

    await course.save();

    // Auto-award XP
    try {
      const USER_PROFILE_URL =
        process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
      await axios.post(
        `${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`,
        {
          action: 'course_upload',
          metadata: { courseId: course._id.toString(), title: course.title, manual: true }
        },
        {
          headers: buildInternalHeaders(req.headers.authorization)
        }
      );
    } catch (xpErr) {
      console.warn('XP award failed for manual course:', xpErr.message);
    }

    res.status(201).json({
      course: {
        id: course._id.toString(),
        title: course.title,
        description: course.description,
        subjectId: course.subjectId,
        status: course.status,
        topicsCount: course.topics?.length || 0,
        filesCount: 0,
        processedAt: course.processedAt,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt
      }
    });
  } catch (error) {
    console.error('Error creating manual course:', error);
    res.status(500).json({ error: 'Failed to create manual course' });
  }
});

module.exports = router;

/**
 * INGEST-01 — Course upload file validation (MIME + magic bytes).
 * Route-level tests: valid PDF/text accepted pipeline-wise, spoofed
 * executables / MIME mismatches rejected with 422 and nothing persists.
 */

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = 'http://ai.test.local'; // never actually hit for rejects

const fs = require('fs');
const UPLOAD_DIR = 'uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

process.exit = jest.fn();

jest.mock('../models/index', () => {
  const mockCourse = jest.fn().mockImplementation(function (data) {
    Object.assign(this, data);
    this._id = 'course-new';
    this.save = jest.fn().mockResolvedValue(true);
    mockCourse.instances.push(this);
  });
  mockCourse.instances = [];
  mockCourse.find = jest.fn();
  mockCourse.findOne = jest.fn();
  mockCourse.findOneAndDelete = jest.fn();
  return {
    Course: mockCourse,
    Subject: { findOne: jest.fn() }
  };
});

jest.mock('../services/objectives', () => ({
  syncObjectivesForDocument: jest
    .fn()
    .mockResolvedValue({ inserted: 0, updated: 0, superseded: 0 }),
  deleteObjectivesForDocument: jest.fn().mockResolvedValue(null)
}));

const { Course, Subject } = require('../models/index');
const courseRoutes = require('../routes/courses');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = express();
const fakeAuth = (req, res, next) => {
  req.user = { userId: 'user-123', tier: 'vip' };
  next();
};

// Shared modules now resolve via the workspace link.
jest.mock('@study-partner/shared/uploadValidation', () => {
  const actual = jest.requireActual('@study-partner/shared/uploadValidation');
  return { ...actual };
});

// INGEST-05: study uploads publish jobs instead of synchronous AI calls.
jest.mock('@study-partner/shared/ai-messaging', () => ({
  publishAiJob: jest.fn()
}));
const { publishAiJob } = require('@study-partner/shared/ai-messaging');

app.use('/api/v1/study/courses', fakeAuth, courseRoutes);

const { errorHandler } = require('@study-partner/shared/middleware');
app.use(errorHandler);

function authHeader(userId = 'user-123') {
  const token = jwt.sign({ userId, role: 'user' }, process.env.JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

const VALID_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF');
const VALID_TEXT = Buffer.from('Introduction to calculus.\nDefinition of a limit.');
const ELF_EXE = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
const SHELL_SCRIPT = Buffer.from('#!/bin/sh\nrm -rf /\n');

describe('INGEST-01 POST /api/v1/study/courses (file validation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    publishAiJob.mockReset(); // clearAllMocks keeps implementations; root out stale ones
    Course.instances = [];
    Course.prototype = {}; // no-op safety
    Subject.findOne.mockResolvedValue({ _id: 'subj-1', userId: 'user-123' });
  });

  test('rejects an executable disguised as .pdf with 422 and no course created', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Bad Course')
      .field('subject_id', 'subj-1')
      .attach('files', ELF_EXE, { filename: 'evil.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Upload rejected|application\/pdf|content is not a PDF|binary/);
    expect(Course.find).not.toHaveBeenCalled();
  });

  test('rejects a shell script renamed to .txt with 422', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Bad Course')
      .field('subject_id', 'subj-1')
      .attach('files', SHELL_SCRIPT, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Upload rejected|binary\/script/);
  });

  test('rejects a PDF renamed to .txt (content mismatch) with 422', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Bad Course')
      .field('subject_id', 'subj-1')
      .attach('files', VALID_PDF, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Upload rejected|content is a PDF/);
  });

  test('rejects unsupported MIME type at the multer filter with 422', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Bad Course')
      .field('subject_id', 'subj-1')
      .attach('files', ELF_EXE, { filename: 'evil.exe', contentType: 'application/x-msdownload' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/unsupported file type/);
  });

  test('accepts valid PDF + text files and enqueues an ingestion job (202)', async () => {
    publishAiJob.mockResolvedValue({ messageId: 'job-1', correlationId: 'corr-1' });

    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Good Course')
      .field('subject_id', 'subj-1')
      .attach('files', VALID_PDF, { filename: 'notes.pdf', contentType: 'application/pdf' })
      .attach('files', VALID_TEXT, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe('job-1');
    expect(res.body.courseId).toBe('course-new');
    expect(res.body.status).toBe('processing');

    expect(Course).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Good Course', status: 'processing' })
    );

    const instance = Course.instances[0];
    expect(instance.save).toHaveBeenCalled();

    // INGEST-07: upload stores the job linkage for ingest-status correlation.
    expect(instance.jobId).toBe('job-1');
    expect(instance.correlationId).toBe('corr-1');

    expect(publishAiJob).toHaveBeenCalledWith(
      'study.ingest.course',
      'user-123',
      expect.objectContaining({
        courseId: 'course-new',
        fileRef: 'uploads/courses/course-new',
        files: expect.arrayContaining([
          expect.objectContaining({ originalName: 'notes.pdf', size: VALID_PDF.length }),
          expect.objectContaining({ originalName: 'notes.txt', size: VALID_TEXT.length })
        ])
      }),
      expect.objectContaining({ requestId: expect.any(String) })
    );
  }, 10000);

  test('returns 503 and marks the course failed when the job bus is unavailable', async () => {
    publishAiJob.mockRejectedValue(
      Object.assign(new Error('broker down'), { code: 'EBROKERDOWN' })
    );

    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Queue Down Course')
      .field('subject_id', 'subj-1')
      .attach('files', VALID_PDF, { filename: 'notes.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/unavailable/);

    const instance = Course.instances[0];
    expect(instance.status).toBe('failed');
    expect(instance.warning).toMatch(/enqueued/);
  });
});

describe('INGEST-02 POST /api/v1/study/courses (size limits → 413)', () => {
  const { MAX_UPLOAD_MB } = require('@study-partner/shared/uploadValidation');

  beforeEach(() => {
    jest.clearAllMocks();
    Course.instances = [];
    Course.prototype = {}; // no-op safety
    Subject.findOne.mockResolvedValue({ _id: 'subj-1', userId: 'user-123' });
  });

  test(`rejects a single file over ${MAX_UPLOAD_MB}MB with 413`, async () => {
    const oversized = Buffer.alloc((MAX_UPLOAD_MB + 1) * 1024 * 1024, 0x25);

    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Oversized Course')
      .field('subject_id', 'subj-1')
      .attach('files', oversized, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(new RegExp(`${MAX_UPLOAD_MB}MB`));
    expect(Course).not.toHaveBeenCalled();
    expect(Course.instances).toHaveLength(0);
  }, 30000);

  test('leaves no residue on disk after a size-limit rejection', async () => {
    const fs = require('fs');
    const before = fs.readdirSync('uploads');
    const oversized = Buffer.alloc((MAX_UPLOAD_MB + 1) * 1024 * 1024, 0x41);

    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Oversized Course 2')
      .field('subject_id', 'subj-1')
      .attach('files', oversized, { filename: 'big.txt', contentType: 'text/plain' });

    expect(res.status).toBe(413);
    const after = fs.readdirSync('uploads');
    expect(after).toEqual(before);
  }, 30000);
});

describe('INGEST-03 POST /api/v1/study/courses (content-type allowlist → 415)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Course.instances = [];
    Course.prototype = {}; // no-op safety
    Subject.findOne.mockResolvedValue({ _id: 'subj-1', userId: 'user-123' });
  });

  test('rejects JSON-typed upload with 415 before any persistence', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .set('Content-Type', 'application/json')
      .send({ title: 'Bad', subject_id: 'subj-1' });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/multipart\/form-data/);
    expect(Course).not.toHaveBeenCalled();
    expect(Course.instances).toHaveLength(0);
  });

  test('rejects non-multipart re-ingest request with 415', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses/some-course/files')
      .set(authHeader())
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('file=not-a-file');

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/multipart\/form-data/);
  });
});

describe('INGEST-04 POST /api/v1/study/courses (polyglot/trailer/encryption → 422)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Course.instances = [];
    Course.prototype = {};
    Subject.findOne.mockResolvedValue({ _id: 'subj-1', userId: 'user-123' });
  });

  test('rejects a truncated PDF (no %%EOF trailer)', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Cut PDF')
      .field('subject_id', 'subj-1')
      .attach('files', Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'), {
        filename: 'cut.pdf',
        contentType: 'application/pdf'
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/trailer/);
    expect(Course.instances).toHaveLength(0);
  });

  test('rejects a polyglot PDF (payload after %%EOF)', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Polyglot')
      .field('subject_id', 'subj-1')
      .attach(
        'files',
        Buffer.concat([
          Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF'),
          Buffer.from('MZ\x90\x00payload')
        ]),
        { filename: 'sneaky.pdf', contentType: 'application/pdf' }
      );

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/polyglot/);
    expect(Course.instances).toHaveLength(0);
  });

  test('rejects an encrypted PDF with a clear message', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Locked')
      .field('subject_id', 'subj-1')
      .attach(
        'files',
        Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<< /Encrypt 9 0 R >>\n%%EOF'),
        { filename: 'locked.pdf', contentType: 'application/pdf' }
      );

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/encrypted/);
    expect(Course.instances).toHaveLength(0);
  });

  test('rejects a masked-binary text file', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Masked')
      .field('subject_id', 'subj-1')
      .attach('files', Buffer.concat([Buffer.from('hello\n'), Buffer.alloc(60, 0xff)]), {
        filename: 'masked.txt',
        contentType: 'text/plain'
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not readable text/);
    expect(Course.instances).toHaveLength(0);
  });
});

describe('INGEST-05 POST /api/v1/study/courses/:courseId/files (async re-ingest → 202)', () => {
  let reIngestCourse;
  beforeEach(() => {
    jest.clearAllMocks();
    Course.instances = [];
    Course.prototype = {};
    Subject.findOne.mockResolvedValue({ _id: 'subj-1', userId: 'user-123' });
    reIngestCourse = {
      _id: 'course-1',
      userId: 'user-123',
      title: 'Existing Course',
      subjectId: 'subj-1',
      files: [],
      status: 'completed',
      ingestError: 'stale failure from a previous run',
      save: jest.fn().mockResolvedValue(true)
    };
    Course.findOne.mockResolvedValue(reIngestCourse);
    publishAiJob.mockResolvedValue({ messageId: 'job-re', correlationId: 'corr-re' });
  });

  test('stages new files, enqueues a job and returns 202 immediately', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses/course-1/files')
      .set(authHeader())
      .attach('files', VALID_PDF, { filename: 'more.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe('job-re');
    expect(res.body.courseId).toBe('course-1');
    expect(res.body.status).toBe('processing');

    // INGEST-07: re-ingest re-points the job linkage and resets progress state.
    expect(reIngestCourse.jobId).toBe('job-re');
    expect(reIngestCourse.correlationId).toBe('corr-re');
    expect(reIngestCourse.ingestError).toBe('');
    expect(reIngestCourse.ingestProgress).toBe(0);

    expect(publishAiJob).toHaveBeenCalledWith(
      'study.ingest.course',
      'user-123',
      expect.objectContaining({
        courseId: 'course-1',
        fileRef: 'uploads/courses/course-1',
        files: expect.arrayContaining([
          expect.objectContaining({ originalName: 'more.pdf', size: VALID_PDF.length })
        ])
      }),
      expect.any(Object)
    );
  });

  test('returns 503 when re-ingest enqueue fails', async () => {
    publishAiJob.mockRejectedValue(new Error('broker down'));

    const res = await request(app)
      .post('/api/v1/study/courses/course-1/files')
      .set(authHeader())
      .attach('files', VALID_PDF, { filename: 'extra.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/unavailable/);
  });
});

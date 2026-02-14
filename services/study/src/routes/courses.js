const express = require('express');
const multer = require('multer');
const path = require('path');
const { Course, Subject } = require('../models');
const axios = require('axios');
const FormData = require('form-data');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per file
  fileFilter: (req, file, cb) => {
    // Allow PDF and text files
    if (
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'text/plain' ||
      file.originalname.toLowerCase().endsWith('.txt')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and text files are allowed'));
    }
  }
});

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

// Create a new course
router.post('/', upload.array('files', 10), async (req, res) => {
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

    // Send files to AI service for processing
    try {
      const formData = new FormData();

      // Add course data
      formData.append('course_title', title);
      formData.append('user_id', userId);
      formData.append('subject_id', subject_id);

      // Add files
      req.files.forEach((file) => {
        const fileBuffer = require('fs').readFileSync(file.path);
        formData.append('files', fileBuffer, {
          filename: file.originalname,
          contentType: file.mimetype,
          knownLength: file.size
        });
      });

      // Call AI service
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const aiResponse = await axios.post(`${aiServiceUrl}/api/ai/courses/ingest`, formData, {
        timeout: 300000 // 5 minutes timeout
      });

      console.log('AI service response:', JSON.stringify(aiResponse.data, null, 2));

      // Transform AI service topics format to match our schema
      const aiTopics = aiResponse.data.topics || [];
      const transformedTopics = aiTopics.map(topic => ({
        title: topic.title,
        subtopics: (topic.subtopics || []).map(sub => ({
          id: sub.id,
          title: sub.title,
          summary: sub.summary,
          key_concepts: sub.key_concepts || [],
          definitions: sub.definitions || [],
          formulas: sub.formulas || [],
          examples: sub.examples || [],
          tokenized_chunks: sub.tokenized_chunks || []
        }))
      }));

      // Update course with processed data
      course.topics = transformedTopics;
      course.aiCourseId = aiResponse.data.course_id; // Link to AI service course
      course.status = 'completed';
      course.processedAt = new Date();
      await course.save();

      console.log('Course saved with', transformedTopics.length, 'topics');

      // Clean up uploaded files
      req.files.forEach((file) => {
        try {
          require('fs').unlinkSync(file.path);
        } catch (err) {
          console.warn(`Failed to cleanup file ${file.path}:`, err);
        }
      });
    } catch (aiError) {
      console.error('❌ AI service error:', aiError.message);
      console.error('Error details:', aiError.response?.data || aiError);
      
      // Update course status to failed
      course.status = 'failed';
      course.processedAt = new Date();
      course.warning = `AI service processing failed: ${aiError.message}`;
      await course.save();
      
      // Clean up uploaded files
      req.files.forEach((file) => {
        try {
          require('fs').unlinkSync(file.path);
        } catch (err) {
          console.warn(`Failed to cleanup file ${file.path}:`, err);
        }
      });

      return res.status(500).json({
        error: 'Course processing failed',
        message: aiError.message,
        course: {
          id: course._id,
          title: course.title,
          status: 'failed'
        }
      });
    }

    return res.status(201).json({
      course: {
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
      }
    });
  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

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

// Delete a course
router.delete('/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const { user_id } = req.query;

    const course = await Course.findOneAndDelete({ _id: courseId, userId: user_id });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// Add files to an existing course
router.post('/:courseId/files', upload.array('files', 10), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required' });
    }

    // Find the course
    const course = await Course.findOne({ _id: courseId, userId: user_id });
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

    // Prepare all files for re-processing
    const allFiles = course.files
      .map((file) => {
        // For existing files, we need to check if they still exist or recreate them
        // For now, we'll only process the new files since old ones might be deleted
        // In a production system, you'd want to store files permanently
        const filePath = path.join('uploads', file.filename);
        if (require('fs').existsSync(filePath)) {
          return {
            path: filePath,
            originalname: file.originalName,
            mimetype: 'application/pdf' // Assume PDF for now
          };
        }
        return null;
      })
      .filter(Boolean);

    // Add the new uploaded files
    allFiles.push(...req.files);

    // Send all files to AI service for re-processing
    try {
      const formData = new FormData();

      // Add course data
      formData.append('course_title', course.title);
      formData.append('user_id', user_id);
      formData.append('subject_id', course.subjectId);

      // Add all files
      allFiles.forEach((file) => {
        const fileBuffer = require('fs').readFileSync(file.path);
        formData.append('files', fileBuffer, {
          filename: file.originalname || file.originalName,
          contentType: file.mimetype || 'application/pdf',
          knownLength: file.size
        });
      });

      // Call AI service
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const aiResponse = await axios.post(`${aiServiceUrl}/api/ai/courses/ingest`, formData, {
        timeout: 300000 // 5 minutes timeout
      });

      // Update course with re-processed data
      course.topics = aiResponse.data.topics || [];
      course.status = 'completed';
      course.processedAt = new Date();
      await course.save();

      // Clean up uploaded files
      req.files.forEach((file) => {
        try {
          require('fs').unlinkSync(file.path);
        } catch (err) {
          console.warn(`Failed to cleanup file ${file.path}:`, err);
        }
      });
    } catch (aiError) {
      course.status = 'failed';
      await course.save();

      return res.status(500).json({
        error: 'Files added but re-processing failed',
        course: {
          id: course._id.toString(),
          title: course.title,
          status: course.status,
          filesCount: course.files?.length || 0,
          files: course.files
        }
      });
    }

    return res.json({
      message: 'Files added and course re-processed successfully',
      course: {
        id: course._id.toString(),
        title: course.title,
        description: course.description,
        subjectId: course.subjectId,
        status: course.status,
        topics: course.topics,
        files: course.files,
        topicsCount: course.topics?.length || 0,
        filesCount: course.files?.length || 0,
        processedAt: course.processedAt,
        updatedAt: course.updatedAt
      }
    });
  } catch (error) {
    console.error('Error adding files to course:', error);
    res.status(500).json({ error: 'Failed to add files to course' });
  }
});

module.exports = router;

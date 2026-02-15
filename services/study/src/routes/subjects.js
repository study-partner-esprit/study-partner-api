const express = require('express');
const multer = require('multer');
const path = require('path');
const { Subject } = require('../models');
const axios = require('axios');

const router = express.Router();

// Configure multer for image uploads - use memoryStorage so we can store image data in DB
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Get all subjects for a user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;

    const subjects = await Subject.find({ userId }).sort({ createdAt: -1 });

    // Add course count for each subject
    const subjectsWithCount = await Promise.all(
      subjects.map(async (subject) => {
        const courseCount = await require('../models').Course.countDocuments({
          subjectId: subject._id.toString(),
          userId
        });
        return {
          id: subject._id.toString(),
          name: subject.name,
          description: subject.description,
          image: subject.image,
          color: subject.color,
          course_count: courseCount,
          createdAt: subject.createdAt,
          updatedAt: subject.updatedAt
        };
      })
    );

    res.json({ subjects: subjectsWithCount });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// Create a new subject
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Check if subject already exists for this user
    const existingSubject = await Subject.findOne({ name, userId });
    if (existingSubject) {
      return res.status(400).json({ error: 'Subject with this name already exists' });
    }

    // Handle image upload: convert to data URL and store in DB
    let imageUrl = null;
    if (req.file && req.file.buffer) {
      const mime = req.file.mimetype || 'application/octet-stream';
      const b64 = req.file.buffer.toString('base64');
      imageUrl = `data:${mime};base64,${b64}`;
    }

    const subject = new Subject({
      name,
      description,
      userId,
      image: imageUrl
    });

    await subject.save();

    res.status(201).json({
      subject: {
        id: subject._id.toString(),
        name: subject.name,
        description: subject.description,
        image: subject.image,
        color: subject.color,
        createdAt: subject.createdAt,
        updatedAt: subject.updatedAt
      }
    });
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ error: 'Failed to create subject' });
  }
});

// Get a specific subject
router.get('/:subjectId', async (req, res) => {
  try {
    const { subjectId } = req.params;
    const userId = req.user.userId;

    const subject = await Subject.findOne({ _id: subjectId, userId });

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Get course count
    const courseCount = await require('../models').Course.countDocuments({
      subjectId: subjectId,
      userId
    });

    res.json({
      subject: {
        id: subject._id.toString(),
        name: subject.name,
        description: subject.description,
        image: subject.image,
        color: subject.color,
        course_count: courseCount,
        createdAt: subject.createdAt,
        updatedAt: subject.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching subject:', error);
    res.status(500).json({ error: 'Failed to fetch subject' });
  }
});

// Update a subject
router.put('/:subjectId', upload.single('image'), async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { name, description } = req.body;
    const userId = req.user.userId;

    const subject = await Subject.findOne({ _id: subjectId, userId });

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Update fields
    if (name) subject.name = name;
    if (description !== undefined) subject.description = description;

    // Handle image upload: convert to data URL and store in DB
    if (req.file && req.file.buffer) {
      const mime = req.file.mimetype || 'application/octet-stream';
      const b64 = req.file.buffer.toString('base64');
      subject.image = `data:${mime};base64,${b64}`;
    }

    await subject.save();

    res.json({
      subject: {
        id: subject._id.toString(),
        name: subject.name,
        description: subject.description,
        image: subject.image,
        color: subject.color,
        createdAt: subject.createdAt,
        updatedAt: subject.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ error: 'Failed to update subject' });
  }
});

// Delete a subject
router.delete('/:subjectId', async (req, res) => {
  try {
    const { subjectId } = req.params;
    const userId = req.user.userId;

    const subject = await Subject.findOneAndDelete({ _id: subjectId, userId });

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Also delete all courses in this subject
    await require('../models').Course.deleteMany({ subjectId: subjectId, userId });

    res.json({ message: 'Subject and associated courses deleted successfully' });
  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({ error: 'Failed to delete subject' });
  }
});

module.exports = router;

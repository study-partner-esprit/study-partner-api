const express = require('express');
const Joi = require('joi');
const { StudySession } = require('../models');

const router = express.Router();

// Validation schema
const createSessionSchema = Joi.object({
  taskId: Joi.string().optional(),
  topicId: Joi.string().optional(),
  duration: Joi.number().required(),
  focusScore: Joi.number().min(0).max(100).optional(),
  notes: Joi.string().max(1000).optional()
});

// Get all sessions
router.get('/', async (req, res) => {
  const userId = req.user.userId;
  const { topicId, taskId, startDate, endDate } = req.query;
  
  const filter = { userId };
  if (topicId) filter.topicId = topicId;
  if (taskId) filter.taskId = taskId;
  if (startDate || endDate) {
    filter.completedAt = {};
    if (startDate) filter.completedAt.$gte = new Date(startDate);
    if (endDate) filter.completedAt.$lte = new Date(endDate);
  }
  
  const sessions = await StudySession.find(filter).sort({ completedAt: -1 });
  
  res.json({ sessions });
});

// Get session by ID
router.get('/:sessionId', async (req, res) => {
  const userId = req.user.userId;
  const { sessionId } = req.params;
  
  const session = await StudySession.findOne({ _id: sessionId, userId });
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({ session });
});

// Create session
router.post('/', async (req, res) => {
  const { error } = createSessionSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  
  const session = await StudySession.create({
    userId,
    ...req.body
  });
  
  res.status(201).json({ 
    message: 'Session created',
    session 
  });
});

// Get session statistics
router.get('/stats/summary', async (req, res) => {
  const userId = req.user.userId;
  const { startDate, endDate } = req.query;
  
  const filter = { userId };
  if (startDate || endDate) {
    filter.completedAt = {};
    if (startDate) filter.completedAt.$gte = new Date(startDate);
    if (endDate) filter.completedAt.$lte = new Date(endDate);
  }
  
  const sessions = await StudySession.find(filter);
  
  const totalSessions = sessions.length;
  const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);
  const avgFocusScore = sessions.length > 0 
    ? sessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / sessions.length 
    : 0;
  
  res.json({ 
    totalSessions,
    totalDuration,
    avgFocusScore: Math.round(avgFocusScore * 100) / 100
  });
});

module.exports = router;

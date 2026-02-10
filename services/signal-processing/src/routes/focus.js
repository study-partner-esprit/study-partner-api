const express = require('express');
const Joi = require('joi');
const FocusSession = require('../models/FocusSession');

const router = express.Router();

// Validation schemas
const startSessionSchema = Joi.object({
  studySessionId: Joi.string().optional()
});

const updateSessionSchema = Joi.object({
  focusLevel: Joi.number().min(0).max(100).required(),
  isDistracted: Joi.boolean().optional(),
  gazeData: Joi.object({
    x: Joi.number().optional(),
    y: Joi.number().optional()
  }).optional()
});

// Start focus tracking session
router.post('/start', async (req, res) => {
  const { error } = startSessionSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  const { studySessionId } = req.body;

  const session = await FocusSession.create({
    userId,
    studySessionId,
    startTime: new Date(),
    dataPoints: []
  });

  res.status(201).json({
    message: 'Focus tracking started',
    sessionId: session._id
  });
});

// Add focus data point
router.post('/:sessionId/data', async (req, res) => {
  const { error } = updateSessionSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  const { sessionId } = req.params;
  const { focusLevel, isDistracted, gazeData } = req.body;

  const session = await FocusSession.findOne({ _id: sessionId, userId });

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.endTime) {
    return res.status(400).json({ error: 'Session already ended' });
  }

  session.dataPoints.push({
    timestamp: new Date(),
    focusLevel,
    isDistracted: isDistracted || false,
    gazeData
  });

  await session.save();

  res.json({
    message: 'Data point added',
    currentFocusLevel: focusLevel
  });
});

// End focus tracking session
router.post('/:sessionId/end', async (req, res) => {
  const userId = req.user.userId;
  const { sessionId } = req.params;

  const session = await FocusSession.findOne({ _id: sessionId, userId });

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.endTime) {
    return res.status(400).json({ error: 'Session already ended' });
  }

  session.endTime = new Date();

  // Calculate summary
  const dataPoints = session.dataPoints;
  const totalPoints = dataPoints.length;

  if (totalPoints > 0) {
    const avgFocusLevel = dataPoints.reduce((sum, dp) => sum + dp.focusLevel, 0) / totalPoints;
    const focusedPoints = dataPoints.filter(dp => !dp.isDistracted).length;
    const distractedPoints = totalPoints - focusedPoints;
    
    const duration = (session.endTime - session.startTime) / 1000; // seconds
    const intervalDuration = duration / totalPoints;

    session.focusScore = Math.round(avgFocusLevel);
    session.summary = {
      totalFocusTime: Math.round(focusedPoints * intervalDuration),
      totalDistractedTime: Math.round(distractedPoints * intervalDuration),
      avgFocusLevel: Math.round(avgFocusLevel * 100) / 100,
      breakCount: 0 // TODO: detect breaks
    };
  }

  await session.save();

  res.json({
    message: 'Session ended',
    focusScore: session.focusScore,
    summary: session.summary
  });
});

// Get session details
router.get('/:sessionId', async (req, res) => {
  const userId = req.user.userId;
  const { sessionId } = req.params;

  const session = await FocusSession.findOne({ _id: sessionId, userId });

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({ session });
});

// Get user's recent focus sessions
router.get('/', async (req, res) => {
  const userId = req.user.userId;
  const { limit = 10 } = req.query;

  const sessions = await FocusSession.find({ userId })
    .sort({ startTime: -1 })
    .limit(parseInt(limit));

  res.json({ sessions });
});

// Get focus statistics
router.get('/stats/summary', async (req, res) => {
  const userId = req.user.userId;
  const { startDate, endDate } = req.query;

  const filter = { userId, endTime: { $exists: true } };
  if (startDate || endDate) {
    filter.startTime = {};
    if (startDate) filter.startTime.$gte = new Date(startDate);
    if (endDate) filter.startTime.$lte = new Date(endDate);
  }

  const sessions = await FocusSession.find(filter);

  const totalSessions = sessions.length;
  const avgFocusScore = sessions.length > 0
    ? sessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / sessions.length
    : 0;
  const totalFocusTime = sessions.reduce((sum, s) => sum + (s.summary?.totalFocusTime || 0), 0);

  res.json({
    totalSessions,
    avgFocusScore: Math.round(avgFocusScore * 100) / 100,
    totalFocusTime
  });
});

module.exports = router;

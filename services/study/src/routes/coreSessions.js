const express = require('express');
const { asyncHandler } = require('@study-partner/shared/middleware');
const Joi = require('joi');
const { StudySession } = require('../models');
const {
  processSessionCompletionRewards,
  trackAnalyticsEvent
} = require('../utils/gamificationService');

const router = express.Router();

// Validation schema
const createSessionSchema = Joi.object({
  taskId: Joi.string().allow('', null).optional(),
  topicId: Joi.string().allow('', null).optional(),
  selectedCharacterId: Joi.string().allow('', null).optional(),
  duration: Joi.number().optional(),
  status: Joi.string().valid('active', 'completed').optional(),
  startTime: Joi.date().optional(),
  endTime: Joi.date().optional(),
  focusScore: Joi.number().min(0).max(100).optional(),
  notes: Joi.string().max(1000).allow('', null).optional(),
  signalHistory: Joi.array()
    .items(
      Joi.object({
        timestamp: Joi.date().optional(),
        focusLevel: Joi.number().optional(),
        fatigueLevel: Joi.number().optional(),
        isDistracted: Joi.boolean().optional()
      })
    )
    .optional(),
  breakStats: Joi.object({
    totalBreaks: Joi.number().optional(),
    totalBreakDuration: Joi.number().optional(),
    avgBreakDuration: Joi.number().optional()
  }).optional()
});

// Update session schema
const updateSessionSchema = Joi.object({
  selectedCharacterId: Joi.string().allow('', null).optional(),
  duration: Joi.number().optional(),
  status: Joi.string().valid('active', 'completed').optional(),
  endTime: Joi.date().optional(),
  notes: Joi.string().optional(),
  focusScore: Joi.number().min(0).max(100).optional(),
  signalHistory: Joi.array()
    .items(
      Joi.object({
        timestamp: Joi.date().optional(),
        focusLevel: Joi.number().optional(),
        fatigueLevel: Joi.number().optional(),
        isDistracted: Joi.boolean().optional()
      })
    )
    .optional(),
  breakStats: Joi.object({
    totalBreaks: Joi.number().optional(),
    totalBreakDuration: Joi.number().optional(),
    avgBreakDuration: Joi.number().optional()
  }).optional()
});

// Get all sessions
router.get(
  '/',
  asyncHandler(async (req, res) => {
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
  })
);

// Get session by ID
router.get(
  '/:sessionId',
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { sessionId } = req.params;

    const session = await StudySession.findOne({ _id: sessionId, userId });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session });
  })
);

// Create session
router.post(
  '/',
  asyncHandler(async (req, res) => {
    console.log('Received session create request body:', req.body);
    const { error } = createSessionSchema.validate(req.body);
    if (error) {
      console.error('Session validation error:', error.details[0].message);
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.userId;

    const session = await StudySession.create({
      userId,
      status: req.body.duration ? 'completed' : 'active',
      ...req.body
    });

    res.status(201).json({
      message: 'Session created',
      session
    });
  })
);

// Update/End session
router.put(
  '/:sessionId',
  asyncHandler(async (req, res) => {
    const { error } = updateSessionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.userId;
    const { sessionId } = req.params;

    const session = await StudySession.findOne({ _id: sessionId, userId });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    Object.assign(session, req.body);

    // If completing, ensure end time and duration are set
    if (req.body.status === 'completed' && !session.duration && session.startTime) {
      session.endTime = new Date();
      const diffMs = session.endTime - session.startTime;
      session.duration = Math.round(diffMs / 60000); // Minutes
    }

    await session.save();

    // Award daily streak XP if the user studied yesterday too
    let completionRewards = null;
    if (req.body.status === 'completed') {
      completionRewards = await processSessionCompletionRewards({
        userId,
        session,
        authorization: req.headers.authorization
      });

      await trackAnalyticsEvent({
        authorization: req.headers.authorization,
        eventType: 'study_session_completed',
        metadata: {
          sessionId: session._id.toString(),
          duration: session.duration || 0,
          focusScore: session.focusScore || 0,
          completedTasks: session.taskProgress?.completedTasks || 0,
          totalTasks: session.taskProgress?.totalTasks || 0
        }
      });
    }

    res.json({
      message: 'Session updated',
      session,
      completionRewards
    });
  })
);

// Get session statistics
router.get(
  '/stats/summary',
  asyncHandler(async (req, res) => {
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
    const avgFocusScore =
      sessions.length > 0
        ? sessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / sessions.length
        : 0;

    res.json({
      totalSessions,
      totalDuration,
      avgFocusScore: Math.round(avgFocusScore * 100) / 100
    });
  })
);

module.exports = router;

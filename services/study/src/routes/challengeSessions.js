const express = require('express');
const Joi = require('joi');
const { StudySession } = require('../models');
const {
  processSessionCompletionRewards,
  trackAnalyticsEvent
} = require('../utils/gamificationService');

const router = express.Router();

const challengeStartSchema = Joi.object({
  challengeId: Joi.string().required(),
  courseId: Joi.string().allow('', null).optional(),
  topicId: Joi.string().allow('', null).optional(),
  selectedCharacterId: Joi.string().allow('', null).optional(),
  difficulty: Joi.string().valid('easy', 'medium', 'hard', 'expert').optional(),
  notes: Joi.string().max(1000).allow('', null).optional()
});

const challengeCompleteSchema = Joi.object({
  duration: Joi.number().optional(),
  endTime: Joi.date().optional(),
  focusScore: Joi.number().min(0).max(100).optional(),
  notes: Joi.string().max(1000).allow('', null).optional(),
  challengeDifficulty: Joi.string().valid('easy', 'medium', 'hard', 'expert').optional(),
  completedSuccessfully: Joi.boolean().optional()
});

// POST /challenge/start — Start a dedicated challenge session
router.post('/challenge/start', async (req, res) => {
  const { error } = challengeStartSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const userId = req.user.userId;
    const {
      challengeId,
      courseId = null,
      topicId = null,
      selectedCharacterId = null,
      difficulty = 'medium',
      notes = null
    } = req.body;

    const session = await StudySession.create({
      userId,
      taskId: challengeId,
      courseId,
      topicId,
      selectedCharacterId,
      mode: 'exam',
      type: 'solo',
      status: 'active',
      notes,
      challengeDifficulty: difficulty,
      startTime: new Date()
    });

    res.status(201).json({
      message: 'Challenge session started',
      session: {
        _id: session._id,
        challengeId: session.taskId,
        courseId: session.courseId,
        topicId: session.topicId,
        mode: session.mode,
        status: session.status,
        challengeDifficulty: session.challengeDifficulty,
        startTime: session.startTime
      }
    });
  } catch (challengeError) {
    console.error('Error starting challenge session:', challengeError);
    res.status(500).json({ error: 'Failed to start challenge session' });
  }
});

// GET /challenge/:sessionId — Get challenge session details
router.get('/challenge/:sessionId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      userId,
      mode: 'exam'
    });

    if (!session) {
      return res.status(404).json({ error: 'Challenge session not found' });
    }

    res.json({
      session: {
        _id: session._id,
        challengeId: session.taskId,
        courseId: session.courseId,
        topicId: session.topicId,
        mode: session.mode,
        type: session.type,
        status: session.status,
        duration: session.duration,
        focusScore: session.focusScore,
        startTime: session.startTime,
        endTime: session.endTime,
        challengeDifficulty: session.challengeDifficulty
      }
    });
  } catch (challengeError) {
    console.error('Error fetching challenge session:', challengeError);
    res.status(500).json({ error: 'Failed to fetch challenge session' });
  }
});

// PUT /challenge/:sessionId/complete — Complete challenge session and award challenge KP/XP
router.put('/challenge/:sessionId/complete', async (req, res) => {
  const { error } = challengeCompleteSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      userId,
      mode: 'exam'
    });

    if (!session) {
      return res.status(404).json({ error: 'Challenge session not found' });
    }

    const completedSuccessfully = req.body.completedSuccessfully !== false;
    Object.assign(session, req.body);
    session.mode = 'exam';
    session.status = 'completed';

    if (!session.endTime) {
      session.endTime = new Date();
    }

    if ((!session.duration || session.duration <= 0) && session.startTime && session.endTime) {
      const diffMs = new Date(session.endTime).getTime() - new Date(session.startTime).getTime();
      session.duration = Math.max(1, Math.round(diffMs / 60000));
    }

    await session.save();

    const completionRewards = completedSuccessfully
      ? await processSessionCompletionRewards({
          userId,
          session,
          authorization: req.headers.authorization
        })
      : null;

    if (completedSuccessfully) {
      await trackAnalyticsEvent({
        authorization: req.headers.authorization,
        eventType: 'study_session_completed',
        metadata: {
          sessionId: session._id.toString(),
          duration: session.duration || 0,
          focusScore: session.focusScore || 0,
          sessionType: 'challenge',
          challengeId: session.taskId || null,
          challengeDifficulty: session.challengeDifficulty || null
        }
      });
    }

    res.json({
      message: 'Challenge session completed',
      session,
      completionRewards
    });
  } catch (challengeError) {
    console.error('Error completing challenge session:', challengeError);
    res.status(500).json({ error: 'Failed to complete challenge session' });
  }
});

module.exports = router;

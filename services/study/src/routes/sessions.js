const express = require('express');
const Joi = require('joi');
const axios = require('axios');
const { StudySession } = require('../models');

const router = express.Router();

// Validation schema
const createSessionSchema = Joi.object({
  taskId: Joi.string().allow('', null).optional(),
  topicId: Joi.string().allow('', null).optional(),
  duration: Joi.number().optional(),
  status: Joi.string().valid('active', 'completed').optional(),
  startTime: Joi.date().optional(),
  endTime: Joi.date().optional(),
  focusScore: Joi.number().min(0).max(100).optional(),
  notes: Joi.string().max(1000).allow('', null).optional(),
  signalHistory: Joi.array().items(Joi.object({
    timestamp: Joi.date().optional(),
    focusLevel: Joi.number().optional(),
    fatigueLevel: Joi.number().optional(),
    isDistracted: Joi.boolean().optional()
  })).optional(),
  breakStats: Joi.object({
    totalBreaks: Joi.number().optional(),
    totalBreakDuration: Joi.number().optional(),
    avgBreakDuration: Joi.number().optional()
  }).optional()
});

// Update session schema
const updateSessionSchema = Joi.object({
  duration: Joi.number().optional(),
  status: Joi.string().valid('active', 'completed').optional(),
  endTime: Joi.date().optional(),
  notes: Joi.string().optional(),
  focusScore: Joi.number().min(0).max(100).optional(),
  signalHistory: Joi.array().items(Joi.object({
    timestamp: Joi.date().optional(),
    focusLevel: Joi.number().optional(),
    fatigueLevel: Joi.number().optional(),
    isDistracted: Joi.boolean().optional()
  })).optional(),
  breakStats: Joi.object({
    totalBreaks: Joi.number().optional(),
    totalBreakDuration: Joi.number().optional(),
    avgBreakDuration: Joi.number().optional()
  }).optional()
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
});

// Update/End session
router.put('/:sessionId', async (req, res) => {
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
  if (req.body.status === 'completed') {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const yesterdaySession = await StudySession.findOne({
        userId: req.user.userId,
        status: 'completed',
        createdAt: { $gte: yesterday, $lt: todayStart }
      });

      if (yesterdaySession) {
        const USER_PROFILE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://localhost:3002';
        await axios.post(`${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`, {
          action: 'daily_streak',
          metadata: { sessionId: session._id.toString() }
        }, {
          headers: { 'Authorization': req.headers.authorization }
        });
      }

      // Also award session_complete XP
      const USER_PROFILE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://localhost:3002';
      await axios.post(`${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`, {
        action: 'session_complete',
        metadata: { sessionId: session._id.toString(), duration: session.duration }
      }, {
        headers: { 'Authorization': req.headers.authorization }
      });

      // Progress quests
      await axios.post(`${USER_PROFILE_URL}/api/v1/users/quests/progress`, {
        action: 'study_session'
      }, {
        headers: { 'Authorization': req.headers.authorization }
      });
    } catch (xpErr) {
      console.warn('XP/streak award failed:', xpErr.message);
    }
  }

  res.json({
    message: 'Session updated',
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
  const avgFocusScore =
    sessions.length > 0
      ? sessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / sessions.length
      : 0;

  res.json({
    totalSessions,
    totalDuration,
    avgFocusScore: Math.round(avgFocusScore * 100) / 100
  });
});

// ==================== Team Session Endpoints ====================

const crypto = require('crypto');
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3007';

// POST /team — Create team session
router.post('/team', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { taskId, topicId, maxParticipants } = req.body;

    const inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char code

    const session = await StudySession.create({
      userId,
      taskId,
      topicId,
      type: 'team',
      status: 'active',
      inviteCode,
      maxParticipants: Math.min(maxParticipants || 5, 10),
      participants: [{
        userId,
        name: req.user.name || 'Host',
        role: 'host',
        joinedAt: new Date()
      }],
      startTime: new Date()
    });

    res.status(201).json({
      message: 'Team session created',
      session,
      inviteCode
    });
  } catch (error) {
    console.error('Error creating team session:', error);
    res.status(500).json({ error: 'Failed to create team session' });
  }
});

// POST /team/:sessionId/join — Join team session
router.post('/team/:sessionId/join', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { inviteCode } = req.body;
    const { sessionId } = req.params;

    const session = await StudySession.findOne({
      _id: sessionId,
      type: 'team',
      status: 'active'
    });

    if (!session) return res.status(404).json({ error: 'Team session not found' });
    if (session.inviteCode !== inviteCode) return res.status(403).json({ error: 'Invalid invite code' });
    if (session.participants.some(p => p.userId === userId && !p.leftAt)) {
      return res.status(409).json({ error: 'Already in this session' });
    }
    if (session.participants.filter(p => !p.leftAt).length >= session.maxParticipants) {
      return res.status(400).json({ error: 'Session is full' });
    }

    session.participants.push({
      userId,
      name: req.user.name || 'Member',
      role: 'member',
      joinedAt: new Date()
    });
    await session.save();

    // Notify host
    try {
      await axios.post(`${NOTIFICATION_URL}/api/v1/notifications`, {
        userId: session.userId,
        type: 'team_join',
        title: 'Someone joined your session',
        message: `A study partner joined your team session!`,
        metadata: { sessionId: session._id.toString() }
      }, { headers: { Authorization: req.headers.authorization } });
    } catch (err) { console.warn('Team join notification failed:', err.message); }

    res.json({ message: 'Joined team session', session });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// POST /team/:sessionId/leave — Leave team session
router.post('/team/:sessionId/leave', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({ _id: req.params.sessionId, type: 'team', status: 'active' });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const participant = session.participants.find(p => p.userId === userId && !p.leftAt);
    if (!participant) return res.status(404).json({ error: 'Not in this session' });

    participant.leftAt = new Date();
    await session.save();

    res.json({ message: 'Left team session' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave session' });
  }
});

// POST /team/:sessionId/invite — Invite friend
router.post('/team/:sessionId/invite', async (req, res) => {
  try {
    const session = await StudySession.findOne({ _id: req.params.sessionId, type: 'team', status: 'active' });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { friendId } = req.body;
    if (!friendId) return res.status(400).json({ error: 'friendId required' });

    // Send team invite notification
    try {
      await axios.post(`${NOTIFICATION_URL}/api/v1/notifications`, {
        userId: friendId,
        type: 'team_invite',
        title: 'Team Study Invite',
        message: 'You\'ve been invited to a team study session!',
        metadata: { sessionId: session._id.toString(), inviteCode: session.inviteCode }
      }, { headers: { Authorization: req.headers.authorization } });
    } catch (err) { console.warn('Team invite notification failed:', err.message); }

    res.json({ message: 'Invite sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// GET /team/:sessionId/participants — List participants
router.get('/team/:sessionId/participants', async (req, res) => {
  try {
    const session = await StudySession.findOne({ _id: req.params.sessionId, type: 'team' });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const participants = session.participants.map(p => ({
      userId: p.userId,
      name: p.name,
      avatar: p.avatar,
      role: p.role,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
      durationMinutes: p.leftAt
        ? Math.round((new Date(p.leftAt) - new Date(p.joinedAt)) / 60000)
        : Math.round((new Date() - new Date(p.joinedAt)) / 60000)
    }));

    res.json({ participants });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get participants' });
  }
});

// PUT /team/:sessionId/end — End team session (host only)
router.put('/team/:sessionId/end', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({ _id: req.params.sessionId, type: 'team', status: 'active' });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Only host can end
    if (session.userId !== userId) return res.status(403).json({ error: 'Only the host can end the session' });

    const now = new Date();
    session.status = 'completed';
    session.endTime = now;
    session.duration = Math.round((now - session.startTime) / 60000);

    // Set leftAt for all active participants
    session.participants.forEach(p => {
      if (!p.leftAt) p.leftAt = now;
    });

    await session.save();

    // Award XP to each participant
    const USER_PROFILE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://localhost:3002';
    for (const p of session.participants) {
      try {
        const action = p.role === 'host' ? 'team_session_host' : 'team_session';
        await axios.post(`${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`, {
          action,
          metadata: { sessionId: session._id.toString(), participantUserId: p.userId }
        }, { headers: { Authorization: req.headers.authorization } });
      } catch (err) { console.warn('Team XP award failed for', p.userId, err.message); }
    }

    res.json({ message: 'Team session ended', session });
  } catch (error) {
    res.status(500).json({ error: 'Failed to end session' });
  }
});

module.exports = router;

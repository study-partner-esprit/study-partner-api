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
        const USER_PROFILE_URL =
          process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
        await axios.post(
          `${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`,
          {
            action: 'daily_streak',
            metadata: { sessionId: session._id.toString() }
          },
          {
            headers: { Authorization: req.headers.authorization }
          }
        );
      }

      // Also award session_complete XP
      const USER_PROFILE_URL =
        process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
      await axios.post(
        `${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`,
        {
          action: 'session_complete',
          metadata: { sessionId: session._id.toString(), duration: session.duration }
        },
        {
          headers: { Authorization: req.headers.authorization }
        }
      );

      // Progress quests
      await axios.post(
        `${USER_PROFILE_URL}/api/v1/users/quests/progress`,
        {
          action: 'study_session'
        },
        {
          headers: { Authorization: req.headers.authorization }
        }
      );
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

// ==================== Session Setup & Task Progression ====================

const { Course, StudyPlan, Task } = require('../models');

// Utility: check if a string looks like a MongoDB ObjectId
const isObjectId = (str) => /^[a-f\d]{24}$/i.test(str);

const DEFAULT_TASK_ESTIMATED_MINUTES = 30;
const MIN_TASK_COMPLETION_RATIO = 0.8;

const getCurrentTaskTimingGate = (session, currentTask) => {
  const estimatedMinutesRaw = Number(currentTask?.estimatedMinutes);
  const estimatedMinutes =
    Number.isFinite(estimatedMinutesRaw) && estimatedMinutesRaw > 0
      ? estimatedMinutesRaw
      : DEFAULT_TASK_ESTIMATED_MINUTES;

  const startedAt = currentTask?.startedAt || session?.startTime || session?.createdAt;
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : Date.now();
  const nowMs = Date.now();
  const elapsedMs = Math.max(0, nowMs - startedAtMs);

  const minRequiredMs = Math.floor(estimatedMinutes * 60 * 1000 * MIN_TASK_COMPLETION_RATIO);
  const canAdvance = elapsedMs >= minRequiredMs;

  return {
    canAdvance,
    estimatedMinutes,
    elapsedMs,
    minRequiredMs,
    remainingMs: Math.max(0, minRequiredMs - elapsedMs)
  };
};

// POST /setup — Initialize a course-based study session
router.post('/setup', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { courseId, studyPlanId, mode } = req.body;

    if (!courseId) return res.status(400).json({ error: 'courseId is required' });

    // Load the course to get tasks/topics
    const course = await Course.findOne({ _id: courseId, userId });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    // Build task list from study plan tasks or course topics
    let tasks = [];

    if (studyPlanId) {
      const plan = await StudyPlan.findOne({ _id: studyPlanId, userId });
      if (plan && plan.taskGraph && plan.taskGraph.tasks) {
        // Fetch Task documents linked to this plan so we can sync completion later
        const planTaskDocs = await Task.find({
          studyPlanId: studyPlanId.toString(),
          userId
        }).lean();

        tasks = plan.taskGraph.tasks.map((t, index) => {
          // Try to match by title (tasks are created in the same order as taskGraph.tasks)
          const matchedDoc = planTaskDocs[index] || planTaskDocs.find((d) => d.title === t.title);
          return {
            taskId: matchedDoc ? matchedDoc._id.toString() : t.id || `task-${index}`,
            title: t.title,
            description: t.description || '',
            estimatedMinutes: Number(
              t.estimated_minutes ||
                t.estimatedTime ||
                matchedDoc?.estimatedTime ||
                DEFAULT_TASK_ESTIMATED_MINUTES
            ),
            status: 'pending',
            xpEarned: 0
          };
        });
      }
    }

    // Fallback: generate tasks from course topics/subtopics
    if (tasks.length === 0 && course.topics) {
      course.topics.forEach((topic, tIdx) => {
        if (topic.subtopics && topic.subtopics.length > 0) {
          topic.subtopics.forEach((sub, sIdx) => {
            tasks.push({
              taskId: sub.id || `t${tIdx}-s${sIdx}`,
              title: sub.title || `${topic.title} - Part ${sIdx + 1}`,
              description: sub.summary || '',
              estimatedMinutes: DEFAULT_TASK_ESTIMATED_MINUTES,
              status: 'pending',
              xpEarned: 0
            });
          });
        } else {
          tasks.push({
            taskId: `topic-${tIdx}`,
            title: topic.title,
            description: '',
            estimatedMinutes: DEFAULT_TASK_ESTIMATED_MINUTES,
            status: 'pending',
            xpEarned: 0
          });
        }
      });
    }

    if (tasks.length > 0) {
      tasks[0].status = 'in-progress';
      tasks[0].startedAt = new Date();
    }

    const session = await StudySession.create({
      userId,
      courseId,
      studyPlanId,
      mode: mode || 'focus',
      status: 'active',
      type: 'solo',
      startTime: new Date(),
      taskProgress: {
        currentTaskIndex: 0,
        tasks,
        totalTasks: tasks.length,
        completedTasks: 0
      },
      xpMultiplier: 1.0
    });

    res.status(201).json({
      message: 'Session setup complete',
      session: {
        _id: session._id,
        courseId: session.courseId,
        mode: session.mode,
        type: session.type,
        status: session.status,
        taskProgress: session.taskProgress,
        xpMultiplier: session.xpMultiplier
      }
    });
  } catch (error) {
    console.error('Error setting up session:', error);
    res.status(500).json({ error: 'Failed to setup session' });
  }
});

// POST /:sessionId/task/complete — Complete current task and move to next
router.post('/:sessionId/task/complete', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;

    const session = await StudySession.findOne({ _id: sessionId, status: 'active' });
    if (!session) return res.status(404).json({ error: 'Active session not found' });

    // Allow host or the session owner
    const isParticipant =
      session.userId === userId ||
      session.participants?.some((p) => p.userId === userId && !p.leftAt);
    if (!isParticipant && session.userId !== userId) {
      return res.status(403).json({ error: 'Not a participant in this session' });
    }

    const { taskProgress } = session;
    if (!taskProgress || !taskProgress.tasks || taskProgress.tasks.length === 0) {
      return res.status(400).json({ error: 'No tasks in this session' });
    }

    const currentIndex = taskProgress.currentTaskIndex;
    if (currentIndex >= taskProgress.tasks.length) {
      return res.status(400).json({ error: 'All tasks already completed' });
    }

    const currentTask = taskProgress.tasks[currentIndex];
    const timingGate = getCurrentTaskTimingGate(session, currentTask);
    if (!timingGate.canAdvance) {
      return res.status(409).json({
        error: 'Task cannot be completed yet. Complete at least 80% of task time first.',
        code: 'TASK_MIN_TIME_NOT_REACHED',
        minCompletionRatio: MIN_TASK_COMPLETION_RATIO,
        estimatedMinutes: timingGate.estimatedMinutes,
        remainingSeconds: Math.ceil(timingGate.remainingMs / 1000)
      });
    }

    // Mark current task as completed
    const baseXP = 15;
    const xpEarned = Math.round(baseXP * (session.xpMultiplier || 1.0));

    const completedTaskId = taskProgress.tasks[currentIndex].taskId;
    taskProgress.tasks[currentIndex].status = 'completed';
    taskProgress.tasks[currentIndex].completedAt = new Date();
    taskProgress.tasks[currentIndex].xpEarned = xpEarned;
    taskProgress.completedTasks += 1;

    // Move to next task
    if (currentIndex + 1 < taskProgress.tasks.length) {
      taskProgress.currentTaskIndex = currentIndex + 1;
      taskProgress.tasks[currentIndex + 1].status = 'in-progress';
      taskProgress.tasks[currentIndex + 1].startedAt = new Date();
    }

    session.markModified('taskProgress');
    await session.save();

    // Sync completion back to the Task collection if taskId is a real MongoDB ObjectId
    if (completedTaskId && isObjectId(completedTaskId)) {
      Task.findOneAndUpdate(
        { _id: completedTaskId, userId: session.userId },
        { status: 'completed', completedAt: new Date() }
      ).catch((err) => console.warn('Task sync failed:', err.message));
    }

    const allDone = taskProgress.completedTasks >= taskProgress.totalTasks;

    res.json({
      message: allDone ? 'All tasks completed!' : 'Task completed',
      currentTaskIndex: taskProgress.currentTaskIndex,
      completedTasks: taskProgress.completedTasks,
      totalTasks: taskProgress.totalTasks,
      xpEarned,
      allTasksComplete: allDone,
      nextTask: allDone ? null : taskProgress.tasks[taskProgress.currentTaskIndex]
    });
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// POST /:sessionId/task/skip — Skip current task
router.post('/:sessionId/task/skip', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await StudySession.findOne({ _id: sessionId, status: 'active' });
    if (!session) return res.status(404).json({ error: 'Active session not found' });

    const { taskProgress } = session;
    const currentIndex = taskProgress.currentTaskIndex;

    if (currentIndex >= taskProgress.tasks.length) {
      return res.status(400).json({ error: 'No more tasks to skip' });
    }

    const currentTask = taskProgress.tasks[currentIndex];
    const timingGate = getCurrentTaskTimingGate(session, currentTask);
    if (!timingGate.canAdvance) {
      return res.status(409).json({
        error: 'Task cannot be skipped yet. Complete at least 80% of task time first.',
        code: 'TASK_MIN_TIME_NOT_REACHED',
        minCompletionRatio: MIN_TASK_COMPLETION_RATIO,
        estimatedMinutes: timingGate.estimatedMinutes,
        remainingSeconds: Math.ceil(timingGate.remainingMs / 1000)
      });
    }

    taskProgress.tasks[currentIndex].status = 'skipped';
    taskProgress.tasks[currentIndex].completedAt = new Date();

    if (currentIndex + 1 < taskProgress.tasks.length) {
      taskProgress.currentTaskIndex = currentIndex + 1;
      taskProgress.tasks[currentIndex + 1].status = 'in-progress';
      taskProgress.tasks[currentIndex + 1].startedAt = new Date();
    }

    session.markModified('taskProgress');
    await session.save();

    const allDone = currentIndex + 1 >= taskProgress.tasks.length;

    res.json({
      message: 'Task skipped',
      currentTaskIndex: taskProgress.currentTaskIndex,
      allTasksComplete: allDone,
      nextTask: allDone ? null : taskProgress.tasks[taskProgress.currentTaskIndex]
    });
  } catch (error) {
    console.error('Error skipping task:', error);
    res.status(500).json({ error: 'Failed to skip task' });
  }
});

// ==================== Team Session Endpoints ====================

const crypto = require('crypto');
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3007';

// POST /team — Create team session
router.post('/team', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { taskId, topicId, courseId, studyPlanId, mode, maxParticipants } = req.body;

    const inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase();

    // Build task list from course if provided
    const tasks = [];
    if (courseId) {
      const course = await Course.findOne({ _id: courseId });
      if (course && course.topics) {
        course.topics.forEach((topic, tIdx) => {
          if (topic.subtopics && topic.subtopics.length > 0) {
            topic.subtopics.forEach((sub, sIdx) => {
              tasks.push({
                taskId: sub.id || `t${tIdx}-s${sIdx}`,
                title: sub.title || `${topic.title} - Part ${sIdx + 1}`,
                description: sub.summary || '',
                estimatedMinutes: DEFAULT_TASK_ESTIMATED_MINUTES,
                status: 'pending',
                xpEarned: 0
              });
            });
          } else {
            tasks.push({
              taskId: `topic-${tIdx}`,
              title: topic.title,
              description: '',
              estimatedMinutes: DEFAULT_TASK_ESTIMATED_MINUTES,
              status: 'pending',
              xpEarned: 0
            });
          }
        });
      }
    }

    if (tasks.length > 0) {
      tasks[0].status = 'in-progress';
      tasks[0].startedAt = new Date();
    }

    const session = await StudySession.create({
      userId,
      taskId,
      topicId,
      courseId,
      studyPlanId,
      mode: mode || 'focus',
      type: 'team',
      status: 'active',
      inviteCode,
      maxParticipants: Math.min(maxParticipants || 4, 4),
      participants: [
        {
          userId,
          name: req.user.name || 'Host',
          role: 'host',
          joinedAt: new Date()
        }
      ],
      startTime: new Date(),
      taskProgress:
        tasks.length > 0
          ? {
              currentTaskIndex: 0,
              tasks,
              totalTasks: tasks.length,
              completedTasks: 0
            }
          : undefined,
      xpMultiplier: 1.0 // Will be updated when session starts based on team size
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
    if (session.inviteCode !== inviteCode)
      return res.status(403).json({ error: 'Invalid invite code' });
    if (session.participants.some((p) => p.userId === userId && !p.leftAt)) {
      return res.status(409).json({ error: 'Already in this session' });
    }
    if (session.participants.filter((p) => !p.leftAt).length >= session.maxParticipants) {
      return res.status(400).json({ error: 'Session is full' });
    }

    session.participants.push({
      userId,
      name: req.user.name || 'Member',
      role: 'member',
      joinedAt: new Date()
    });

    // Update XP multiplier based on team size
    const activeCount = session.participants.filter((p) => !p.leftAt).length;
    const multipliers = { 1: 1.0, 2: 1.15, 3: 1.2, 4: 1.25 };
    session.xpMultiplier = multipliers[Math.min(activeCount, 4)] || 1.25;

    await session.save();

    // Notify host
    try {
      await axios.post(
        `${NOTIFICATION_URL}/api/v1/notifications`,
        {
          userId: session.userId,
          type: 'team_join',
          title: 'Someone joined your session',
          message: `A study partner joined your team session!`,
          metadata: { sessionId: session._id.toString() }
        },
        { headers: { Authorization: req.headers.authorization } }
      );
    } catch (err) {
      console.warn('Team join notification failed:', err.message);
    }

    res.json({ message: 'Joined team session', session });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// POST /team/join-by-code — Join session using invite code only (no sessionId needed)
router.post('/team/join-by-code', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { inviteCode } = req.body;

    if (!inviteCode) return res.status(400).json({ error: 'inviteCode is required' });

    const session = await StudySession.findOne({
      inviteCode: inviteCode.toUpperCase(),
      type: 'team',
      status: 'active'
    });

    if (!session)
      return res.status(404).json({ error: 'No active session found with that invite code' });
    if (session.participants.some((p) => p.userId === userId && !p.leftAt)) {
      return res.status(409).json({ error: 'Already in this session' });
    }
    if (session.participants.filter((p) => !p.leftAt).length >= session.maxParticipants) {
      return res.status(400).json({ error: 'Session is full' });
    }

    session.participants.push({
      userId,
      name: req.user.name || 'Member',
      role: 'member',
      joinedAt: new Date()
    });

    const activeCount = session.participants.filter((p) => !p.leftAt).length;
    const multipliers = { 1: 1.0, 2: 1.15, 3: 1.2, 4: 1.25 };
    session.xpMultiplier = multipliers[Math.min(activeCount, 4)] || 1.25;

    await session.save();

    // Notify host
    try {
      await axios.post(
        `${NOTIFICATION_URL}/api/v1/notifications`,
        {
          userId: session.userId,
          type: 'team_join',
          title: 'Someone joined your session',
          message: `A study partner joined your team session!`,
          metadata: { sessionId: session._id.toString() }
        },
        { headers: { Authorization: req.headers.authorization } }
      );
    } catch (err) {
      console.warn('Team join notification failed:', err.message);
    }

    res.json({
      message: 'Joined team session',
      session,
      sessionId: session._id.toString(),
      inviteCode: session.inviteCode
    });
  } catch (error) {
    console.error('Error joining by code:', error);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// POST /team/:sessionId/leave — Leave team session
router.post('/team/:sessionId/leave', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      type: 'team',
      status: 'active'
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const participant = session.participants.find((p) => p.userId === userId && !p.leftAt);
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
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      type: 'team',
      status: 'active'
    });
    if (!session) {
      console.warn(`[Team Invite] Session not found: ${req.params.sessionId}`);
      return res.status(404).json({ error: 'Session not found' });
    }

    const { friendId } = req.body;
    if (!friendId) {
      console.warn('[Team Invite] friendId not provided in request body');
      return res.status(400).json({ error: 'friendId required' });
    }

    console.log(`[Team Invite] Inviting ${friendId} to session ${session._id}`);

    // Lookup inviter nickname and course title for a personalised notification
    let inviterName = 'A friend';
    let courseName = null;
    try {
      const USER_PROFILE_URL =
        process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
      const profileRes = await axios.get(`${USER_PROFILE_URL}/api/v1/users/profile`, {
        headers: { Authorization: req.headers.authorization }
      });
      inviterName = profileRes.data?.nickname || profileRes.data?.profile?.nickname || inviterName;
    } catch (_e) {
      /* best-effort */
    }
    if (session.courseId) {
      try {
        const { Course } = require('../models');
        const course = await Course.findById(session.courseId).select('title').lean();
        if (course) courseName = course.title;
      } catch (_e) {
        /* best-effort */
      }
    }

    // Send team invite notification
    try {
      const notificationPayload = {
        userId: friendId,
        type: 'team_invite',
        title: 'Game Room Invite',
        message: `${inviterName} invited you to join a Game Room!`,
        metadata: {
          sessionId: session._id.toString(),
          inviteCode: session.inviteCode,
          inviterName,
          ...(courseName && { courseName })
        }
      };

      console.log('[Team Invite] Sending notification:', notificationPayload);

      await axios.post(`${NOTIFICATION_URL}/api/v1/notifications`, notificationPayload, {
        headers: { Authorization: req.headers.authorization }
      });

      console.log(`[Team Invite] Notification sent successfully to ${friendId}`);
    } catch (err) {
      console.warn('Team invite notification failed:', err.message, err.response?.data);
    }

    res.json({ message: 'Invite sent' });
  } catch (error) {
    console.error('[Team Invite] Error:', error);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// PUT /team/:sessionId/start — Leader starts the session for everyone
router.put('/team/:sessionId/start', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      type: 'team',
      status: 'active'
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.userId !== userId)
      return res.status(403).json({ error: 'Only the session leader can start' });

    // Broadcast session_start to all active participants (including leader)
    const activeUserIds = session.participants.filter((p) => !p.leftAt).map((p) => p.userId);

    // Also include the host if not already in participants list
    if (!activeUserIds.includes(userId)) activeUserIds.push(userId);

    try {
      await axios.post(
        `${NOTIFICATION_URL}/api/v1/notifications/broadcast`,
        {
          userIds: activeUserIds,
          payload: {
            type: 'session_start',
            sessionId: session._id.toString(),
            inviteCode: session.inviteCode
          }
        },
        { headers: { Authorization: req.headers.authorization } }
      );
    } catch (err) {
      console.warn('[Team Start] Broadcast failed:', err.message);
    }

    res.json({ message: 'Session started', sessionId: session._id.toString() });
  } catch (error) {
    console.error('[Team Start] Error:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// GET /team/:sessionId/participants — List participants
router.get('/team/:sessionId/participants', async (req, res) => {
  try {
    const session = await StudySession.findOne({ _id: req.params.sessionId, type: 'team' });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const participants = session.participants.map((p) => ({
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
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      type: 'team',
      status: 'active'
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Only host can end
    if (session.userId !== userId)
      return res.status(403).json({ error: 'Only the host can end the session' });

    const now = new Date();
    session.status = 'completed';
    session.endTime = now;
    session.duration = Math.round((now - session.startTime) / 60000);

    // Set leftAt for all active participants
    session.participants.forEach((p) => {
      if (!p.leftAt) p.leftAt = now;
    });

    await session.save();

    // Award XP to each participant
    const USER_PROFILE_URL =
      process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
    for (const p of session.participants) {
      try {
        const action = p.role === 'host' ? 'team_session_host' : 'team_session';
        await axios.post(
          `${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`,
          {
            action,
            metadata: { sessionId: session._id.toString(), participantUserId: p.userId }
          },
          { headers: { Authorization: req.headers.authorization } }
        );
      } catch (err) {
        console.warn('Team XP award failed for', p.userId, err.message);
      }
    }

    res.json({ message: 'Team session ended', session });
  } catch (error) {
    res.status(500).json({ error: 'Failed to end session' });
  }
});

module.exports = router;

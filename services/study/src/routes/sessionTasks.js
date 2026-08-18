const express = require('express');
const axios = require('axios');
const { StudySession, Course, StudyPlan, Task } = require('../models');
const {
  buildInternalHeaders,
  getAxiosErrorDetails,
  isObjectId
} = require('../utils/sessionHelpers');
const { trackAnalyticsEvent } = require('../utils/gamificationService');

const router = express.Router();

const USER_PROFILE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
const BYPASS_TASK_TIMING_GATE =
  String(process.env.BYPASS_TASK_TIMING_GATE || '').toLowerCase() === 'true' ||
  String(process.env.NODE_ENV || '').toLowerCase() === 'test';

const DEFAULT_TASK_ESTIMATED_MINUTES = 30;
const MIN_TASK_COMPLETION_RATIO = 0.8;

const getCurrentTaskTimingGate = (session, currentTask) => {
  const estimatedMinutesRaw = Number(currentTask?.estimatedMinutes);
  const estimatedMinutes =
    Number.isFinite(estimatedMinutesRaw) && estimatedMinutesRaw > 0
      ? estimatedMinutesRaw
      : DEFAULT_TASK_ESTIMATED_MINUTES;

  if (BYPASS_TASK_TIMING_GATE) {
    return {
      canAdvance: true,
      estimatedMinutes,
      elapsedMs: 0,
      minRequiredMs: 0,
      remainingMs: 0,
      bypassed: true
    };
  }

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
    const { courseId, studyPlanId, mode, selectedCharacterId = null } = req.body;

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
      selectedCharacterId,
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

    // Auto-award XP on task completion during study session
    try {
      const priorityMap = {
        easy: 'task_complete_easy',
        medium: 'task_complete_medium',
        hard: 'task_complete_hard',
        expert: 'task_complete_hard'
      };
      const action = priorityMap[session.challengeDifficulty] || 'task_complete_medium';
      await axios.post(
        `${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`,
        {
          action,
          metadata: {
            taskId: completedTaskId ? completedTaskId.toString() : undefined,
            taskIndex: currentIndex,
            sessionId: session._id.toString(),
            title: taskProgress.tasks[currentIndex]?.title
          }
        },
        {
          headers: buildInternalHeaders(req.headers.authorization)
        }
      );
      // Progress quests
      await axios.post(
        `${USER_PROFILE_URL}/api/v1/users/quests/progress`,
        {
          action: 'task_complete'
        },
        {
          headers: buildInternalHeaders(req.headers.authorization)
        }
      );
    } catch (xpErr) {
      console.warn('[Session Task Complete] XP/Quest award failed:', getAxiosErrorDetails(xpErr));
    }

    await trackAnalyticsEvent({
      authorization: req.headers.authorization,
      eventType: 'task_completed',
      metadata: {
        sessionId: session._id.toString(),
        taskId: completedTaskId ? completedTaskId.toString() : null,
        taskIndex: currentIndex,
        taskTitle: taskProgress.tasks[currentIndex]?.title,
        xpEarned
      }
    });

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

module.exports = router;

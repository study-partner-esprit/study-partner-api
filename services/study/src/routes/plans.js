const express = require('express');
const Joi = require('joi');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { StudyPlan, Task, Course } = require('../models');
const { getWeakCompetenciesForCourse } = require('../services/competencyQueries');
const { tierGate } = require('@study-partner/shared/tierGate');
const { logger } = require('@study-partner/shared');

const router = express.Router();

// Ensure indexes on the raw calendar collection (idempotent)
mongoose.connection.once('open', () => {
  const cal = mongoose.connection.collection('calendar');
  cal.createIndex({ userId: 1, startTime: 1 }, { background: true }).catch(() => {});
  cal.createIndex({ userId: 1, taskId: 1, source: 1 }, { background: true }).catch(() => {});
});

// Validation schemas
const createPlanSchema = Joi.object({
  goal: Joi.string().required(),
  availableTimeMinutes: Joi.number().min(30).required(),
  courseId: Joi.string().optional(),
  startDate: Joi.date().optional()
});

const schedulePlanSchema = Joi.object({
  calendarEvents: Joi.array().items(Joi.object()).optional(),
  maxMinutesPerDay: Joi.number().min(30).max(480).optional(),
  allowLateNight: Joi.boolean().optional()
});

// Create study plan from goal (AI-powered) — PLAN-08: async via job bus
router.post('/create', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  try {
    const { error } = createPlanSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.userId;
    const { goal, availableTimeMinutes, courseId } = req.body;

    if (!courseId) {
      return res.status(400).json({ error: 'courseId is required for plan generation' });
    }

    let course;
    try {
      course = await Course.findOne({ _id: courseId, userId });
    } catch (err) {
      return res.status(400).json({ error: 'Invalid course ID format' });
    }
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (course.status !== 'completed') {
      return res.status(400).json({
        error: 'Course is still being processed. Please wait until processing is complete.'
      });
    }

    const correlationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const requestId = req.get('X-Request-ID') || `req-${Date.now()}`;

    // BLOOM-10: weakest-first targeting input for the planner. Fetched from the
    // user's competency profile scoped to this course; [] degrades gracefully.
    let weakCompetencies = [];
    try {
      weakCompetencies = await getWeakCompetenciesForCourse(userId, courseId);
    } catch (err) {
      logger.warn('plan_weak_competencies_fetch_failed', { error: err.message });
    }

    // Call the orchestrator's POST /jobs route — it creates the AiJob
    // (for result correlation) AND publishes to the bus in one shot.
    const axios = require('axios');
    const orchestratorUrl = process.env.AI_ORCHESTRATOR_URL || 'http://localhost:3001';

    let jobResponse;
    try {
      jobResponse = await axios.post(
        `${orchestratorUrl}/api/v1/ai/jobs`,
        {
          type: 'study.plan.generate',
          payload: {
            goal,
            available_minutes: availableTimeMinutes,
            courseId: courseId || undefined,
            concepts: [],
            weak_competencies: weakCompetencies
          }
        },
        {
          headers: {
            Authorization: req.headers.authorization,
            'X-Request-ID': requestId
          },
          timeout: 10000
        }
      );
    } catch (err) {
      logger.error('orchestrator_job_create_failed', {
        status: err.response?.status,
        error: err.message
      });
      return res.status(503).json({ error: 'AI job bus unavailable, retry later' });
    }

    const { jobId, correlationId: cid } = jobResponse.data;

    logger.info('plan_job_published', { userId, courseId, jobId, correlationId: cid });

    return res.status(202).json({
      status: 'processing',
      jobId,
      correlationId: cid,
      message: 'Plan generation started. Poll /api/v1/ai/jobs/:jobId for completion.'
    });
  } catch (err) {
    logger.error('plan_create_failed', { error: err.message });
    return res.status(503).json({ error: 'AI job bus unavailable, retry later' });
  }
});

// Finalise a plan once the job is COMPLETED — persists StudyPlan + Tasks
router.post('/create-status', async (req, res) => {
  try {
    const { correlationId } = req.body || {};
    if (!correlationId) {
      return res.status(400).json({ error: 'correlationId is required' });
    }

    // Read the AiJob directly via the study service's mongoose connection
    const aiJobsColl = mongoose.connection.collection('ai_jobs');
    const job = await aiJobsColl.findOne({ correlationId });

    if (!job) return res.status(404).json({ error: 'job not found' });
    if (job.status === 'PENDING' || job.status === 'PROCESSING' || job.status === 'RETRYING') {
      return res.status(202).json({ status: job.status, message: 'Job still in progress' });
    }
    if (job.status === 'FAILED') {
      return res.status(500).json({ error: 'Plan generation failed', details: job.error });
    }

    // COMPLETED — persist StudyPlan
    const planPayload = job.result || {};
    const taskGraph = planPayload.task_graph || { goal: '', tasks: [] };
    const goal = taskGraph.goal || '';
    const totalEstimatedMinutes = (taskGraph.tasks || []).reduce(
      (sum, t) => sum + (t.estimated_minutes || 0),
      0
    );

    const studyPlan = await StudyPlan.create({
      userId: job.userId,
      courseId: null,
      goal,
      availableTimeMinutes: totalEstimatedMinutes,
      taskGraph,
      totalEstimatedMinutes,
      warning: planPayload.warning || null,
      status: 'created'
    });

    const createdTasks = [];
    for (const taskData of taskGraph.tasks || []) {
      const task = await Task.create({
        userId: job.userId,
        studyPlanId: studyPlan._id.toString(),
        title: taskData.title,
        description: taskData.description,
        priority: taskData.difficulty < 0.4 ? 'low' : taskData.difficulty < 0.7 ? 'medium' : 'high',
        estimatedTime: taskData.estimated_minutes,
        tags: [goal.substring(0, 50)],
        status: 'todo',
        objectiveId: taskData.objective_id || undefined,
        targetBloomLevel: taskData.target_bloom_level || undefined
      });
      createdTasks.push(task);
    }

    logger.info('plan_finalised', {
      userId: job.userId,
      planId: studyPlan._id.toString(),
      fallbackUsed: planPayload.fallbackUsed || false
    });

    return res.status(201).json({
      message: 'Study plan finalised',
      plan: {
        id: studyPlan._id.toString(),
        userId: studyPlan.userId,
        goal: studyPlan.goal,
        availableTimeMinutes: studyPlan.availableTimeMinutes,
        totalEstimatedMinutes: studyPlan.totalEstimatedMinutes,
        tasksCount: createdTasks.length,
        status: studyPlan.status,
        warning: studyPlan.warning,
        fallbackUsed: planPayload.fallbackUsed || false,
        taskGraph: studyPlan.taskGraph,
        createdAt: studyPlan.createdAt
      },
      tasks: createdTasks
    });
  } catch (err) {
    logger.error('plan_finalize_failed', { error: err.message });
    res.status(500).json({ error: 'Failed to finalise study plan' });
  }
});

// Get all study plans for user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, courseId } = req.query;

    const filter = { userId };
    if (status) filter.status = status;
    if (courseId) filter.courseId = courseId;

    const plans = await StudyPlan.find(filter).sort({ createdAt: -1 }).lean();

    const formattedPlans = plans.map((plan) => ({
      id: plan._id.toString(),
      userId: plan.userId,
      courseId: plan.courseId,
      goal: plan.goal,
      availableTimeMinutes: plan.availableTimeMinutes,
      totalEstimatedMinutes: plan.totalEstimatedMinutes,
      tasksCount: plan.taskGraph?.tasks?.length || 0,
      status: plan.status,
      warning: plan.warning,
      createdAt: plan.createdAt,
      scheduledAt: plan.scheduledAt
    }));

    res.json({ plans: formattedPlans });
  } catch (error) {
    logger.error('plans_list_failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch study plans' });
  }
});

// Get calendar entries for the user within upcoming weeks (default 2 weeks)
router.get('/calendar', async (req, res) => {
  try {
    const userId = req.user.userId;
    const weeks = parseInt(req.query.weeks, 10) || 2;
    const start = req.query.startDate ? new Date(req.query.startDate) : new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + weeks * 7);

    const calendarColl = mongoose.connection.collection('calendar');

    const entries = await calendarColl
      .find({
        userId,
        startTime: { $gte: start, $lte: end }
      })
      .sort({ startTime: 1 })
      .toArray();

    res.json({ entries });
  } catch (error) {
    logger.error('calendar_fetch_failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch calendar entries' });
  }
});

// Get specific study plan by ID
router.get('/:planId([0-9a-fA-F]{24})', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { planId } = req.params;

    const plan = await StudyPlan.findOne({ _id: planId, userId }).lean();

    if (!plan) {
      return res.status(404).json({ error: 'Study plan not found' });
    }

    const tasks = await Task.find({ studyPlanId: planId, userId }).lean();

    res.json({
      plan: {
        id: plan._id.toString(),
        userId: plan.userId,
        courseId: plan.courseId,
        goal: plan.goal,
        availableTimeMinutes: plan.availableTimeMinutes,
        totalEstimatedMinutes: plan.totalEstimatedMinutes,
        tasksCount: plan.taskGraph?.tasks?.length || 0,
        status: plan.status,
        warning: plan.warning,
        createdAt: plan.createdAt,
        scheduledAt: plan.scheduledAt,
        taskGraph: plan.taskGraph
      },
      tasks
    });
  } catch (error) {
    logger.error('plan_fetch_failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch study plan' });
  }
});

// Schedule a study plan (call Python AI scheduler)
router.post('/:planId/schedule', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  try {
    const { error } = schedulePlanSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.userId;
    const { planId } = req.params;
    const { calendarEvents, maxMinutesPerDay, allowLateNight } = req.body;

    const plan = await StudyPlan.findOne({ _id: planId, userId });

    if (!plan) {
      return res.status(404).json({ error: 'Study plan not found' });
    }

    const tasks = await Task.find({ studyPlanId: planId, userId }).lean();

    if (tasks.length === 0) {
      return res.status(400).json({ error: 'No tasks found for this study plan' });
    }

    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    const axios = require('axios');

    try {
      const schedulerResponse = await axios.post(`${aiServiceUrl}/api/ai/scheduler/schedule`, {
        user_id: userId,
        tasks: tasks,
        calendar_events: calendarEvents || [],
        max_minutes_per_day: maxMinutesPerDay || 240,
        allow_late_night: allowLateNight || false
      });

      const schedule = schedulerResponse.data.schedule;

      try {
        const calendarColl = mongoose.connection.collection('calendar');
        const entries = (schedule.sessions || schedule || []).map((s) => ({
          userId,
          planId: plan._id.toString(),
          taskId: s.taskId || s.task_id || s.task || null,
          title: s.title || s.name || null,
          description: s.description || s.note || null,
          startTime: s.startTime
            ? new Date(s.startTime)
            : s.start_time
              ? new Date(s.start_time)
              : null,
          endTime: s.endTime ? new Date(s.endTime) : s.end_time ? new Date(s.end_time) : null,
          estimatedMinutes: s.estimatedMinutes || s.estimated_minutes || s.duration || null,
          status: 'scheduled',
          source: 'plan',
          createdAt: new Date()
        }));

        if (entries.length > 0) {
          await calendarColl.insertMany(entries);
        }
      } catch (saveErr) {
        logger.error('calendar_save_failed', { error: saveErr.message });
      }

      plan.status = 'scheduled';
      plan.scheduledAt = new Date();
      await plan.save();

      res.json({
        message: 'Study plan scheduled successfully',
        planId: plan._id.toString(),
        schedule: schedule
      });
    } catch (aiError) {
      logger.error('scheduler_service_error', { error: aiError.message });
      return res.status(500).json({
        error: 'Failed to schedule study plan',
        details: aiError.response?.data?.detail || aiError.message
      });
    }
  } catch (error) {
    logger.error('plan_schedule_failed', { error: error.message });
    res.status(500).json({ error: 'Failed to schedule study plan' });
  }
});

// Get schedule for a study plan
router.get('/:planId/schedule', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { planId } = req.params;

    const plan = await StudyPlan.findOne({ _id: planId, userId });

    if (!plan) {
      return res.status(404).json({ error: 'Study plan not found' });
    }

    if (plan.status !== 'scheduled') {
      return res.status(400).json({ error: 'Study plan has not been scheduled yet' });
    }

    const tasks = await Task.find({ studyPlanId: planId, userId }).lean();

    const schedule = {
      planId: plan._id.toString(),
      goal: plan.goal,
      scheduledAt: plan.scheduledAt,
      sessions: tasks.map((task, index) => {
        const startDate = new Date(plan.scheduledAt);
        startDate.setDate(startDate.getDate() + index);
        startDate.setHours(9, 0, 0, 0);

        return {
          taskId: task._id.toString(),
          title: task.title,
          description: task.description,
          status: task.status,
          startTime: startDate.toISOString(),
          endTime: new Date(startDate.getTime() + (task.estimatedTime || 30) * 60000).toISOString(),
          estimatedMinutes: task.estimatedTime || 30
        };
      })
    };

    res.json({ schedule });
  } catch (error) {
    logger.error('schedule_fetch_failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// Delete study plan and associated tasks
router.delete('/:planId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { planId } = req.params;

    const plan = await StudyPlan.findOne({ _id: planId, userId });

    if (!plan) {
      return res.status(404).json({ error: 'Study plan not found' });
    }

    await Task.deleteMany({ studyPlanId: planId, userId });
    await StudyPlan.deleteOne({ _id: planId, userId });

    res.json({ message: 'Study plan and associated tasks deleted successfully' });
  } catch (error) {
    logger.error('plan_delete_failed', { error: error.message });
    res.status(500).json({ error: 'Failed to delete study plan' });
  }
});

// Schedule user's tasks (all or filtered)
router.post('/schedule-tasks', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { taskIds, calendarEvents, maxMinutesPerDay, allowLateNight } = req.body;

    let tasks;
    if (taskIds && Array.isArray(taskIds) && taskIds.length > 0) {
      tasks = await Task.find({ _id: { $in: taskIds }, userId }).lean();
    } else {
      tasks = await Task.find({
        userId,
        status: { $in: ['todo', 'in-progress'] }
      }).lean();
    }

    if (tasks.length === 0) {
      return res.status(400).json({ error: 'No tasks found to schedule' });
    }

    const calendarColl = mongoose.connection.collection('calendar');
    const taskIdsToSchedule = tasks.map((t) => t._id.toString());
    const existingScheduled = await calendarColl
      .find({
        userId,
        taskId: { $in: taskIdsToSchedule },
        source: 'auto'
      })
      .toArray();

    if (existingScheduled.length > 0) {
      const scheduledTaskIds = new Set(existingScheduled.map((e) => e.taskId));
      tasks = tasks.filter((t) => !scheduledTaskIds.has(t._id.toString()));

      if (tasks.length === 0) {
        return res.status(200).json({
          message: 'All tasks are already scheduled',
          schedule: { sessions: existingScheduled },
          tasksCount: 0
        });
      }
    }

    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    const axios = require('axios');

    try {
      const schedulerResponse = await axios.post(`${aiServiceUrl}/api/ai/scheduler/schedule`, {
        user_id: userId,
        tasks: tasks,
        calendar_events: calendarEvents || [],
        max_minutes_per_day: maxMinutesPerDay || 240,
        allow_late_night: allowLateNight || false
      });

      const schedule = schedulerResponse.data.schedule;

      try {
        const calendarEntries = (schedule.sessions || schedule || []).map((s) => ({
          userId,
          planId: null,
          taskId: s.taskId || s.task_id || s.task || null,
          title: s.title || s.name || null,
          description: s.description || s.note || null,
          startTime: s.startTime
            ? new Date(s.startTime)
            : s.start_time
              ? new Date(s.start_time)
              : null,
          endTime: s.endTime ? new Date(s.endTime) : s.end_time ? new Date(s.end_time) : null,
          estimatedMinutes: s.estimatedMinutes || s.estimated_minutes || s.duration || null,
          status: 'scheduled',
          source: 'auto',
          createdAt: new Date()
        }));

        if (calendarEntries.length > 0) {
          await calendarColl.insertMany(calendarEntries);
        }
      } catch (saveErr) {
        logger.error('calendar_save_failed', { error: saveErr.message });
        throw saveErr;
      }

      res.json({
        message: 'Tasks scheduled successfully',
        schedule: schedule,
        tasksCount: tasks.length
      });
    } catch (aiError) {
      logger.error('scheduler_service_error', { error: aiError.message });
      return res.status(500).json({
        error: 'Failed to schedule tasks',
        details: aiError.response?.data?.detail || aiError.message
      });
    }
  } catch (error) {
    logger.error('tasks_schedule_failed', { error: error.message });
    res.status(500).json({ error: 'Failed to schedule tasks' });
  }
});

module.exports = router;

const express = require('express');
const Joi = require('joi');
const axios = require('axios');
const FormData = require('form-data');
const { createProxy } = require('../utils/proxyBuilder');
const { tierGate } = require('@study-partner/shared/tierGate');

const AI_URL = process.env.AI_SERVICE_URL || 'http://ai-service:8000';
const router = express.Router();

// Validation Schemas
const ingestCourseSchema = Joi.object({
  courseData: Joi.string().required(),
  format: Joi.string().valid('pdf', 'text', 'markdown', 'html').required()
});
const generatePlanSchema = Joi.object({
  courseId: Joi.string().required(),
  deadline: Joi.date().optional(),
  hoursPerWeek: Joi.number().min(1).optional()
});
const scheduleTasksSchema = Joi.object({
  planId: Joi.string().required(),
  preferences: Joi.object({
    studyTime: Joi.string().optional(),
    breakDuration: Joi.number().optional()
  }).optional()
});
const coachAdviceSchema = Joi.object({
  ignored_count: Joi.number().min(0).optional().default(0),
  do_not_disturb: Joi.boolean().optional().default(false),
  focus_score: Joi.number().min(0).max(1).optional().allow(null),
  focus_state: Joi.string().optional().allow(null, ''),
  fatigue_score: Joi.number().min(0).max(1).optional().allow(null),
  fatigue_state: Joi.string().optional().allow(null, '')
});
const searchAskSchema = Joi.object({
  question: Joi.string().trim().allow('').required(),
  user_id: Joi.string().optional().allow('', null),
  session_id: Joi.string().optional().allow('', null)
});
const evaluateSessionSchema = Joi.object({
  session_duration_minutes: Joi.number().integer().min(0).required(),
  focus_score: Joi.number().min(0).max(100).required(),
  completed_tasks: Joi.number().integer().min(0).optional().default(0),
  skipped_tasks: Joi.number().integer().min(0).optional().default(0)
});
const socraticStartSchema = Joi.object({
  task_title: Joi.string().required(),
  task_description: Joi.string().required(),
  task_details: Joi.string().required(),
  max_attempts: Joi.number().integer().min(1).max(10).optional().default(5)
});
const socraticAnswerSchema = Joi.object({
  session_id: Joi.string().required(),
  user_answer: Joi.string().required()
});
const planCreateSchema = Joi.object({
  goal: Joi.string().required(),
  available_time_minutes: Joi.number().min(30).required(),
  course_id: Joi.string().optional().allow(null),
  start_date: Joi.date().optional().allow(null)
});

// Proxy Routes
router.post(
  '/ingest',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/courses/ingest',
    targetUrl: AI_URL,
    timeout: 60000,
    tier: ['vip', 'vip_plus', 'trial'],
    schema: ingestCourseSchema,
    userIdField: 'userId',
    mapResponse: (data) => ({ message: 'Course ingested successfully', ...data })
  })
);
router.get(
  '/plan/list',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/planner/plans/${req.user.userId}`,
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    mapResponse: (data) => ({ plans: data })
  })
);
router.post(
  '/plan',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/planner/create-plan',
    targetUrl: AI_URL,
    timeout: 120000,
    schema: generatePlanSchema,
    mapBody: (req) => {
      const { courseId, deadline, hoursPerWeek } = req.body;
      return {
        user_id: req.user.userId,
        goal: `Complete course ${courseId || 'general'} by ${deadline || 'flexible'}`,
        available_time_minutes: (hoursPerWeek || 10) * 60,
        course_id: courseId
      };
    },
    mapResponse: (data) => ({ message: 'Study plan generated', ...data })
  })
);
router.post(
  '/schedule',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/scheduler/schedule',
    targetUrl: AI_URL,
    timeout: 120000,
    tier: ['vip', 'vip_plus', 'trial'],
    schema: scheduleTasksSchema,
    mapBody: (req) => ({
      user_id: req.user.userId,
      plan_id: req.body.planId,
      preferences: req.body.preferences
    }),
    mapResponse: (data) => ({ message: 'Tasks scheduled', ...data })
  })
);
router.post(
  '/schedule/reschedule',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/scheduler/reschedule',
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    schema: Joi.object({ reason: Joi.string().trim().max(500).optional().default('manual') }),
    mapResponse: (data) => ({ message: 'Reschedule request submitted', result: data })
  })
);
router.post(
  '/schedule/apply-coach-action',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/scheduler/apply-coach-action',
    targetUrl: AI_URL,
    tier: ['vip_plus', 'trial'],
    schema: Joi.object({ coach_action: Joi.object().required() }),
    mapBody: (req) => ({ user_id: req.user.userId, coach_action: req.body.coach_action }),
    mapResponse: (data) => ({ message: 'Coach action applied to schedule', result: data })
  })
);
router.get(
  '/schedule/status',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/scheduler/status/${req.user.userId}`,
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial']
  })
);
router.put(
  '/schedule/optimize',
  ...createProxy({
    method: 'PUT',
    path: '/api/ai/scheduler/optimize',
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    schema: Joi.object({
      reason: Joi.string().trim().max(500).optional().default('manual_optimize')
    }),
    mapBody: (req) => ({ user_id: req.user.userId, reason: req.body.reason }),
    mapResponse: (data) => ({ message: 'Schedule optimization complete', result: data })
  })
);
router.post(
  '/evaluator/session',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/evaluator/session',
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    schema: evaluateSessionSchema,
    userIdField: 'user_id'
  })
);
router.post(
  '/evaluator/socratic/start',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/evaluator/socratic/start',
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    schema: socraticStartSchema,
    userIdField: 'user_id'
  })
);
router.post(
  '/evaluator/socratic/answer',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/evaluator/socratic/answer',
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    schema: socraticAnswerSchema
  })
);
router.post(
  '/signals/fatigue/reset',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/signals/fatigue/reset',
    targetUrl: AI_URL,
    tier: ['vip_plus', 'trial'],
    schema: Joi.object({ user_id: Joi.string().required() })
  })
);
router.get(
  '/vector/status/:courseId',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/vector/status/${req.params.courseId}`,
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial']
  })
);
router.post(
  '/vector/rebuild/:courseId',
  ...createProxy({
    method: 'POST',
    path: (req) => `/api/ai/vector/rebuild/${req.params.courseId}`,
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial']
  })
);
router.post(
  '/coach',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/coach/decision',
    targetUrl: AI_URL,
    tier: ['vip_plus', 'trial'],
    schema: coachAdviceSchema,
    mapBody: (req) => {
      const {
        ignored_count = 0,
        do_not_disturb = false,
        focus_score,
        focus_state,
        fatigue_score,
        fatigue_state
      } = req.body;
      const payload = { user_id: req.user?.userId || 'anonymous', ignored_count, do_not_disturb };
      if (focus_score != null) payload.focus_score = focus_score;
      if (focus_state) payload.focus_state = focus_state;
      if (fatigue_score != null) payload.fatigue_score = fatigue_score;
      if (fatigue_state) payload.fatigue_state = fatigue_state;
      return payload;
    },
    mapResponse: (data) => ({
      message: 'Coach executed successfully',
      action_type: data.coach_action.action_type,
      coach_message: data.coach_action.message,
      reasoning: data.coach_action.reasoning,
      schedule_update: data.schedule_update,
      timestamp: new Date().toISOString()
    })
  })
);
router.get(
  '/coach/history/:userId',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/coach/history/${req.params.userId}`,
    targetUrl: AI_URL,
    tier: ['vip_plus', 'trial'],
    requireOwnership: true,
    forwardQuery: true
  })
);
router.get(
  '/signals/current/:userId',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/signals/current/${req.params.userId}`,
    targetUrl: AI_URL,
    tier: ['vip_plus', 'trial'],
    requireOwnership: true
  })
);
router.get(
  '/signals/history/:userId',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/signals/history/${req.params.userId}`,
    targetUrl: AI_URL,
    tier: ['vip_plus', 'trial'],
    requireOwnership: true,
    forwardQuery: true
  })
);
router.post(
  '/signals/process',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/signals/process',
    targetUrl: AI_URL,
    tier: ['vip_plus', 'trial'],
    mapBody: (req) => ({ user_id: req.user?.userId })
  })
);
router.get(
  '/signals/latest/:userId',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/signals/latest/${req.params.userId}`,
    targetUrl: AI_URL,
    tier: ['vip_plus', 'trial'],
    requireOwnership: true,
    forwardQuery: true
  })
);
router.get(
  '/search/history/:userId',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/search/history/${req.params.userId}`,
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    requireOwnership: true,
    forwardQuery: true
  })
);
router.delete(
  '/search/history/:userId',
  ...createProxy({
    method: 'DELETE',
    path: (req) => `/api/ai/search/history/${req.params.userId}`,
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    requireOwnership: true
  })
);
router.post(
  '/reviews/schedule',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/reviews/schedule',
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    mapBody: (req) => ({ ...req.body, user_id: req.user?.userId })
  })
);
router.post(
  '/reviews/record-result',
  ...createProxy({
    method: 'POST',
    path: '/api/ai/reviews/record-result',
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    mapBody: (req) => ({
      user_id: req.user?.userId,
      review_id:
        req.body?.review_id ||
        req.body?.reviewId ||
        req.body?._id ||
        req.body?.id ||
        req.body?.topicId,
      quality_score: req.body?.quality_score ?? req.body?.qualityScore ?? req.body?.quality
    }),
    validateBody: (body) => {
      if (!body.user_id || !body.review_id || body.quality_score === undefined) {
        return 'Invalid review result payload. Required fields: user_id, review_id, quality_score';
      }
    }
  })
);
router.get(
  '/reviews/pending/:userId',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/reviews/pending/${req.params.userId}`,
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    requireOwnership: true,
    forwardQuery: true
  })
);
router.get(
  '/reviews/stats/:userId',
  ...createProxy({
    method: 'GET',
    path: (req) => `/api/ai/reviews/stats/${req.params.userId}`,
    targetUrl: AI_URL,
    tier: ['vip', 'vip_plus', 'trial'],
    requireOwnership: true
  })
);

// Custom Routes (multi-service orchestration, multipart, special error handling)

router.post('/plan/create', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  const { error } = planCreateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const userId = req.user.userId;
  const { goal, available_time_minutes, course_id, start_date } = req.body;

  try {
    const USER_PROFILE_URL =
      process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
    let calendar_events = [];
    try {
      const availabilityResponse = await axios.get(
        `${USER_PROFILE_URL}/api/v1/users/availability`,
        { headers: { Authorization: req.headers.authorization } }
      );
      calendar_events = availabilityResponse.data.map((s) => ({
        day_of_week: s.dayOfWeek,
        start_time: s.startTime,
        end_time: s.endTime,
        label: s.label || 'Blocked',
        is_recurring: s.isRecurring !== false
      }));
    } catch (availErr) {
      console.warn('Failed to fetch user availability:', availErr.message);
    }

    const response = await axios.post(
      `${AI_URL}/api/ai/planner/create-plan`,
      { user_id: userId, goal, available_time_minutes, course_id, start_date, calendar_events },
      { timeout: 60000 }
    );
    res.json({ message: 'Study plan created successfully', plan: response.data });
  } catch (err) {
    console.error('Plan creation failed:', err.message);
    if (err.response) {
      res
        .status(err.response.status)
        .json({ error: 'Plan creation failed', details: err.response.data.detail || err.message });
    } else if (err.request) {
      res
        .status(503)
        .json({ error: 'AI service unavailable', details: 'Cannot connect to Python AI service' });
    } else {
      res.status(500).json({ error: 'Plan creation failed', details: err.message });
    }
  }
});

router.post('/signals/analyze-frame', tierGate('vip_plus', 'trial'), async (req, res) => {
  try {
    const formData = new FormData();
    formData.append('user_id', req.body.user_id || req.user?.userId || 'anonymous');
    if (req.file) {
      formData.append('frame', req.file.buffer, {
        filename: 'frame.jpg',
        contentType: req.file.mimetype
      });
    } else if (req.files?.frame) {
      const frame = Array.isArray(req.files.frame) ? req.files.frame[0] : req.files.frame;
      formData.append('frame', frame.data, { filename: frame.name, contentType: frame.mimetype });
    }
    const response = await axios.post(`${AI_URL}/api/ai/signals/analyze-frame`, formData, {
      headers: formData.getHeaders(),
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024
    });
    res.json(response.data);
  } catch (err) {
    console.error('Frame analysis proxy failed:', err.message);
    if (err.response) res.status(err.response.status).json(err.response.data);
    else res.status(503).json({ error: 'AI service unavailable' });
  }
});

router.post('/search/ask', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  const normalizedBody = {
    question: (req.body?.question || req.body?.query || '').toString().trim()
  };
  if (req.user?.userId) normalizedBody.user_id = req.user.userId;
  if (req.body?.session_id) normalizedBody.session_id = req.body.session_id;

  const { error } = searchAskSchema.validate(normalizedBody);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const response = await axios.post(`${AI_URL}/api/ai/search/ask`, normalizedBody, {
      timeout: 120000
    });
    res.json(response.data);
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      return res.status(200).json({
        success: true,
        question: normalizedBody.question,
        answer: 'Search took too long to complete. Please try again with a more specific question.',
        sources_count: 0,
        urls: [],
        degraded: true,
        reason: 'Search timeout at AI orchestrator'
      });
    }
    if (err.response) res.status(err.response.status).json(err.response.data);
    else res.status(503).json({ error: 'AI service unavailable' });
  }
});

router.get('/status', async (req, res) => {
  res.json({
    agents: {
      courseIngestion: 'available',
      planner: 'available',
      scheduler: 'available',
      coach: 'available',
      signals: 'available',
      reviews: 'available'
    },
    aiServiceUrl: process.env.AI_SERVICE_URL || 'http://study-partner-ai:8000'
  });
});

module.exports = router;

const express = require('express');
const Joi = require('joi');
const { executeAIAgent } = require('../services/agentService');
const { tierGate } = require('@study-partner/shared/tierGate');

const router = express.Router();

// Validation schemas
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
  do_not_disturb: Joi.boolean().optional().default(false)
});

// Course Ingestion Agent
router.post('/ingest', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  const { error } = ingestCourseSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  const { courseData, format } = req.body;

  try {
    const result = await executeAIAgent('course_ingestion', {
      userId,
      courseData,
      format
    });

    res.json({
      message: 'Course ingested successfully',
      courseId: result.courseId,
      topics: result.topics,
      metadata: result.metadata
    });
  } catch (err) {
    res.status(500).json({ error: 'Course ingestion failed', details: err.message });
  }
});

// Planner Agent - Creates study plan with user availability
router.post('/plan/create', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  console.log('[DEBUG] Received plan/create request body:', JSON.stringify(req.body, null, 2));
  console.log('[DEBUG] User from JWT:', req.user);
  
  const schema = Joi.object({
    goal: Joi.string().required(),
    available_time_minutes: Joi.number().min(30).required(),
    course_id: Joi.string().optional().allow(null),
    start_date: Joi.date().optional().allow(null)
  });

  const { error } = schema.validate(req.body);
  if (error) {
    console.error('[DEBUG] Validation error:', error.details[0].message);
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  const { goal, available_time_minutes, course_id, start_date } = req.body;

  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    const USER_PROFILE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://localhost:3002';
    
    // Fetch user's availability from user-profile service
    let calendar_events = [];
    try {
      const availabilityResponse = await axios.get(`${USER_PROFILE_URL}/api/v1/users/availability`, {
        headers: {
          'Authorization': req.headers.authorization // Forward JWT token
        }
      });
      
      // Convert availability slots to calendar events format for scheduler
      calendar_events = availabilityResponse.data.map(slot => ({
        day_of_week: slot.dayOfWeek,
        start_time: slot.startTime,
        end_time: slot.endTime,
        label: slot.label || 'Blocked',
        is_recurring: slot.isRecurring !== false
      }));
    } catch (availErr) {
      console.warn('Failed to fetch user availability:', availErr.message);
      // Continue without availability - scheduler will use full day
    }
    
    // Call Python AI to create study plan with availability
    const response = await axios.post(`${AI_SERVICE_URL}/api/ai/planner/create-plan`, {
      user_id: userId,
      goal,
      available_time_minutes,
      course_id,
      start_date,
      calendar_events // Pass user's blocked time slots
    }, {
      timeout: 60000 // 60 second timeout for AI processing
    });

    res.json({
      message: 'Study plan created successfully',
      plan: response.data
    });
  } catch (err) {
    console.error('Plan creation failed:', err.message);
    
    if (err.response) {
      res.status(err.response.status).json({ 
        error: 'Plan creation failed', 
        details: err.response.data.detail || err.message 
      });
    } else if (err.request) {
      res.status(503).json({ 
        error: 'AI service unavailable', 
        details: 'Cannot connect to Python AI service' 
      });
    } else {
      res.status(500).json({ 
        error: 'Plan creation failed', 
        details: err.message 
      });
    }
  }
});

// Get user's study plans
router.get('/plan/list', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  const userId = req.user.userId;

  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    
    const response = await axios.get(`${AI_SERVICE_URL}/api/ai/planner/plans/${userId}`);

    res.json({
      plans: response.data
    });
  } catch (err) {
    console.error('Failed to fetch plans:', err.message);
    res.status(500).json({ 
      error: 'Failed to fetch plans', 
      details: err.message 
    });
  }
});

// Legacy endpoint - kept for backwards compatibility
router.post('/plan', async (req, res) => {
  const { error } = generatePlanSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  const { courseId, deadline, hoursPerWeek } = req.body;

  try {
    const result = await executeAIAgent('planner', {
      userId,
      courseId,
      deadline,
      hoursPerWeek: hoursPerWeek || 10
    });

    res.json({
      message: 'Study plan generated',
      planId: result.planId,
      tasks: result.tasks,
      timeline: result.timeline
    });
  } catch (err) {
    res.status(500).json({ error: 'Plan generation failed', details: err.message });
  }
});

// Scheduler Agent
router.post('/schedule', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  const { error } = scheduleTasksSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  const { planId, preferences } = req.body;

  try {
    const result = await executeAIAgent('scheduler', {
      userId,
      planId,
      preferences
    });

    res.json({
      message: 'Tasks scheduled',
      schedule: result.schedule,
      conflicts: result.conflicts
    });
  } catch (err) {
    res.status(500).json({ error: 'Scheduling failed', details: err.message });
  }
});

// Coach Agent - Forwards request to Python AI service
router.post('/coach', tierGate('vip_plus', 'trial'), async (req, res) => {
  const { error } = coachAdviceSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user?.userId || 'anonymous'; // Fallback if auth not enabled
  const { ignored_count = 0, do_not_disturb = false } = req.body;

  try {
    // Forward request to Python AI service
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    
    const response = await axios.post(`${AI_SERVICE_URL}/api/ai/coach/decision`, {
      user_id: userId,
      ignored_count,
      do_not_disturb
    });

    // Return the coach's decision
    res.json({
      message: 'Coach executed successfully',
      action_type: response.data.coach_action.action_type,
      coach_message: response.data.coach_action.message,
      reasoning: response.data.coach_action.reasoning,
      schedule_update: response.data.schedule_update,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Coach execution failed:', err.message);
    
    // Handle different error types
    if (err.response) {
      // Python service returned an error
      res.status(err.response.status).json({ 
        error: 'Coach execution failed', 
        details: err.response.data.detail || err.message 
      });
    } else if (err.request) {
      // Python service is unreachable
      res.status(503).json({ 
        error: 'AI service unavailable', 
        details: 'Cannot connect to Python AI service' 
      });
    } else {
      // Other error
      res.status(500).json({ 
        error: 'Coach execution failed', 
        details: err.message 
      });
    }
  }
});

// Coach History - Forwards request to Python AI service
router.get('/coach/history/:userId', tierGate('vip_plus', 'trial'), async (req, res) => {
  const { userId } = req.params;
  const { limit = 20 } = req.query;

  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    const response = await axios.get(`${AI_SERVICE_URL}/api/ai/coach/history/${userId}`, {
      params: { limit }
    });

    res.json(response.data);
  } catch (err) {
    console.error('Coach history fetch failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json({ error: err.response.data.detail || err.message });
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// ==================== Signal Processing (proxy to Python AI) ====================

// Analyze a video frame for focus and fatigue
router.post('/signals/analyze-frame', tierGate('vip_plus', 'trial'), async (req, res) => {
  try {
    const axios = require('axios');
    const FormData = require('form-data');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    // Forward the raw request body as multipart form data
    const formData = new FormData();
    formData.append('user_id', req.body.user_id || req.user?.userId || 'anonymous');

    if (req.file) {
      formData.append('frame', req.file.buffer, { filename: 'frame.jpg', contentType: req.file.mimetype });
    } else if (req.files?.frame) {
      const frame = Array.isArray(req.files.frame) ? req.files.frame[0] : req.files.frame;
      formData.append('frame', frame.data, { filename: frame.name, contentType: frame.mimetype });
    }

    const response = await axios.post(`${AI_SERVICE_URL}/api/ai/signals/analyze-frame`, formData, {
      headers: formData.getHeaders(),
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024
    });

    res.json(response.data);
  } catch (err) {
    console.error('Frame analysis proxy failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// Get current signals for a user
router.get('/signals/current/:userId', tierGate('vip_plus', 'trial'), async (req, res) => {
  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    const response = await axios.get(`${AI_SERVICE_URL}/api/ai/signals/current/${req.params.userId}`);
    res.json(response.data);
  } catch (err) {
    console.error('Signal fetch failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// Get signal history for a user
router.get('/signals/history/:userId', tierGate('vip_plus', 'trial'), async (req, res) => {
  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    const response = await axios.get(`${AI_SERVICE_URL}/api/ai/signals/history/${req.params.userId}`, {
      params: { limit: req.query.limit || 50 }
    });
    res.json(response.data);
  } catch (err) {
    console.error('Signal history fetch failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// Trigger signal processing for a user
router.post('/signals/process', tierGate('vip_plus', 'trial'), async (req, res) => {
  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    const response = await axios.post(`${AI_SERVICE_URL}/api/ai/signals/process`, {
      user_id: req.body.user_id || req.user?.userId
    });
    res.json(response.data);
  } catch (err) {
    console.error('Signal processing proxy failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// Get latest signal results for a user
router.get('/signals/latest/:userId', tierGate('vip_plus', 'trial'), async (req, res) => {
  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    const response = await axios.get(`${AI_SERVICE_URL}/api/ai/signals/latest/${req.params.userId}`, {
      params: { limit: req.query.limit || 10 }
    });
    res.json(response.data);
  } catch (err) {
    console.error('Latest signals fetch failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// ── Review / Spaced Repetition Proxy Routes ──────────────────────────

// Schedule a review for a completed task
router.post('/reviews/schedule', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    const response = await axios.post(`${AI_SERVICE_URL}/api/ai/reviews/schedule`, req.body);
    res.json(response.data);
  } catch (err) {
    console.error('Schedule review proxy failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// Record a review result
router.post('/reviews/record-result', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    const response = await axios.post(`${AI_SERVICE_URL}/api/ai/reviews/record-result`, req.body);
    res.json(response.data);
  } catch (err) {
    console.error('Record review result proxy failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// Get pending reviews for a user
router.get('/reviews/pending/:userId', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    const response = await axios.get(`${AI_SERVICE_URL}/api/ai/reviews/pending/${req.params.userId}`, {
      params: { limit: req.query.limit || 20 }
    });
    res.json(response.data);
  } catch (err) {
    console.error('Get pending reviews proxy failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// Get review stats for a user
router.get('/reviews/stats/:userId', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  try {
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    const response = await axios.get(`${AI_SERVICE_URL}/api/ai/reviews/stats/${req.params.userId}`);
    res.json(response.data);
  } catch (err) {
    console.error('Get review stats proxy failed:', err.message);
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'AI service unavailable' });
    }
  }
});

// Get AI agent status
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

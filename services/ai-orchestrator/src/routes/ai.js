const express = require('express');
const Joi = require('joi');
const { executeAIAgent } = require('../services/agentService');

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
router.post('/ingest', async (req, res) => {
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

// Planner Agent
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
router.post('/schedule', async (req, res) => {
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
router.post('/coach', async (req, res) => {
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
    
    const response = await axios.post(`${AI_SERVICE_URL}/api/coach/run`, {
      user_id: userId,
      ignored_count,
      do_not_disturb
    });

    // Return the coach's decision
    res.json({
      message: 'Coach executed successfully',
      action_type: response.data.action_type,
      coach_message: response.data.message,
      reasoning: response.data.reasoning,
      timestamp: response.data.timestamp
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

// Get AI agent status
router.get('/status', async (req, res) => {
  res.json({
    agents: {
      courseIngestion: 'available',
      planner: 'available',
      scheduler: 'available',
      coach: 'available'
    },
    aiServiceUrl: process.env.AI_SERVICE_URL || 'http://study-partner-ai:5000'
  });
});

module.exports = router;

const express = require('express');
const Joi = require('joi');
const axios = require('axios');
const { Task, Course } = require('../models');

const router = express.Router();

// Validation schemas
const createTaskSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional(),
  topicId: Joi.string().optional(),
  priority: Joi.string().valid('low', 'medium', 'high').optional(),
  estimatedTime: Joi.number().optional(),
  dueDate: Joi.date().optional(),
  tags: Joi.array().items(Joi.string()).optional()
});

const updateTaskSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional(),
  topicId: Joi.string().optional(),
  priority: Joi.string().valid('low', 'medium', 'high').optional(),
  estimatedTime: Joi.number().optional(),
  status: Joi.string().valid('todo', 'in-progress', 'completed', 'cancelled').optional(),
  dueDate: Joi.date().optional(),
  tags: Joi.array().items(Joi.string()).optional()
});

// Get all tasks
router.get('/', async (req, res) => {
  const userId = req.user.userId;
  const { status, priority, topicId } = req.query;
  
  const filter = { userId };
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (topicId) filter.topicId = topicId;
  
  const tasks = await Task.find(filter).sort({ createdAt: -1 });
  
  res.json({ tasks });
});

// Get task by ID
router.get('/:taskId', async (req, res) => {
  const userId = req.user.userId;
  const { taskId } = req.params;
  
  const task = await Task.findOne({ _id: taskId, userId });
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  res.json({ task });
});

// Create task
router.post('/', async (req, res) => {
  const { error } = createTaskSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  
  const task = await Task.create({
    userId,
    ...req.body
  });
  
  res.status(201).json({ 
    message: 'Task created',
    task 
  });
});

// Update task
router.put('/:taskId', async (req, res) => {
  const { error } = updateTaskSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  const { taskId } = req.params;
  
  const task = await Task.findOne({ _id: taskId, userId });
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  Object.assign(task, req.body);
  
  if (req.body.status === 'completed' && !task.completedAt) {
    task.completedAt = new Date();
  }
  
  await task.save();
  
  res.json({ 
    message: 'Task updated',
    task 
  });
});

// Delete task
router.delete('/:taskId', async (req, res) => {
  const userId = req.user.userId;
  const { taskId } = req.params;
  
  const result = await Task.deleteOne({ _id: taskId, userId });
  
  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  res.json({ message: 'Task deleted' });
});

// Generate tasks from planner using AI (kept for backward compatibility) (kept for backward compatibility)
// Note: New flow should use /api/v1/study/plans/create instead
router.post('/generate-from-planner', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { goal, availableTimeMinutes, courseId, startDate } = req.body;

    if (!goal) {
      return res.status(400).json({ error: 'Goal is required' });
    }

    // Redirect to new study plans endpoint
    res.status(410).json({
      error: 'This endpoint is deprecated. Please use /api/v1/study/plans/create instead',
      newEndpoint: '/api/v1/study/plans/create'
    });

  } catch (error) {
    console.error('Error in deprecated endpoint:', error);
    res.status(500).json({ error: 'Failed to generate tasks' });
  }
});

module.exports = router;

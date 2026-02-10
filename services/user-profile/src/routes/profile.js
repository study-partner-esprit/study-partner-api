const express = require('express');
const Joi = require('joi');
const UserProfile = require('../models/UserProfile');

const router = express.Router();

// Validation schema
const updateProfileSchema = Joi.object({
  bio: Joi.string().max(500).optional(),
  avatar: Joi.string().uri().optional(),
  preferences: Joi.object({
    studyTime: Joi.string().valid('morning', 'afternoon', 'evening', 'night').optional(),
    notifications: Joi.object({
      email: Joi.boolean().optional(),
      push: Joi.boolean().optional()
    }).optional(),
    theme: Joi.string().valid('light', 'dark').optional(),
    language: Joi.string().optional()
  }).optional()
});

const addGoalSchema = Joi.object({
  title: Joi.string().required(),
  target: Joi.number().required(),
  deadline: Joi.date().optional()
});

// Get profile
router.get('/', async (req, res) => {
  const userId = req.user.userId;
  
  let profile = await UserProfile.findOne({ userId });
  
  // Create profile if doesn't exist
  if (!profile) {
    profile = await UserProfile.create({ userId });
  }
  
  res.json({ profile });
});

// Update profile
router.put('/', async (req, res) => {
  const { error } = updateProfileSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  
  let profile = await UserProfile.findOne({ userId });
  
  if (!profile) {
    profile = await UserProfile.create({ userId, ...req.body });
  } else {
    Object.assign(profile, req.body);
    await profile.save();
  }
  
  res.json({ 
    message: 'Profile updated successfully',
    profile 
  });
});

// Get stats
router.get('/stats', async (req, res) => {
  const userId = req.user.userId;
  
  const profile = await UserProfile.findOne({ userId });
  
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  res.json({ stats: profile.stats });
});

// Update stats
router.patch('/stats', async (req, res) => {
  const userId = req.user.userId;
  const { studyTime, tasksCompleted } = req.body;
  
  const profile = await UserProfile.findOne({ userId });
  
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  if (studyTime) {
    profile.stats.totalStudyTime += studyTime;
  }
  
  if (tasksCompleted) {
    profile.stats.completedTasks += tasksCompleted;
  }
  
  await profile.save();
  
  res.json({ 
    message: 'Stats updated',
    stats: profile.stats 
  });
});

// Get goals
router.get('/goals', async (req, res) => {
  const userId = req.user.userId;
  
  const profile = await UserProfile.findOne({ userId });
  
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  res.json({ goals: profile.goals });
});

// Add goal
router.post('/goals', async (req, res) => {
  const { error } = addGoalSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  
  const profile = await UserProfile.findOne({ userId });
  
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  profile.goals.push({
    ...req.body,
    current: 0
  });
  
  await profile.save();
  
  res.status(201).json({ 
    message: 'Goal added',
    goal: profile.goals[profile.goals.length - 1]
  });
});

// Update goal progress
router.patch('/goals/:goalId', async (req, res) => {
  const userId = req.user.userId;
  const { goalId } = req.params;
  const { current, completed } = req.body;
  
  const profile = await UserProfile.findOne({ userId });
  
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  const goal = profile.goals.id(goalId);
  
  if (!goal) {
    return res.status(404).json({ error: 'Goal not found' });
  }
  
  if (current !== undefined) {
    goal.current = current;
  }
  
  if (completed !== undefined) {
    goal.completed = completed;
  }
  
  await profile.save();
  
  res.json({ 
    message: 'Goal updated',
    goal 
  });
});

// Delete goal
router.delete('/goals/:goalId', async (req, res) => {
  const userId = req.user.userId;
  const { goalId } = req.params;
  
  const profile = await UserProfile.findOne({ userId });
  
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  profile.goals.pull(goalId);
  await profile.save();
  
  res.json({ message: 'Goal deleted' });
});

module.exports = router;

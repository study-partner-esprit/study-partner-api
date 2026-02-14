const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const UserProfile = require('../models/UserProfile');

const router = express.Router();

// Configuration for Multer (File Upload) - use memoryStorage so avatars can be stored in DB as data URLs
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/; // Allowed extensions
    const mimetype = file.mimetype && filetypes.test(file.mimetype);
    const extname = path.extname(file.originalname || '').toLowerCase() && filetypes.test(path.extname(file.originalname || '').toLowerCase());
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Error: File upload only supports following file.types: " + filetypes));
  }
});

// Update profile schema (avatar is now optional handling, as it might be handled separately or as string)
const updateProfileSchema = Joi.object({
  nickname: Joi.string().trim().max(50).allow('', null).optional(),
  bio: Joi.string().max(500).allow('', null).optional(),
  avatar: Joi.string().allow('', null).optional(),
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
  // Debug: log forwarded headers and host/proto to diagnose avatar URL construction
  try {
    console.log('GET /api/v1/users/profile - headers x-forwarded-host:', req.headers['x-forwarded-host']);
    console.log('GET /api/v1/users/profile - headers x-forwarded-proto:', req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol']);
    console.log('GET /api/v1/users/profile - req.get(host):', req.get('host'), 'protocol:', req.protocol);
  } catch (e) {
    console.error('Error logging forwarded headers', e);
  }

  let profile = await UserProfile.findOne({ userId });
  
  // Create profile if doesn't exist
  if (!profile) {
    profile = await UserProfile.create({ userId });
  }
  // If avatar is a relative uploads path (legacy), convert to absolute URL so clients can display it.
  // If avatar is already a data URL, return it unchanged.
  try {
    if (profile.avatar && !profile.avatar.startsWith('http') && !profile.avatar.startsWith('data:')) {
      const forwardedHost = req.headers['x-forwarded-host'] || req.headers['x-forwarded-hostname'];
      const forwardedProto = req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'];
      const host = forwardedHost || req.get('host') || 'localhost:3000';
      const protocol = forwardedProto || req.protocol || 'http';
      profile = profile.toObject();
      profile.avatar = `${protocol}://${host}${profile.avatar}`;
    }
  } catch (e) {
    console.error('Error converting avatar to absolute URL', e);
  }

  res.json({ profile });
});

// Update profile (supports file upload or JSON)
router.put('/', upload.single('avatarFile'), async (req, res) => {
  // Detailed logging for debugging uploads
  try {
    console.log('PUT /api/v1/users/profile - file present:', !!req.file, 'file:', req.file && req.file.filename);
    console.log('PUT /api/v1/users/profile - body keys:', Object.keys(req.body));
    console.log('PUT /api/v1/users/profile - sample body:', { nickname: req.body.nickname, bio: req.body.bio, avatar: req.body.avatar });
  } catch (e) {
    console.error('Error logging request data', e);
  }

    // If file uploaded, convert to base64 data URL and store in body.avatar
    if (req.file && req.file.buffer) {
      const mime = req.file.mimetype || 'application/octet-stream';
      const b64 = req.file.buffer.toString('base64');
      req.body.avatar = `data:${mime};base64,${b64}`;
    }

  // Remove avatarFile from body if present (multer might have left it or legacy reasons)
  delete req.body.avatarFile;

  // Joi validation
  const { error } = updateProfileSchema.validate(req.body);
  if (error) {
    console.error('Profile validation error:', error.details[0].message, req.body);
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  
  let profile = await UserProfile.findOne({ userId });
  
  if (!profile) {
    profile = await UserProfile.create({ userId, ...req.body });
  } else {
    // Only update fields that are present
    if (req.body.nickname !== undefined) profile.nickname = req.body.nickname;
    if (req.body.bio !== undefined) profile.bio = req.body.bio;
    if (req.body.avatar !== undefined) profile.avatar = req.body.avatar;
    if (req.body.preferences) {
        profile.preferences = { ...profile.preferences, ...req.body.preferences };
    }
    
    await profile.save();
  }
  
  // Log saved avatar for debugging
  try {
    console.log('Profile updated for user:', userId, 'avatar:', profile.avatar);
  } catch (e) {
    console.error('Error logging profile avatar', e);
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

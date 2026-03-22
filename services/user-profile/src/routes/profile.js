const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const path = require('path');
const UserProfile = require('../models/UserProfile');

const router = express.Router();

// Configuration for Multer (File Upload) - use memoryStorage so avatars can be stored in DB as data URLs
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for images
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/; // Allowed image extensions
    const mimetype = file.mimetype && filetypes.test(file.mimetype);
    const extname =
      path.extname(file.originalname || '').toLowerCase() &&
      filetypes.test(path.extname(file.originalname || '').toLowerCase());
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Error: File upload only supports following file.types: ' + filetypes));
  }
});

const uploadVideo = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for videos
  fileFilter: (req, file, cb) => {
    const filetypes = /mp4|webm|mov|avi/; // Allowed video extensions
    const mimetype = file.mimetype && /video\//i.test(file.mimetype);
    const extname =
      path.extname(file.originalname || '').toLowerCase() &&
      filetypes.test(path.extname(file.originalname || '').toLowerCase());
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Error: File upload only supports following video types: ' + filetypes));
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

const requireUserLevel = async (userId, minLevel) => {
  const Gamification = require('../models/Gamification');
  let gamification = await Gamification.findOne({ userId });
  if (!gamification) {
    gamification = await Gamification.create({ userId });
  }
  return {
    level: gamification.level || 1,
    allowed: (gamification.level || 1) >= minLevel
  };
};

// Get profile
router.get('/', async (req, res) => {
  const userId = req.user.userId;

  let profile = await UserProfile.findOne({ userId });

  // Create profile if doesn't exist
  if (!profile) {
    profile = await UserProfile.create({ userId });
  }
  // If avatar is a relative uploads path (legacy), convert to absolute URL so clients can display it.
  // If avatar is already a data URL, return it unchanged.
  try {
    if (
      profile.avatar &&
      !profile.avatar.startsWith('http') &&
      !profile.avatar.startsWith('data:')
    ) {
      const forwardedHost = req.headers['x-forwarded-host'] || req.headers['x-forwarded-hostname'];
      const forwardedProto =
        req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'];
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

// PUT /online-status — Update online status (called by notification service)
router.put('/online-status', async (req, res) => {
  try {
    const { userId, onlineStatus } = req.body;
    if (!userId || !['online', 'studying', 'offline'].includes(onlineStatus)) {
      return res.status(400).json({ error: 'Invalid userId or status' });
    }

    const update = { onlineStatus };
    if (onlineStatus === 'offline') {
      update.lastSeenAt = new Date();
    }

    await UserProfile.findOneAndUpdate({ userId }, update, { upsert: false });
    res.json({ message: 'Status updated' });
  } catch (error) {
    console.error('Error updating online status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// PUT /privacy — Update privacy settings
router.put('/privacy', async (req, res) => {
  try {
    const userId = req.user?.userId || req.body.userId;
    const { showOnlineStatus, showStudyActivity, showStats, allowRequests } = req.body;

    const profile = await UserProfile.findOne({ userId });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    if (showOnlineStatus !== undefined) profile.privacy.showOnlineStatus = showOnlineStatus;
    if (showStudyActivity !== undefined) profile.privacy.showStudyActivity = showStudyActivity;
    if (showStats !== undefined) profile.privacy.showStats = showStats;
    if (allowRequests !== undefined) profile.privacy.allowRequests = allowRequests;

    await profile.save();
    res.json({ message: 'Privacy settings updated', privacy: profile.privacy });
  } catch (error) {
    console.error('Error updating privacy:', error);
    res.status(500).json({ error: 'Failed to update privacy settings' });
  }
});

// ==================== Background Customization Endpoints ====================

// GET /background — Get current background settings
router.get('/background', async (req, res) => {
  try {
    const userId = req.user.userId;
    const profile = await UserProfile.findOne({ userId });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    res.json({
      backgroundSettings: profile.backgroundSettings || {},
      animatedBackgroundSettings: profile.animatedBackgroundSettings || {}
    });
  } catch (error) {
    console.error('Error fetching background settings:', error);
    res.status(500).json({ error: 'Failed to fetch background settings' });
  }
});

// POST /background/apply — Apply static wallpaper settings (Level 10+)
router.post('/background/apply', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { imageUrl, type, opacity, blur, position, enabled } = req.body;

    const gate = await requireUserLevel(userId, 10);
    if (!gate.allowed) {
      return res.status(403).json({
        error: 'Background customization unlocks at level 10',
        code: 'LEVEL_REQUIRED',
        requiredLevel: 10,
        currentLevel: gate.level
      });
    }

    const profile = await UserProfile.findOne({ userId });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    profile.backgroundSettings = {
      enabled: enabled !== undefined ? enabled : true,
      type: type || 'preset',
      imageUrl: imageUrl || profile.backgroundSettings?.imageUrl,
      opacity: opacity !== undefined ? opacity : 0.3,
      blur: blur !== undefined ? blur : 5,
      position: position || 'cover',
      uploadedAt: type === 'uploaded' ? new Date() : profile.backgroundSettings?.uploadedAt
    };

    await profile.save();
    res.json({ message: 'Background applied', backgroundSettings: profile.backgroundSettings });
  } catch (error) {
    console.error('Error applying background:', error);
    res.status(500).json({ error: 'Failed to apply background' });
  }
});

// POST /background/upload — Upload custom wallpaper (Level 10+)
router.post('/background/upload', upload.single('backgroundImage'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const gate = await requireUserLevel(userId, 10);
    if (!gate.allowed) {
      return res.status(403).json({
        error: 'Background customization unlocks at level 10',
        code: 'LEVEL_REQUIRED',
        requiredLevel: 10,
        currentLevel: gate.level
      });
    }

    if (!req.file) return res.status(400).json({ error: 'No image file provided' });

    const mime = req.file.mimetype || 'application/octet-stream';
    const b64 = req.file.buffer.toString('base64');
    const imageUrl = `data:${mime};base64,${b64}`;

    const profile = await UserProfile.findOne({ userId });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    profile.backgroundSettings = {
      ...profile.backgroundSettings,
      enabled: true,
      type: 'uploaded',
      imageUrl,
      uploadedAt: new Date()
    };

    await profile.save();
    res.json({
      message: 'Background uploaded',
      backgroundSettings: profile.backgroundSettings
    });
  } catch (error) {
    console.error('Error uploading background:', error);
    res.status(500).json({ error: 'Failed to upload background' });
  }
});

// POST /animated-background/upload — Upload custom animated background video (Level 20+)
router.post(
  '/animated-background/upload',
  uploadVideo.single('animatedVideo'),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const gate = await requireUserLevel(userId, 20);
      if (!gate.allowed) {
        return res.status(403).json({
          error: 'Animated backgrounds unlock at level 20',
          code: 'LEVEL_REQUIRED',
          requiredLevel: 20,
          currentLevel: gate.level
        });
      }

      if (!req.file) return res.status(400).json({ error: 'No video file provided' });

      const mime = req.file.mimetype || 'video/mp4';
      const b64 = req.file.buffer.toString('base64');
      const videoUrl = `data:${mime};base64,${b64}`;

      const profile = await UserProfile.findOne({ userId });
      if (!profile) return res.status(404).json({ error: 'Profile not found' });

      profile.animatedBackgroundSettings = {
        ...profile.animatedBackgroundSettings,
        enabled: true,
        type: 'uploaded',
        videoUrl,
        uploadedAt: new Date()
      };

      await profile.save();
      res.json({
        message: 'Animated background video uploaded',
        animatedBackgroundSettings: profile.animatedBackgroundSettings
      });
    } catch (error) {
      console.error('Error uploading animated background:', error);
      res.status(500).json({ error: 'Failed to upload animated background' });
    }
  }
);

// POST /animated-background/apply — Apply animated background settings (Level 20+)
router.post('/animated-background/apply', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { videoUrl, type, opacity, brightness, saturation, loop, speed, enabled } = req.body;

    const gate = await requireUserLevel(userId, 20);
    if (!gate.allowed) {
      return res.status(403).json({
        error: 'Animated backgrounds unlock at level 20',
        code: 'LEVEL_REQUIRED',
        requiredLevel: 20,
        currentLevel: gate.level
      });
    }

    const profile = await UserProfile.findOne({ userId });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    profile.animatedBackgroundSettings = {
      enabled: enabled !== undefined ? enabled : true,
      type: type || 'preset',
      videoUrl: videoUrl || profile.animatedBackgroundSettings?.videoUrl,
      opacity: opacity !== undefined ? opacity : 0.15,
      brightness: brightness !== undefined ? brightness : 0,
      saturation: saturation !== undefined ? saturation : 100,
      loop: loop !== undefined ? loop : true,
      speed: speed !== undefined ? speed : 1,
      uploadedAt: type === 'uploaded' ? new Date() : profile.animatedBackgroundSettings?.uploadedAt
    };

    await profile.save();
    res.json({
      message: 'Animated background applied',
      animatedBackgroundSettings: profile.animatedBackgroundSettings
    });
  } catch (error) {
    console.error('Error applying animated background:', error);
    res.status(500).json({ error: 'Failed to apply animated background' });
  }
});

// GET /background/presets — Get preset backgrounds gallery
router.get('/background/presets', async (req, res) => {
  const presets = [
    {
      id: 'space-1',
      name: 'Cosmic Nebula',
      category: 'space',
      imageUrl:
        'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1920&q=80'
    },
    {
      id: 'space-2',
      name: 'Deep Space',
      category: 'space',
      imageUrl:
        'https://images.unsplash.com/photo-1444703686981-a3abbc4d4fe3?auto=format&fit=crop&w=1920&q=80'
    },
    {
      id: 'nature-1',
      name: 'Mountain Lake',
      category: 'nature',
      imageUrl:
        'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1920&q=80'
    },
    {
      id: 'nature-2',
      name: 'Northern Lights',
      category: 'nature',
      imageUrl:
        'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?auto=format&fit=crop&w=1920&q=80'
    },
    {
      id: 'urban-1',
      name: 'City Lights',
      category: 'urban',
      imageUrl:
        'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1920&q=80'
    },
    {
      id: 'urban-2',
      name: 'Neon Streets',
      category: 'urban',
      imageUrl:
        'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1920&q=80'
    },
    {
      id: 'abstract-1',
      name: 'Dark Gradient',
      category: 'abstract',
      imageUrl:
        'https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1920&q=80'
    },
    {
      id: 'abstract-2',
      name: 'Purple Waves',
      category: 'abstract',
      imageUrl:
        'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=1920&q=80'
    },
    {
      id: 'gaming-1',
      name: 'Cyberpunk',
      category: 'gaming',
      imageUrl:
        'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1920&q=80'
    },
    {
      id: 'gaming-2',
      name: 'Retro Grid',
      category: 'gaming',
      imageUrl:
        'https://images.unsplash.com/photo-1614294149010-950b698f72c0?auto=format&fit=crop&w=1920&q=80'
    }
  ];
  res.json({ presets });
});

// GET /animated-background/presets — Get preset animated backgrounds
router.get('/animated-background/presets', async (req, res) => {
  // These are placeholder URLs — in production these would be hosted on a CDN
  const presets = [
    {
      id: 'anim-space-1',
      name: 'Starfield',
      category: 'space',
      thumbnailUrl:
        'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=400&q=60',
      videoUrl: '',
      duration: 30
    },
    {
      id: 'anim-nature-1',
      name: 'Rain Drops',
      category: 'nature',
      thumbnailUrl:
        'https://images.unsplash.com/photo-1428592953211-077101b2021b?auto=format&fit=crop&w=400&q=60',
      videoUrl: '',
      duration: 20
    },
    {
      id: 'anim-nature-2',
      name: 'Ocean Waves',
      category: 'nature',
      thumbnailUrl:
        'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?auto=format&fit=crop&w=400&q=60',
      videoUrl: '',
      duration: 25
    },
    {
      id: 'anim-urban-1',
      name: 'Neon City',
      category: 'urban',
      thumbnailUrl:
        'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=400&q=60',
      videoUrl: '',
      duration: 15
    },
    {
      id: 'anim-abstract-1',
      name: 'Particles',
      category: 'abstract',
      thumbnailUrl:
        'https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=400&q=60',
      videoUrl: '',
      duration: 30
    },
    {
      id: 'anim-gaming-1',
      name: 'Pixel Rain',
      category: 'gaming',
      thumbnailUrl:
        'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=400&q=60',
      videoUrl: '',
      duration: 20
    }
  ];
  res.json({ presets });
});

// GET /level — Get user level info with unlocked features
router.get('/level', async (req, res) => {
  try {
    const userId = req.user.userId;
    const Gamification = require('../models/Gamification');
    let gamification = await Gamification.findOne({ userId });
    if (!gamification) {
      gamification = await Gamification.create({ userId });
    }

    const level = gamification.level;
    const totalXP = gamification.totalXp;
    const nextLevelXP = level * 100;
    const xpProgress = Math.round(totalXP % 100);

    const unlockedFeatures = [];
    if (level >= 10) unlockedFeatures.push('wallpaper');
    if (level >= 20) unlockedFeatures.push('animated_background');

    res.json({
      level,
      totalXP,
      nextLevelXP,
      xpProgress,
      unlockedFeatures
    });
  } catch (error) {
    console.error('Error fetching level info:', error);
    res.status(500).json({ error: 'Failed to fetch level info' });
  }
});

module.exports = router;

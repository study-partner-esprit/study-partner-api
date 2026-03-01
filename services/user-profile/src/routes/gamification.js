const express = require('express');
const Joi = require('joi');
const axios = require('axios');
const Gamification = require('../models/Gamification');

const router = express.Router();

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3007';

// XP rewards configuration
const XP_REWARDS = {
  course_upload: 50,
  task_complete_easy: 10,
  task_complete_medium: 20,
  task_complete_hard: 30,
  perfect_focus_session: 25,
  daily_streak: 15,
  session_complete: 10,
  // Social XP
  friend_added: 5,
  team_session: 20,
  team_session_host: 30,
};

// Validation schema
const awardXpSchema = Joi.object({
  action: Joi.string().required(),
  xp_amount: Joi.number().optional(),
  metadata: Joi.object().optional()
});

// Get gamification profile
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    let profile = await Gamification.findOne({ userId });

    if (!profile) {
      profile = await Gamification.create({ userId });
    }

    res.json({
      user_id: profile.userId,
      total_xp: profile.totalXp,
      level: profile.level,
      achievements: profile.achievements,
      xp_history: profile.xpHistory,
      stats: profile.stats,
      created_at: profile.createdAt,
      updated_at: profile.updatedAt
    });
  } catch (error) {
    console.error('Error fetching gamification profile:', error);
    res.status(500).json({ error: 'Failed to fetch gamification profile' });
  }
});

// Award XP
router.post('/award-xp', async (req, res) => {
  try {
    const { error, value } = awardXpSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.userId;
    const xp = value.xp_amount || XP_REWARDS[value.action] || 0;

    if (xp === 0) {
      return res.status(400).json({ error: `Unknown action: ${value.action}` });
    }

    let profile = await Gamification.findOne({ userId });
    if (!profile) {
      profile = await Gamification.create({ userId });
    }

    const result = profile.awardXp(xp, value.action, value.metadata);

    // Update stats based on action
    if (value.action === 'course_upload') {
      profile.stats.coursesUploaded += 1;
    } else if (value.action.startsWith('task_complete')) {
      profile.stats.tasksCompleted += 1;
    } else if (value.action === 'perfect_focus_session') {
      profile.stats.perfectSessions += 1;
    } else if (value.action === 'friend_added') {
      profile.stats.friendsAdded = (profile.stats.friendsAdded || 0) + 1;
    } else if (value.action === 'team_session' || value.action === 'team_session_host') {
      profile.stats.teamSessions = (profile.stats.teamSessions || 0) + 1;
    }

    await profile.save();

    // Send notifications for level-ups and new achievements
    const notifications = [];
    if (result.leveledUp) {
      notifications.push({
        userId,
        type: 'level_up',
        title: 'Level Up! 🎉',
        message: `Congratulations! You reached level ${result.newLevel}!`,
        data: { oldLevel: result.oldLevel, newLevel: result.newLevel }
      });
    }
    if (result.newAchievements && result.newAchievements.length > 0) {
      for (const ach of result.newAchievements) {
        notifications.push({
          userId,
          type: 'achievement',
          title: `Achievement Unlocked! ${ach.icon}`,
          message: `${ach.name}: ${ach.description}`,
          data: { achievementId: ach.id }
        });
      }
    }
    // Fire-and-forget notifications
    if (notifications.length > 0) {
      for (const notif of notifications) {
        axios
          .post(`${NOTIFICATION_SERVICE_URL}/api/v1/notifications`, notif, {
            headers: { Authorization: req.headers.authorization }
          })
          .catch((err) => console.warn('Notification send failed:', err.message));
      }
    }

    res.json({
      status: 'success',
      xp_awarded: result.xpAwarded,
      total_xp: result.totalXp,
      old_level: result.oldLevel,
      new_level: result.newLevel,
      leveled_up: result.leveledUp,
      level_progress: result.totalXp % 100,
      next_level_xp: 100,
      new_achievements: result.newAchievements || []
    });
  } catch (error) {
    console.error('Error awarding XP:', error);
    res.status(500).json({ error: 'Failed to award XP' });
  }
});

// Get leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const leaderboard = await Gamification.find()
      .sort({ totalXp: -1 })
      .limit(limit)
      .select('userId totalXp level stats.coursesUploaded stats.tasksCompleted');

    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;

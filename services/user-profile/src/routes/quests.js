const express = require('express');
const Quest = require('../models/Quest');
const Gamification = require('../models/Gamification');

const router = express.Router();

// ── Daily / Weekly quest templates ──────────────────
const DAILY_QUEST_TEMPLATES = [
  {
    title: 'Task Crusher',
    description: 'Complete 3 tasks today',
    icon: '✅',
    action: 'task_complete',
    targetCount: 3,
    xpReward: 30
  },
  {
    title: 'Focus Champion',
    description: 'Complete 2 focus sessions',
    icon: '🎯',
    action: 'focus_session',
    targetCount: 2,
    xpReward: 25
  },
  {
    title: 'Study Warrior',
    description: 'Complete 1 study session',
    icon: '📖',
    action: 'study_session',
    targetCount: 1,
    xpReward: 20
  },
  {
    title: 'Review Master',
    description: 'Review 5 items',
    icon: '🧠',
    action: 'review_complete',
    targetCount: 5,
    xpReward: 25
  }
];

const WEEKLY_QUEST_TEMPLATES = [
  {
    title: 'Knowledge Builder',
    description: 'Upload 2 courses this week',
    icon: '📚',
    action: 'course_upload',
    targetCount: 2,
    xpReward: 75
  },
  {
    title: 'Task Marathon',
    description: 'Complete 15 tasks this week',
    icon: '⚡',
    action: 'task_complete',
    targetCount: 15,
    xpReward: 100
  },
  {
    title: 'Focus Legend',
    description: 'Complete 10 focus sessions this week',
    icon: '🧘',
    action: 'focus_session',
    targetCount: 10,
    xpReward: 80
  },
  {
    title: 'Study Streak',
    description: 'Complete 5 study sessions this week',
    icon: '🔥',
    action: 'study_session',
    targetCount: 5,
    xpReward: 60
  }
];

// Pick N random items from array
function pickRandom(arr, n) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

// Get end of day (UTC)
function endOfDay() {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

// Get end of week (Sunday 23:59 UTC)
function endOfWeek() {
  const d = new Date();
  const dayOfWeek = d.getUTCDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  d.setUTCDate(d.getUTCDate() + daysUntilSunday);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

// ── GET /api/v1/users/quests — get active quests (auto-generate if needed) ──
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const now = new Date();

    // Expire old quests
    await Quest.updateMany(
      { userId, status: 'active', expiresAt: { $lt: now } },
      { status: 'expired' }
    );

    // Check for existing active daily quests
    let dailyQuests = await Quest.find({ userId, type: 'daily', status: 'active' });
    if (dailyQuests.length === 0) {
      // Generate 2 random daily quests
      const templates = pickRandom(DAILY_QUEST_TEMPLATES, 2);
      dailyQuests = await Quest.insertMany(
        templates.map((t) => ({
          userId,
          type: 'daily',
          ...t,
          expiresAt: endOfDay()
        }))
      );
    }

    // Check for existing active weekly quests
    let weeklyQuests = await Quest.find({ userId, type: 'weekly', status: 'active' });
    if (weeklyQuests.length === 0) {
      // Generate 2 random weekly quests
      const templates = pickRandom(WEEKLY_QUEST_TEMPLATES, 2);
      weeklyQuests = await Quest.insertMany(
        templates.map((t) => ({
          userId,
          type: 'weekly',
          ...t,
          expiresAt: endOfWeek()
        }))
      );
    }

    // Also get recently completed quests (last 24h)
    const recentCompleted = await Quest.find({
      userId,
      status: 'completed',
      completedAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) }
    }).sort({ completedAt: -1 });

    res.json({
      daily: dailyQuests,
      weekly: weeklyQuests,
      recentCompleted
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching quests:', error);
    res.status(500).json({ error: 'Failed to fetch quests' });
  }
});

// ── POST /api/v1/users/quests/progress — increment quest progress by action ──
router.post('/progress', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { action } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    // Find all active quests that match this action
    const quests = await Quest.find({ userId, status: 'active', action });

    const results = [];
    for (const quest of quests) {
      const result = quest.incrementProgress();
      if (result.changed) {
        await quest.save();

        // If quest completed, award bonus XP
        if (result.completed) {
          try {
            let profile = await Gamification.findOne({ userId });
            if (!profile) {
              profile = await Gamification.create({ userId });
            }
            profile.awardXp(result.xpReward, 'quest_complete', {
              questId: quest._id.toString(),
              questTitle: quest.title
            });
            await profile.save();
          } catch (xpErr) {
            // eslint-disable-next-line no-console
            console.warn('Quest XP award failed:', xpErr.message);
          }
        }

        results.push({
          questId: quest._id,
          title: quest.title,
          currentCount: quest.currentCount,
          targetCount: quest.targetCount,
          completed: result.completed || false,
          xpReward: result.completed ? result.xpReward : 0
        });
      }
    }

    res.json({ updated: results });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error progressing quests:', error);
    res.status(500).json({ error: 'Failed to progress quests' });
  }
});

module.exports = router;

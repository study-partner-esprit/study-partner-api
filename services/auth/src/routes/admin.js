const express = require('express');
const User = require('../models/User');
const { requireRole } = require('@study-partner/shared/auth');

const router = express.Router();

// All admin routes require admin role
router.use(requireRole('admin'));

// GET /admin/users — List all users with tier info
router.get('/users', async (req, res) => {
  try {
    const { tier, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (tier) filter.tier = tier;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const users = await User.find(filter)
      .select('-password -refreshTokens -verificationToken -resetPasswordToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await User.countDocuments(filter);

    res.json({ users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT /admin/users/:userId/tier — Change a user's tier
router.put('/users/:userId/tier', async (req, res) => {
  try {
    const { userId } = req.params;
    const { tier } = req.body;
    const validTiers = ['trial', 'normal', 'vip', 'vip_plus'];

    if (!tier || !validTiers.includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.tier = tier;
    user.tierChangedAt = new Date();
    if (tier === 'trial') {
      user.trialStartedAt = new Date();
      user.trialExpiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    }
    await user.save();

    res.json({ message: 'Tier updated', user: user.toJSON() });
  } catch (error) {
    console.error('Error updating user tier:', error);
    res.status(500).json({ error: 'Failed to update tier' });
  }
});

// GET /admin/stats — Tier distribution
router.get('/stats', async (req, res) => {
  try {
    const stats = await User.aggregate([{ $group: { _id: '$tier', count: { $sum: 1 } } }]);

    const total = await User.countDocuments();
    const distribution = {};
    stats.forEach((s) => {
      distribution[s._id || 'unknown'] = s.count;
    });

    res.json({ total, distribution });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;

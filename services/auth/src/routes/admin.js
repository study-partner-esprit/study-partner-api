const express = require('express');
const Joi = require('joi');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const Payment = require('../models/Payment');
const { requireRole } = require('@study-partner/shared/auth');

const router = express.Router();

// All admin routes require admin role
router.use(requireRole('admin'));

const updatableTiers = ['trial', 'normal', 'vip', 'vip_plus'];

const couponCreateSchema = Joi.object({
  code: Joi.string().trim().min(3).max(100).optional().allow(''),
  targetTier: Joi.string().valid('trial', 'normal', 'vip', 'vip_plus').required(),
  durationDays: Joi.number().integer().min(1).max(365).default(30),
  maxUses: Joi.number().integer().min(1).default(1),
  expiresAt: Joi.date().optional().allow(null)
});

const couponUpdateSchema = Joi.object({
  targetTier: Joi.string().valid('trial', 'normal', 'vip', 'vip_plus').optional(),
  durationDays: Joi.number().integer().min(1).max(365).optional(),
  maxUses: Joi.number().integer().min(1).optional(),
  expiresAt: Joi.date().optional().allow(null),
  isActive: Joi.boolean().optional()
}).min(1);

// GET /admin/users — List all users with tier info
router.get('/users', async (req, res) => {
  try {
    const { tier, isActive, query, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (tier) filter.tier = tier;
    if (typeof isActive !== 'undefined') {
      filter.isActive = String(isActive).toLowerCase() === 'true';
    }
    if (query) {
      filter.$or = [
        { email: { $regex: query, $options: 'i' } },
        { name: { $regex: query, $options: 'i' } }
      ];
    }

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

// GET /admin/users/:userId — User detail
router.get('/users/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('-password -refreshTokens -verificationToken -resetPasswordToken')
      .lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (error) {
    console.error('Error fetching user detail:', error);
    return res.status(500).json({ error: 'Failed to fetch user detail' });
  }
});

// PUT /admin/users/:userId — Update user state/tier/admin status
router.put('/users/:userId', async (req, res) => {
  try {
    const { tier, isActive, isAdmin, role } = req.body || {};
    const updates = {};

    if (typeof tier !== 'undefined') {
      if (!updatableTiers.includes(tier)) {
        return res.status(400).json({ error: 'Invalid tier' });
      }
      updates.tier = tier;
      updates.tierChangedAt = new Date();
    }

    if (typeof isActive !== 'undefined') {
      updates.isActive = !!isActive;
    }

    if (typeof isAdmin !== 'undefined') {
      updates.isAdmin = !!isAdmin;
      updates.role = isAdmin ? 'admin' : role === 'admin' ? 'student' : role || 'student';
    } else if (typeof role !== 'undefined') {
      updates.role = role;
      updates.isAdmin = role === 'admin';
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const user = await User.findByIdAndUpdate(req.params.userId, { $set: updates }, { new: true });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ message: 'User updated', user: user.toJSON() });
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /admin/users/:userId — Soft deactivate user
router.delete('/users/:userId', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { $set: { isActive: false } },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ message: 'User deactivated', user: user.toJSON() });
  } catch (error) {
    console.error('Error deactivating user:', error);
    return res.status(500).json({ error: 'Failed to deactivate user' });
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

// GET /admin/analytics/revenue — monthly revenue + ARR
router.get('/analytics/revenue', async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const monthly = await Payment.aggregate([
      {
        $match: {
          status: 'succeeded',
          createdAt: { $gte: startOfYear }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenueCents: { $sum: { $ifNull: ['$amount', 0] } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const totalRevenueCents = monthly.reduce((sum, row) => sum + row.revenueCents, 0);
    const avgMonthlyRevenueCents = monthly.length
      ? Math.round(totalRevenueCents / monthly.length)
      : 0;
    const arrCents = avgMonthlyRevenueCents * 12;

    return res.json({
      monthly,
      totalRevenueCents,
      avgMonthlyRevenueCents,
      arrCents
    });
  } catch (error) {
    console.error('Error fetching revenue analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch revenue analytics' });
  }
});

// GET /admin/subscriptions — list subscription payments with user context
router.get('/subscriptions', async (req, res) => {
  try {
    const { status = 'succeeded', tier, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (tier) {
      filter.tier = tier;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const subscriptions = await Payment.find(filter)
      .populate('userId', 'email name tier subscriptionStartAt subscriptionEndAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Payment.countDocuments(filter);
    return res.json({ subscriptions, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// PUT /admin/subscriptions/:paymentId/cancel — force cancel subscription and downgrade user
router.put('/subscriptions/:paymentId/cancel', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId);
    if (!payment) {
      return res.status(404).json({ error: 'Subscription payment not found' });
    }

    payment.status = 'canceled';
    await payment.save();

    const user = await User.findById(payment.userId);
    if (user) {
      user.tier = 'normal';
      user.tierChangedAt = new Date();
      user.subscriptionId = null;
      user.subscriptionStartAt = null;
      user.subscriptionEndAt = null;
      user.subscriptionDurationMonths = 0;
      user.renewalDate = null;
      user.canChangeAfter = null;
      user.autoRenew = false;
      await user.save();
    }

    return res.json({ message: 'Subscription canceled', payment, user: user?.toJSON?.() || null });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// GET /admin/coupons — list all coupons
router.get('/coupons', async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .populate('createdBy', 'email name')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ coupons });
  } catch (error) {
    console.error('Error fetching coupons:', error);
    return res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

// POST /admin/coupons — create coupon
router.post('/coupons', async (req, res) => {
  try {
    const { error, value } = couponCreateSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const code = String(value.code || `partner-${Math.random().toString(36).slice(2, 10)}`)
      .trim()
      .toLowerCase();

    const existing = await Coupon.findOne({ code });
    if (existing) {
      return res.status(409).json({ error: 'Coupon code already exists' });
    }

    const coupon = await Coupon.create({
      code,
      targetTier: value.targetTier,
      durationDays: value.durationDays,
      maxUses: value.maxUses,
      expiresAt: value.expiresAt || null,
      createdBy: req.user.userId,
      isActive: true
    });

    return res.status(201).json({ message: 'Coupon created', coupon });
  } catch (error) {
    console.error('Error creating coupon:', error);
    return res.status(500).json({ error: 'Failed to create coupon' });
  }
});

// PUT /admin/coupons/:couponId — update coupon
router.put('/coupons/:couponId', async (req, res) => {
  try {
    const { error, value } = couponUpdateSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const coupon = await Coupon.findByIdAndUpdate(
      req.params.couponId,
      { $set: value },
      { new: true }
    );
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    return res.json({ message: 'Coupon updated', coupon });
  } catch (error) {
    console.error('Error updating coupon:', error);
    return res.status(500).json({ error: 'Failed to update coupon' });
  }
});

// DELETE /admin/coupons/:couponId — soft delete (deactivate)
router.delete('/coupons/:couponId', async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.couponId,
      { $set: { isActive: false } },
      { new: true }
    );
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    return res.json({ message: 'Coupon deactivated', coupon });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    return res.status(500).json({ error: 'Failed to deactivate coupon' });
  }
});

// GET /admin/coupons/:couponId/usage — usage history
router.get('/coupons/:couponId/usage', async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.couponId)
      .populate('usageHistory.userId', 'email name')
      .lean();
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    return res.json({
      coupon: {
        _id: coupon._id,
        code: coupon.code,
        targetTier: coupon.targetTier,
        durationDays: coupon.durationDays,
        maxUses: coupon.maxUses,
        usageCount: coupon.usageCount,
        usageHistory: coupon.usageHistory || []
      }
    });
  } catch (error) {
    console.error('Error fetching coupon usage:', error);
    return res.status(500).json({ error: 'Failed to fetch coupon usage' });
  }
});

module.exports = router;

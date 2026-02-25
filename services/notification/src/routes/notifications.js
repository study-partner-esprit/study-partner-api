const express = require('express');
const Joi = require('joi');
const Notification = require('../models/Notification');

const router = express.Router();

// ── Validation schemas ──────────────────────────────
const createSchema = Joi.object({
  userId: Joi.string().required(),
  type: Joi.string().valid(
    'study_reminder', 'break_suggestion', 'plan_generated',
    'task_due', 'session_suspended', 'fatigue_alert',
    'focus_drop', 'achievement', 'schedule_change', 'system'
  ).required(),
  title: Joi.string().max(200).required(),
  message: Joi.string().max(2000).required(),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal'),
  metadata: Joi.object().default({})
});

// ── GET /api/v1/notifications?userId=...&status=...&limit=... ──
router.get('/', async (req, res, next) => {
  try {
    const { userId, status, limit = 50, offset = 0 } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }

    const filter = { userId };
    if (status) filter.status = status;

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(Number(offset))
        .limit(Number(limit))
        .lean(),
      Notification.countDocuments(filter)
    ]);

    const unreadCount = await Notification.countDocuments({ userId, status: 'unread' });

    res.json({ notifications, total, unreadCount });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/notifications ──
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const notification = await Notification.create(value);
    res.status(201).json(notification);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/v1/notifications/:id/read ──
router.patch('/:id/read', async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { status: 'read', readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(notification);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/v1/notifications/read-all?userId=... ──
router.patch('/read-all', async (req, res, next) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }

    const result = await Notification.updateMany(
      { userId, status: 'unread' },
      { status: 'read', readAt: new Date() }
    );

    res.json({ modifiedCount: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/v1/notifications/:id ──
router.delete('/:id', async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { status: 'dismissed' },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification dismissed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const Joi = require('joi');
const Notification = require('../models/Notification');
const { isEmailEnabled, sendNotificationEmail } = require('../services/emailService');
const { requireInternalOrAdmin } = require('@study-partner/shared/auth');

const router = express.Router();

// ── Validation schemas ──────────────────────────────
const createSchema = Joi.object({
  userId: Joi.string().required(),
  type: Joi.string()
    .valid(
      'study_reminder',
      'break_suggestion',
      'plan_generated',
      'task_due',
      'session_suspended',
      'fatigue_alert',
      'focus_drop',
      'achievement',
      'level_up',
      'quest_complete',
      'schedule_change',
      'system',
      'team_invite',
      'team_join',
      'session_start',
      'friend_request',
      'friend_accepted',
      'friend_studying'
    )
    .required(),
  title: Joi.string().max(200).required(),
  message: Joi.string().max(2000).required(),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal'),
  metadata: Joi.object().default({}),
  data: Joi.object().optional()
});

// ── GET /api/v1/notifications?status=...&limit=... ──
// Scoped to the authenticated user (req.user.userId); the userId query param is ignored.
router.get('/', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const dbTimeoutMs = Number(process.env.NOTIFICATION_DB_TIMEOUT_MS || 8000);
    const userId = req.user.userId;

    const filter = { userId };
    if (status) filter.status = status;

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(Number(offset))
        .limit(Number(limit))
        .maxTimeMS(dbTimeoutMs)
        .lean(),
      Notification.countDocuments(filter).maxTimeMS(dbTimeoutMs)
    ]);

    const unreadCount = await Notification.countDocuments({ userId, status: 'unread' }).maxTimeMS(
      dbTimeoutMs
    );

    res.json({ notifications, total, unreadCount });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/notifications/broadcast — fire WS only, no DB storage ──
// Internal services only (or admins).
router.post('/broadcast', requireInternalOrAdmin, async (req, res, next) => {
  try {
    const { userIds, payload } = req.body;
    if (!Array.isArray(userIds) || !payload) {
      return res.status(400).json({ error: 'userIds (array) and payload are required' });
    }
    const broadcastToUser = req.app.locals.broadcastToUser;
    if (broadcastToUser) {
      userIds.forEach((uid) => broadcastToUser(uid, payload));
    }
    res.json({ delivered: userIds.length });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/notifications — internal services only (or admins) ──
router.post('/', requireInternalOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const normalizedValue = {
      ...value,
      metadata:
        value.metadata && Object.keys(value.metadata).length > 0 ? value.metadata : value.data || {}
    };
    delete normalizedValue.data;

    const notification = await Notification.create(normalizedValue);

    // Push via WebSocket if available
    const broadcastToUser = req.app.locals.broadcastToUser;
    if (broadcastToUser) {
      broadcastToUser(normalizedValue.userId, {
        type: 'new_notification',
        notification: notification.toObject()
      });
    }

    const shouldEmail =
      isEmailEnabled() &&
      ['achievement', 'level_up', 'study_reminder', 'session_start', 'plan_generated'].includes(
        notification.type
      );

    let emailResult = null;
    if (shouldEmail) {
      emailResult = await sendNotificationEmail({ req, notification: notification.toObject() });
    }

    res.status(201).json({ ...notification.toObject(), email: emailResult });
  } catch (err) {
    next(err);
  }
});

router.post('/email/test', requireInternalOrAdmin, async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Email test disabled in production' });
    }

    const payload = {
      type: req.body?.type || 'system',
      title: req.body?.title || 'Test Email Notification',
      message: req.body?.message || 'This is a test email from Study Partner.',
      metadata: req.body?.metadata || {}
    };

    const result = await sendNotificationEmail({ req, notification: payload });
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/v1/notifications/:id/read — owner-only ──
router.patch('/:id/read', async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
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

// ── PATCH /api/v1/notifications/read-all — scoped to authenticated user ──
router.patch('/read-all', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const result = await Notification.updateMany(
      { userId, status: 'unread' },
      { status: 'read', readAt: new Date() }
    );

    res.json({ modifiedCount: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/v1/notifications/:id — owner-only ──
router.delete('/:id', async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
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

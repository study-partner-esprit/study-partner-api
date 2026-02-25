const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'study_reminder',
      'break_suggestion',
      'plan_generated',
      'task_due',
      'session_suspended',
      'fatigue_alert',
      'focus_drop',
      'achievement',
      'schedule_change',
      'system'
    ]
  },
  title: {
    type: String,
    required: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    maxlength: 2000
  },
  status: {
    type: String,
    enum: ['unread', 'read', 'dismissed'],
    default: 'unread',
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  readAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound index for common queries
notificationSchema.index({ userId: 1, status: 1, createdAt: -1 });

// Auto-expire dismissed notifications after 30 days
notificationSchema.index({ updatedAt: 1 }, {
  expireAfterSeconds: 30 * 24 * 60 * 60,
  partialFilterExpression: { status: 'dismissed' }
});

module.exports = mongoose.model('Notification', notificationSchema);

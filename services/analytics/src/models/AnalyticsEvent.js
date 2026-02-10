const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  eventType: {
    type: String,
    required: true,
    enum: [
      'study_session_started',
      'study_session_completed',
      'task_created',
      'task_completed',
      'course_ingested',
      'plan_generated',
      'focus_tracked',
      'login',
      'profile_updated'
    ]
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Index for efficient time-based queries
analyticsEventSchema.index({ userId: 1, timestamp: -1 });
analyticsEventSchema.index({ eventType: 1, timestamp: -1 });

const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

module.exports = AnalyticsEvent;

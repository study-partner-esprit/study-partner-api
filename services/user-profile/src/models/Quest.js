const mongoose = require('mongoose');

const questSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['daily', 'weekly'],
      required: true
    },
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      default: ''
    },
    icon: {
      type: String,
      default: '🎯'
    },
    // What action triggers progress
    action: {
      type: String,
      required: true,
      enum: ['task_complete', 'course_upload', 'focus_session', 'study_session', 'review_complete']
    },
    // How many of the action are needed
    targetCount: {
      type: Number,
      required: true,
      min: 1
    },
    currentCount: {
      type: Number,
      default: 0,
      min: 0
    },
    xpReward: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'expired'],
      default: 'active'
    },
    completedAt: {
      type: Date
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Compound index for efficient lookup
questSchema.index({ userId: 1, status: 1, type: 1 });

// Progress a quest by 1 (or more)
questSchema.methods.incrementProgress = function (amount = 1) {
  if (this.status !== 'active') return { changed: false };

  this.currentCount = Math.min(this.currentCount + amount, this.targetCount);

  if (this.currentCount >= this.targetCount) {
    this.status = 'completed';
    this.completedAt = new Date();
    return { changed: true, completed: true, xpReward: this.xpReward };
  }

  return { changed: true, completed: false };
};

const Quest = mongoose.model('Quest', questSchema);

module.exports = Quest;

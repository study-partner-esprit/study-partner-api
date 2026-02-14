const mongoose = require('mongoose');

const gamificationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  totalXp: {
    type: Number,
    default: 0,
    min: 0
  },
  level: {
    type: Number,
    default: 1,
    min: 1
  },
  xpHistory: [{
    action: {
      type: String,
      required: true
    },
    xp: {
      type: Number,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed
    }
  }],
  achievements: [{
    id: String,
    name: String,
    description: String,
    unlockedAt: Date,
    icon: String
  }],
  stats: {
    coursesUploaded: {
      type: Number,
      default: 0
    },
    tasksCompleted: {
      type: Number,
      default: 0
    },
    perfectSessions: {
      type: Number,
      default: 0
    },
    currentStreak: {
      type: Number,
      default: 0
    },
    longestStreak: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Calculate level based on XP (100 XP per level)
gamificationSchema.methods.calculateLevel = function() {
  return Math.floor(this.totalXp / 100) + 1;
};

// Award XP and check for level up
gamificationSchema.methods.awardXp = function(xp, action, metadata = {}) {
  const oldLevel = this.level;
  this.totalXp += xp;
  this.level = this.calculateLevel();
  
  this.xpHistory.push({
    action,
    xp,
    metadata,
    timestamp: new Date()
  });
  
  return {
    xpAwarded: xp,
    totalXp: this.totalXp,
    oldLevel,
    newLevel: this.level,
    leveledUp: this.level > oldLevel
  };
};

const Gamification = mongoose.model('Gamification', gamificationSchema);

module.exports = Gamification;

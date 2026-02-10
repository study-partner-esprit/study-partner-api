const mongoose = require('mongoose');

const userProfileSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  bio: {
    type: String,
    maxlength: 500
  },
  avatar: {
    type: String
  },
  preferences: {
    studyTime: {
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'night'],
      default: 'evening'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      }
    },
    theme: {
      type: String,
      enum: ['light', 'dark'],
      default: 'dark'
    },
    language: {
      type: String,
      default: 'en'
    }
  },
  stats: {
    totalStudyTime: {
      type: Number,
      default: 0
    },
    completedTasks: {
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
  },
  goals: [{
    title: String,
    target: Number,
    current: Number,
    deadline: Date,
    completed: {
      type: Boolean,
      default: false
    }
  }]
}, {
  timestamps: true
});

const UserProfile = mongoose.model('UserProfile', userProfileSchema);

module.exports = UserProfile;

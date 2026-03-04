const mongoose = require('mongoose');
const crypto = require('crypto');

const userProfileSchema = new mongoose.Schema(
  {
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
      type: String,
      default: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix'
    },
    nickname: {
      type: String,
      trim: true
    },
    friendCode: {
      type: String,
      unique: true,
      sparse: true,
      default: () => crypto.randomBytes(4).toString('hex').toUpperCase()
    },
    onlineStatus: {
      type: String,
      enum: ['online', 'studying', 'offline'],
      default: 'offline'
    },
    lastSeenAt: { type: Date },
    privacy: {
      showOnlineStatus: { type: Boolean, default: true },
      showStudyActivity: { type: Boolean, default: true },
      showStats: { type: Boolean, default: true },
      allowRequests: { type: String, enum: ['everyone', 'nobody'], default: 'everyone' }
    },
    level: {
      current: { type: Number, default: 1 },
      xp: { type: Number, default: 0 },
      title: { type: String, default: 'Novice Explorer' }
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
    goals: [
      {
        title: String,
        target: Number,
        current: Number,
        deadline: Date,
        completed: {
          type: Boolean,
          default: false
        }
      }
    ],
    // Background Customization (Level 10 unlock)
    backgroundSettings: {
      enabled: { type: Boolean, default: false },
      type: { type: String, enum: ['preset', 'uploaded', 'url'], default: 'preset' },
      imageUrl: { type: String },
      opacity: { type: Number, default: 0.3, min: 0.05, max: 0.5 },
      blur: { type: Number, default: 5, min: 0, max: 10 },
      position: { type: String, enum: ['cover', 'contain', 'repeat'], default: 'cover' },
      uploadedAt: { type: Date }
    },
    // Animated Background (Level 20 unlock)
    animatedBackgroundSettings: {
      enabled: { type: Boolean, default: false },
      type: { type: String, enum: ['preset', 'uploaded', 'url'], default: 'preset' },
      videoUrl: { type: String },
      fileName: { type: String },
      opacity: { type: Number, default: 0.15, min: 0.05, max: 0.3 },
      brightness: { type: Number, default: 0, min: -50, max: 50 },
      saturation: { type: Number, default: 100, min: 0, max: 150 },
      loop: { type: Boolean, default: true },
      speed: { type: Number, default: 1, min: 0.5, max: 2 },
      uploadedAt: { type: Date }
    },
    // Team Stats
    teamStats: {
      teamSessionsCompleted: { type: Number, default: 0 },
      currentTeam: { type: String },
      friendsInTeams: { type: Number, default: 0 },
      preferredTeammates: [{ type: String }]
    }
  },
  {
    timestamps: true
  }
);

const UserProfile = mongoose.model('UserProfile', userProfileSchema);

module.exports = UserProfile;

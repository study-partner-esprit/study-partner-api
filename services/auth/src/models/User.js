const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    role: {
      type: String,
      enum: ['student', 'admin'],
      default: 'student'
    },
    isAdmin: {
      type: Boolean,
      default: false,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    refreshTokens: [
      {
        token: String,
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    lastLogin: {
      type: Date
    },
    tier: {
      type: String,
      enum: ['trial', 'normal', 'vip', 'vip_plus'],
      default: 'trial'
    },
    trialStartedAt: {
      type: Date,
      default: Date.now
    },
    trialExpiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    },
    tierChangedAt: {
      type: Date
    },
    subscriptionId: {
      type: String
    },
    subscriptionStartAt: {
      type: Date,
      default: null
    },
    subscriptionEndAt: {
      type: Date,
      default: null,
      index: true
    },
    subscriptionDurationMonths: {
      type: Number,
      default: 0
    },
    autoRenew: {
      type: Boolean,
      default: false
    },
    renewalDate: {
      type: Date,
      default: null
    },
    canChangeAfter: {
      type: Date,
      default: null
    },
    subscriptionExpiryNoticeSentAt: {
      type: Date,
      default: null
    },
    stripeCustomerId: {
      type: String
    },
    verificationToken: { type: String },
    verificationExpires: { type: Date },
    verificationOtp: { type: String },
    verificationOtpExpires: { type: Date },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    notificationPreferences: {
      type: {
        emailOnVerification: { type: Boolean, default: true },
        emailOnLevelUp: { type: Boolean, default: true },
        emailOnTaskDue: { type: Boolean, default: false },
        emailOnSessionReminder: { type: Boolean, default: false },
        emailOnWeeklySummary: { type: Boolean, default: true },
        emailOnAchievement: { type: Boolean, default: true },
        emailOnPasswordReset: { type: Boolean, default: true },
        emailOnSubscriptionUpdate: { type: Boolean, default: true }
      },
      default: () => ({
        emailOnVerification: true,
        emailOnLevelUp: true,
        emailOnTaskDue: false,
        emailOnSessionReminder: false,
        emailOnWeeklySummary: true,
        emailOnAchievement: true,
        emailOnPasswordReset: true,
        emailOnSubscriptionUpdate: true
      })
    },
    onboardingDraft: {
      studyGoals: {
        type: [String],
        default: []
      },
      preferredSubjects: {
        type: [String],
        default: []
      },
      weeklyHours: {
        type: Number,
        min: 0,
        default: 0
      },
      studyLevel: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced'],
        default: 'beginner'
      },
      studyTime: {
        type: String,
        enum: ['morning', 'afternoon', 'evening', 'night'],
        default: 'evening'
      },
      timezone: {
        type: String,
        default: 'UTC'
      },
      language: {
        type: String,
        default: 'en'
      },
      notificationPreferences: {
        email: {
          type: Boolean,
          default: true
        },
        push: {
          type: Boolean,
          default: true
        }
      }
    },
    onboardingCompletedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Remove password from JSON representation
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.refreshTokens;
  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;

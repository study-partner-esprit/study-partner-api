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
    resetPasswordExpires: { type: Date }
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

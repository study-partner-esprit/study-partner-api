const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true
    },
    targetTier: {
      type: String,
      enum: ['trial', 'normal', 'vip', 'vip_plus'],
      required: true,
      index: true
    },
    durationDays: {
      type: Number,
      min: 1,
      max: Number(process.env.COUPON_MAX_DURATION || 365),
      default: 30
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    maxUses: {
      type: Number,
      default: 1
    },
    usageCount: {
      type: Number,
      default: 0
    },
    usedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    usageHistory: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        redeemedAt: {
          type: Date,
          default: Date.now
        }
      }
    ]
  },
  {
    timestamps: true
  }
);

couponSchema.methods.isRedeemableBy = function isRedeemableBy(userId) {
  if (!this.isActive) {
    return { redeemable: false, reason: 'Coupon is inactive' };
  }

  if (this.expiresAt && new Date(this.expiresAt) <= new Date()) {
    return { redeemable: false, reason: 'Coupon has expired' };
  }

  if (this.maxUses !== -1 && this.usageCount >= this.maxUses) {
    return { redeemable: false, reason: 'Coupon usage limit reached' };
  }

  if (this.usedBy.some((id) => String(id) === String(userId))) {
    return { redeemable: false, reason: 'Coupon already used by this user' };
  }

  return { redeemable: true };
};

module.exports = mongoose.model('Coupon', couponSchema);

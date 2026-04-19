const mongoose = require('mongoose');

const rankBadgeSchema = new mongoose.Schema(
  {
    rankIndex: {
      type: Number,
      required: true,
      unique: true,
      index: true,
      min: 0
    },
    rankName: {
      type: String,
      required: true,
      trim: true
    },
    tier: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    division: {
      type: String,
      default: null
    },
    badgeKey: {
      type: String,
      required: true,
      enum: ['first', 'second', 'third', 'use']
    },
    imagePath: {
      type: String,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('RankBadge', rankBadgeSchema);

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    stripeEventId: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },
    stripeCheckoutSessionId: {
      type: String,
      index: true
    },
    stripeSubscriptionId: {
      type: String,
      index: true
    },
    stripeCustomerId: {
      type: String,
      index: true
    },
    tier: {
      type: String,
      enum: ['normal', 'vip', 'vip_plus'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'canceled'],
      default: 'pending',
      index: true
    },
    amount: {
      type: Number
    },
    currency: {
      type: String,
      default: 'usd'
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Payment', paymentSchema);

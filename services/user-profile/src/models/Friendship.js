const mongoose = require('mongoose');

const friendshipSchema = new mongoose.Schema(
  {
    requester: { type: String, required: true, index: true },
    recipient: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'blocked'],
      default: 'pending',
      index: true
    }
  },
  { timestamps: true }
);

// One request per pair
friendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });

module.exports = mongoose.model('Friendship', friendshipSchema);

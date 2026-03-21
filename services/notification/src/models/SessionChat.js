const mongoose = require('mongoose');

const searchResultSchema = new mongoose.Schema(
  {
    title: String,
    snippet: String,
    source: String,
    url: String,
    relevanceScore: Number
  },
  { _id: false }
);

const sessionChatSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    messageType: {
      type: String,
      enum: ['query', 'result', 'coach_suggestion'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    searchQuery: {
      type: String,
      default: ''
    },
    searchResults: {
      type: [searchResultSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

sessionChatSchema.index({ sessionId: 1, createdAt: -1 });

module.exports = mongoose.model('SessionChat', sessionChatSchema);

const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    peerId: { type: String, default: '' },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    isMuted: { type: Boolean, default: false },
    speakingStatus: {
      type: String,
      enum: ['silent', 'speaking', 'loud'],
      default: 'silent'
    },
    connectionState: {
      type: String,
      enum: ['connecting', 'connected', 'disconnected', 'failed'],
      default: 'connecting'
    },
    speakingTime: { type: Number, default: 0 },
    mutedDuration: { type: Number, default: 0 },
    lastHeartbeat: { type: Date, default: Date.now }
  },
  { _id: false }
);

const voiceSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    recordingUrl: { type: String, default: null },
    participants: {
      type: [participantSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('VoiceSession', voiceSessionSchema);

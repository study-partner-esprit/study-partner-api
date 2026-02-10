const mongoose = require('mongoose');

const focusSessionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  studySessionId: {
    type: String
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date
  },
  focusScore: {
    type: Number,
    min: 0,
    max: 100
  },
  dataPoints: [{
    timestamp: Date,
    focusLevel: Number,
    isDistracted: Boolean,
    gazeData: {
      x: Number,
      y: Number
    }
  }],
  summary: {
    totalFocusTime: Number,
    totalDistractedTime: Number,
    avgFocusLevel: Number,
    breakCount: Number
  }
}, {
  timestamps: true
});

const FocusSession = mongoose.model('FocusSession', focusSessionSchema);

module.exports = FocusSession;

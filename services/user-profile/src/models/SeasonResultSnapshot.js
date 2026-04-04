const mongoose = require('mongoose');

const seasonResultSnapshotSchema = new mongoose.Schema(
  {
    seasonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RankSeason',
      required: true,
      index: true
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    position: {
      type: Number,
      min: 1,
      default: null
    },
    finalRankIndex: {
      type: Number,
      required: true
    },
    finalKnowledgePoints: {
      type: Number,
      required: true,
      default: 0
    },
    // Compatibility alias (legacy RP naming).
    finalRankName: {
      type: String,
      required: true
    },
    seasonPeakKp: {
      type: Number,
      default: null
    },
    seasonPeakRankIndex: {
      type: Number,
      default: null
    },
    eventsCount: {
      type: Number,
      default: 0
    },
    rewardsGranted: {
      type: [String],
      default: []
    },
    resetApplied: {
      demotedBy: { type: Number, default: 0 },
      newRankIndex: { type: Number, default: 0 },
      newRankName: { type: String, default: null },
      seasonFloorIndex: { type: Number, default: 0 }
    },
    snapshotAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

seasonResultSnapshotSchema.pre('save', function normalizePoints(next) {
  if (!Number.isFinite(this.finalKnowledgePoints)) {
    this.finalKnowledgePoints = 0;
  }
  if (!Number.isFinite(this.seasonPeakKp)) {
    this.seasonPeakKp = null;
  }
  next();
});

seasonResultSnapshotSchema.index({ seasonId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('SeasonResultSnapshot', seasonResultSnapshotSchema);

const mongoose = require('mongoose');
const { DEFAULT_SEASON_FLOOR_INDEX } = require('./rankingConfig');

const rankSeasonSchema = new mongoose.Schema(
  {
    seasonCode: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    name: {
      type: String,
      required: true
    },
    theme: {
      type: String,
      default: null
    },
    startAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    },
    endAt: {
      type: Date,
      default: null,
      index: true
    },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'closed', 'archived'],
      default: 'active',
      index: true
    },
    resetPolicy: {
      lowBracketDrop: {
        type: Number,
        min: 0,
        max: 10,
        default: 3
      },
      highBracketDrop: {
        type: Number,
        min: 0,
        max: 10,
        default: 5
      },
      seasonFloorIndex: {
        type: Number,
        min: 0,
        default: DEFAULT_SEASON_FLOOR_INDEX
      }
    },
    startedBy: {
      type: String,
      default: null
    },
    closedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

rankSeasonSchema.statics.getActiveSeason = async function getActiveSeason(at = new Date()) {
  return this.findOne({
    status: 'active',
    startAt: { $lte: at },
    $or: [{ endAt: null }, { endAt: { $gt: at } }]
  })
    .sort({ startAt: -1 })
    .lean(false);
};

module.exports = mongoose.model('RankSeason', rankSeasonSchema);

const mongoose = require('mongoose');
const {
  DEFAULT_KP,
  DEFAULT_SEASON_FLOOR_INDEX,
  getRankByKp,
  getRankByIndex,
  isLowBracket
} = require('./rankingConfig');

const userRankProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    currentSeasonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RankSeason',
      default: null,
      index: true
    },
    knowledgePoints: {
      type: Number,
      min: 0,
      default: DEFAULT_KP,
      index: true
    },
    rankIndex: {
      type: Number,
      min: 0,
      default: DEFAULT_SEASON_FLOOR_INDEX,
      index: true
    },
    rankName: {
      type: String,
      default: getRankByIndex(DEFAULT_SEASON_FLOOR_INDEX).name
    },
    seasonPeakRankIndex: {
      type: Number,
      min: 0,
      default: DEFAULT_SEASON_FLOOR_INDEX
    },
    allTimePeakRankIndex: {
      type: Number,
      min: 0,
      default: DEFAULT_SEASON_FLOOR_INDEX
    },
    seasonPeakKp: {
      type: Number,
      min: 0,
      default: DEFAULT_KP
    },
    allTimePeakKp: {
      type: Number,
      min: 0,
      default: DEFAULT_KP
    },
    competitiveEventsCountSeason: {
      type: Number,
      min: 0,
      default: 0
    },
    learningSkillRating: {
      type: Number,
      min: 0,
      default: 1000
    },
    currentStreak: {
      type: Number,
      min: 0,
      default: 0
    },
    comebackBonusRemaining: {
      type: Number,
      min: 0,
      default: 0
    },
    lastActivityAt: {
      type: Date,
      default: null,
      index: true
    },
    lastEventAt: {
      type: Date,
      default: null
    },
    lastResetAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

userRankProfileSchema.methods.syncRankFromPoints = function syncRankFromPoints() {
  const safeKp = Math.max(0, Number(this.knowledgePoints) || 0);
  this.knowledgePoints = safeKp;

  const rank = getRankByKp(safeKp);
  this.rankIndex = rank.index;
  this.rankName = rank.name;
  return rank;
};

userRankProfileSchema.methods.applyKnowledgeDelta = function applyKnowledgeDelta(deltaKp) {
  const delta = Number.isFinite(deltaKp) ? Math.trunc(deltaKp) : 0;
  const beforeKp = Math.max(0, Number(this.knowledgePoints) || 0);
  const beforeRank = getRankByKp(beforeKp);

  this.knowledgePoints = Math.max(0, beforeKp + delta);
  const afterRank = this.syncRankFromPoints();

  if (this.rankIndex > (this.seasonPeakRankIndex || 0)) {
    this.seasonPeakRankIndex = this.rankIndex;
  }
  if (this.rankIndex > (this.allTimePeakRankIndex || 0)) {
    this.allTimePeakRankIndex = this.rankIndex;
  }
  if (this.knowledgePoints > (this.seasonPeakKp || 0)) {
    this.seasonPeakKp = this.knowledgePoints;
  }
  if (this.knowledgePoints > (this.allTimePeakKp || 0)) {
    this.allTimePeakKp = this.knowledgePoints;
  }

  this.competitiveEventsCountSeason = (this.competitiveEventsCountSeason || 0) + 1;
  this.lastEventAt = new Date();
  this.lastActivityAt = this.lastEventAt;

  return {
    deltaKp: delta,
    beforeKp,
    afterKp: this.knowledgePoints,
    beforeRankIndex: beforeRank.index,
    afterRankIndex: afterRank.index,
    rankUp: afterRank.index > beforeRank.index,
    rankDown: afterRank.index < beforeRank.index
  };
};

userRankProfileSchema.methods.applySeasonReset = function applySeasonReset(resetPolicy = {}) {
  const lowBracketDrop = Number.isFinite(resetPolicy.lowBracketDrop)
    ? resetPolicy.lowBracketDrop
    : 3;
  const highBracketDrop = Number.isFinite(resetPolicy.highBracketDrop)
    ? resetPolicy.highBracketDrop
    : 5;
  const seasonFloorIndex = Number.isFinite(resetPolicy.seasonFloorIndex)
    ? resetPolicy.seasonFloorIndex
    : DEFAULT_SEASON_FLOOR_INDEX;

  const oldRankIndex = this.rankIndex;
  const demotedBy = isLowBracket(oldRankIndex) ? lowBracketDrop : highBracketDrop;
  const newRankIndex = Math.max(seasonFloorIndex, oldRankIndex - demotedBy);
  const newRank = getRankByIndex(newRankIndex);

  this.rankIndex = newRank.index;
  this.rankName = newRank.name;
  const rankFloor = Number.isFinite(newRank.minKp) ? newRank.minKp : DEFAULT_KP;
  this.knowledgePoints = rankFloor;

  this.seasonPeakRankIndex = this.rankIndex;
  this.seasonPeakKp = this.knowledgePoints;
  this.competitiveEventsCountSeason = 0;
  this.currentStreak = 0;
  this.comebackBonusRemaining = 5;
  this.lastResetAt = new Date();

  return {
    oldRankIndex,
    newRankIndex,
    demotedBy,
    seasonFloorIndex
  };
};

userRankProfileSchema.pre('save', function syncBeforeSave(next) {
  if (this.isModified('knowledgePoints') && !this.isModified('rankIndex')) {
    this.syncRankFromPoints();
  }

  if (!Number.isFinite(this.seasonPeakKp)) {
    this.seasonPeakKp = Math.max(0, Number(this.knowledgePoints) || DEFAULT_KP);
  }
  if (!Number.isFinite(this.allTimePeakKp)) {
    this.allTimePeakKp = Math.max(0, Number(this.knowledgePoints) || DEFAULT_KP);
  }

  next();
});

module.exports = mongoose.model('UserRankProfile', userRankProfileSchema);

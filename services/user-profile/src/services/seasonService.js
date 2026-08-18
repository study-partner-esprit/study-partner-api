const RankSeason = require('../models/RankSeason');
const UserRankProfile = require('../models/UserRankProfile');
const SeasonResultSnapshot = require('../models/SeasonResultSnapshot');
const {
  DEFAULT_SEASON_FLOOR_INDEX,
  getRankByIndex,
  isLowBracket
} = require('../models/rankingConfig');

function toSeasonCode(date = new Date()) {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${year}-S${quarter}`;
}

function deriveNextSeasonCode(currentCode) {
  const match = String(currentCode || '').match(/^(\d{4})-S([1-4])$/);
  if (!match) {
    const now = new Date();
    now.setUTCMonth(now.getUTCMonth() + 3);
    return toSeasonCode(now);
  }

  const year = Number(match[1]);
  const quarter = Number(match[2]);
  if (quarter < 4) {
    return `${year}-S${quarter + 1}`;
  }

  return `${year + 1}-S1`;
}

async function getOrCreateActiveSeason() {
  const now = new Date();
  let season = await RankSeason.getActiveSeason(now);
  if (season) return season;

  const seasonCode = toSeasonCode(now);
  season = await RankSeason.findOne({ seasonCode, status: { $in: ['upcoming', 'active'] } });

  if (season) {
    season.status = 'active';
    if (!season.startAt) season.startAt = now;
    if (season.endAt && season.endAt <= now) season.endAt = null;
    await season.save();
    return season;
  }

  season = await RankSeason.create({
    seasonCode,
    name: `Season ${seasonCode}`,
    theme: null,
    status: 'active',
    startAt: now,
    resetPolicy: {
      lowBracketDrop: 3,
      highBracketDrop: 5,
      seasonFloorIndex: DEFAULT_SEASON_FLOOR_INDEX
    }
  });

  return season;
}

async function ensureUserRankProfile(userId, seasonId) {
  let profile = await UserRankProfile.findOne({ userId });

  if (!profile) {
    profile = await UserRankProfile.create({ userId, currentSeasonId: seasonId });
    return profile;
  }

  if (!profile.currentSeasonId || String(profile.currentSeasonId) !== String(seasonId)) {
    profile.currentSeasonId = seasonId;
    profile.seasonPeakRankIndex = profile.rankIndex;
    const points = Math.max(0, Number(profile.knowledgePoints || 0));
    profile.seasonPeakKp = points;
    profile.competitiveEventsCountSeason = 0;
    profile.currentStreak = 0;
    await profile.save();
  }

  return profile;
}

function computeResetPreviewForProfile(profile, resetPolicy = {}) {
  const lowBracketDrop = Number.isFinite(resetPolicy.lowBracketDrop)
    ? resetPolicy.lowBracketDrop
    : 3;
  const highBracketDrop = Number.isFinite(resetPolicy.highBracketDrop)
    ? resetPolicy.highBracketDrop
    : 5;
  const seasonFloorIndex = Number.isFinite(resetPolicy.seasonFloorIndex)
    ? resetPolicy.seasonFloorIndex
    : DEFAULT_SEASON_FLOOR_INDEX;

  const oldRankIndex = profile.rankIndex;
  const demotedBy = isLowBracket(oldRankIndex) ? lowBracketDrop : highBracketDrop;
  const newRankIndex = Math.max(seasonFloorIndex, oldRankIndex - demotedBy);
  const newRank = getRankByIndex(newRankIndex);
  const oldPoints = Math.max(0, Number(profile.knowledgePoints || 0));

  return {
    userId: profile.userId,
    oldRankIndex,
    oldRankName: profile.rankName,
    oldKnowledgePoints: oldPoints,
    demotedBy,
    newRankIndex,
    newRankName: newRank.name,
    seasonFloorIndex
  };
}

async function previewSeasonReset(seasonId = null) {
  const season = seasonId ? await RankSeason.findById(seasonId) : await getOrCreateActiveSeason();
  if (!season) {
    throw new Error('Season not found');
  }

  const profiles = await UserRankProfile.find({ currentSeasonId: season._id })
    .sort({ knowledgePoints: -1 })
    .select('userId rankIndex rankName knowledgePoints')
    .lean();

  const preview = profiles.map((profile) =>
    computeResetPreviewForProfile(profile, season.resetPolicy)
  );
  return { season, preview };
}

async function startSeason({ seasonCode, name, theme = null, startedBy }) {
  const activeSeason = await RankSeason.getActiveSeason(new Date());
  if (activeSeason) {
    throw new Error('An active season already exists. Close it before starting a new one.');
  }

  const now = new Date();
  const code = seasonCode || toSeasonCode(now);
  const seasonName = name || `Season ${code}`;

  let season = await RankSeason.findOne({ seasonCode: code });
  if (season) {
    season.status = 'active';
    season.startAt = now;
    season.endAt = null;
    season.theme = theme || season.theme || null;
    season.startedBy = startedBy || null;
    await season.save();
    return season;
  }

  season = await RankSeason.create({
    seasonCode: code,
    name: seasonName,
    theme,
    status: 'active',
    startAt: now,
    startedBy: startedBy || null,
    resetPolicy: {
      lowBracketDrop: 3,
      highBracketDrop: 5,
      seasonFloorIndex: DEFAULT_SEASON_FLOOR_INDEX
    }
  });

  return season;
}

async function closeSeasonAndStartNext({ seasonId = null, startedBy = null }) {
  const season = seasonId ? await RankSeason.findById(seasonId) : await getOrCreateActiveSeason();
  if (!season) {
    throw new Error('Season not found');
  }
  if (season.status !== 'active') {
    throw new Error('Only active seasons can be closed');
  }

  const now = new Date();
  const nextSeasonCode = deriveNextSeasonCode(season.seasonCode);

  let nextSeason = await RankSeason.findOne({ seasonCode: nextSeasonCode });
  if (!nextSeason) {
    nextSeason = await RankSeason.create({
      seasonCode: nextSeasonCode,
      name: `Season ${nextSeasonCode}`,
      theme: season.theme || null,
      status: 'active',
      startAt: now,
      startedBy: startedBy || null,
      resetPolicy: {
        lowBracketDrop: 3,
        highBracketDrop: 5,
        seasonFloorIndex: DEFAULT_SEASON_FLOOR_INDEX
      }
    });
  } else {
    nextSeason.status = 'active';
    nextSeason.startAt = now;
    nextSeason.endAt = null;
    if (!nextSeason.theme && season.theme) nextSeason.theme = season.theme;
    if (startedBy) nextSeason.startedBy = startedBy;
    await nextSeason.save();
  }

  const currentProfiles = await UserRankProfile.find({ currentSeasonId: season._id }).sort({
    knowledgePoints: -1,
    updatedAt: 1
  });

  const snapshots = [];
  for (let idx = 0; idx < currentProfiles.length; idx += 1) {
    const profile = currentProfiles[idx];
    const finalRankIndex = profile.rankIndex;
    const finalRankName = profile.rankName;
    const finalKnowledgePoints = Math.max(0, Number(profile.knowledgePoints || 0));
    const seasonPeakRankIndex = profile.seasonPeakRankIndex;
    const seasonPeakKp = Math.max(0, Number(profile.seasonPeakKp || 0));
    const eventsCount = profile.competitiveEventsCountSeason;

    const resetInfo = profile.applySeasonReset(season.resetPolicy || {});
    const newRank = getRankByIndex(resetInfo.newRankIndex);

    profile.currentSeasonId = nextSeason._id;
    await profile.save();

    snapshots.push({
      seasonId: season._id,
      userId: profile.userId,
      position: idx + 1,
      finalRankIndex,
      finalRankName,
      finalKnowledgePoints,
      seasonPeakRankIndex,
      seasonPeakKp,
      eventsCount,
      resetApplied: {
        demotedBy: resetInfo.demotedBy,
        newRankIndex: resetInfo.newRankIndex,
        newRankName: newRank.name,
        seasonFloorIndex: resetInfo.seasonFloorIndex
      }
    });
  }

  if (snapshots.length > 0) {
    await SeasonResultSnapshot.insertMany(snapshots, { ordered: false });
  }

  season.status = 'closed';
  season.endAt = now;
  season.closedAt = now;
  await season.save();

  return {
    closedSeason: season,
    startedSeason: nextSeason,
    affectedUsers: currentProfiles.length
  };
}

module.exports = {
  getOrCreateActiveSeason,
  ensureUserRankProfile,
  previewSeasonReset,
  startSeason,
  closeSeasonAndStartNext
};

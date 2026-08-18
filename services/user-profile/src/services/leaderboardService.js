const RankEventLedger = require('../models/RankEventLedger');
const UserRankProfile = require('../models/UserRankProfile');
const RankBadge = require('../models/RankBadge');
const Friendship = require('../models/Friendship');
const UserProfile = require('../models/UserProfile');
const { RANK_LADDER, getRankByIndex } = require('../models/rankingConfig');
const seasonService = require('./seasonService');

const SINGLE_BADGE_TIERS = new Set(['grandmaster', 'legend']);
const DIVISION_TO_BADGE_KEY = {
  III: 'first',
  II: 'second',
  I: 'third'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getBadgeKeyForRank(rank) {
  const tier = String(rank?.tier || '').toLowerCase();
  if (SINGLE_BADGE_TIERS.has(tier)) {
    return 'use';
  }

  return DIVISION_TO_BADGE_KEY[String(rank?.division || '').toUpperCase()] || 'use';
}

function buildFallbackRankBadge(rankIndex) {
  const rank = getRankByIndex(rankIndex || 0);
  const tier = String(rank?.tier || 'novice').toLowerCase();
  const badgeKey = getBadgeKeyForRank(rank);

  return {
    rankIndex: rank.index,
    rankName: rank.name,
    tier,
    division: rank.division || null,
    badgeKey,
    imagePath: `/ranking-badges/${tier}/${badgeKey}.png`
  };
}

async function getRankBadge(rankIndex) {
  const fallback = buildFallbackRankBadge(rankIndex);

  try {
    const badge = await RankBadge.findOne({
      rankIndex: fallback.rankIndex,
      isActive: true
    }).lean();

    if (!badge) return fallback;

    return {
      rankIndex: badge.rankIndex,
      rankName: badge.rankName,
      tier: badge.tier,
      division: badge.division || null,
      badgeKey: badge.badgeKey,
      imagePath: badge.imagePath
    };
  } catch (error) {
    return fallback;
  }
}

async function getAllRankBadges() {
  try {
    const badges = await RankBadge.find({ isActive: true }).sort({ rankIndex: 1 }).lean();
    if (badges.length > 0) {
      return badges.map((badge) => ({
        rankIndex: badge.rankIndex,
        rankName: badge.rankName,
        tier: badge.tier,
        division: badge.division || null,
        badgeKey: badge.badgeKey,
        imagePath: badge.imagePath
      }));
    }
  } catch (error) {
    // Ignore and return fallback ladder mapping.
  }

  return RANK_LADDER.map((rank) => buildFallbackRankBadge(rank.index));
}

function buildRankProgress(profile) {
  const currentPoints = Math.max(0, Number(profile?.knowledgePoints || 0));
  const currentRank = getRankByIndex(profile?.rankIndex || 0);
  const nextRank = getRankByIndex((profile?.rankIndex || 0) + 1);

  if (!nextRank || nextRank.index === currentRank.index) {
    return {
      currentKp: currentPoints,
      currentRank,
      nextRank: null,
      kpToNextRank: 0,
      progressPercent: 100
    };
  }

  const span = Math.max(1, nextRank.minKp - currentRank.minKp);
  const progressPercent = clamp(((currentPoints - currentRank.minKp) / span) * 100, 0, 100);

  return {
    currentKp: currentPoints,
    currentRank,
    nextRank,
    kpToNextRank: Math.max(0, nextRank.minKp - currentPoints),
    progressPercent
  };
}

async function getRankProfile(userId) {
  const season = await seasonService.getOrCreateActiveSeason();
  const profile = await seasonService.ensureUserRankProfile(userId, season._id);
  const progress = buildRankProgress(profile);
  const rankBadge = await getRankBadge(profile.rankIndex);
  return { season, profile, progress, rankBadge };
}

async function getRankProgress(userId) {
  const { season, profile, progress, rankBadge } = await getRankProfile(userId);
  return { season, profile, progress, rankBadge };
}

async function getRankHistory(userId, limit = 20) {
  const season = await seasonService.getOrCreateActiveSeason();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

  const events = await RankEventLedger.find({
    userId,
    seasonId: season._id
  })
    .sort({ occurredAt: -1 })
    .limit(safeLimit)
    .lean();

  return { season, events };
}

async function getRankLeaderboard({ userId, scope = 'all', limit = 20 }) {
  const season = await seasonService.getOrCreateActiveSeason();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

  const query = { currentSeasonId: season._id };

  if (scope === 'friends') {
    const friendships = await Friendship.find({
      $or: [
        { requester: userId, status: 'accepted' },
        { recipient: userId, status: 'accepted' }
      ]
    })
      .select('requester recipient')
      .lean();

    const friendIds = friendships.map((f) => (f.requester === userId ? f.recipient : f.requester));
    friendIds.push(userId);
    query.userId = { $in: [...new Set(friendIds)] };
  }

  const rows = await UserRankProfile.find(query)
    .sort({ knowledgePoints: -1, updatedAt: 1 })
    .limit(safeLimit)
    .select(
      'userId knowledgePoints rankIndex rankName seasonPeakRankIndex seasonPeakKp currentStreak learningSkillRating'
    )
    .lean();

  const userIds = rows.map((row) => row.userId);
  const profiles = await UserProfile.find({ userId: { $in: userIds } })
    .select('userId nickname avatar')
    .lean();

  const profileMap = new Map();
  profiles.forEach((profile) => {
    profileMap.set(profile.userId, profile);
  });

  const leaderboard = rows.map((row, idx) => {
    const userProfile = profileMap.get(row.userId) || {};
    const points = Math.max(0, Number(row.knowledgePoints || 0));
    return {
      position: idx + 1,
      userId: row.userId,
      nickname: userProfile.nickname || null,
      avatar: userProfile.avatar || null,
      knowledgePoints: points,
      rankIndex: row.rankIndex,
      rankName: row.rankName,
      seasonPeakRankIndex: row.seasonPeakRankIndex,
      seasonPeakKp: Math.max(0, Number(row.seasonPeakKp || 0)),
      currentStreak: row.currentStreak || 0,
      learningSkillRating: row.learningSkillRating || 0
    };
  });

  return { season, leaderboard };
}

async function getSessionResult(userId, sessionId = null) {
  const season = await seasonService.getOrCreateActiveSeason();

  let resolvedSessionId = sessionId || null;
  if (!resolvedSessionId) {
    const latestSessionEvent = await RankEventLedger.findOne({
      userId,
      seasonId: season._id,
      contextSessionId: { $ne: null }
    })
      .sort({ occurredAt: -1 })
      .lean();

    resolvedSessionId = latestSessionEvent?.contextSessionId || null;
  }

  if (!resolvedSessionId) {
    return {
      season,
      sessionId: null,
      totalKP: 0,
      events: []
    };
  }

  let events = await RankEventLedger.find({
    userId,
    seasonId: season._id,
    contextSessionId: resolvedSessionId
  })
    .sort({ occurredAt: 1 })
    .lean();

  // Backward-compat query path for events written before contextSessionId existed.
  if (events.length === 0) {
    events = await RankEventLedger.find({
      userId,
      seasonId: season._id,
      'metadata.sessionId': resolvedSessionId
    })
      .sort({ occurredAt: 1 })
      .lean();
  }

  const normalizedEvents = events.map((event) => ({
    action: event.action,
    baseKP: Number(event.baseKP || 0),
    multipliers: {
      difficulty: Number(event.multipliers?.difficulty || 1),
      performance: Number(event.multipliers?.performance || 1),
      consistency: Number(event.multipliers?.consistency || 1),
      comeback: Number(event.multipliers?.comeback || 1),
      antiGrind: Number(event.multipliers?.antiGrind || 1),
      total: Number(event.multipliers?.total || 1)
    },
    finalKP: Number(event.finalKP ?? event.deltaKp ?? 0),
    reasonBreakdown: event.reasonBreakdown || {},
    occurredAt: event.occurredAt
  }));

  const totalKP = normalizedEvents.reduce((sum, event) => sum + event.finalKP, 0);
  const primaryEvent =
    normalizedEvents.find((event) => event.action === 'session_complete') ||
    normalizedEvents[0] ||
    null;

  return {
    season,
    sessionId: resolvedSessionId,
    totalKP,
    events: normalizedEvents,
    primaryBreakdown: primaryEvent
  };
}

module.exports = {
  buildRankProgress,
  getRankProfile,
  getRankProgress,
  getAllRankBadges,
  getRankHistory,
  getRankLeaderboard,
  getSessionResult
};

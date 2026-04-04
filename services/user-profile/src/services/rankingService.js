const RankSeason = require('../models/RankSeason');
const UserRankProfile = require('../models/UserRankProfile');
const RankEventLedger = require('../models/RankEventLedger');
const SeasonResultSnapshot = require('../models/SeasonResultSnapshot');
const Friendship = require('../models/Friendship');
const UserProfile = require('../models/UserProfile');
const {
  DEFAULT_SEASON_FLOOR_INDEX,
  getRankByIndex,
  isLowBracket
} = require('../models/rankingConfig');

const BASE_KP_MAP = {
  // Required by product specification.
  task_complete_easy: 20,
  task_complete_medium: 40,
  task_complete_hard: 70,
  session_complete: 30,
  perfect_focus_session: 20,
  // Legacy events retained for compatibility.
  subject_create: 20,
  course_upload: 40,
  daily_streak: 20,
  team_session: 35,
  team_session_host: 45,
  quest_complete: 40,
  friend_added: 10
};

const DIFFICULTY_MULTIPLIERS = {
  easy: 1,
  medium: 1.2,
  hard: 1.5,
  extreme: 2
};

const DAILY_KP_CAP = Number(process.env.RANK_DAILY_KP_CAP || 600);
const LOW_DIFFICULTY_REPEAT_THRESHOLD = Number(
  process.env.RANK_LOW_DIFFICULTY_REPEAT_THRESHOLD || 8
);
const LOW_DIFFICULTY_WINDOW_MINUTES = Number(
  process.env.RANK_LOW_DIFFICULTY_WINDOW_MINUTES || 120
);
const COMEBACK_INACTIVITY_HOURS = Number(process.env.RANK_COMEBACK_INACTIVITY_HOURS || 72);
const COMEBACK_BONUS_SESSIONS = Number(process.env.RANK_COMEBACK_BONUS_SESSIONS || 5);

const SESSION_ACTIONS = new Set(['session_complete', 'team_session', 'team_session_host']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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

function getUtcDayBounds(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function getUtcDayDiff(a, b) {
  const aDay = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bDay = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((aDay - bDay) / (24 * 60 * 60 * 1000));
}

function buildEventKey({ userId, action, metadata = {} }) {
  const stableId =
    metadata.eventId ||
    metadata.taskId ||
    metadata.sessionId ||
    metadata.courseId ||
    metadata.subjectId ||
    metadata.questId ||
    metadata.focusSessionId ||
    null;

  if (!stableId) return null;
  return `${userId}:${action}:${stableId}`;
}

function resolveDifficultyLabel(action, metadata = {}) {
  const fromMeta = String(metadata.difficulty || metadata.taskDifficulty || '').toLowerCase();
  if (DIFFICULTY_MULTIPLIERS[fromMeta]) return fromMeta;

  if (action.endsWith('_easy')) return 'easy';
  if (action.endsWith('_medium')) return 'medium';
  if (action.endsWith('_hard')) return 'hard';
  if (action.endsWith('_extreme')) return 'extreme';

  return 'medium';
}

function resolvePerformanceMultiplier(metadata = {}) {
  const score = toNumber(
    metadata.quizScore ?? metadata.score ?? metadata.performanceScore ?? metadata.focusScore,
    NaN
  );
  if (!Number.isFinite(score)) return 1;
  if (score >= 90) return 1.5;
  if (score >= 75) return 1.2;
  if (score < 50) return 0.5;
  return 1;
}

function resolveConsistencyMultiplier(streak) {
  if (streak >= 30) return 1.5;
  if (streak >= 7) return 1.2;
  return 1;
}

function isSessionAction(action) {
  return SESSION_ACTIONS.has(action);
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

function updateStreak(profile, now) {
  if (!profile.lastActivityAt) {
    profile.currentStreak = 1;
    profile.lastActivityAt = now;
    return profile.currentStreak;
  }

  const previous = new Date(profile.lastActivityAt);
  const dayDiff = getUtcDayDiff(now, previous);

  if (dayDiff <= 0) {
    // Same UTC day activity does not advance streak, but keeps activity fresh.
    profile.lastActivityAt = now;
    return profile.currentStreak || 1;
  }

  if (dayDiff === 1) {
    profile.currentStreak = (profile.currentStreak || 0) + 1;
  } else {
    profile.currentStreak = 1;
  }

  profile.lastActivityAt = now;
  return profile.currentStreak;
}

function refreshComebackWindow(profile, now) {
  if (!profile.lastActivityAt) return;

  const inactivityHours = (now.getTime() - new Date(profile.lastActivityAt).getTime()) / (60 * 60 * 1000);
  if (inactivityHours >= COMEBACK_INACTIVITY_HOURS && (profile.comebackBonusRemaining || 0) <= 0) {
    profile.comebackBonusRemaining = COMEBACK_BONUS_SESSIONS;
  }
}

function computeLearningSkillDelta({
  difficultyMultiplier,
  performanceMultiplier,
  consistencyMultiplier,
  antiGrindMultiplier
}) {
  const score =
    (difficultyMultiplier - 1) * 16 +
    (performanceMultiplier - 1) * 24 +
    (consistencyMultiplier - 1) * 10 +
    (antiGrindMultiplier < 1 ? -8 : 0);
  return Math.round(score);
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

async function getTodayAwardedKp(userId, seasonId) {
  const { start, end } = getUtcDayBounds();
  const result = await RankEventLedger.aggregate([
    {
      $match: {
        userId,
        seasonId,
        occurredAt: { $gte: start, $lt: end },
        finalKP: { $gt: 0 }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$finalKP' }
      }
    }
  ]);

  return result[0]?.total || 0;
}

async function countRecentLowDifficultyActions(userId, seasonId, now) {
  const since = new Date(now.getTime() - LOW_DIFFICULTY_WINDOW_MINUTES * 60 * 1000);
  return RankEventLedger.countDocuments({
    userId,
    seasonId,
    occurredAt: { $gte: since },
    'reasonBreakdown.lowDifficultyAction': true
  });
}

async function awardKnowledgePoints({ userId, action, metadata = {} }) {
  const baseKP = BASE_KP_MAP[action] || 0;
  if (baseKP <= 0) {
    return {
      awarded: false,
      reason: 'action_not_ranked',
      deltaKp: 0
    };
  }

  const season = await getOrCreateActiveSeason();
  const profile = await ensureUserRankProfile(userId, season._id);
  const now = new Date();

  const eventKey = buildEventKey({ userId, action, metadata });
  if (eventKey) {
    const existingEvent = await RankEventLedger.findOne({ eventKey }).lean();
    if (existingEvent) {
      return {
        awarded: false,
        reason: 'duplicate_event',
        deltaKp: 0,
        season,
        profile,
        progress: buildRankProgress(profile)
      };
    }
  }

  refreshComebackWindow(profile, now);
  const currentStreak = updateStreak(profile, now);

  const difficultyLabel = resolveDifficultyLabel(action, metadata);
  const difficultyMultiplier = DIFFICULTY_MULTIPLIERS[difficultyLabel] || 1;
  const performanceMultiplier = resolvePerformanceMultiplier(metadata);
  const consistencyMultiplier = resolveConsistencyMultiplier(currentStreak);

  const lowDifficultyAction = difficultyLabel === 'easy';
  let antiGrindMultiplier = 1;
  if (lowDifficultyAction) {
    const recentLowCount = await countRecentLowDifficultyActions(userId, season._id, now);
    if (recentLowCount >= LOW_DIFFICULTY_REPEAT_THRESHOLD) {
      antiGrindMultiplier = 0.6;
    }
  }

  let comebackMultiplier = 1;
  const comebackEligible = isSessionAction(action) && (profile.comebackBonusRemaining || 0) > 0;
  if (comebackEligible) {
    comebackMultiplier = 1.5;
    profile.comebackBonusRemaining = Math.max(0, (profile.comebackBonusRemaining || 0) - 1);
  }

  const totalMultiplier =
    difficultyMultiplier *
    performanceMultiplier *
    consistencyMultiplier *
    antiGrindMultiplier *
    comebackMultiplier;

  const rawFinalKp = baseKP * totalMultiplier;
  let finalKP = Math.max(0, Math.floor(rawFinalKp));

  const todayAwarded = await getTodayAwardedKp(userId, season._id);
  const remaining = Math.max(0, DAILY_KP_CAP - todayAwarded);
  let cappedByDailyLimit = false;

  if (remaining <= 0) {
    await profile.save();
    return {
      awarded: false,
      reason: 'daily_cap_reached',
      deltaKp: 0,
      season,
      profile,
      progress: buildRankProgress(profile)
    };
  }

  if (finalKP > remaining) {
    finalKP = remaining;
    cappedByDailyLimit = true;
  }

  if (finalKP <= 0) {
    await profile.save();
    return {
      awarded: false,
      reason: 'zero_kp_after_balancing',
      deltaKp: 0,
      season,
      profile,
      progress: buildRankProgress(profile)
    };
  }

  const applyResult = profile.applyKnowledgeDelta(finalKP);

  const skillDelta = computeLearningSkillDelta({
    difficultyMultiplier,
    performanceMultiplier,
    consistencyMultiplier,
    antiGrindMultiplier
  });
  profile.learningSkillRating = Math.max(
    0,
    Math.round((profile.learningSkillRating || 1000) + skillDelta)
  );

  await profile.save();

  const reasonBreakdown = {
    formula:
      'baseKP × difficultyMultiplier × performanceMultiplier × consistencyMultiplier × comebackMultiplier × antiGrindMultiplier',
    baseKP,
    difficulty: {
      label: difficultyLabel,
      multiplier: difficultyMultiplier
    },
    performance: {
      score: toNumber(metadata.quizScore ?? metadata.score ?? metadata.performanceScore, null),
      multiplier: performanceMultiplier
    },
    consistency: {
      streak: currentStreak,
      multiplier: consistencyMultiplier
    },
    comeback: {
      applied: comebackEligible,
      multiplier: comebackMultiplier,
      remainingSessions: profile.comebackBonusRemaining || 0
    },
    antiGrind: {
      lowDifficultyAction,
      applied: antiGrindMultiplier < 1,
      multiplier: antiGrindMultiplier
    },
    totalMultiplier,
    rawFinalKp,
    cappedByDailyLimit,
    finalKP,
    learningSkillDelta: skillDelta,
    learningSkillRating: profile.learningSkillRating
  };

  await RankEventLedger.create({
    userId,
    seasonId: season._id,
    action,
    baseKP,
    multipliers: {
      difficulty: difficultyMultiplier,
      performance: performanceMultiplier,
      consistency: consistencyMultiplier,
      comeback: comebackMultiplier,
      antiGrind: antiGrindMultiplier,
      total: totalMultiplier
    },
    finalKP,
    deltaKp: finalKP,
    beforeKp: applyResult.beforeKp,
    afterKp: applyResult.afterKp,
    beforeRankIndex: applyResult.beforeRankIndex,
    afterRankIndex: applyResult.afterRankIndex,
    rankName: profile.rankName,
    metadata,
    reasonBreakdown,
    contextSessionId:
      metadata.sessionId || metadata.focusSessionId || metadata.eventId || null,
    eventKey
  });

  const progress = buildRankProgress(profile);

  return {
    awarded: true,
    deltaKp: finalKP,
    season,
    profile,
    progress,
    baseKP,
    multipliers: {
      difficulty: difficultyMultiplier,
      performance: performanceMultiplier,
      consistency: consistencyMultiplier,
      comeback: comebackMultiplier,
      antiGrind: antiGrindMultiplier,
      total: totalMultiplier
    },
    breakdown: reasonBreakdown,
    ...applyResult
  };
}

async function getRankProfile(userId) {
  const season = await getOrCreateActiveSeason();
  const profile = await ensureUserRankProfile(userId, season._id);
  const progress = buildRankProgress(profile);
  return { season, profile, progress };
}

async function getRankProgress(userId) {
  const { season, profile, progress } = await getRankProfile(userId);
  return { season, profile, progress };
}

async function getRankHistory(userId, limit = 20) {
  const season = await getOrCreateActiveSeason();
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
  const season = await getOrCreateActiveSeason();
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

async function getSessionResult(userId, sessionId = null) {
  const season = await getOrCreateActiveSeason();

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
  BASE_KP_MAP,
  DAILY_KP_CAP,
  getOrCreateActiveSeason,
  ensureUserRankProfile,
  awardKnowledgePoints,
  getRankProfile,
  getRankProgress,
  getRankHistory,
  getRankLeaderboard,
  getSessionResult,
  previewSeasonReset,
  startSeason,
  closeSeasonAndStartNext
};

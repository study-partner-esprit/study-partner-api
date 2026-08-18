const RankEventLedger = require('../models/RankEventLedger');
const seasonService = require('./seasonService');
const leaderboardService = require('./leaderboardService');

const BASE_KP_MAP = {
  task_complete_easy: 20,
  task_complete_medium: 40,
  task_complete_hard: 70,
  session_complete: 30,
  challenge_complete: 60,
  challenge_completed: 60,
  perfect_focus_session: 20,
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
const LOW_DIFFICULTY_WINDOW_MINUTES = Number(process.env.RANK_LOW_DIFFICULTY_WINDOW_MINUTES || 120);
const COMEBACK_INACTIVITY_HOURS = Number(process.env.RANK_COMEBACK_INACTIVITY_HOURS || 72);
const COMEBACK_BONUS_SESSIONS = Number(process.env.RANK_COMEBACK_BONUS_SESSIONS || 5);

const SESSION_ACTIONS = new Set([
  'session_complete',
  'challenge_complete',
  'challenge_completed',
  'team_session',
  'team_session_host'
]);

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function updateStreak(profile, now) {
  if (!profile.lastActivityAt) {
    profile.currentStreak = 1;
    profile.lastActivityAt = now;
    return profile.currentStreak;
  }

  const previous = new Date(profile.lastActivityAt);
  const dayDiff = getUtcDayDiff(now, previous);

  if (dayDiff <= 0) {
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

  const inactivityHours =
    (now.getTime() - new Date(profile.lastActivityAt).getTime()) / (60 * 60 * 1000);
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

  const season = await seasonService.getOrCreateActiveSeason();
  const profile = await seasonService.ensureUserRankProfile(userId, season._id);
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
        progress: leaderboardService.buildRankProgress(profile)
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
      progress: leaderboardService.buildRankProgress(profile)
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
      progress: leaderboardService.buildRankProgress(profile)
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
    contextSessionId: metadata.sessionId || metadata.focusSessionId || metadata.eventId || null,
    eventKey
  });

  const progress = leaderboardService.buildRankProgress(profile);

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

module.exports = {
  BASE_KP_MAP,
  DAILY_KP_CAP,
  awardKnowledgePoints
};

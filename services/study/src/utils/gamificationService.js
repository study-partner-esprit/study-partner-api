const axios = require('axios');
const { StudySession } = require('../models');
const { toSafeInteger, countXpHistoryActions, getAxiosErrorDetails, buildInternalHeaders } = require('./sessionHelpers');

const USER_PROFILE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:3006';
const BASE_SESSION_COMPLETE_XP = Number(process.env.BASE_SESSION_COMPLETE_XP || 10);
const BASE_CHALLENGE_COMPLETE_XP = Number(process.env.BASE_CHALLENGE_COMPLETE_XP || 30);
const BASE_TEAM_SESSION_XP = Number(process.env.BASE_TEAM_SESSION_XP || 20);
const BASE_TEAM_HOST_XP = Number(process.env.BASE_TEAM_HOST_XP || 30);
const CHALLENGE_DIFFICULTY_MULTIPLIER = {
  easy: 1,
  medium: 1.5,
  hard: 2,
  expert: 2.5
};

const buildUnlockMetricsFromAward = ({ awardData = {}, gamificationProfile = null } = {}) => {
  const stats = gamificationProfile?.stats || {};
  const xpHistory = gamificationProfile?.xp_history || [];

  const challengeCountFromHistory = countXpHistoryActions(xpHistory, (action) =>
    action.toLowerCase().includes('challenge')
  );

  const groupCountFromHistory = countXpHistoryActions(xpHistory, (action) =>
    /^team_session(_host)?$/i.test(action)
  );

  return {
    totalXp: Number(awardData.total_xp ?? gamificationProfile?.total_xp),
    currentStreak: Number(awardData.current_streak),
    rankIndex: Number(awardData.rank_index),
    rankName: awardData.rank_name,
    challengesCompleted: toSafeInteger(
      stats.challengesCompleted ??
        stats.challenges_completed ??
        stats.challengeCount ??
        challengeCountFromHistory,
      challengeCountFromHistory
    ),
    groupSessions: toSafeInteger(
      stats.groupSessions ??
        stats.group_sessions ??
        stats.teamSessions ??
        stats.team_sessions ??
        groupCountFromHistory,
      groupCountFromHistory
    )
  };
};

const trackAnalyticsEvent = async ({ authorization, eventType, metadata = {} }) => {
  if (!authorization) return null;

  try {
    const response = await axios.post(
      `${ANALYTICS_SERVICE_URL}/api/v1/analytics/track`,
      { eventType, metadata },
      {
        headers: { Authorization: authorization }
      }
    );

    return response?.data || null;
  } catch (error) {
    console.warn('[Analytics] Event tracking failed:', getAxiosErrorDetails(error));
    return null;
  }
};

const fetchGamificationProfile = async ({ authorization, userId = null } = {}) => {
  if (!authorization) return null;

  try {
    const response = await axios.get(`${USER_PROFILE_URL}/api/v1/users/gamification`, {
      params: userId ? { userId } : {},
      headers: buildInternalHeaders(authorization)
    });

    return response?.data || null;
  } catch (error) {
    console.warn('[Gamification] Profile lookup failed:', getAxiosErrorDetails(error));
    return null;
  }
};

const getSelectedCharacterForAuthorization = async ({ authorization, userId = null } = {}) => {
  if (!authorization) return null;

  try {
    const response = await axios.get(`${USER_PROFILE_URL}/api/v1/user/character`, {
      params: userId ? { userId } : {},
      headers: buildInternalHeaders(authorization)
    });

    return response?.data?.data || null;
  } catch (error) {
    return null;
  }
};

const buildAbilityBonusPayload = (abilityResult) => {
  if (!abilityResult) return [];

  return [
    {
      abilityId: abilityResult.abilityId,
      abilityName: abilityResult.abilityName,
      effectType: abilityResult.effectType,
      bonus: toSafeInteger(abilityResult.xpBonus, 0),
      multiplier: Number(abilityResult.multiplier || 1),
      debugInfo: abilityResult.debugInfo || null
    }
  ];
};

const executeCharacterAbilityForReward = async ({
  authorization,
  userId = null,
  characterId,
  sessionData,
  baseXP
}) => {
  if (!authorization || !characterId) return null;

  try {
    const response = await axios.post(
      `${USER_PROFILE_URL}/api/v1/abilities/trigger`,
      {
        ...(userId ? { userId } : {}),
        characterId,
        sessionData,
        baseXp: baseXP
      },
      {
        headers: buildInternalHeaders(authorization)
      }
    );

    return response?.data?.data || null;
  } catch (error) {
    console.warn('[Character API] Ability trigger failed:', getAxiosErrorDetails(error));
    return null;
  }
};

const calculateCharacterAdjustedXP = async ({
  authorization,
  userId = null,
  baseXP,
  sessionData,
  selectedCharacterId = null,
  fallbackMultiplier = 1
}) => {
  const normalizedBaseXP = toSafeInteger(baseXP, 0);
  const selectedCharacter = await getSelectedCharacterForAuthorization({ authorization, userId });
  const activeCharacterId =
    selectedCharacter?.character_id?._id || selectedCharacter?.character_id || null;
  const characterId = selectedCharacterId || activeCharacterId;

  if (!characterId) {
    return {
      baseXP: normalizedBaseXP,
      totalXP: normalizedBaseXP,
      multiplier: fallbackMultiplier,
      abilityBonuses: []
    };
  }

  const abilityResult = await executeCharacterAbilityForReward({
    authorization,
    userId,
    characterId: String(characterId),
    sessionData,
    baseXP: normalizedBaseXP
  });

  if (!abilityResult?.success || !abilityResult?.applied) {
    return {
      baseXP: normalizedBaseXP,
      totalXP: normalizedBaseXP,
      multiplier: fallbackMultiplier,
      abilityBonuses: []
    };
  }

  const totalXP = toSafeInteger(abilityResult.xpGain, normalizedBaseXP);
  const multiplier =
    normalizedBaseXP > 0
      ? Number((totalXP / normalizedBaseXP).toFixed(4))
      : Number(abilityResult.multiplier || fallbackMultiplier || 1);

  return {
    baseXP: normalizedBaseXP,
    totalXP,
    multiplier,
    abilityBonuses: buildAbilityBonusPayload(abilityResult)
  };
};

const calculateSessionXPWithCharacter = async ({
  authorization,
  userId = null,
  sessionId,
  sessionType,
  duration,
  courseId,
  selectedCharacterId,
  baseXP
}) => {
  return calculateCharacterAdjustedXP({
    authorization,
    userId,
    baseXP,
    selectedCharacterId,
    sessionData: {
      session_id: sessionId,
      session_type: sessionType,
      duration,
      course_id: courseId,
      flagged: false
    },
    fallbackMultiplier: 1
  });
};

const calculateChallengeXPWithCharacter = async ({
  authorization,
  userId = null,
  sessionId,
  challengeId,
  difficulty,
  selectedCharacterId,
  baseXP
}) => {
  const normalizedDifficulty = String(difficulty || 'medium').toLowerCase();
  const difficultyMultiplier = CHALLENGE_DIFFICULTY_MULTIPLIER[normalizedDifficulty] || 1;
  const adjustedBaseXP = toSafeInteger(baseXP * difficultyMultiplier, baseXP);

  return calculateCharacterAdjustedXP({
    authorization,
    userId,
    baseXP: adjustedBaseXP,
    selectedCharacterId,
    sessionData: {
      session_id: sessionId,
      session_type: 'challenge',
      challenge_id: challengeId,
      difficulty: normalizedDifficulty,
      flagged: false
    },
    fallbackMultiplier: difficultyMultiplier
  });
};

const calculateSocialXPWithCharacter = async ({
  authorization,
  userId = null,
  sessionId,
  activityType,
  baseXP
}) => {
  return calculateCharacterAdjustedXP({
    authorization,
    userId,
    baseXP,
    sessionData: {
      session_id: sessionId,
      session_type: 'social',
      activity_type: activityType,
      flagged: false
    },
    fallbackMultiplier: 1
  });
};

const syncUnlockProgressFromMetrics = async ({ authorization, userId = null, metrics }) => {
  if (!authorization) return null;

  try {
    const response = await axios.post(
      `${USER_PROFILE_URL}/api/v1/user/unlock-progress/sync`,
      {
        ...(userId ? { userId } : {}),
        metrics: metrics || {}
      },
      {
        headers: buildInternalHeaders(authorization)
      }
    );

    return response?.data?.data || null;
  } catch (error) {
    console.warn('[Character API] Unlock progress sync failed:', getAxiosErrorDetails(error));
    return null;
  }
};

const getSessionCompletionContext = (session) => {
  const isChallenge = session.mode === 'exam';
  const duration = Number(session.duration || 0);

  if (isChallenge) {
    return {
      isChallenge: true,
      action: 'challenge_complete',
      baseXP: BASE_CHALLENGE_COMPLETE_XP,
      challengeId: session.taskId,
      difficulty: session.challengeDifficulty || 'medium',
      sessionType: 'challenge'
    };
  }

  return {
    isChallenge: false,
    action: 'study_session',
    baseXP: BASE_SESSION_COMPLETE_XP,
    challengeId: null,
    difficulty: null,
    sessionType: duration >= 60 ? 'long' : 'short'
  };
};

async function awardSessionCompletionWithCharacterEffects({ _userId, session, authorization }) {
  const sessionId = String(session?._id || '');
  const sessionSelectedCharacterId =
    session?.selectedCharacterId || session?.selected_character_id || null;
  const durationMinutes = Number(session?.duration || 0);
  const completionContext = getSessionCompletionContext(session);
  let xpResult = null;

  try {
    if (completionContext.isChallenge) {
      xpResult = await calculateChallengeXPWithCharacter({
        authorization,
        challengeId: completionContext.challengeId,
        difficulty: completionContext.difficulty,
        selectedCharacterId: sessionSelectedCharacterId,
        baseXP: completionContext.baseXP,
        sessionId
      });
    } else {
      xpResult = await calculateSessionXPWithCharacter({
        authorization,
        duration: durationMinutes,
        sessionType: completionContext.sessionType,
        selectedCharacterId: sessionSelectedCharacterId,
        baseXP: completionContext.baseXP,
        sessionId,
        courseId: session?.courseId || null
      });
    }
  } catch (error) {
    console.warn('[Session XP] Character XP calculation failed:', getAxiosErrorDetails(error));
  }

  const computedTotalXP = toSafeInteger(xpResult?.totalXP, completionContext.baseXP);
  const awardPayload = {
    action: completionContext.action,
    xp_amount: computedTotalXP,
    metadata: {
      sessionId,
      duration: durationMinutes,
      sessionType: completionContext.sessionType,
      challengeId: completionContext.challengeId,
      challengeDifficulty: completionContext.difficulty,
      characterMultiplier: Number(xpResult?.multiplier || 1)
    }
  };

  const awardResponse = await axios.post(
    `${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`,
    awardPayload,
    {
      headers: buildInternalHeaders(authorization)
    }
  );

  const awardData = awardResponse?.data || {};
  const gamificationProfile = await fetchGamificationProfile({ authorization });
  let unlockSync = null;

  try {
    unlockSync = await syncUnlockProgressFromMetrics({
      authorization,
      metrics: buildUnlockMetricsFromAward({
        awardData,
        gamificationProfile
      })
    });
  } catch (unlockError) {
    console.warn('[Session XP] Unlock progress sync failed:', getAxiosErrorDetails(unlockError));
  }

  return {
    action: completionContext.action,
    baseXP: completionContext.baseXP,
    awardedXP: computedTotalXP,
    abilityBonuses: xpResult?.abilityBonuses || [],
    multiplier: Number(xpResult?.multiplier || 1),
    rank: {
      name: awardData.rank_name || null,
      index: Number.isFinite(Number(awardData.rank_index)) ? Number(awardData.rank_index) : null,
      totalKnowledgePoints: Number.isFinite(Number(awardData.total_knowledge_points))
        ? Number(awardData.total_knowledge_points)
        : null,
      knowledgePointsAwarded: Number.isFinite(Number(awardData.knowledge_points_awarded))
        ? Number(awardData.knowledge_points_awarded)
        : null,
      kpToNextRank: Number.isFinite(Number(awardData.kp_to_next_rank))
        ? Number(awardData.kp_to_next_rank)
        : null
    },
    unlockSync
  };
}

async function processSessionCompletionRewards({ userId, session, authorization }) {
  let completionRewards = null;

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const yesterdaySession = await StudySession.findOne({
      userId,
      status: 'completed',
      createdAt: { $gte: yesterday, $lt: todayStart }
    });

    if (yesterdaySession) {
      await axios.post(
        `${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`,
        {
          action: 'daily_streak',
          metadata: { sessionId: session._id.toString() }
        },
        {
          headers: buildInternalHeaders(authorization)
        }
      );
    }

    completionRewards = await awardSessionCompletionWithCharacterEffects({
      userId,
      session,
      authorization
    });

    const completionAction = String(completionRewards?.action || 'session_complete').toLowerCase();
    const questAction = completionAction.includes('challenge')
      ? 'challenge_complete'
      : 'study_session';

    await axios.post(
      `${USER_PROFILE_URL}/api/v1/users/quests/progress`,
      {
        action: questAction
      },
      {
        headers: buildInternalHeaders(authorization)
      }
    );
  } catch (xpErr) {
    console.warn('XP/streak award failed:', getAxiosErrorDetails(xpErr));
  }

  return completionRewards;
}

module.exports = {
  BASE_SESSION_COMPLETE_XP,
  BASE_CHALLENGE_COMPLETE_XP,
  BASE_TEAM_SESSION_XP,
  BASE_TEAM_HOST_XP,
  CHALLENGE_DIFFICULTY_MULTIPLIER,
  buildUnlockMetricsFromAward,
  trackAnalyticsEvent,
  fetchGamificationProfile,
  getSelectedCharacterForAuthorization,
  buildAbilityBonusPayload,
  executeCharacterAbilityForReward,
  calculateCharacterAdjustedXP,
  calculateSessionXPWithCharacter,
  calculateChallengeXPWithCharacter,
  calculateSocialXPWithCharacter,
  syncUnlockProgressFromMetrics,
  getSessionCompletionContext,
  awardSessionCompletionWithCharacterEffects,
  processSessionCompletionRewards
};

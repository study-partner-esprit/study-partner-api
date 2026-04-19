const express = require('express');
const Joi = require('joi');
const {
  getOrCreateActiveSeason,
  getRankProfile,
  getRankProgress,
  getAllRankBadges,
  getRankHistory,
  getRankLeaderboard,
  getSessionResult,
  awardKnowledgePoints,
  previewSeasonReset,
  startSeason,
  closeSeasonAndStartNext
} = require('../services/rankingService');

const router = express.Router();

const awardEventSchema = Joi.object({
  action: Joi.string().required(),
  userId: Joi.string().optional(),
  metadata: Joi.object().optional().default({})
});

const startSeasonSchema = Joi.object({
  seasonCode: Joi.string().trim().optional(),
  name: Joi.string().trim().optional(),
  theme: Joi.string().trim().max(120).optional().allow('', null)
});

function toProfilePayload(profile) {
  const knowledgePoints = Math.max(0, Number(profile.knowledgePoints || 0));
  const seasonPeakKp = Math.max(0, Number(profile.seasonPeakKp || 0));
  const allTimePeakKp = Math.max(0, Number(profile.allTimePeakKp || 0));

  return {
    userId: profile.userId,
    knowledgePoints,
    rankIndex: profile.rankIndex,
    rankName: profile.rankName,
    seasonPeakRankIndex: profile.seasonPeakRankIndex,
    seasonPeakKp,
    allTimePeakRankIndex: profile.allTimePeakRankIndex,
    allTimePeakKp,
    learningSkillRating: profile.learningSkillRating || 0,
    currentStreak: profile.currentStreak || 0,
    lastActivityAt: profile.lastActivityAt,
    comebackBonusRemaining: profile.comebackBonusRemaining || 0,
    competitiveEventsCountSeason: profile.competitiveEventsCountSeason,
    lastEventAt: profile.lastEventAt,
    updatedAt: profile.updatedAt
  };
}

function isAdmin(req) {
  return req.user?.role === 'admin' || req.user?.isAdmin === true;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

router.get('/seasons/current', async (req, res) => {
  try {
    const season = await getOrCreateActiveSeason();
    return res.json({
      season: {
        id: season._id,
        seasonCode: season.seasonCode,
        name: season.name,
        theme: season.theme,
        status: season.status,
        startAt: season.startAt,
        endAt: season.endAt,
        resetPolicy: season.resetPolicy
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch current season' });
  }
});

router.get('/profile', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { season, profile, progress, rankBadge } = await getRankProfile(userId);

    return res.json({
      season: {
        id: season._id,
        seasonCode: season.seasonCode,
        name: season.name,
        theme: season.theme,
        status: season.status,
        startAt: season.startAt,
        endAt: season.endAt
      },
      profile: toProfilePayload(profile),
      progress,
      rankBadge
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch rank profile' });
  }
});

router.get('/progress', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { season, profile, progress, rankBadge } = await getRankProgress(userId);

    return res.json({
      season: {
        id: season._id,
        seasonCode: season.seasonCode,
        name: season.name,
        theme: season.theme,
        status: season.status
      },
      profile: toProfilePayload(profile),
      progress,
      rankBadge
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch rank progress' });
  }
});

router.get('/badges', async (req, res) => {
  try {
    const badges = await getAllRankBadges();
    return res.json({ badges });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch rank badges' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Number(req.query.limit) || 20;
    const { season, events } = await getRankHistory(userId, limit);

    return res.json({
      season: {
        id: season._id,
        seasonCode: season.seasonCode,
        name: season.name
      },
      events
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch rank history' });
  }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Number(req.query.limit) || 20;
    const scope = req.query.scope === 'friends' ? 'friends' : 'all';
    const { season, leaderboard } = await getRankLeaderboard({ userId, scope, limit });

    return res.json({
      season: {
        id: season._id,
        seasonCode: season.seasonCode,
        name: season.name,
        theme: season.theme,
        status: season.status
      },
      scope,
      leaderboard
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch rank leaderboard' });
  }
});

router.get('/session-result', async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessionId = req.query.sessionId || null;
    const result = await getSessionResult(userId, sessionId);

    return res.json({
      season: {
        id: result.season._id,
        seasonCode: result.season.seasonCode,
        name: result.season.name,
        theme: result.season.theme
      },
      sessionId: result.sessionId,
      totalKP: result.totalKP,
      events: result.events,
      primaryBreakdown: result.primaryBreakdown
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch session result' });
  }
});

router.post('/events/award', async (req, res) => {
  try {
    const { error, value } = awardEventSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const targetUserId = value.userId && isAdmin(req) ? value.userId : req.user.userId;
    const award = await awardKnowledgePoints({
      userId: targetUserId,
      action: value.action,
      metadata: value.metadata || {}
    });

    return res.json({
      status: award.awarded ? 'awarded' : 'skipped',
      reason: award.reason || null,
      deltaKp: award.deltaKp || 0,
      knowledgePoints: award.profile?.knowledgePoints ?? null,
      rankName: award.profile?.rankName,
      rankIndex: award.profile?.rankIndex,
      currentStreak: award.profile?.currentStreak || 0,
      kpToNextRank: award.progress?.kpToNextRank ?? null,
      breakdown: award.breakdown || null,
      seasonCode: award.season?.seasonCode || null
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to award knowledge points' });
  }
});

router.post('/seasons/reset-preview', requireAdmin, async (req, res) => {
  try {
    const { seasonId } = req.body || {};
    const { season, preview } = await previewSeasonReset(seasonId || null);

    return res.json({
      season: {
        id: season._id,
        seasonCode: season.seasonCode,
        name: season.name,
        status: season.status,
        resetPolicy: season.resetPolicy
      },
      totalUsers: preview.length,
      preview
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to preview season reset' });
  }
});

router.post('/seasons/start', requireAdmin, async (req, res) => {
  try {
    const { error, value } = startSeasonSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const season = await startSeason({
      seasonCode: value.seasonCode,
      name: value.name,
      theme: value.theme || null,
      startedBy: req.user.userId
    });

    return res.status(201).json({
      message: 'Season started',
      season: {
        id: season._id,
        seasonCode: season.seasonCode,
        name: season.name,
        theme: season.theme,
        status: season.status,
        startAt: season.startAt
      }
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to start season' });
  }
});

router.post('/seasons/close', requireAdmin, async (req, res) => {
  try {
    const { seasonId } = req.body || {};

    const result = await closeSeasonAndStartNext({
      seasonId: seasonId || null,
      startedBy: req.user.userId
    });

    return res.json({
      message: 'Season closed and next season started',
      closedSeason: {
        id: result.closedSeason._id,
        seasonCode: result.closedSeason.seasonCode,
        endedAt: result.closedSeason.endAt
      },
      startedSeason: {
        id: result.startedSeason._id,
        seasonCode: result.startedSeason.seasonCode,
        startedAt: result.startedSeason.startAt
      },
      affectedUsers: result.affectedUsers
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to close season' });
  }
});

module.exports = router;

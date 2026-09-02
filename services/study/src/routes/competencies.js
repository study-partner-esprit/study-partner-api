const express = require('express');
const { asyncHandler } = require('@study-partner/shared/middleware');
const { getUserCompetencyMap, getTopicDetail } = require('../services/competencyQueries');

const router = express.Router();

// Short-TTL private cache (PERF): competency data is user-specific and
// refreshes as the updater writes new evidence. Bounded per user.
const CACHE_TTL_SECONDS = 60;

// GET /api/v1/competencies
// Grouped subject → topic → 6 Bloom levels, optionally filtered by subject
// and/or with a per-knowledge-type breakdown.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;

    const subjectId = req.query.subjectId || undefined;
    const knowledgeTypeBreakdown = req.query.knowledgeType === 'breakdown';

    const competencies = await getUserCompetencyMap(userId, {
      subjectId,
      knowledgeTypeBreakdown
    });

    res.set('Cache-Control', `private, max-age=${CACHE_TTL_SECONDS}`);
    res.json({ competencies });
  })
);

// GET /api/v1/competencies/topics/:topicId
// Per-topic detail with evidence excerpts + internal needsReview signals.
router.get(
  '/topics/:topicId',
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { topicId } = req.params;

    const detail = await getTopicDetail(userId, topicId);

    if (!detail) {
      return res.status(404).json({ error: 'No competency data for this topic' });
    }

    res.set('Cache-Control', `private, max-age=${CACHE_TTL_SECONDS}`);
    res.json({ topic: detail });
  })
);

module.exports = router;

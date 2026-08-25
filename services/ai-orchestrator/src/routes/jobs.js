/**
 * AI jobs API (F01 / AI-COM-07).
 *
 * POST /api/v1/ai/jobs          → validate + persist + publish, 202 { jobId }
 * GET  /api/v1/ai/jobs/:jobId   → status/result for the owning user
 * GET  /api/v1/ai/jobs          → list own jobs (optional ?status=&limit=)
 */

const express = require('express');
const { logger } = require('@study-partner/shared');
const { publishAiJob, AI_JOB_TYPES } = require('@study-partner/shared/ai-messaging');
const AiJob = require('../models/AiJob');

const router = express.Router();

// Basic per-type payload sanity before publishing. Per-agent schemas
// (PLAN-02, COACH-02, EVAL-02, SEARCH-02) tighten these on each migration.
const PAYLOAD_RULES = {
  'study.plan.generate': (p) =>
    typeof p.goal === 'string' && p.goal.length >= 1 && p.goal.length <= 500,
  'study.coach.nudge': (p) => typeof p === 'object',
  'study.eval.step': (p) => typeof p === 'object' && !!p.sessionId,
  'study.search.query': (p) =>
    typeof p.query === 'string' && p.query.length >= 1 && p.query.length <= 500,
  'study.ingest.course': (p) => typeof p === 'object' && !!p.fileRef
};

router.post('/jobs', async (req, res, next) => {
  try {
    const userId = req.user.userId; // from authenticated context — never body
    const { type, payload } = req.body || {};

    if (!AI_JOB_TYPES.includes(type)) {
      return res.status(400).json({ error: `unknown job type: ${type}` });
    }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload must be an object' });
    }
    const payloadOk = PAYLOAD_RULES[type] ? PAYLOAD_RULES[type](payload) : true;
    if (!payloadOk) {
      return res.status(422).json({ error: `payload failed validation for ${type}` });
    }

    const requestId = req.get('X-Request-ID') || `req-${Date.now()}`;
    const messageId = require('crypto').randomUUID();
    const correlationId = require('crypto').randomUUID();

    // Persist BEFORE publishing: a fast worker's result event must always
    // find its job (AI-COM-07 correlation guarantee).
    let job;
    try {
      job = await AiJob.createPending({
        type,
        userId,
        requestId,
        correlationId,
        messageId
      });
    } catch (err) {
      return next(err);
    }

    try {
      await publishAiJob(type, userId, payload, { requestId, correlationId, messageId });
    } catch (err) {
      await job.deleteOne(); // no silent loss, no orphan PENDING rows
      logger.error('ai_job_publish_failed_rolling_back', { jobId: job.jobId });
      return res.status(503).json({ error: 'AI job bus unavailable, retry later' });
    }

    logger.info('ai_job_created', {
      jobId: job.jobId,
      correlationId: job.correlationId,
      type,
      requestId,
      userId
    });

    return res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      correlationId: job.correlationId,
      poll: `/api/v1/ai/jobs/${job.jobId}`
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const query = { jobId: req.params.jobId };
    if (req.user.role !== 'admin') query.userId = req.user.userId;
    const job = await AiJob.findOne(query).lean();
    if (!job) return res.status(404).json({ error: 'job not found' });
    return res.json({
      jobId: job.jobId,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      result: job.result,
      error: job.error,
      fallbackUsed: job.fallbackUsed,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/jobs', async (req, res, next) => {
  try {
    const filter = { userId: req.user.userId };
    if (req.query.status) filter.status = String(req.query.status);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const jobs = await AiJob.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('jobId type status attempts error createdAt updatedAt')
      .lean();
    return res.json({ jobs });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

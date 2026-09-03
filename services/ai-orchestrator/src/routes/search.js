/**
 * Search API (F05 / SEARCH-07).
 *
 * POST /api/v1/search/query     → submit a search query; creates and publishes
 *                                 a study.search.query AiJob; 202 { jobId, poll }
 * GET  /api/v1/search/jobs/:jobId → status + answer/sources for the owning user
 *
 * Rate limited to 10 requests/min per user (SEARCH-02).
 * userId comes from the authenticated context only, never the body.
 */

const express = require('express');
const crypto = require('crypto');
const { logger } = require('@study-partner/shared');
const { publishAiJob } = require('@study-partner/shared/ai-messaging');
const { validateJobPayload } = require('@study-partner/shared/ai-messaging/payloadSchemas');
const AiJob = require('../models/AiJob');

const SEARCH_JOB_TYPE = 'study.search.query';
const router = express.Router();

router.post('/query', async (req, res, next) => {
  try {
    const userId = req.user.userId; // from auth context — never body
    const payload = req.body || {};

    // Validate against the worker contract (SEARCH-02 strict) BEFORE publishing.
    const check = validateJobPayload(SEARCH_JOB_TYPE, payload);
    if (!check.valid) {
      return res
        .status(422)
        .json({ error: 'search payload failed validation', details: check.errors });
    }

    const requestId = req.get('X-Request-ID') || `req-${Date.now()}`;
    const messageId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();

    // Persist BEFORE publishing: a fast worker's result event must always find
    // its job (AI-COM-07 correlation guarantee).
    let job;
    try {
      job = await AiJob.createPending({
        type: SEARCH_JOB_TYPE,
        userId,
        requestId,
        correlationId,
        messageId
      });
    } catch (err) {
      return next(err);
    }

    try {
      await publishAiJob(SEARCH_JOB_TYPE, userId, payload, {
        requestId,
        correlationId,
        messageId
      });
    } catch (err) {
      await job.deleteOne(); // no silent loss, no orphan PENDING rows
      logger.error('search_job_publish_failed_rolling_back', { jobId: job.jobId });
      return res.status(503).json({ error: 'AI job bus unavailable, retry later' });
    }

    logger.info('search_job_created', {
      jobId: job.jobId,
      query: payload.query,
      maxResults: payload.maxResults || 5,
      correlationId,
      requestId,
      userId
    });

    return res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      correlationId: job.correlationId,
      poll: `/api/v1/search/jobs/${job.jobId}`
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const query = { jobId: req.params.jobId, type: SEARCH_JOB_TYPE };
    if (req.user.role !== 'admin') query.userId = req.user.userId;
    const job = await AiJob.findOne(query).lean();
    if (!job) return res.status(404).json({ error: 'search job not found' });
    return res.json({
      jobId: job.jobId,
      status: job.status,
      attempts: job.attempts,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

/**
 * Eval API (F04 / EVAL-09).
 *
 * POST /api/v1/eval/step        → submit an answer for a session step; creates
 *                                 and publishes a study.eval.step AiJob;
 *                                 202 { jobId, poll }
 * GET  /api/v1/eval/jobs/:jobId → status + step result for the owning user
 *
 * This is the dedicated async surface for the Socratic UI (which polls instead
 * of waiting on a synchronous LLM call). It mirrors the generic AI jobs API
 * shape but is scoped to evaluations, and the POST+GET pair intentionally uses
 * the job bus so transient LLM failures retry (EVAL-07) and per-step results
 * are persisted by the result consumer (EVAL-08).
 */

const express = require('express');
const crypto = require('crypto');
const { logger } = require('@study-partner/shared');
const { publishAiJob } = require('@study-partner/shared/ai-messaging');
const { validateJobPayload } = require('@study-partner/shared/ai-messaging/payloadSchemas');
const AiJob = require('../models/AiJob');
const { resolveObjectiveContext } = require('../services/objectiveContext');

const EVAL_JOB_TYPE = 'study.eval.step';
const router = express.Router();

router.post('/step', async (req, res, next) => {
  try {
    const userId = req.user.userId; // from auth context — never body
    const payload = req.body || {};

    // Validate against the worker contract (sessionId required, optional
    // objectiveId parity) BEFORE persisting or publishing.
    const check = validateJobPayload(EVAL_JOB_TYPE, payload);
    if (!check.valid) {
      return res
        .status(422)
        .json({ error: 'eval payload failed validation', details: check.errors });
    }

    // EVAL-02b: when an objectiveId is provided, resolve the learning
    // objective's bloomLevel + knowledgeType server-side (Python never
    // touches Mongo) and carry them as evaluation context in the job
    // payload.  A present-but-unresolvable objectiveId is a client error.
    if (payload.objectiveId) {
      const ctx = await resolveObjectiveContext(payload.objectiveId);
      if (!ctx) {
        return res.status(422).json({
          error: 'objective not found or inactive',
          details: `objectiveId "${payload.objectiveId}" did not match an active learning objective`
        });
      }
      payload.targetBloomLevel = ctx.targetBloomLevel;
      payload.knowledgeType = ctx.knowledgeType;
    }

    const requestId = req.get('X-Request-ID') || `req-${Date.now()}`;
    const messageId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();

    // Persist BEFORE publishing: a fast worker's result event must always find
    // its job (AI-COM-07 correlation guarantee).
    let job;
    try {
      job = await AiJob.createPending({
        type: EVAL_JOB_TYPE,
        userId,
        requestId,
        correlationId,
        messageId
      });
    } catch (err) {
      return next(err);
    }

    try {
      await publishAiJob(EVAL_JOB_TYPE, userId, payload, {
        requestId,
        correlationId,
        messageId
      });
    } catch (err) {
      await job.deleteOne(); // no silent loss, no orphan PENDING rows
      logger.error('eval_job_publish_failed_rolling_back', { jobId: job.jobId });
      return res.status(503).json({ error: 'AI job bus unavailable, retry later' });
    }

    logger.info('eval_job_created', {
      jobId: job.jobId,
      sessionId: payload.sessionId,
      step: payload.step,
      objectiveId: payload.objectiveId || null,
      targetBloomLevel: payload.targetBloomLevel || null,
      correlationId,
      requestId,
      userId
    });

    return res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      correlationId: job.correlationId,
      sessionId: payload.sessionId,
      step: payload.step,
      poll: `/api/v1/eval/jobs/${job.jobId}`
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const query = { jobId: req.params.jobId, type: EVAL_JOB_TYPE };
    if (req.user.role !== 'admin') query.userId = req.user.userId;
    const job = await AiJob.findOne(query).lean();
    if (!job) return res.status(404).json({ error: 'eval job not found' });
    return res.json({
      jobId: job.jobId,
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

module.exports = router;

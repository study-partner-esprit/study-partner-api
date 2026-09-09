/**
 * Coach API (COACH-10) — async nudge trigger over the job bus.
 *
 * POST /api/v1/coach/nudge       → creates a `study.coach.nudge` job, 202 { jobId }
 * GET  /api/v1/coach/jobs/:jobId → status + nudge result (owner-scoped)
 *
 * The envoy payload is bounded by `validateCoachPayload` (COACH-02) on the
 * orchestrator side; this router adds the same checks up front so malformed
 * nudges are rejected before any job is created. The nudge is tied to the
 * authenticated user's active session (AC#3) — `session_id` is always resolved
 * here, never trusted from the client unless it belongs to the user.
 *
 * COACH-13: the bounded `session_stats` block (progress, minutes on task, task
 * switches, breaks, streak) is derived SERVER-SIDE from the active session and
 * the user's gamification streak — never accepted from the client — so nudges
 * are grounded in real in-session behaviour.
 */

const express = require('express');
const Joi = require('joi');
const mongoose = require('mongoose');
const axios = require('axios');

const { logger } = require('@study-partner/shared');
const { tierGate } = require('@study-partner/shared/tierGate');
const { StudySession } = require('../models');
const { resolveSessionStats } = require('../utils/sessionStats');
const { fetchGamificationProfile } = require('../utils/gamificationService');
const { validateCoachPayload } = require('@study-partner/shared/ai-messaging/payloadSchemas');
const router = express.Router();

// Mirrors COACH-02 limits (same bounds as validateCoachPayload).
const nudgeSchema = Joi.object({
  session_id: Joi.string().max(64).optional(),
  focus_score: Joi.number().min(0).max(1).optional(),
  focus_state: Joi.string().valid('Focused', 'Drifting', 'Lost').optional(),
  fatigue_score: Joi.number().min(0).max(1).optional(),
  fatigue_state: Joi.string().valid('Alert', 'Moderate', 'High', 'Critical').optional(),
  ignored_count: Joi.number().integer().min(0).optional(),
  do_not_disturb: Joi.boolean().optional(),
  current_time: Joi.date().iso().optional()
});

// POST /api/v1/coach/nudge → 202 { jobId }
router.post('/nudge', tierGate('vip', 'vip_plus', 'trial'), async (req, res) => {
  try {
    const { error, value } = nudgeSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.userId;

    // Resolve the active session: explicit session_id (must belong to the
    // user) or the user's current active session. The resolved document is
    // also the source of the COACH-13 session_stats.
    let sessionId = value.session_id;
    let session = null;
    if (sessionId) {
      const owned = await StudySession.findOne({ _id: sessionId, userId });
      if (!owned) {
        return res.status(404).json({ error: 'Session not found' });
      }
      // Keep the provided id only if the session is still active.
      if (owned.status !== 'active') {
        return res.status(400).json({ error: 'Session is not active' });
      }
      session = owned;
    } else {
      const active = await StudySession.findOne({ userId, status: 'active' }).sort({
        createdAt: -1
      });
      if (!active) {
        return res.status(400).json({ error: 'No active study session for this user' });
      }
      session = active;
      sessionId = active._id.toString();
    }

    const payload = { session_id: sessionId };
    for (const field of [
      'focus_score',
      'focus_state',
      'fatigue_score',
      'fatigue_state',
      'ignored_count',
      'do_not_disturb',
      'current_time'
    ]) {
      if (value[field] !== undefined) payload[field] = value[field];
    }
    payload.current_time = payload.current_time || new Date().toISOString();

    // COACH-13: supply bounded session stats from the active session + the
    // user's gamification streak. Missing/stale data defaults to 0 — the
    // coach job must never fail because stats are unavailable.
    const profile = await fetchGamificationProfile({
      authorization: req.headers.authorization
    });
    const streakDays = profile?.stats?.currentStreak ?? 0;
    payload.session_stats = resolveSessionStats({
      session,
      now: new Date(payload.current_time),
      currentStreakDays: streakDays
    });

    // Defense-in-depth: reject pre-publish the same way the orchestrator would.
    const check = validateCoachPayload(payload);
    if (!check.valid) {
      return res.status(422).json({ error: 'payload failed validation', details: check.errors });
    }

    const requestId = req.get('X-Request-ID') || `req-${Date.now()}`;

    const orchestratorUrl =
      process.env.AI_ORCHESTRATOR_URL || 'http://ai-orchestrator-service:3004';

    let response;
    try {
      response = await axios.post(
        `${orchestratorUrl}/api/v1/ai/jobs`,
        { type: 'study.coach.nudge', payload },
        {
          headers: {
            Authorization: req.headers.authorization,
            'X-Request-ID': requestId
          },
          timeout: 10000
        }
      );
    } catch (err) {
      logger.error('coach_job_create_failed', {
        status: err.response?.status,
        error: err.message
      });
      return res.status(503).json({ error: 'AI job bus unavailable, retry later' });
    }

    const { jobId, correlationId } = response.data;

    logger.info('coach_nudge_job_published', {
      userId,
      sessionId,
      jobId,
      correlationId
    });

    return res.status(202).json({
      status: 'processing',
      jobId,
      correlationId,
      message: 'Nudge scheduled. Poll /api/v1/coach/jobs/:jobId for completion.'
    });
  } catch (err) {
    logger.error('coach_nudge_failed', { error: err.message });
    return res.status(503).json({ error: 'AI job bus unavailable, retry later' });
  }
});

// GET /api/v1/coach/jobs/:jobId → status + nudge (owner-scoped)
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const job = await mongoose.connection
      .collection('ai_jobs')
      .findOne({ jobId: req.params.jobId, userId });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.json({
      jobId: job.jobId,
      status: job.status,
      result: job.result,
      error: job.error,
      fallbackUsed: job.fallbackUsed,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    });
  } catch (err) {
    logger.error('coach_job_status_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch job status' });
  }
});

module.exports = router;

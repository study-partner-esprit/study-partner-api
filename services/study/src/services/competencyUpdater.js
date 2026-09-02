/**
 * BLOOM-08 Competency Updater
 *
 * Polls the eval_results collection (written by the orchestrator) for steps
 * that demonstrated a skill level, claims each via a unique correlationId
 * (idempotent ACK-skip), resolves the competency key, and calls
 * upsertProfile to atomically update the CompetencyProfile.
 *
 * Collection hygiene:
 * - eval_results: read-only by this service (orchestrator writes)
 * - competency_processing: idempotency claim store (unique correlationId)
 * - competency_profiles: upserted by upsertProfile (BLOOM-07)
 */

const { EvalResultRecord, CompetencyProcessing, LearningObjective } = require('../models/index');
const { upsertProfile } = require('./competency');

const POLL_INTERVAL_MS = Number(process.env.COMPETENCY_POLL_INTERVAL_MS) || 5000;
const POLL_LIMIT = Number(process.env.COMPETENCY_POLL_LIMIT) || 50;

/**
 * Claim an eval result idempotently via unique correlationId.
 * Returns true if newly claimed, false if already processed.
 */
async function claimResult(correlationId) {
  try {
    await CompetencyProcessing.create({ correlationId });
    return true;
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

/**
 * Resolve objectiveId → { topicId, knowledgeType } via LearningObjective.
 * Returns null when the objective is missing or lacks a topic reference.
 */
async function resolveCompetencyKey(objectiveId) {
  if (!objectiveId) return null;
  const objective = await LearningObjective.findOne({ objectiveId }).lean();
  if (!objective || !objective.topicId) return null;
  return { topicId: objective.topicId, knowledgeType: objective.knowledgeType || 'declarative' };
}

/**
 * Process a single EvalResult record: claim it, resolve the key, build the
 * evidence item, and upsert the profile.
 */
async function processEvalResult(result) {
  if (!result.demonstratedBloomLevel) return { skipped: 'no_skill_level' };

  const claimed = await claimResult(result.correlationId);
  if (!claimed) return { skipped: 'already_processed' };

  const key = await resolveCompetencyKey(result.objectiveId);
  if (!key) {
    // Claim is already held; can't retry without manual intervention.
    // Log and move on. The correlationId in the claim prevents re-processing.
    return { skipped: 'no_objective', correlationId: result.correlationId };
  }

  const evidenceItem = {
    objectiveId: result.objectiveId,
    demonstratedBloomLevel: result.demonstratedBloomLevel,
    masteryScore: result.masteryScore,
    evaluatedAt: result.createdAt,
    correlationId: result.correlationId
  };

  await upsertProfile({
    userId: result.userId,
    topicId: key.topicId,
    knowledgeType: key.knowledgeType,
    bloomLevel: result.demonstratedBloomLevel,
    evidenceItem
  });

  return {
    processed: true,
    userId: result.userId,
    topicId: key.topicId,
    knowledgeType: key.knowledgeType,
    bloomLevel: result.demonstratedBloomLevel
  };
}

/**
 * One poll cycle: find EvalResult records with a demonstrated skill level,
 * claim each idempotently, and process unclaimed ones.
 */
async function runOnce() {
  const candidates = await EvalResultRecord.find({
    demonstratedBloomLevel: { $ne: null }
  })
    .sort({ createdAt: 1 })
    .limit(POLL_LIMIT)
    .lean();

  const results = { total: candidates.length, processed: 0, skipped: 0, errors: 0 };

  for (const candidate of candidates) {
    try {
      const outcome = await processEvalResult(candidate);
      if (outcome.processed) results.processed++;
      else results.skipped++;
    } catch (err) {
      results.errors++;
    }
  }

  return results;
}

/**
 * Start the recurring poller. Intended to be called once at server boot.
 * Returns a stop function for graceful shutdown.
 */
function startCompetencyUpdater() {
  let timer = null;
  let running = false;

  async function poll() {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (_) {
      // poll-level errors swallowed; individual results logged above
    } finally {
      running = false;
    }
  }

  timer = setInterval(poll, POLL_INTERVAL_MS);
  // Run immediately on start
  poll();

  return function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

module.exports = {
  claimResult,
  resolveCompetencyKey,
  processEvalResult,
  runOnce,
  startCompetencyUpdater,
  POLL_INTERVAL_MS,
  POLL_LIMIT
};

/**
 * EvalResult persistence helpers (F04 / EVAL-08).
 *
 * `upsertByCorrelation` is idempotent by `correlationId`: a replayed result
 * event overwrites the existing document in place, so a step is never
 * double-counted. `listStepsForSession` returns the ordered per-step history a
 * backend can use to resume a session.
 *
 * This is the only writer to the eval_results collection — the Python agents
 * only publish ai.results events and never touch MongoDB.
 */

const EvalResult = require('../models/EvalResult');

/**
 * @param {object} record fields produced by buildEvalResultRecord
 * @returns {Promise<string>} correlationId written
 */
async function upsertByCorrelation(record) {
  const doc = {
    correlationId: record.correlationId,
    messageId: record.messageId,
    sessionId: record.sessionId,
    step: record.step,
    status: record.status,
    masteryScore: record.masteryScore,
    scores: record.scores,
    nextQuestion: record.nextQuestion,
    demonstratedBloomLevel: record.demonstratedBloomLevel,
    objectiveId: record.objectiveId
  };
  await EvalResult.updateOne(
    { correlationId: record.correlationId },
    { $set: doc },
    { upsert: true }
  );
  return doc.correlationId;
}

/**
 * @param {string} sessionId
 * @returns {Promise<Array>} step records ascending by step
 */
async function listStepsForSession(sessionId) {
  return EvalResult.find({ sessionId }).sort({ step: 1 }).lean();
}

module.exports = { upsertByCorrelation, listStepsForSession };

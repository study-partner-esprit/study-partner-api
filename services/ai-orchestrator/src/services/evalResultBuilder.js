/**
 * buildEvalResultRecord — pure transform of an ai.results result event into the
 * EvalResult doc to persist. Extracted from the consumer so it is unit-testable
 * without a broker or a database.
 *
 * Only completed study.eval.step result events produce a record; everything
 * else returns null (non-eval jobs keep their existing AiJob persistence path).
 */

const EVAL_JOB_TYPE = 'study.eval.step';

const SCORE_FIELDS = [
  'concept_coverage',
  'logical_coherence',
  'causal_reasoning',
  'error_awareness',
  'specificity',
  'mastery_score'
];

/**
 * @param {object} result ai.results envelope {correlationId, messageId, type, status, payload}
 * @returns {object|null} EvalResult doc fields, or null when not an eval step
 */
function buildEvalResultRecord(result) {
  if (!result || !result.payload || result.type !== EVAL_JOB_TYPE) return null;

  const payload = result.payload;
  if (typeof payload.sessionId !== 'string' || !Number.isInteger(payload.step)) {
    return null;
  }

  const evaluationOutput = payload.evaluation_output || {};
  const scores = {};
  for (const field of SCORE_FIELDS) {
    if (typeof evaluationOutput[field] === 'number') {
      scores[field] = evaluationOutput[field];
    }
  }

  return {
    correlationId: result.correlationId,
    messageId: result.messageId,
    sessionId: payload.sessionId,
    step: payload.step,
    status: payload.state || evaluationOutput.session_status || 'CONTINUE',
    masteryScore: typeof payload.mastery_score === 'number' ? payload.mastery_score : null,
    scores,
    nextQuestion:
      evaluationOutput.next_question !== undefined && evaluationOutput.next_question !== null
        ? evaluationOutput.next_question
        : payload.next_question || null,
    demonstratedBloomLevel:
      payload.demonstratedBloomLevel !== undefined && payload.demonstratedBloomLevel !== null
        ? payload.demonstratedBloomLevel
        : evaluationOutput.demonstrated_bloom_level || null,
    objectiveId: payload.objectiveId !== undefined ? payload.objectiveId : null
  };
}

module.exports = { buildEvalResultRecord, EVAL_JOB_TYPE };

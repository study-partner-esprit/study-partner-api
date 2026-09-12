/**
 * AI message contract — canonical envelopes (AI-COM-02 / AI-COM-03).
 *
 * Single source of truth for the shape of AI job messages and AI result
 * events travelling over RabbitMQ. Mirrored by the Pydantic models in
 * `study-partner-ai/messaging/envelope.py`; both sides MUST validate on
 * publish AND on consume. Contract doc: docs/contracts/ai-message-contract.md
 */

const ENVELOPE_VERSION = '1';

/**
 * Known AI job types. Each maps to one RabbitMQ work queue.
 */
const AI_JOB_TYPES = Object.freeze([
  'study.plan.generate',
  'study.coach.nudge',
  'study.eval.step',
  'study.search.query',
  'study.ingest.course',
  'study.knowledge.extract',
  'study.schedule.apply'
]);

const JOB_STATUSES = Object.freeze(['PENDING', 'PROCESSING', 'RETRYING', 'COMPLETED', 'FAILED']);

const RESULT_STATUSES = Object.freeze(['completed', 'failed']);

/**
 * INGEST-06/07 — staged progress events published on ai.results under the
 * `progress` routing key. Mirrors `AiProgressEnvelope` in
 * study-partner-ai/messaging/envelope.py (status "progress", stage in
 * PROGRESS_STAGES, progress ∈ [0,1], detail ≤256, no payload field).
 */
const PROGRESS_STATUS = 'progress';
const PROGRESS_STAGES = Object.freeze(['parsing', 'enriching', 'embedding', 'indexing']);

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isNonEmptyString(value, maxLength = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function validateCommonFields(envelope, errors) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    errors.push('envelope must be a JSON object');
    return false;
  }
  if (!isNonEmptyString(envelope.messageId) || !UUID_V4_RE.test(envelope.messageId)) {
    errors.push('messageId must be a UUID v4 string');
  }
  if (!isNonEmptyString(envelope.correlationId) || !UUID_V4_RE.test(envelope.correlationId)) {
    errors.push('correlationId must be a UUID v4 string');
  }
  if (!isNonEmptyString(envelope.requestId, 128)) {
    errors.push('requestId must be a non-empty string (max 128 chars)');
  }
  if (envelope.version !== ENVELOPE_VERSION) {
    errors.push(`version must be "${ENVELOPE_VERSION}"`);
  }
  if (!isNonEmptyString(envelope.timestamp, 40) || !ISO_8601_RE.test(envelope.timestamp)) {
    errors.push('timestamp must be an ISO-8601 UTC string');
  }
  return true;
}

/**
 * Validate an AI job (request) envelope.
 * @param {*} envelope
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateAiJobEnvelope(envelope) {
  const errors = [];
  if (!validateCommonFields(envelope, errors)) {
    return { valid: false, errors };
  }
  if (!AI_JOB_TYPES.includes(envelope.type)) {
    errors.push(`type must be one of: ${AI_JOB_TYPES.join(', ')}`);
  }
  if (!isNonEmptyString(envelope.userId, 128)) {
    errors.push('userId must be a non-empty string taken from the authenticated context');
  }
  if (
    !envelope.payload ||
    typeof envelope.payload !== 'object' ||
    Array.isArray(envelope.payload)
  ) {
    errors.push('payload must be a JSON object');
  }
  if ('status' in envelope || 'error' in envelope || 'result' in envelope) {
    errors.push('job envelopes must not carry status/error/result fields');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate an AI result event envelope.
 * @param {*} envelope
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateAiResultEnvelope(envelope) {
  const errors = [];
  if (!validateCommonFields(envelope, errors)) {
    return { valid: false, errors };
  }
  if (!AI_JOB_TYPES.includes(envelope.type)) {
    errors.push(`type must be one of: ${AI_JOB_TYPES.join(', ')}`);
  }
  if (!RESULT_STATUSES.includes(envelope.status)) {
    errors.push('status must be "completed" or "failed"');
  }
  if (envelope.status === 'completed') {
    if (
      !envelope.payload ||
      typeof envelope.payload !== 'object' ||
      Array.isArray(envelope.payload)
    ) {
      errors.push('completed results must carry a payload object');
    }
    if ('error' in envelope && envelope.error !== undefined && envelope.error !== null) {
      errors.push('completed results must not carry an error field');
    }
  }
  if (envelope.status === 'failed') {
    if (!isNonEmptyString(envelope.error, 512)) {
      errors.push('failed results must carry a sanitized error message (max 512 chars)');
    } else if (/stack|at .*\(|mongodb(\+srv)?:\/\//i.test(envelope.error)) {
      errors.push('error must be sanitized: no stack traces or connection strings');
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate an AI progress event envelope (INGEST-06/07).
 * @param {*} envelope
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateAiProgressEnvelope(envelope) {
  const errors = [];
  if (!validateCommonFields(envelope, errors)) {
    return { valid: false, errors };
  }
  if (!AI_JOB_TYPES.includes(envelope.type)) {
    errors.push(`type must be one of: ${AI_JOB_TYPES.join(', ')}`);
  }
  if (envelope.status !== PROGRESS_STATUS) {
    errors.push(`status must be "${PROGRESS_STATUS}"`);
  }
  if (!PROGRESS_STAGES.includes(envelope.stage)) {
    errors.push(`stage must be one of: ${PROGRESS_STAGES.join(', ')}`);
  }
  if (envelope.progress !== undefined && envelope.progress !== null) {
    if (
      typeof envelope.progress !== 'number' ||
      Number.isNaN(envelope.progress) ||
      envelope.progress < 0 ||
      envelope.progress > 1
    ) {
      errors.push('progress must be a number in [0, 1]');
    }
  }
  if (envelope.detail !== undefined && envelope.detail !== null) {
    if (!isNonEmptyString(envelope.detail, 256)) {
      errors.push('detail must be a string (max 256 chars)');
    }
  }
  if ('payload' in envelope || 'error' in envelope) {
    errors.push('progress envelopes must not carry payload/error fields');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  ENVELOPE_VERSION,
  AI_JOB_TYPES,
  JOB_STATUSES,
  RESULT_STATUSES,
  PROGRESS_STATUS,
  PROGRESS_STAGES,
  validateAiJobEnvelope,
  validateAiResultEnvelope,
  validateAiProgressEnvelope
};

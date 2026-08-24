/**
 * RabbitMQ topology for AI jobs (F01 / AI-COM-06).
 *
 * Mirrored by `study-partner-ai/messaging/topology.py`. Names and semantics
 * MUST stay identical on both sides — covered by topology-parity tests.
 *
 * Layout (vhost `mindflow`):
 *   ai.jobs   (direct)  → work queue per type: ai.work.<type>
 *                         args: dead-letter-exchange = ai.dlx
 *   ai.delay  (direct)  → delay queues: ai.delay.1s | ai.delay.4s | ai.delay.16s
 *                         args: x-message-ttl = step, dead-letter-exchange = ai.jobs
 *                         (dead-lettering preserves the original routing key,
 *                          so a delayed job re-routes to its work queue)
 *   ai.dlx    (direct)  → DLQ per type: ai.dlq.<type>
 *   ai.results(direct)  → result events consumed by the orchestrator: ai.results.inbox
 */

const EXCHANGE_JOBS = 'ai.jobs';
const EXCHANGE_DELAY = 'ai.delay';
const EXCHANGE_DLX = 'ai.dlx';
const EXCHANGE_RESULTS = 'ai.results';

const RESULT_QUEUE = 'ai.results.inbox';

const RETRY_DELAYS_MS = Object.freeze([1000, 4000, 16000]);
const MAX_RETRIES = RETRY_DELAYS_MS.length; // 3 retries → up to 4 attempts total

const workQueueName = (type) => `ai.work.${type}`;
const dlqQueueName = (type) => `ai.dlq.${type}`;
const delayQueueName = (delayMs) =>
  `ai.delay.${RETRY_DELAYS_MS.includes(delayMs) ? `${delayMs / 1000}s` : `${delayMs}ms`}`;

/**
 * Classify a failure as retryable or terminal.
 * Retryable: transient infrastructure/provider issues (timeouts, connections, quotas).
 * Terminal: schema/validation/authorization problems — retrying cannot succeed.
 */
const FAILURE_CLASSES = Object.freeze({ RETRYABLE: 'retryable', TERMINAL: 'terminal' });

function classifyFailure(err) {
  const message = String((err && err.message) || err || '');
  const code = (err && (err.code || err.name)) || '';
  const combined = `${code} ${message}`.toLowerCase();

  const terminalPatterns = [
    'validation',
    'invalid',
    'schema',
    'unauthorized',
    'forbidden',
    'notfound',
    'not found',
    'rejected', // output rejected by validation pipeline
    'parseerror',
    'payload'
  ];
  if (terminalPatterns.some((p) => combined.includes(p))) {
    return FAILURE_CLASSES.TERMINAL;
  }

  const retryablePatterns = [
    'timeout',
    'timed out',
    'etimedout',
    'econnrefused',
    'econnreset',
    'econnaborted',
    'enotfound',
    'ehostunreach',
    'enetunreach',
    'socket hang up',
    'rate limit',
    'quota',
    '429',
    '502',
    '503',
    '504',
    'temporarily unavailable',
    'connection closed'
  ];
  if (retryablePatterns.some((p) => combined.includes(p))) {
    return FAILURE_CLASSES.RETRYABLE;
  }

  // Unknown failures are treated as retryable so transient blips recover;
  // persistent unknowns exhaust retries and land in the DLQ.
  return FAILURE_CLASSES.RETRYABLE;
}

/** Retry attempt number stored in message headers (1-based). */
const retryHeader = 'x-retry-count';

module.exports = {
  EXCHANGE_JOBS,
  EXCHANGE_DELAY,
  EXCHANGE_DLX,
  EXCHANGE_RESULTS,
  RESULT_QUEUE,
  RETRY_DELAYS_MS,
  MAX_RETRIES,
  workQueueName,
  dlqQueueName,
  delayQueueName,
  FAILURE_CLASSES,
  classifyFailure,
  retryHeader
};

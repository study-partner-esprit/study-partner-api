/**
 * RabbitMQ topology for AI jobs (F01 / AI-COM-06).
 *
 * Mirrored by `study-partner-ai/messaging/topology.py`. Names and semantics
 * MUST stay identical on both sides — covered by topology-parity tests.
 *
 * Layout (vhost `/`):
 *   ai.jobs   (direct)  → work queue per type: ai.work.<type>
 *                         args: dead-letter-exchange = ai.dlx
 *                         Extra binding per (type, step): retry.<type>.<ms>
 *   ai.delay  (direct)  → per-type delay queues: ai.delay.<type>.<ms>
 *                         args: x-message-ttl = step, dead-letter-exchange = ai.jobs
 *                         (dead-lettering preserves routing key = retry.<type>.<ms>,
 *                          which is bound to the work queue above)
 *   ai.dlx    (direct)  → DLQ per type: ai.dlq.<type>
 *   ai.results(direct)  → result events consumed by the orchestrator: ai.results.inbox
 */

const EXCHANGE_JOBS = 'ai.jobs';
const EXCHANGE_DELAY = 'ai.delay';
const EXCHANGE_DLX = 'ai.dlx';
const EXCHANGE_RESULTS = 'ai.results';

const RESULT_QUEUE = 'ai.results.inbox';

const RETRY_DELAYS_MS = Object.freeze(
  (() => {
    // Env override exists for integration tests (tiny delays); production
    // uses the canonical 1s → 4s → 16s ladder.
    const raw = process.env.AI_RETRY_DELAYS_MS;
    if (!raw) return [1000, 4000, 16000];
    const parsed = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.length ||
      parsed.some((n) => !Number.isInteger(n) || n < 1)
    ) {
      throw new Error('AI_RETRY_DELAYS_MS must be a JSON array of positive integers');
    }
    return parsed;
  })()
);
const MAX_RETRIES = RETRY_DELAYS_MS.length;

const workQueueName = (type) => `ai.work.${type}`;
const dlqQueueName = (type) => `ai.dlq.${type}`;
/**
 * Delay queues are PER-TYPE: a dead-lettered retry keeps its CURRENT routing
 * key, so each (type, step) delay queue publishes under a dedicated retry key
 * that is ALSO bound from the jobs exchange to the work queue. Expired
 * retries therefore land back on the right work queue without needing
 * x-dead-letter-routing-key.
 */
const delayQueueName = (type, delayMs) => `ai.delay.${type}.${delayMs}`;
const retryRoutingKey = (type, delayMs) => `retry.${type}.${delayMs}`;

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
  retryRoutingKey,
  FAILURE_CLASSES,
  classifyFailure,
  retryHeader
};

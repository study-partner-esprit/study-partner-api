/**
 * DLQ replay tool (F01 / AI-COM-06 ops completion).
 *
 * Moves dead-lettered jobs from `ai.dlq.<type>` back onto the work exchange
 * after a hotfix, granting each message exactly one fresh attempt:
 *
 * - NEW messageId per replay: idempotency claims are keyed
 *   `<messageId>:<attempt>` (AI-COM-08); reusing the original id could be
 *   swallowed as a duplicate if its claim is still within TTL.
 * - correlationId PRESERVED so AiJob status updates still correlate.
 * - `x-retry-count` / `x-last-failure` stripped; attempt restarts at 0.
 * - `x-original-message-id` + `x-replayed-from` added for audit trails.
 *
 * CLI:
 *   node shared/ai-messaging/dlq-replay.js --type study.search.query [--limit 50] [--dry-run]
 * Env:
 *   RABBITMQ_URL (default amqp://guest:guest@localhost:5672/%2F)
 */

const crypto = require('crypto');
const amqp = require('amqplib');
const { EXCHANGE_JOBS, dlqQueueName, retryHeader } = require('./topology');
const logger = require('../logger');

/**
 * Replay up to `limit` messages from a DLQ back onto the jobs exchange.
 * @param {object} ch amqplib channel (confirm channel recommended)
 * @param {{type: string, limit?: number, dryRun?: boolean}} opts
 * @returns {Promise<{inspected: number, replayed: number, dryRun: boolean}>}
 */
async function replayDeadLetters(ch, { type, limit = Infinity, dryRun = false }) {
  if (!type) throw new Error('replay requires a job type');
  const queue = dlqQueueName(type);
  let inspected = 0;
  let replayed = 0;

  while (inspected < limit) {
    const msg = await ch.get(queue, { noAck: false });
    if (!msg) break;
    inspected += 1;

    const headers = { ...(msg.properties.headers || {}) };
    const originalMessageId = msg.properties.messageId || headers['x-original-message-id'];
    delete headers[retryHeader];
    delete headers['x-last-failure'];
    headers['x-original-message-id'] = originalMessageId || 'unknown';
    headers['x-replayed-from'] = queue;

    if (!dryRun) {
      ch.publish(EXCHANGE_JOBS, type, msg.content, {
        persistent: true,
        mandatory: true,
        contentType: msg.properties.contentType || 'application/json',
        messageId: crypto.randomUUID(), // fresh id → fresh idempotency claim
        correlationId: msg.properties.correlationId,
        headers,
        timestamp: Date.now()
      });
      ch.ack(msg);
      replayed += 1;
    } else {
      ch.nack(msg, false, true); // put it back untouched
    }
  }

  return { inspected, replayed, dryRun };
}

/** CLI entrypoint. */
async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const type = getArg('--type');
  const limit = Number(getArg('--limit')) || Infinity;
  const dryRun = args.includes('--dry-run');

  if (!type) {
    console.error('Usage: node dlq-replay.js --type <job.type> [--limit N] [--dry-run]');
    process.exit(2);
  }

  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/%2F';
  const connection = await amqp.connect(url);
  const ch = await connection.createConfirmChannel();

  try {
    const result = await replayDeadLetters(ch, { type, limit, dryRun });
    if (!dryRun && result.replayed > 0) await ch.waitForConfirms();
    console.log(JSON.stringify({ ...result, type }));
  } finally {
    await connection.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('dlq_replay_failed', { error: err.message });
    process.exit(1);
  });
}

module.exports = { replayDeadLetters };

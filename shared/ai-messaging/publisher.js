/**
 * AI job publisher + result consumer (F01 / AI-COM-04).
 *
 * Single shared module for publishing validated AI jobs to RabbitMQ and
 * consuming AI result events. Enforces the AI-COM-02/03 envelope contracts,
 * owns connection lifecycle (reconnect with exponential backoff + heartbeat),
 * and uses publisher confirms so a publish is only reported as successful
 * once the broker has accepted it.
 *
 * Usage:
 *   const { publishAiJob } = require('@study-partner/shared/ai-messaging');
 *   const { messageId, correlationId } = await publishAiJob(
 *     'study.plan.generate', userId, payload, { requestId });
 */

const crypto = require('crypto');
const amqp = require('amqplib');
const {
  validateAiJobEnvelope,
  validateAiResultEnvelope,
  validateAiProgressEnvelope
} = require('./envelope');
const {
  EXCHANGE_JOBS,
  EXCHANGE_DELAY,
  EXCHANGE_RESULTS,
  RESULT_QUEUE,
  PROGRESS_QUEUE,
  INGEST_RESULT_QUEUE,
  PROGRESS_ROUTING_KEY,
  RETRY_DELAYS_MS,
  workQueueName,
  dlqQueueName,
  delayQueueName,
  retryRoutingKey
} = require('./topology');
const logger = require('../logger');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/%2F';
const HEARTBEAT_SECONDS = 30;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30000;

let connection = null;
let confirmChannel = null;
let connecting = null;
let reconnectAttempts = 0;
let closing = false;
// ai.results consumer channels, keyed by queue name (INGEST-07: the study
// service subscribes to BOTH `progress` and `result` on its own queues).
const consumerChannels = new Map();
// messageIds the broker returned as UNROUTABLE (no queue matched). A
// confirmed-but-unroutable publish is still a lost job, so publishAiJob
// checks this set after confirms and fails loudly instead.
const unroutableMessageIds = new Set();

function backoffDelay(attempt) {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
}

async function connect() {
  if (connection && connection !== 'closed') return connection;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      connection = await amqp.connect(RABBITMQ_URL, {
        heartbeat: HEARTBEAT_SECONDS
      });
      reconnectAttempts = 0;
      logger.info('ai_messaging_connected', { url: safeUrl(RABBITMQ_URL) });

      connection.on('error', (err) => {
        logger.error('ai_messaging_connection_error', { error: err.message });
      });
      connection.on('close', () => {
        connection = null;
        confirmChannel = null;
        if (!closing) scheduleReconnect();
      });

      // Publisher-confirm channel: jobs are only "sent" after broker ACK.
      confirmChannel = await connection.createConfirmChannel();
      await confirmChannel.assertExchange(EXCHANGE_JOBS, 'direct', { durable: true });
      // mandatory:true → unroutable jobs come back via basic.return instead
      // of being silently dropped (AI-COM-04: no silent loss).
      confirmChannel.on('return', (msg) => {
        const id = msg && msg.properties && msg.properties.messageId;
        logger.error('ai_job_unroutable', { messageId: id });
        if (id) unroutableMessageIds.add(id);
      });
      confirmChannel.on('error', () => {}); // handled via connection close
      return connection;
    } catch (err) {
      connection = null;
      confirmChannel = null;
      scheduleReconnect();
      throw err;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

function scheduleReconnect() {
  if (closing) return;
  const delay = backoffDelay(reconnectAttempts++);
  logger.warn('ai_messaging_reconnect_scheduled', { delayMs: delay });
  setTimeout(() => {
    connect().catch(() => {}); // logged inside connect()
  }, delay);
}

function safeUrl(url) {
  return String(url).replace(/\/\/[^@]*@/, '//***@');
}

/**
 * Publish an AI job. Validates the fully-built envelope before sending.
 * @param {string} type one of AI_JOB_TYPES
 * @param {string} userId from the authenticated context (never from client body)
 * @param {object} payload operation-specific, already schema-checked by caller
 * @param {{correlationId?: string, requestId?: string}} [opts]
 * @returns {Promise<{messageId: string, correlationId: string}>}
 */
async function publishAiJob(type, userId, payload, opts = {}) {
  const envelope = {
    messageId: opts.messageId || crypto.randomUUID(),
    correlationId: opts.correlationId || crypto.randomUUID(),
    type,
    version: '1',
    userId,
    requestId: opts.requestId || `req-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    payload: payload || {}
  };

  const validation = validateAiJobEnvelope(envelope);
  if (!validation.valid) {
    const err = new Error(`invalid job envelope: ${validation.errors.join('; ')}`);
    err.code = 'ENVELOPE_INVALID';
    throw err;
  }

  try {
    await connect();
    if (!confirmChannel)
      throw Object.assign(new Error('broker channel unavailable'), { code: 'EBROKERDOWN' });

    const ok = confirmChannel.publish(EXCHANGE_JOBS, type, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      mandatory: true,
      contentType: 'application/json',
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      type: envelope.type,
      timestamp: Date.parse(envelope.timestamp)
    });
    if (!ok || !(await confirmChannel.waitForConfirms())) {
      throw Object.assign(new Error('broker did not confirm job publish'), {
        code: 'EPUBLISHCONFIRM'
      });
    }
    // A confirmed-but-unroutable message (queue missing for this type) would
    // otherwise be lost — surface it as a recoverable failure.
    if (unroutableMessageIds.has(envelope.messageId)) {
      unroutableMessageIds.delete(envelope.messageId);
      throw Object.assign(
        new Error(`no queue bound for job type "${type}" — worker topology missing`),
        { code: 'ENOROUTE' }
      );
    }

    logger.info('ai_job_published', {
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      type,
      requestId: envelope.requestId
    });
    return { messageId: envelope.messageId, correlationId: envelope.correlationId };
  } catch (err) {
    logger.error('ai_job_publish_failed', {
      type,
      code: err.code || 'UNKNOWN',
      error: err.message
    });
    // Recoverable by design: callers map this to 503/retry, never silent loss.
    throw err;
  }
}

/**
 * Ensure the full topology for a given job type exists (idempotent).
 * Creates per-type delay queues, the work queue with all retry bindings, and
 * the DLQ.  Called by workers at startup; publishers only need the exchange.
 */
async function ensureTopologyForType(type) {
  await connect();
  const ch = await connection.createConfirmChannel();
  try {
    await ch.assertExchange(EXCHANGE_JOBS, 'direct', { durable: true });
    await ch.assertExchange(EXCHANGE_DELAY, 'direct', { durable: true });
    await ch.assertExchange('ai.dlx', 'direct', { durable: true });

    const workQ = workQueueName(type);

    // Work queue: dead-letters rejected/unacked messages to ai.dlx. The
    // routing key is pinned to the bare type — a retried message's CURRENT
    // key is `retry.<type>.<ms>` and would otherwise miss the DLQ binding.
    await ch.assertQueue(workQ, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'ai.dlx',
        'x-dead-letter-routing-key': type
      }
    });
    // Primary binding: type routing key
    await ch.bindQueue(workQ, EXCHANGE_JOBS, type);

    // Per-(type, step) delay queues + extra work-queue bindings for retry keys.
    // When a delayed message expires it keeps its CURRENT routing key
    // (retry.<type>.<ms>), so the work queue needs a binding for each one.
    for (const delayMs of RETRY_DELAYS_MS) {
      const qName = delayQueueName(type, delayMs);
      await ch.assertQueue(qName, {
        durable: true,
        arguments: {
          'x-message-ttl': delayMs,
          'x-dead-letter-exchange': EXCHANGE_JOBS
        }
      });
      const retryKey = retryRoutingKey(type, delayMs);
      await ch.bindQueue(qName, EXCHANGE_DELAY, retryKey);
      await ch.bindQueue(workQ, EXCHANGE_JOBS, retryKey);
    }

    // DLQ: receives messages from ai.dlx with the same type routing key
    await ch.assertQueue(dlqQueueName(type), { durable: true });
    await ch.bindQueue(dlqQueueName(type), 'ai.dlx', type);

    await ch.waitForConfirms();
  } finally {
    await ch.close();
  }
}

/**
 * Bind a consumer to a queue on the ai.results exchange. Messages are
 * envelope-validated before the handler sees them; invalid messages are
 * dead-lettered (nack, no requeue), handler failures retried once then
 * dead-lettered. Idempotent per queue: a second call for the same queue
 * returns the existing channel.
 *
 * @param {(event: object) => Promise<void>} handler validated envelope callback
 * @param {{queue: string, routingKey: string, validator: Function, name: string}} opts
 */
async function startResultsConsumer(handler, { queue, routingKey, validator, name }) {
  if (typeof handler !== 'function') {
    throw new TypeError(`${name} handler must be a function`);
  }
  if (consumerChannels.has(queue)) {
    return consumerChannels.get(queue);
  }
  await connect();

  const ch = await connection.createChannel();
  await ch.assertExchange(EXCHANGE_RESULTS, 'direct', { durable: true });
  await ch.assertQueue(queue, { durable: true });
  await ch.bindQueue(queue, EXCHANGE_RESULTS, routingKey);
  ch.prefetch(10);

  ch.consume(
    queue,
    async (msg) => {
      if (!msg) return;
      let parsed;
      try {
        parsed = JSON.parse(msg.content.toString());
        const validation = validator(parsed);
        if (!validation.valid) throw new Error(validation.errors.join('; '));
      } catch (err) {
        logger.error('ai_result_invalid', { error: err.message });
        ch.nack(msg, false, false);
        return;
      }
      try {
        await handler(parsed);
        ch.ack(msg);
      } catch (err) {
        logger.error('ai_result_handler_failed', {
          correlationId: parsed.correlationId,
          error: err.message
        });
        // Handler failure is retried by requeueing once; persistent failures
        // eventually hit the queue's dead-letter policy.
        ch.nack(msg, false, msg.fields.redelivered === false);
      }
    },
    { noAck: false }
  );
  consumerChannels.set(queue, ch);
  logger.info('ai_results_consumer_started', { queue, routingKey });
  return ch;
}

/**
 * Consume AI result events on the orchestrator inbox (routing key `result`).
 * @param {(result: object) => Promise<void>} handler
 */
async function consumeAiResults(handler) {
  return startResultsConsumer(handler, {
    queue: RESULT_QUEUE,
    routingKey: 'result',
    validator: validateAiResultEnvelope,
    name: 'ai.results.inbox'
  });
}

/**
 * INGEST-07 — consume staged ingest progress events (routing key `progress`).
 * @param {(progress: object) => Promise<void>} handler
 */
async function consumeAiProgress(handler) {
  return startResultsConsumer(handler, {
    queue: PROGRESS_QUEUE,
    routingKey: PROGRESS_ROUTING_KEY,
    validator: validateAiProgressEnvelope,
    name: 'ai.results.progress'
  });
}

/**
 * INGEST-07 — consume AI result events on the study service's own queue
 * (routing key `result`). Queue-separated from the orchestrator inbox so the
 * study service can flip Course state without competing for messages.
 * @param {(result: object) => Promise<void>} handler
 */
async function consumeIngestResults(handler) {
  return startResultsConsumer(handler, {
    queue: INGEST_RESULT_QUEUE,
    routingKey: 'result',
    validator: validateAiResultEnvelope,
    name: 'ai.results.ingest'
  });
}

/** Graceful shutdown: stop consuming, close channels/connection. */
async function closeAiMessaging() {
  closing = true;
  try {
    for (const ch of consumerChannels.values()) {
      await ch.close().catch(() => {});
    }
    consumerChannels.clear();
    if (confirmChannel) {
      await confirmChannel.close().catch(() => {});
      confirmChannel = null;
    }
    if (connection) {
      await connection.close().catch(() => {});
      connection = null;
    }
  } finally {
    closing = false;
    reconnectAttempts = 0;
  }
}

module.exports = {
  publishAiJob,
  consumeAiResults,
  consumeAiProgress,
  consumeIngestResults,
  ensureTopologyForType,
  closeAiMessaging
};

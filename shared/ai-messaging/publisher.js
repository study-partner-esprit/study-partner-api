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
const { validateAiJobEnvelope, validateAiResultEnvelope } = require('./envelope');
const {
  EXCHANGE_JOBS,
  EXCHANGE_RESULTS,
  RESULT_QUEUE,
  workQueueName,
  dlqQueueName
} = require('./topology');
const logger = require('../logger');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/%2F';
const HEARTBEAT_SECONDS = 30;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30000;

let connection = null;
let confirmChannel = null;
let resultChannel = null;
let connecting = null;
let reconnectAttempts = 0;
let closing = false;
let resultHandler = null;

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
    messageId: crypto.randomUUID(),
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
      contentType: 'application/json',
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      type: envelope.type,
      timestamp: new Date(envelope.timestamp)
    });
    if (!ok || !(await confirmChannel.waitForConfirms())) {
      throw Object.assign(new Error('broker did not confirm job publish'), {
        code: 'EPUBLISHCONFIRM'
      });
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
 * Ensure the work queue + DLQ for a given job type exist (idempotent).
 * Called by consumers/workers at startup; publishers only need the exchange.
 */
async function ensureTopologyForType(type) {
  await connect();
  const ch = await connection.createConfirmChannel();
  try {
    await ch.assertExchange(EXCHANGE_JOBS, 'direct', { durable: true });
    await ch.assertExchange('ai.dlx', 'direct', { durable: true });
    await ch.assertQueue(workQueueName(type), {
      durable: true,
      arguments: { 'x-dead-letter-exchange': 'ai.dlx' }
    });
    await ch.bindQueue(workQueueName(type), EXCHANGE_JOBS, type);
    await ch.assertQueue(dlqQueueName(type), { durable: true });
    await ch.bindQueue(dlqQueueName(type), 'ai.dlx', type);
    await ch.waitForConfirms();
  } finally {
    await ch.close();
  }
}

/**
 * Start consuming AI result events. The handler receives a VALIDATED result
 * envelope; invalid results are dead-lettered (nack, no requeue).
 * @param {(result: object) => Promise<void>} handler
 */
async function consumeAiResults(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('result handler must be a function');
  }
  resultHandler = handler;
  await connect();

  if (!resultChannel || resultChannel === null) {
    resultChannel = await connection.createChannel();
    await resultChannel.assertExchange(EXCHANGE_RESULTS, 'direct', { durable: true });
    await resultChannel.assertQueue(RESULT_QUEUE, { durable: true });
    await resultChannel.bindQueue(RESULT_QUEUE, EXCHANGE_RESULTS, 'result');
    resultChannel.prefetch(10);

    resultChannel.consume(
      RESULT_QUEUE,
      async (msg) => {
        if (!msg) return;
        let parsed;
        try {
          parsed = JSON.parse(msg.content.toString());
          const validation = validateAiResultEnvelope(parsed);
          if (!validation.valid) throw new Error(validation.errors.join('; '));
        } catch (err) {
          logger.error('ai_result_invalid', { error: err.message });
          resultChannel.nack(msg, false, false);
          return;
        }
        try {
          await resultHandler(parsed);
          resultChannel.ack(msg);
        } catch (err) {
          logger.error('ai_result_handler_failed', {
            correlationId: parsed.correlationId,
            error: err.message
          });
          // Handler failure is retried by requeueing once; persistent failures
          // eventually hit the queue's dead-letter policy.
          resultChannel.nack(msg, false, msg.fields.redelivered === false);
        }
      },
      { noAck: false }
    );
    logger.info('ai_results_consumer_started', { queue: RESULT_QUEUE });
  }
  return resultChannel;
}

/** Graceful shutdown: stop consuming, close channels/connection. */
async function closeAiMessaging() {
  closing = true;
  try {
    if (resultChannel) {
      await resultChannel.close().catch(() => {});
      resultChannel = null;
    }
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
  ensureTopologyForType,
  closeAiMessaging
};

/**
 * Consumes AI result events from RabbitMQ and correlates them to persisted
 * AiJobs via correlationId (F01 / AI-COM-07 + OPS-03).
 */

const { consumeAiResults } = require('@study-partner/shared/ai-messaging');
const { logger } = require('@study-partner/shared');
const AiJob = require('../models/AiJob');

async function handleResult(result) {
  logger.info('ai_result_received', {
    correlationId: result.correlationId,
    type: result.type,
    status: result.status,
    requestId: result.requestId
  });

  if (result.status === 'completed') {
    const job = await AiJob.completeByCorrelation(result.correlationId, result.payload);
    if (!job) {
      logger.warn('ai_result_unmatched', {
        correlationId: result.correlationId
      });
    }
  } else {
    await AiJob.failByCorrelation(result.correlationId, result.error);
  }
}

/** Start the consumer; resolves once the subscription is live. */
async function startResultConsumer() {
  return consumeAiResults(handleResult);
}

module.exports = { startResultConsumer, handleResult };

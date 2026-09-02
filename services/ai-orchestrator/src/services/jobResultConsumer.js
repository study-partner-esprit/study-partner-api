/**
 * Consumes AI result events from RabbitMQ and correlates them to persisted
 * AiJobs via correlationId (F01 / AI-COM-07 + OPS-03).
 */

const { consumeAiResults } = require('@study-partner/shared/ai-messaging');
const { logger } = require('@study-partner/shared');
const AiJob = require('../models/AiJob');
const { buildEvalResultRecord } = require('./evalResultBuilder');
const { upsertByCorrelation } = require('./evalResultStore');

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

    // EVAL-08: persist each completed eval step as a per-step Mongo record,
    // idempotent by correlationId. Mongo writes are owned by this Node backend;
    // the Python agents only publish the ai.results event that lands here.
    const evalRecord = buildEvalResultRecord(result);
    if (evalRecord) {
      await upsertByCorrelation(evalRecord);
      logger.info('eval_result_persisted', {
        sessionId: evalRecord.sessionId,
        step: evalRecord.step,
        correlationId: evalRecord.correlationId
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

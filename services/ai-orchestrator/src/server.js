require('dotenv').config();
const app = require('./app');
const { checkAIServiceHealth } = require('./services/agentService');
const { connectDatabase, disconnectDatabase, logger } = require('@study-partner/shared');
const { closeAiMessaging } = require('@study-partner/shared/ai-messaging');
const { startResultConsumer } = require('./services/jobResultConsumer');
const { registerProcessHandlers } = require('@study-partner/shared/processHandlers');

registerProcessHandlers('ai-orchestrator-service');

const PORT = process.env.PORT || 8004;
const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.DOCKER_MONGODB_URI ||
  'mongodb://localhost:27017/study_partner';

async function startServer() {
  try {
    // Persist AI jobs (AI-COM-07)
    await connectDatabase(MONGODB_URI);
    logger.info('Connected to MongoDB (ai-orchestrator)');

    // Consume AI result events and correlate to jobs
    if (process.env.RABBITMQ_URL) {
      try {
        await startResultConsumer();
      } catch (err) {
        logger.warn(`Result consumer unavailable (${err.message}); retrying via bus reconnect`);
      }
    }

    // Check AI service health (don't fail if it's not available)
    try {
      const isAIServiceHealthy = await checkAIServiceHealth();
      if (!isAIServiceHealthy) {
        logger.warn('AI service is not responding - AI features may be unavailable');
      } else {
        logger.info('AI service is healthy');
      }
    } catch (aiError) {
      logger.warn(
        'AI service health check failed - AI features may be unavailable:',
        aiError.message
      );
    }

    // Start server
    app.listen(PORT, () => {
      logger.info(`AI Orchestrator service listening on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
    });
  } catch (error) {
    logger.error('Failed to start AI orchestrator service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await closeAiMessaging().catch(() => {});
  await disconnectDatabase().catch(() => {});
  process.exit(0);
});

startServer();

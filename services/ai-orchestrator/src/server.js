require('dotenv').config();
const app = require('./app');
// const { logger } = require('@study-partner/shared');
const { checkAIServiceHealth } = require('./services/agentService');

// Temporary logger until shared package is fixed
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const PORT = process.env.PORT || 8004;

async function startServer() {
  try {
    // Check AI service health (don't fail if it's not available)
    try {
      const isAIServiceHealthy = await checkAIServiceHealth();
      if (!isAIServiceHealthy) {
        logger.warn('AI service is not responding - AI features may be unavailable');
      } else {
        logger.info('AI service is healthy');
      }
    } catch (aiError) {
      logger.warn('AI service health check failed - AI features may be unavailable:', aiError.message);
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
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

startServer();

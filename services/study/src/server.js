require('dotenv').config();
const app = require('./app');
const { connectDatabase, logger } = require('@study-partner/shared');

const PORT = process.env.PORT || 8003;
const { registerProcessHandlers } = require('@study-partner/shared/processHandlers');

registerProcessHandlers('study-service');

async function startServer() {
  try {
    await connectDatabase();
    logger.info('Connected to MongoDB');

    // BLOOM-08: start the competency updater poller
    const { startCompetencyUpdater } = require('./services/competencyUpdater');
    const stopUpdater = startCompetencyUpdater();
    logger.info('Competency updater started (BLOOM-08)');

    app.listen(PORT, () => {
      logger.info(`Study Management service listening on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
    });

    // Wire graceful shutdown for the updater
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully...');
      stopUpdater();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start study management service:', error);
    process.exit(1);
  }
}

startServer();

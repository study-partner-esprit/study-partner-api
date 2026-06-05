require('dotenv').config();
const app = require('./app');
const { connectDatabase, logger } = require('@study-partner/shared');

const PORT = process.env.PORT || 8002;

async function startServer() {
  try {
    await connectDatabase();
    logger.info('Connected to MongoDB');

    app.listen(PORT, () => {
      logger.info(`User Profile service listening on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
    });
  } catch (error) {
    logger.error('Failed to start user profile service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

startServer();

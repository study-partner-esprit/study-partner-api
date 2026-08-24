require('dotenv').config();
const app = require('./app');
const { logger } = require('@study-partner/shared');

const PORT = process.env.PORT || 8000;
const { registerProcessHandlers } = require('@study-partner/shared/processHandlers');

registerProcessHandlers('api-gateway');

function startServer() {
  app.listen(PORT, () => {
    logger.info(`API Gateway listening on port ${PORT}`);
    logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

startServer();

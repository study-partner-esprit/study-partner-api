require('dotenv').config();
const app = require('./app');
// const { logger } = require('@study-partner/shared');

// Temporary logger until shared package is fixed
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const PORT = process.env.PORT || 8000;

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

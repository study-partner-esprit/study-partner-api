const app = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  logger.info(`🚀 Study Partner API Server running on http://${HOST}:${PORT}`);
  logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🗃️  Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`${signal} signal received: closing HTTP server`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err);
  gracefulShutdown('unhandledRejection');
});

module.exports = server;

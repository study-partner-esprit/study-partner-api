/**
 * Study Service Entry Point
 */
require('dotenv').config();

const app = require('./app');
const config = require('./config');
const { sequelize } = require('./config/database');
const { createLogger } = require('@study-partner/shared-utils');

const logger = createLogger('study-service');

async function startServer() {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established');
    
    if (config.env === 'development') {
      await sequelize.sync({ alter: true });
      logger.info('Database models synchronized');
    }
    
    const server = app.listen(config.port, () => {
      logger.info(`Study service running on port ${config.port}`);
    });
    
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);
      server.close(async () => {
        await sequelize.close();
        logger.info('Database connection closed');
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 30000);
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

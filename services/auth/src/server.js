/**
 * Auth Service Entry Point
 */
require('dotenv').config();

const app = require('./app');
const config = require('./config');
const { sequelize } = require('./config/database');
const { roleService } = require('./services');
const { createLogger } = require('@study-partner/shared-utils');

const logger = createLogger('auth-service');

async function startServer() {
  try {
    // Test database connection
    await sequelize.authenticate();
    logger.info('Database connection established');
    
    // Sync models (in development, use migrations in production)
    if (config.env === 'development') {
      await sequelize.sync({ alter: true });
      logger.info('Database models synchronized');
      
      // Seed default roles
      await roleService.seedDefaultRoles();
      logger.info('Default roles seeded');
    }
    
    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`Auth service running on port ${config.port}`);
      logger.info(`Environment: ${config.env}`);
    });
    
    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          await sequelize.close();
          logger.info('Database connection closed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown:', error);
          process.exit(1);
        }
      });
      
      // Force exit after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

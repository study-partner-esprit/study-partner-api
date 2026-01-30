/**
 * Database Configuration & Connection
 */
const { Sequelize } = require('sequelize');
const config = require('./index');
const { createLogger } = require('@study-partner/shared-utils').logger;

const logger = createLogger('auth-service');

const sequelize = new Sequelize(
  config.database.name,
  config.database.user,
  config.database.password,
  {
    host: config.database.host,
    port: config.database.port,
    dialect: 'postgres',
    logging: config.env === 'development' ? (msg) => logger.debug(msg) : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
    },
  }
);

const testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info('✅ Database connection established');
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', error.message);
    return false;
  }
};

const syncDatabase = async (force = false) => {
  try {
    await sequelize.sync({ force, alter: config.env === 'development' });
    logger.info('✅ Database synchronized');
  } catch (error) {
    logger.error('❌ Database sync failed:', error.message);
    throw error;
  }
};

module.exports = { sequelize, testConnection, syncDatabase };

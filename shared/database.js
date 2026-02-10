const mongoose = require('mongoose');
const logger = require('./logger');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:admin123@mongo:27017/study_partner';

let isConnected = false;

/**
 * Connect to MongoDB
 * @returns {Promise<void>}
 */
async function connectDatabase() {
  if (isConnected) {
    logger.info('Using existing MongoDB connection');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    isConnected = true;
    logger.info('Connected to MongoDB successfully');

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
      isConnected = false;
    });
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

/**
 * Disconnect from MongoDB
 * @returns {Promise<void>}
 */
async function disconnectDatabase() {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('Disconnected from MongoDB');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB:', error);
    throw error;
  }
}

/**
 * Get database connection status
 * @returns {boolean}
 */
function isConnectedToDatabase() {
  return isConnected && mongoose.connection.readyState === 1;
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  isConnectedToDatabase,
  mongoose,
};

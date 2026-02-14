require('dotenv').config();
const app = require('./app');
// const { connectDatabase, logger } = require('@study-partner/shared');

// Temporary implementations until shared package is fixed
const mongoose = require('mongoose');

const connectDatabase = async (uri) => {
  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
};

const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const PORT = process.env.PORT || 8003;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/study_partner';

async function startServer() {
  try {
    // Connect to MongoDB
    await connectDatabase(MONGODB_URI);
    logger.info('Connected to MongoDB');

    // Start server
    app.listen(PORT, () => {
      logger.info(`Study Management service listening on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
    });
  } catch (error) {
    logger.error('Failed to start study management service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

startServer();

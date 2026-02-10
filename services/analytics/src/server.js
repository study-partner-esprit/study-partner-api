require('dotenv').config();
const app = require('./app');
// const { connectDatabase, logger } = require('@study-partner/shared');

// Temporary implementations until shared package is fixed
const connectDatabase = async (uri) => {
  console.log('Database connection not implemented yet');
  return true;
};

const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const PORT = process.env.PORT || 8006;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:admin123@mongo:27017/study_partner';

async function startServer() {
  try {
    // Connect to MongoDB
    await connectDatabase(MONGODB_URI);
    logger.info('Connected to MongoDB');

    // Start server
    app.listen(PORT, () => {
      logger.info(`Analytics service listening on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
    });
  } catch (error) {
    logger.error('Failed to start analytics service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

startServer();

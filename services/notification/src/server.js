require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');

const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const PORT = process.env.PORT || 3007;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/study_partner';

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info('Connected to MongoDB');

    app.listen(PORT, () => {
      logger.info(`Notification service listening on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
    });
  } catch (error) {
    logger.error('Failed to start notification service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

startServer();

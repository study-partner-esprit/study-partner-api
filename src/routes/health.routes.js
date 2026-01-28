const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'study-partner-api'
  });
});

// Database health check
router.get('/db', async (req, res) => {
  try {
    // TODO: Add actual database connection check
    res.status(200).json({
      status: 'ok',
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
});

// Redis health check
router.get('/redis', async (req, res) => {
  try {
    // TODO: Add actual Redis connection check
    res.status(200).json({
      status: 'ok',
      redis: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      redis: 'disconnected',
      error: error.message
    });
  }
});

module.exports = router;

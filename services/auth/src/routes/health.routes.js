/**
 * Health Check Routes
 */
const express = require('express');
const { sequelize } = require('../config/database');

const router = express.Router();

/**
 * @route   GET /health
 * @desc    Basic health check
 * @access  Public
 */
router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'auth-service',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @route   GET /health/ready
 * @desc    Readiness check (includes DB)
 * @access  Public
 */
router.get('/ready', async (req, res) => {
  try {
    await sequelize.authenticate();
    
    res.json({
      status: 'ready',
      service: 'auth-service',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      service: 'auth-service',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;

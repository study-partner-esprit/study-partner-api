/**
 * Health Routes
 */
const express = require('express');
const { sequelize } = require('../config/database');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'study-service',
    timestamp: new Date().toISOString()
  });
});

router.get('/ready', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({
      status: 'ready',
      service: 'study-service',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      service: 'study-service',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;

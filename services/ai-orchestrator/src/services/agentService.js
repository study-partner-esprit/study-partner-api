const axios = require('axios');
// const { logger } = require('@study-partner/shared');

// Temporary logger until shared package is fixed
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:8000';

/**
 * Check if AI service is healthy
 * @returns {Promise<boolean>}
 */
async function checkAIServiceHealth() {
  try {
    const response = await axios.get(`${AI_SERVICE_URL}/health`, {
      timeout: 5000
    });
    return response.status === 200;
  } catch (error) {
    logger.error('AI service health check failed:', error.message);
    return false;
  }
}

module.exports = {
  checkAIServiceHealth
};

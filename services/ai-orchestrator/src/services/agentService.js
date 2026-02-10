const axios = require('axios');
// const { logger } = require('@study-partner/shared');

// Temporary logger until shared package is fixed
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://study-partner-ai:5000';

/**
 * Execute an AI agent via the Python AI service
 * @param {string} agentType - Type of agent: 'course_ingestion', 'planner', 'scheduler', 'coach'
 * @param {object} payload - Data to send to the agent
 * @returns {Promise<object>} Result from the AI agent
 */
async function executeAIAgent(agentType, payload) {
  try {
    logger.info(`Executing AI agent: ${agentType}`);
    
    const response = await axios.post(`${AI_SERVICE_URL}/api/agents/${agentType}`, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 second timeout for AI operations
    });

    logger.info(`AI agent ${agentType} completed successfully`);
    return response.data;
  } catch (error) {
    logger.error(`AI agent ${agentType} failed:`, error.message);
    
    if (error.response) {
      // AI service returned an error
      throw new Error(error.response.data.error || 'AI agent execution failed');
    } else if (error.request) {
      // No response from AI service
      throw new Error('AI service is unavailable');
    } else {
      // Request setup error
      throw new Error(`Failed to execute AI agent: ${error.message}`);
    }
  }
}

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
  executeAIAgent,
  checkAIServiceHealth
};

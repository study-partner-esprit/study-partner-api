/**
 * JWT Utility
 * Token generation and verification
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Generate access token
 * @param {Object} payload - Token payload
 * @returns {string}
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: config.jwt.issuer
  });
};

/**
 * Verify access token
 * @param {string} token
 * @returns {Object|null}
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer
    });
  } catch (error) {
    return null;
  }
};

/**
 * Decode token without verification
 * @param {string} token
 * @returns {Object|null}
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

/**
 * Get expiration time in milliseconds
 * @param {string} duration - Duration string (e.g., '15m', '7d')
 * @returns {number}
 */
const getExpirationMs = (duration) => {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
};

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  decodeToken,
  getExpirationMs
};

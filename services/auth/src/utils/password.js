/**
 * Password Utility
 * Hashing and verification using bcrypt
 */
const bcrypt = require('bcryptjs');
const config = require('../config');

/**
 * Hash a password
 * @param {string} password
 * @returns {Promise<string>}
 */
const hashPassword = async (password) => {
  return bcrypt.hash(password, config.bcrypt.saltRounds);
};

/**
 * Verify password against hash
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

/**
 * Check password strength
 * @param {string} password
 * @returns {Object} - { isValid, errors }
 */
const checkPasswordStrength = (password) => {
  const errors = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
};

module.exports = {
  hashPassword,
  verifyPassword,
  checkPasswordStrength,
};

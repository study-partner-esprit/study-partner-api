/**
 * RefreshToken Model
 * Stores refresh tokens for JWT rotation
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const crypto = require('crypto');

const RefreshToken = sequelize.define('RefreshToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id',
    references: {
      model: 'users',
      key: 'id',
    },
  },
  token: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'expires_at',
  },
  revoked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  revokedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'revoked_at',
  },
  replacedByToken: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'replaced_by_token',
  },
  userAgent: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: 'user_agent',
  },
  ipAddress: {
    type: DataTypes.STRING(45),
    allowNull: true,
    field: 'ip_address',
  },
}, {
  tableName: 'refresh_tokens',
  timestamps: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['token'] },
    { fields: ['expires_at'] },
  ],
});

/**
 * Generate a secure random token
 * @returns {string}
 */
RefreshToken.generateToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

/**
 * Check if token is expired
 * @returns {boolean}
 */
RefreshToken.prototype.isExpired = function () {
  return new Date() >= this.expiresAt;
};

/**
 * Check if token is active (not revoked and not expired)
 * @returns {boolean}
 */
RefreshToken.prototype.isActive = function () {
  return !this.revoked && !this.isExpired();
};

module.exports = RefreshToken;

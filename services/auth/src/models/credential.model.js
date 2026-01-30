/**
 * Credential Model
 * Stores password hashes separately from user
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcryptjs');
const config = require('../config');

const Credential = sequelize.define(
  'Credential',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id',
      references: {
        model: 'users',
        key: 'id'
      }
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'password_hash'
    }
  },
  {
    tableName: 'credentials',
    timestamps: true,
    hooks: {
      beforeCreate: async (credential) => {
        if (credential.passwordHash) {
          credential.passwordHash = await bcrypt.hash(
            credential.passwordHash,
            config.bcrypt.saltRounds
          );
        }
      },
      beforeUpdate: async (credential) => {
        if (credential.changed('passwordHash')) {
          credential.passwordHash = await bcrypt.hash(
            credential.passwordHash,
            config.bcrypt.saltRounds
          );
        }
      }
    }
  }
);

/**
 * Verify password against hash
 * @param {string} password - Plain text password
 * @returns {Promise<boolean>}
 */
Credential.prototype.verifyPassword = async function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

module.exports = Credential;

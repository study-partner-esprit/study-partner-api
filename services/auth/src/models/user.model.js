/**
 * User Model
 * Core user entity for authentication
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    status: {
      type: DataTypes.ENUM('active', 'suspended', 'deleted'),
      defaultValue: 'active',
      allowNull: false
    }
  },
  {
    tableName: 'users',
    timestamps: true,
    paranoid: true, // Soft delete
    indexes: [{ unique: true, fields: ['email'] }, { fields: ['status'] }]
  }
);

module.exports = User;

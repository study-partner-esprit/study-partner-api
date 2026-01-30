/**
 * Role Model
 * RBAC role definitions
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Role = sequelize.define('Role', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'roles',
  timestamps: true,
});

// Default roles
Role.ROLES = {
  STUDENT: 'student',
  ADMIN: 'admin',
  MODERATOR: 'moderator',
};

module.exports = Role;

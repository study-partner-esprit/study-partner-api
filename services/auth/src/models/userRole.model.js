/**
 * UserRole Model
 * Many-to-many relationship between users and roles
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserRole = sequelize.define(
  'UserRole',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
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
    roleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'role_id',
      references: {
        model: 'roles',
        key: 'id'
      }
    },
    assignedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'assigned_at'
    }
  },
  {
    tableName: 'user_roles',
    timestamps: false,
    indexes: [{ unique: true, fields: ['user_id', 'role_id'] }]
  }
);

module.exports = UserRole;

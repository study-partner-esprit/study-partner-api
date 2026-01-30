/**
 * Subject Model
 * Study subjects (e.g., Mathematics, Programming, Languages)
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Subject = sequelize.define('Subject', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id',
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  color: {
    type: DataTypes.STRING(7),
    allowNull: true,
    defaultValue: '#6366f1',
  },
  icon: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  isArchived: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_archived',
  },
  totalStudyTime: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_study_time',
    comment: 'Total study time in minutes',
  },
}, {
  tableName: 'subjects',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['user_id', 'is_archived'] },
  ],
});

module.exports = Subject;

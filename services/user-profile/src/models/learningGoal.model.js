/**
 * Learning Goal Model
 * Stores user's learning goals
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const LearningGoal = sequelize.define(
  'LearningGoal',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id'
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'e.g., Programming, Mathematics, Languages'
    },
    targetDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'target_date'
    },
    priority: {
      type: DataTypes.ENUM('low', 'medium', 'high'),
      allowNull: false,
      defaultValue: 'medium'
    },
    status: {
      type: DataTypes.ENUM('active', 'completed', 'paused', 'abandoned'),
      allowNull: false,
      defaultValue: 'active'
    },
    progressPercent: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'progress_percent',
      validate: {
        min: 0,
        max: 100
      }
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'completed_at'
    }
  },
  {
    tableName: 'learning_goals',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['status'] }, { fields: ['user_id', 'status'] }]
  }
);

module.exports = LearningGoal;

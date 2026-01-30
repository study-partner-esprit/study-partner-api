/**
 * Topic Model
 * Topics within a subject
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Topic = sequelize.define(
  'Topic',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    subjectId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'subject_id'
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id'
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    difficulty: {
      type: DataTypes.ENUM('easy', 'medium', 'hard'),
      allowNull: true,
      defaultValue: 'medium'
    },
    masteryLevel: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'mastery_level',
      validate: {
        min: 0,
        max: 100
      },
      comment: 'Mastery level from 0-100'
    },
    lastStudiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_studied_at'
    },
    totalStudyTime: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'total_study_time',
      comment: 'Total study time in minutes'
    },
    isArchived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_archived'
    }
  },
  {
    tableName: 'topics',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['subject_id'] },
      { fields: ['user_id'] },
      { fields: ['user_id', 'is_archived'] }
    ]
  }
);

module.exports = Topic;

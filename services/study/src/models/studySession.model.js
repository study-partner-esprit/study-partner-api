/**
 * Study Session Model
 * Individual study sessions
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StudySession = sequelize.define(
  'StudySession',
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
    subjectId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'subject_id'
    },
    topicId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'topic_id'
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('planned', 'in_progress', 'completed', 'cancelled'),
      allowNull: false,
      defaultValue: 'planned'
    },
    sessionType: {
      type: DataTypes.ENUM('pomodoro', 'free_study', 'quiz', 'review', 'practice'),
      allowNull: false,
      defaultValue: 'free_study',
      field: 'session_type'
    },
    plannedDuration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'planned_duration',
      comment: 'Planned duration in minutes'
    },
    actualDuration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'actual_duration',
      comment: 'Actual duration in minutes'
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'started_at'
    },
    endedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'ended_at'
    },
    scheduledFor: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'scheduled_for'
    },
    // AI-generated feedback
    focusScore: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'focus_score',
      validate: {
        min: 0,
        max: 100
      }
    },
    productivityScore: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'productivity_score',
      validate: {
        min: 0,
        max: 100
      }
    },
    aiSummary: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'ai_summary'
    }
  },
  {
    tableName: 'study_sessions',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['user_id', 'status'] },
      { fields: ['subject_id'] },
      { fields: ['topic_id'] },
      { fields: ['scheduled_for'] },
      { fields: ['started_at'] }
    ]
  }
);

module.exports = StudySession;

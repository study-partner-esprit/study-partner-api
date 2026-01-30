/**
 * User Preferences Model
 * Stores user preferences and settings
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserPreferences = sequelize.define('UserPreferences', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    field: 'user_id',
  },
  // Study Preferences
  preferredStudyDuration: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 25, // Pomodoro default
    field: 'preferred_study_duration',
    comment: 'Preferred study session duration in minutes',
  },
  preferredBreakDuration: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 5,
    field: 'preferred_break_duration',
    comment: 'Preferred break duration in minutes',
  },
  dailyStudyGoal: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 120,
    field: 'daily_study_goal',
    comment: 'Daily study goal in minutes',
  },
  // Notification Preferences
  emailNotifications: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'email_notifications',
  },
  pushNotifications: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'push_notifications',
  },
  reminderTime: {
    type: DataTypes.TIME,
    allowNull: true,
    field: 'reminder_time',
    comment: 'Daily reminder time',
  },
  // AI Preferences
  aiDifficulty: {
    type: DataTypes.ENUM('easy', 'medium', 'hard', 'adaptive'),
    allowNull: false,
    defaultValue: 'adaptive',
    field: 'ai_difficulty',
  },
  aiPersonality: {
    type: DataTypes.ENUM('encouraging', 'strict', 'neutral', 'playful'),
    allowNull: false,
    defaultValue: 'encouraging',
    field: 'ai_personality',
  },
  // UI Preferences
  theme: {
    type: DataTypes.ENUM('light', 'dark', 'system'),
    allowNull: false,
    defaultValue: 'system',
  },
  accentColor: {
    type: DataTypes.STRING(7),
    allowNull: true,
    defaultValue: '#6366f1',
    field: 'accent_color',
  },
}, {
  tableName: 'user_preferences',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'], unique: true },
  ],
});

module.exports = UserPreferences;

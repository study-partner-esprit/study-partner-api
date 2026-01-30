/**
 * User Profile Model
 * Stores user profile information
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserProfile = sequelize.define('UserProfile', {
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
    comment: 'References user in Auth Service',
  },
  firstName: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'first_name',
  },
  lastName: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'last_name',
  },
  displayName: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'display_name',
  },
  avatarUrl: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: 'avatar_url',
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  dateOfBirth: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    field: 'date_of_birth',
  },
  timezone: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'UTC',
  },
  language: {
    type: DataTypes.STRING(10),
    allowNull: true,
    defaultValue: 'en',
  },
  onboardingCompleted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'onboarding_completed',
  },
}, {
  tableName: 'user_profiles',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'], unique: true },
  ],
});

module.exports = UserProfile;

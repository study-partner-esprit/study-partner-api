/**
 * Models Index - User Profile Service
 */
const UserProfile = require('./userProfile.model');
const UserPreferences = require('./userPreferences.model');
const LearningGoal = require('./learningGoal.model');
const { sequelize } = require('../config/database');

// Associations
UserProfile.hasOne(UserPreferences, {
  foreignKey: 'userId',
  as: 'preferences',
  onDelete: 'CASCADE'
});

UserPreferences.belongsTo(UserProfile, {
  foreignKey: 'userId',
  as: 'profile'
});

UserProfile.hasMany(LearningGoal, {
  foreignKey: 'userId',
  as: 'learningGoals',
  onDelete: 'CASCADE'
});

LearningGoal.belongsTo(UserProfile, {
  foreignKey: 'userId',
  as: 'profile'
});

module.exports = {
  sequelize,
  UserProfile,
  UserPreferences,
  LearningGoal
};

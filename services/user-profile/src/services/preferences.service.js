/**
 * Preferences Service
 */
const { UserPreferences } = require('../models');
const { ApiError } = require('@study-partner/shared-utils');

class PreferencesService {
  /**
   * Get user preferences
   */
  async getPreferences(userId) {
    let preferences = await UserPreferences.findOne({ where: { userId } });
    
    if (!preferences) {
      preferences = await UserPreferences.create({ userId });
    }
    
    return preferences;
  }

  /**
   * Update preferences
   */
  async updatePreferences(userId, data) {
    let preferences = await UserPreferences.findOne({ where: { userId } });
    
    if (!preferences) {
      preferences = await UserPreferences.create({ userId, ...data });
    } else {
      await preferences.update(data);
    }
    
    return preferences;
  }

  /**
   * Reset preferences to defaults
   */
  async resetPreferences(userId) {
    const preferences = await UserPreferences.findOne({ where: { userId } });
    
    if (!preferences) {
      throw ApiError.notFound('Preferences not found');
    }
    
    await preferences.update({
      preferredStudyDuration: 25,
      preferredBreakDuration: 5,
      dailyStudyGoal: 120,
      emailNotifications: true,
      pushNotifications: true,
      reminderTime: null,
      aiDifficulty: 'adaptive',
      aiPersonality: 'encouraging',
      theme: 'system',
      accentColor: '#6366f1',
    });
    
    return preferences;
  }
}

module.exports = new PreferencesService();

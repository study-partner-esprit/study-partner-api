/**
 * Profile Service
 */
const { UserProfile, UserPreferences } = require('../models');
const { ApiError } = require('@study-partner/shared-utils');
const { sequelize } = require('../config/database');

class ProfileService {
  /**
   * Get or create profile for user
   */
  async getOrCreateProfile(userId) {
    let profile = await UserProfile.findOne({
      where: { userId },
      include: [{ model: UserPreferences, as: 'preferences' }]
    });

    if (!profile) {
      const transaction = await sequelize.transaction();
      try {
        profile = await UserProfile.create({ userId }, { transaction });
        await UserPreferences.create({ userId }, { transaction });
        await transaction.commit();

        profile = await UserProfile.findOne({
          where: { userId },
          include: [{ model: UserPreferences, as: 'preferences' }]
        });
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    }

    return profile;
  }

  /**
   * Update profile
   */
  async updateProfile(userId, data) {
    const profile = await UserProfile.findOne({ where: { userId } });

    if (!profile) {
      throw ApiError.notFound('Profile not found');
    }

    const allowedFields = [
      'firstName',
      'lastName',
      'displayName',
      'avatarUrl',
      'bio',
      'dateOfBirth',
      'timezone',
      'language'
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    await profile.update(updateData);

    return this.getOrCreateProfile(userId);
  }

  /**
   * Complete onboarding
   */
  async completeOnboarding(userId) {
    const profile = await UserProfile.findOne({ where: { userId } });

    if (!profile) {
      throw ApiError.notFound('Profile not found');
    }

    await profile.update({ onboardingCompleted: true });
    return profile;
  }
}

module.exports = new ProfileService();

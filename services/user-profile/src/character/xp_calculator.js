/**
 * XP Calculator with Character Ability Integration
 * Integrates character abilities into the XP calculation pipeline
 * Handles ability triggering and multiplier application
 */

const logger = require('@study-partner/shared/logger');

class XPCalculator {
  constructor(abilityExecutor, characterManager) {
    this.abilityExecutor = abilityExecutor;
    this.characterManager = characterManager;
  }

  /**
   * Calculate session XP with ability bonuses
   * @param {Object} sessionData - Session information
   * @param {string} sessionData.userId - User ID
   * @param {number} sessionData.duration - Duration in minutes
   * @param {string} sessionData.courseId - Course ID
   * @param {string} sessionData.sessionType - Type of session (study/challenge/review)
   * @param {number} sessionData.baseXP - Base XP for session
   * @returns {Promise<Object>} XP calculation result with ability bonuses
   */
  async calculateSessionXP(sessionData) {
    const { userId, duration, courseId, sessionType, baseXP } = sessionData;

    try {
      const userCharacter = await this.characterManager.getUserCharacter(userId);
      const characterId =
        userCharacter && userCharacter.character_id && userCharacter.character_id._id
          ? userCharacter.character_id._id
          : userCharacter && userCharacter.character_id
            ? userCharacter.character_id
            : null;

      if (!characterId) {
        return {
          baseXP,
          abilityBonuses: [],
          totalXP: baseXP,
          multiplier: 1,
          debugInfo: {
            noCharacterSelected: true
          }
        };
      }

      const abilityResult = await this.abilityExecutor.executeAbility(
        userId,
        characterId,
        {
          session_id: sessionData.sessionId || `session-${Date.now()}`,
          session_type: sessionType,
          duration,
          course_id: courseId,
          flagged: false
        },
        baseXP
      );

      if (!abilityResult.success) {
        return {
          baseXP,
          abilityBonuses: [],
          totalXP: baseXP,
          multiplier: 1,
          debugInfo: {
            abilityApplied: false,
            reason: abilityResult.reason
          }
        };
      }

      const totalXP = abilityResult.xpGain;
      const multiplier = baseXP > 0 ? Number((totalXP / baseXP).toFixed(4)) : 1;

      return {
        baseXP,
        abilityBonuses: [
          {
            abilityId: abilityResult.abilityId,
            abilityName: abilityResult.abilityName,
            effectType: abilityResult.effectType,
            bonus: abilityResult.xpBonus,
            multiplier: abilityResult.multiplier,
            debugInfo: abilityResult.debugInfo
          }
        ],
        totalXP,
        multiplier,
        debugInfo: {
          abilityApplied: true,
          characterId,
          finalMultiplier: multiplier
        }
      };
    } catch (error) {
      logger.error('Error calculating session XP:', error);
      return {
        baseXP,
        abilityBonuses: [],
        totalXP: baseXP,
        multiplier: 1,
        error: error.message
      };
    }
  }

  /**
   * Calculate challenge XP with difficulty multiplier and ability bonuses
   * @param {Object} challengeData - Challenge completion data
   * @param {string} challengeData.userId - User ID
   * @param {string} challengeData.challengeId - Challenge ID
   * @param {string} challengeData.difficulty - Challenge difficulty
   * @param {boolean} challengeData.completedSuccessfully - Whether challenge was completed
   * @param {number} challengeData.baseXP - Base XP for challenge
   * @returns {Promise<Object>} Challenge XP result with bonuses
   */
  async calculateChallengeXP(challengeData) {
    const { userId, challengeId, difficulty, completedSuccessfully, baseXP } =
      challengeData;

    if (!completedSuccessfully) {
      return {
        baseXP: 0,
        abilityBonuses: [],
        totalXP: 0,
        multiplier: 1,
        debugInfo: {
          challengeFailed: true
        }
      };
    }

    const difficultyMultiplier = this.getDifficultyMultiplier(difficulty);
    const adjustedBaseXP = Math.floor(baseXP * difficultyMultiplier);

    try {
      const userCharacter = await this.characterManager.getUserCharacter(userId);
      const characterId =
        userCharacter && userCharacter.character_id && userCharacter.character_id._id
          ? userCharacter.character_id._id
          : userCharacter && userCharacter.character_id
            ? userCharacter.character_id
            : null;

      if (!characterId) {
        return {
          baseXP: adjustedBaseXP,
          abilityBonuses: [],
          totalXP: adjustedBaseXP,
          multiplier: difficultyMultiplier
        };
      }

      const abilityResult = await this.abilityExecutor.executeAbility(
        userId,
        characterId,
        {
          session_id: challengeData.sessionId || `challenge-${Date.now()}`,
          session_type: 'challenge',
          challenge_id: challengeId,
          difficulty,
          flagged: false
        },
        adjustedBaseXP
      );

      if (!abilityResult.success) {
        return {
          baseXP: adjustedBaseXP,
          abilityBonuses: [],
          totalXP: adjustedBaseXP,
          multiplier: difficultyMultiplier,
          debugInfo: {
            abilityApplied: false,
            reason: abilityResult.reason
          }
        };
      }

      const totalXP = abilityResult.xpGain;
      const multiplier = adjustedBaseXP > 0 ? Number((totalXP / adjustedBaseXP).toFixed(4)) : 1;

      return {
        baseXP: adjustedBaseXP,
        abilityBonuses: [
          {
            abilityId: abilityResult.abilityId,
            abilityName: abilityResult.abilityName,
            effectType: abilityResult.effectType,
            bonus: abilityResult.xpBonus,
            multiplier: abilityResult.multiplier,
            debugInfo: abilityResult.debugInfo
          }
        ],
        totalXP,
        multiplier,
        debugInfo: {
          difficultyMultiplier,
          abilityApplied: true
        }
      };
    } catch (error) {
      logger.error('Error calculating challenge XP:', error);
      return {
        baseXP: adjustedBaseXP,
        abilityBonuses: [],
        totalXP: adjustedBaseXP,
        multiplier: difficultyMultiplier,
        error: error.message
      };
    }
  }

  /**
   * Calculate team/social XP with ability bonuses
   * @param {Object} socialData - Social activity data
   * @param {string} socialData.userId - User ID
   * @param {string} socialData.activityType - Type of social activity
   * @param {number} socialData.baseXP - Base XP for activity
   * @returns {Promise<Object>} Social XP result
   */
  async calculateSocialXP(socialData) {
    const { userId, activityType, baseXP } = socialData;

    try {
      const userCharacter = await this.characterManager.getUserCharacter(userId);
      const characterId =
        userCharacter && userCharacter.character_id && userCharacter.character_id._id
          ? userCharacter.character_id._id
          : userCharacter && userCharacter.character_id
            ? userCharacter.character_id
            : null;

      if (!characterId) {
        return {
          baseXP,
          abilityBonuses: [],
          totalXP: baseXP,
          multiplier: 1
        };
      }

      const abilityResult = await this.abilityExecutor.executeAbility(
        userId,
        characterId,
        {
          session_id: socialData.sessionId || `social-${Date.now()}`,
          session_type: 'social',
          activity_type: activityType,
          flagged: false
        },
        baseXP
      );

      if (!abilityResult.success) {
        return {
          baseXP,
          abilityBonuses: [],
          totalXP: baseXP,
          multiplier: 1,
          debugInfo: {
            abilityApplied: false,
            reason: abilityResult.reason
          }
        };
      }

      const totalXP = abilityResult.xpGain;
      const multiplier = baseXP > 0 ? Number((totalXP / baseXP).toFixed(4)) : 1;

      return {
        baseXP,
        abilityBonuses: [
          {
            abilityId: abilityResult.abilityId,
            abilityName: abilityResult.abilityName,
            effectType: abilityResult.effectType,
            bonus: abilityResult.xpBonus,
            multiplier: abilityResult.multiplier,
            debugInfo: abilityResult.debugInfo
          }
        ],
        totalXP,
        multiplier,
        debugInfo: {
          activityType,
          abilityApplied: true
        }
      };
    } catch (error) {
      logger.error('Error calculating social XP:', error);
      return {
        baseXP,
        abilityBonuses: [],
        totalXP: baseXP,
        multiplier: 1,
        error: error.message
      };
    }
  }

  /**
   * Get difficulty multiplier for challenges
   * @param {string} difficulty - Challenge difficulty
   * @returns {number} Multiplier value
   */
  getDifficultyMultiplier(difficulty) {
    const multipliers = {
      easy: 1.0,
      medium: 1.5,
      hard: 2.0,
      expert: 2.5,
    };

    return multipliers[difficulty] || 1.0;
  }
}

module.exports = XPCalculator;

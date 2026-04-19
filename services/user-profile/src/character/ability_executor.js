/**
 * Ability Executor Service
 * Core orchestration layer for validating, computing, and applying ability effects
 */

const { AbilityEvent } = require('./models');
const characterManager = require('./character_manager');
const logger = require('@study-partner/shared/logger');

class AbilityExecutor {
  normalizeExecuteAbilityArgs(arg1, arg2, arg3, arg4) {
    if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
      const payload = arg1;
      return {
        userId: payload.userId,
        characterId: payload.characterId,
        abilityId: payload.abilityId,
        sessionData: payload.triggerContext || payload.sessionData || {},
        baseXp:
          payload.baseXp ||
          payload.baseXP ||
          (payload.triggerContext && payload.triggerContext.baseXp) ||
          (payload.triggerContext && payload.triggerContext.baseXP) ||
          0,
      };
    }

    return {
      userId: arg1,
      characterId: arg2,
      abilityId: null,
      sessionData: arg3 || {},
      baseXp: arg4 || 0,
    };
  }

  /**
   * Validate if ability trigger conditions are met
   * Returns { isValid: boolean, flags: array }
   */
  async validateTrigger(userId, characterId, sessionData) {
    try {
      const flags = [];
      const isValid = true;

      // Check: User has character assigned
      const userCharacter = await characterManager.getUserCharacter(userId);
      if (
        userCharacter.character_id._id.toString() !==
        characterId.toString()
      ) {
        flags.push('character_mismatch');
        return { isValid: false, flags };
      }

      // Check: Session is valid (not flagged as duplicate/farm)
      if (sessionData.flagged) {
        flags.push('flagged_session');
        return { isValid: false, flags };
      }

      // Check: Rate limiting (max 1 ability trigger per minute)
      const recentEvent = await AbilityEvent.findOne({
        user_id: userId,
        character_id: characterId,
        created_at: {
          $gt: new Date(Date.now() - 60000), // Last 60 seconds
        },
        applied: true,
      });

      if (recentEvent) {
        flags.push('rate_limited');
        return { isValid: false, flags };
      }

      // Check: Diminishing returns (more than 3 sessions in 24h)
      const sessionsIn24h = await AbilityEvent.countDocuments({
        user_id: userId,
        character_id: characterId,
        applied: true,
        created_at: {
          $gt: new Date(Date.now() - 86400000), // Last 24 hours
        },
      });

      if (sessionsIn24h > 3) {
        flags.push('diminishing_returns');
      }

      return { isValid, flags };
    } catch (error) {
      logger.error('Error validating trigger:', error);
      throw error;
    }
  }

  /**
   * Compute ability effect value
   * Applies multipliers, caps, and diminishing returns
   */
  async computeEffect(
    userId,
    characterId,
    baseXp,
    ability,
    existingMultipliers = 1.0
  ) {
    try {
      let effectValue = ability.effect_value;

      // Handle different effect types
      let multiplier = 1.0;

      switch (ability.effect_type) {
        case 'XP_MULTIPLIER':
          multiplier = 1 + effectValue; // e.g., 0.25 → 1.25
          break;

        case 'CHALLENGE_MULTIPLIER':
          multiplier = 1 + effectValue; // e.g., 0.5 → 1.5
          break;

        case 'TEAM_XP_BOOST':
          multiplier = 1 + effectValue; // e.g., 0.1 → 1.1
          break;

        case 'MULTI_BENEFIT':
          // Zenith: Amplify OTHER abilities, not itself
          multiplier = 1 + effectValue; // e.g., 0.25 → 1.25
          break;

        default:
          multiplier = 1.0;
      }

      // Apply existing multipliers to avoid stacking
      let finalMultiplier = multiplier;

      if (existingMultipliers > 1.0) {
        // Multiplicative stacking for multiple abilities
        finalMultiplier = existingMultipliers * (1 + (multiplier - 1) * 0.5);
        // Reduce stacking effectivity by 50% to prevent exponential growth
      }

      // Apply hard cap (max +25% or as defined in ability)
      const hardCap = ability.hard_cap || 1.25;
      finalMultiplier = Math.min(finalMultiplier, hardCap);

      // Apply global cap (max 100% bonus total)
      finalMultiplier = Math.min(finalMultiplier, 2.0); // 1.0 base + 1.0 bonus = 2.0x

      const computedXp = baseXp * finalMultiplier;

      // Check for diminishing returns
      const sessionsIn24h = await AbilityEvent.countDocuments({
        user_id: userId,
        character_id: characterId,
        applied: true,
        created_at: {
          $gt: new Date(Date.now() - 86400000),
        },
      });

      let diminishingReturnsPenalty = 1.0;
      if (sessionsIn24h > 3) {
        // Session 4: -15%, Session 5: -30%, Session 6+: -50%
        const sessionCount = sessionsIn24h;
        if (sessionCount === 4) {
          diminishingReturnsPenalty = 0.85;
        } else if (sessionCount === 5) {
          diminishingReturnsPenalty = 0.7;
        } else {
          diminishingReturnsPenalty = 0.5;
        }
      }

      const finalXp = computedXp * diminishingReturnsPenalty;

      return {
        effectValue,
        multiplier,
        finalMultiplier,
        diminishingReturnsPenalty,
        finalXp: Math.floor(finalXp),
        debugInfo: {
          baseXp,
          applicableMultiplier: multiplier,
          hardCapApplied: finalMultiplier !== multiplier,
          diminishingReturnsApplied: diminishingReturnsPenalty < 1.0,
          sessionsIn24h,
        },
      };
    } catch (error) {
      logger.error('Error computing effect:', error);
      throw error;
    }
  }

  /**
   * Apply computed effect to user (update XP, mastery, etc.)
   */
  async applyResult(userId, characterId, computedEffect, sessionId) {
    try {
      // Update user XP in gamification service
      // This would integrate with the existing xp_calculator service
      const xpGain = computedEffect.finalXp;

      // Update mastery
      const masteryBonus = computedEffect.debugInfo.sessionsIn24h > 2 ? 2 : 1;
      await characterManager.incrementMastery(userId, masteryBonus);

      logger.info(
        `Applied ability effect: +${xpGain} XP to user ${userId}, session ${sessionId}`
      );

      return {
        xpGain,
        masteryBonus,
        success: true,
      };
    } catch (error) {
      logger.error('Error applying result:', error);
      throw error;
    }
  }

  /**
   * Log ability event for analytics and audit trail
   */
  async logEvent(
    userId,
    characterId,
    abilityId,
    sessionId,
    triggerResult,
    computedEffect,
    flags = []
  ) {
    try {
      const event = new AbilityEvent({
        user_id: userId,
        character_id: characterId,
        ability_id: abilityId,
        session_id: sessionId,
        trigger_condition_met: triggerResult.isValid,
        effect_value: computedEffect?.finalXp || 0,
        anti_abuse_flags: flags,
        validated: triggerResult.isValid,
        applied: triggerResult.isValid,
      });

      await event.save();

      logger.debug(`Logged ability event for user ${userId}`);

      return event;
    } catch (error) {
      logger.error('Error logging event:', error);
      throw error;
    }
  }

  /**
   * Main orchestration: Validate → Compute → Apply → Log
   */
  async executeAbility(arg1, arg2, arg3, arg4) {
    try {
      const { userId, characterId, abilityId, sessionData, baseXp } =
        this.normalizeExecuteAbilityArgs(arg1, arg2, arg3, arg4);

      const normalizedSessionData = {
        ...sessionData,
        session_id:
          sessionData.session_id ||
          sessionData.sessionId ||
          `character-session-${Date.now()}`,
      };

      // Step 1: Get character and ability info
      const character = await characterManager.getCharacterById(characterId);
      const ability = await characterManager.getAbilityById(
        abilityId || character.primary_ability_id
      );

      // Step 2: Validate trigger
      const triggerResult = await this.validateTrigger(
        userId,
        characterId,
        normalizedSessionData
      );

      if (!triggerResult.isValid) {
        // Log failed event
        await this.logEvent(
          userId,
          characterId,
          ability._id,
          normalizedSessionData.session_id,
          triggerResult,
          null,
          triggerResult.flags
        );

        return {
          success: false,
          applied: false,
          abilityId: ability._id,
          abilityName: ability.name,
          effectType: ability.effect_type,
          multiplier: 1.0,
          xpGain: baseXp,
          xpBonus: 0,
          reason: triggerResult.flags.join(', '),
          flags: triggerResult.flags,
        };
      }

      // Step 3: Compute effect
      const computedEffect = await this.computeEffect(
        userId,
        characterId,
        baseXp,
        ability
      );

      // Step 4: Apply result
      const applyResult = await this.applyResult(
        userId,
        characterId,
        computedEffect,
        normalizedSessionData.session_id
      );

      // Step 5: Log event
      await this.logEvent(
        userId,
        characterId,
        ability._id,
        normalizedSessionData.session_id,
        triggerResult,
        computedEffect,
        triggerResult.flags
      );

      const normalizedBaseXp = Number(baseXp) || 0;
      const normalizedXpGain = Number(applyResult.xpGain) || 0;
      const xpBonus = Math.max(0, normalizedXpGain - normalizedBaseXp);

      return {
        success: true,
        applied: true,
        abilityId: ability._id,
        abilityName: ability.name,
        effectType: ability.effect_type,
        multiplier: computedEffect.finalMultiplier,
        xpGain: normalizedXpGain,
        xpBonus,
        masteryBonus: applyResult.masteryBonus,
        debugInfo: computedEffect.debugInfo,
      };
    } catch (error) {
      logger.error('Error executing ability:', error);
      throw error;
    }
  }

  /**
   * Get ability event history for a user
   */
  async getAbilityEventHistory(userId, limit = 100) {
    try {
      const events = await AbilityEvent.find({ user_id: userId })
        .sort({ created_at: -1 })
        .limit(limit)
        .populate('character_id')
        .populate('ability_id');

      return events;
    } catch (error) {
      logger.error('Error fetching event history:', error);
      throw error;
    }
  }

  /**
   * Get ability statistics for a user
   */
  async getAbilityStats(userId) {
    try {
      const stats = await AbilityEvent.aggregate([
        { $match: { user_id: userId, applied: true } },
        {
          $group: {
            _id: '$ability_id',
            count: { $sum: 1 },
            totalXp: { $sum: '$effect_value' },
          },
        },
        { $sort: { count: -1 } },
      ]);

      return stats;
    } catch (error) {
      logger.error('Error fetching ability stats:', error);
      throw error;
    }
  }
}

module.exports = new AbilityExecutor();

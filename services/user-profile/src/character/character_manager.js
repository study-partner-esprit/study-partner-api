/**
 * Character Manager Service
 * Handles CRUD operations for characters and user character assignments
 */

const { Character, CharacterAbility, UserCharacter, CharacterUnlockProgress } = require('./models');
const logger = require('@study-partner/shared/logger');

const RANK_REQUIREMENT_INDEX = Object.freeze({
  'novice iii': 0,
  'novice ii': 1,
  'novice i': 2,
  'explorer iii': 3,
  'explorer ii': 4,
  'explorer i': 5,
  'scholar iii': 6,
  'scholar ii': 7,
  'scholar i': 8,
  'strategist iii': 9,
  'strategist ii': 10,
  'strategist i': 11,
  'expert iii': 12,
  'expert ii': 13,
  'expert i': 14,
  'master iii': 15,
  'master ii': 16,
  'master i': 17,
  'grandmaster ii': 18,
  'grandmaster i': 18,
  grandmaster: 18,
  legend: 19,

  // Backward-compatible aliases used by old design docs/seeds.
  bronze: 3,
  silver: 9,
  gold: 15,
  platinum: 18,
  diamond: 18,
  'grand master': 18,
  novice: 0,
  explorer: 3,
  scholar: 6,
  strategist: 9,
  expert: 12,
  master: 15
});

const toNumeric = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) return null;

    const n = Number(trimmedValue);
    return Number.isFinite(n) ? n : null;
  }

  return null;
};

const normalizeRankRequirementToIndex = (value) => {
  const numeric = toNumeric(value);
  if (numeric !== null) return numeric;

  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(RANK_REQUIREMENT_INDEX, normalized)) {
    return RANK_REQUIREMENT_INDEX[normalized];
  }

  return null;
};

const toIdString = (value) => String(value || '');

const includesObjectId = (list = [], targetId) => {
  const target = toIdString(targetId);
  return list.some((item) => toIdString(item) === target);
};

class CharacterManager {
  /**
   * Get all available characters (filtered by layer/rarity)
   */
  async getAllCharacters(filters = {}) {
    try {
      const query = { is_active: true };

      if (filters.layer) {
        query.layer = filters.layer;
      }
      if (filters.rarity) {
        query.rarity = filters.rarity;
      }

      const characters = await Character.find(query)
        .populate('primary_ability_id')
        .populate('secondary_ability_id')
        .populate('abilities')
        .sort({ layer: 1, rarity: 1 });

      return characters;
    } catch (error) {
      logger.error('Error fetching characters:', error);
      throw new Error('Failed to fetch characters');
    }
  }

  /**
   * Get character by ID
   */
  async getCharacterById(characterId) {
    try {
      const character = await Character.findById(characterId)
        .populate('primary_ability_id')
        .populate('secondary_ability_id')
        .populate('abilities');

      if (!character) {
        throw new Error('Character not found');
      }

      return character;
    } catch (error) {
      logger.error('Error fetching character:', error);
      throw error;
    }
  }

  /**
   * Get character by name
   */
  async getCharacterByName(name) {
    try {
      const character = await Character.findOne({ name })
        .populate('primary_ability_id')
        .populate('secondary_ability_id')
        .populate('abilities');

      return character;
    } catch (error) {
      logger.error('Error fetching character by name:', error);
      throw error;
    }
  }

  /**
   * Get base (Layer 1) characters for onboarding
   */
  async getBaseCharacters() {
    try {
      return await this.getAllCharacters({ layer: 'base' });
    } catch (error) {
      logger.error('Error fetching base characters:', error);
      throw error;
    }
  }

  /**
   * Select character for user (during onboarding)
   */
  async selectCharacterForUser(userId, characterId) {
    try {
      // Verify character exists and is active
      const character = await Character.findById(characterId);
      if (!character || !character.is_active) {
        throw new Error('Invalid character selection');
      }

      if (character.layer !== 'base') {
        throw new Error('Onboarding character must be selected from base tier');
      }

      // Check if user already has a character assigned
      const existingAssignment = await UserCharacter.findOne({
        user_id: userId
      });
      if (existingAssignment) {
        throw new Error('User already has a character assigned');
      }

      // Create user-character assignment
      const userCharacter = new UserCharacter({
        user_id: userId,
        starter_character_id: characterId,
        character_id: characterId,
        owned_character_ids: [characterId],
        selected_at: new Date(),
        mastery_level: 0,
        mastery_points: 0
      });

      await userCharacter.save();

      // Initialize unlock progress for Layer 2 and Layer 3 characters
      await this.initializeUnlockProgress(userId);

      logger.info(`Character ${characterId} assigned to user ${userId}`);

      return userCharacter;
    } catch (error) {
      logger.error('Error selecting character:', error);
      throw error;
    }
  }

  /**
   * Get user's current character
   */
  async getUserCharacter(userId) {
    try {
      const userCharacter = await UserCharacter.findOne({ user_id: userId })
        .populate('starter_character_id')
        .populate('owned_character_ids')
        .populate('character_id')
        .populate({
          path: 'character_id',
          populate: [
            { path: 'primary_ability_id' },
            { path: 'secondary_ability_id' },
            { path: 'abilities' }
          ]
        });

      if (!userCharacter) {
        throw new Error('User has no character assigned');
      }

      let needsLegacyBackfill = false;
      const activeCharacterId = userCharacter.character_id?._id || userCharacter.character_id;

      if (!userCharacter.starter_character_id && activeCharacterId) {
        userCharacter.starter_character_id = activeCharacterId;
        needsLegacyBackfill = true;
      }

      if (
        (!Array.isArray(userCharacter.owned_character_ids) ||
          userCharacter.owned_character_ids.length === 0) &&
        activeCharacterId
      ) {
        userCharacter.owned_character_ids = [activeCharacterId];
        needsLegacyBackfill = true;
      }

      if (needsLegacyBackfill) {
        await userCharacter.save();
        await userCharacter.populate('starter_character_id');
        await userCharacter.populate('owned_character_ids');
      }

      return userCharacter;
    } catch (error) {
      logger.error('Error fetching user character:', error);
      throw error;
    }
  }

  /**
   * Get user's owned characters and active selection.
   */
  async getUserOwnedCharacters(userId) {
    try {
      const userCharacter = await this.getUserCharacter(userId);

      const ownedCharacters = Array.isArray(userCharacter.owned_character_ids)
        ? userCharacter.owned_character_ids
        : [];

      return {
        active_character_id: userCharacter.character_id?._id || userCharacter.character_id,
        starter_character_id:
          userCharacter.starter_character_id?._id || userCharacter.starter_character_id,
        owned_characters: ownedCharacters
      };
    } catch (error) {
      logger.error('Error fetching owned characters:', error);
      throw error;
    }
  }

  async addOwnedCharactersToUser(userId, characterIds = []) {
    const normalizedIds = Array.from(
      new Set((characterIds || []).map((id) => toIdString(id)).filter(Boolean))
    );

    if (!normalizedIds.length) {
      return null;
    }

    if (typeof UserCharacter.updateOne === 'function') {
      await UserCharacter.updateOne(
        { user_id: userId },
        {
          $addToSet: {
            owned_character_ids: { $each: normalizedIds }
          }
        }
      );
    } else if (typeof UserCharacter.findOne === 'function') {
      const userCharacter = await UserCharacter.findOne({ user_id: userId });
      if (!userCharacter) {
        return null;
      }

      const existingOwnedIds = Array.isArray(userCharacter.owned_character_ids)
        ? userCharacter.owned_character_ids.map((id) => toIdString(id)).filter(Boolean)
        : [];

      userCharacter.owned_character_ids = Array.from(
        new Set([...existingOwnedIds, ...normalizedIds])
      );

      if (typeof userCharacter.save === 'function') {
        await userCharacter.save();
      }
    } else {
      // Lightweight unit/integration tests may stub out UserCharacter methods entirely.
      return null;
    }

    return this.getUserCharacter(userId);
  }

  /**
   * Add a newly unlocked or purchased character to user's owned inventory.
   */
  async unlockCharacterForUser(userId, characterId) {
    try {
      const character = await Character.findById(characterId);
      if (!character || !character.is_active) {
        throw new Error('Invalid character unlock target');
      }

      const userCharacter = await UserCharacter.findOne({ user_id: userId });
      if (!userCharacter) {
        throw new Error('User has no character assigned');
      }

      await this.addOwnedCharactersToUser(userId, [characterId]);

      if (typeof CharacterUnlockProgress.findOne === 'function') {
        const unlockProgress = await CharacterUnlockProgress.findOne({
          user_id: userId,
          character_id: characterId
        });

        if (unlockProgress && !unlockProgress.is_unlocked) {
          const requiredProgress = this.resolveRequiredProgress(unlockProgress);
          unlockProgress.current_progress =
            requiredProgress !== null
              ? Math.max(toNumeric(unlockProgress.current_progress) || 0, requiredProgress)
              : toNumeric(unlockProgress.current_progress) || 0;
          unlockProgress.is_unlocked = true;
          unlockProgress.unlocked_at = new Date();

          if (typeof unlockProgress.save === 'function') {
            await unlockProgress.save();
          }
        }
      }

      return this.getUserCharacter(userId);
    } catch (error) {
      logger.error('Error unlocking character for user:', error);
      throw error;
    }
  }

  /**
   * Initialize unlock progress tracking for a new user
   */
  async initializeUnlockProgress(userId) {
    try {
      // Get all progression and endgame characters
      const progressionCharacters = await Character.find({
        layer: { $in: ['progression', 'endgame'] },
        is_active: true
      });

      const progressTrackers = progressionCharacters
        .filter((character) => character.unlock_condition)
        .map((character) => ({
          user_id: userId,
          character_id: character._id,
          unlock_type: character.unlock_condition.type,
          required_progress: character.unlock_condition.value,
          current_progress: 0,
          is_unlocked: false
        }));

      if (progressTrackers.length > 0) {
        await CharacterUnlockProgress.insertMany(progressTrackers);
        logger.info(`Initialized unlock progress for user ${userId}`);
      }
    } catch (error) {
      logger.error('Error initializing unlock progress:', error);
      throw error;
    }
  }

  /**
   * Update user's mastery level
   */
  async incrementMastery(userId, points = 1) {
    try {
      const userCharacter = await UserCharacter.findOne({ user_id: userId });

      if (!userCharacter) {
        throw new Error('User character not found');
      }

      userCharacter.mastery_points += points;
      userCharacter.total_abilities_used += 1;

      // Calculate mastery level (10 points per level)
      userCharacter.mastery_level = Math.floor(userCharacter.mastery_points / 10);
      userCharacter.mastery_level = Math.min(userCharacter.mastery_level, 10); // Cap at 10

      await userCharacter.save();

      return userCharacter;
    } catch (error) {
      logger.error('Error incrementing mastery:', error);
      throw error;
    }
  }

  /**
   * Update unlock progress for a character
   */
  async updateUnlockProgress(userId, characterId, newProgress) {
    try {
      const unlockProgress = await CharacterUnlockProgress.findOne({
        user_id: userId,
        character_id: characterId
      }).populate('character_id');

      if (!unlockProgress) {
        throw new Error('Unlock progress not found');
      }

      unlockProgress.current_progress = newProgress;

      const requiredProgress = this.resolveRequiredProgress(unlockProgress);
      if (requiredProgress !== null) {
        unlockProgress.required_progress = requiredProgress;
      }

      // Check if threshold reached
      if (
        requiredProgress !== null &&
        newProgress >= requiredProgress &&
        !unlockProgress.is_unlocked
      ) {
        unlockProgress.is_unlocked = true;
        unlockProgress.unlocked_at = new Date();

        await this.addOwnedCharactersToUser(userId, [characterId]);

        logger.info(
          `Character ${characterId} unlocked for user ${userId} (threshold: ${newProgress}/${requiredProgress})`
        );
      }

      await unlockProgress.save();

      return unlockProgress;
    } catch (error) {
      logger.error('Error updating unlock progress:', error);
      throw error;
    }
  }

  /**
   * Get all unlock progress for a user
   */
  async getUserUnlockProgress(userId) {
    try {
      const progress = await CharacterUnlockProgress.find({
        user_id: userId
      }).populate('character_id');

      return progress;
    } catch (error) {
      logger.error('Error fetching unlock progress:', error);
      throw error;
    }
  }

  resolveRequiredProgress(progressDoc) {
    const numericRequirement = toNumeric(progressDoc?.required_progress);
    if (numericRequirement !== null) {
      return numericRequirement;
    }

    if (progressDoc?.unlock_type !== 'rank') {
      return null;
    }

    const rankRequirement = progressDoc?.character_id?.unlock_condition?.value;
    return normalizeRankRequirementToIndex(rankRequirement);
  }

  getMetricProgressByUnlockType(unlockType, metrics = {}) {
    switch (unlockType) {
      case 'streak':
        return toNumeric(metrics.currentStreak);
      case 'total_xp':
        return toNumeric(metrics.totalXp);
      case 'rank': {
        const directRankIndex = toNumeric(metrics.rankIndex);
        if (directRankIndex !== null) return directRankIndex;
        return normalizeRankRequirementToIndex(metrics.rankName);
      }
      case 'challenge':
      case 'challenges_completed':
        return toNumeric(metrics.challengesCompleted);
      case 'group_session':
      case 'group_sessions':
        return toNumeric(metrics.groupSessions);
      default:
        return null;
    }
  }

  /**
   * Sync unlock progress from known user metrics.
   * This is intentionally tolerant of partial metrics and only updates the unlock types provided.
   */
  async syncUnlockProgressByMetrics(userId, metrics = {}) {
    try {
      const progressDocs = await CharacterUnlockProgress.find({
        user_id: userId
      }).populate('character_id');

      if (!progressDocs.length) {
        return {
          updatedCount: 0,
          unlockedCharacterIds: []
        };
      }

      let updatedCount = 0;
      const unlockedCharacterIds = [];

      for (const progressDoc of progressDocs) {
        const observedProgress = this.getMetricProgressByUnlockType(
          progressDoc.unlock_type,
          metrics
        );

        if (observedProgress === null) {
          continue;
        }

        const currentProgress = toNumeric(progressDoc.current_progress) || 0;
        const mergedProgress = Math.max(currentProgress, observedProgress);
        const requiredProgress = this.resolveRequiredProgress(progressDoc);

        let hasChanged = false;

        if (mergedProgress !== currentProgress) {
          progressDoc.current_progress = mergedProgress;
          hasChanged = true;
        }

        if (requiredProgress !== null && progressDoc.required_progress !== requiredProgress) {
          progressDoc.required_progress = requiredProgress;
          hasChanged = true;
        }

        if (
          requiredProgress !== null &&
          !progressDoc.is_unlocked &&
          mergedProgress >= requiredProgress
        ) {
          progressDoc.is_unlocked = true;
          progressDoc.unlocked_at = new Date();
          hasChanged = true;
          unlockedCharacterIds.push(
            String(progressDoc.character_id?._id || progressDoc.character_id)
          );
        }

        if (hasChanged) {
          await progressDoc.save();
          updatedCount += 1;
        }
      }

      if (unlockedCharacterIds.length > 0) {
        await this.addOwnedCharactersToUser(userId, unlockedCharacterIds);
      }

      return {
        updatedCount,
        unlockedCharacterIds
      };
    } catch (error) {
      logger.error('Error syncing unlock progress by metrics:', error);
      throw error;
    }
  }

  /**
   * Change user's selected character
   * Future enhancement: add cooldown checks before allowing switch.
   */
  async changeUserCharacter(userId, newCharacterId) {
    try {
      const character = await Character.findById(newCharacterId);
      if (!character || !character.is_active) {
        throw new Error('Invalid character selection');
      }

      const userCharacter = await UserCharacter.findOne({ user_id: userId });
      if (!userCharacter) {
        throw new Error('User has no character assigned');
      }

      if (!includesObjectId(userCharacter.owned_character_ids || [], newCharacterId)) {
        throw new Error('Character not owned by user');
      }

      userCharacter.character_id = newCharacterId;
      userCharacter.selected_at = new Date();

      await userCharacter.save();

      logger.info(`User ${userId} switched to character ${newCharacterId}`);

      return userCharacter;
    } catch (error) {
      logger.error('Error changing user character:', error);
      throw error;
    }
  }

  /**
   * Create a new character (admin)
   */
  async createCharacter(characterData) {
    try {
      const character = new Character(characterData);
      await character.save();

      logger.info(`Created new character: ${character.name}`);

      return character;
    } catch (error) {
      logger.error('Error creating character:', error);
      throw error;
    }
  }

  /**
   * Update character (admin)
   */
  async updateCharacter(characterId, updateData) {
    try {
      const character = await Character.findByIdAndUpdate(characterId, updateData, { new: true });

      if (!character) {
        throw new Error('Character not found');
      }

      logger.info(`Updated character: ${character.name}`);

      return character;
    } catch (error) {
      logger.error('Error updating character:', error);
      throw error;
    }
  }

  /**
   * Create ability
   */
  async createAbility(abilityData) {
    try {
      const ability = new CharacterAbility(abilityData);
      await ability.save();

      logger.info(`Created new ability: ${ability.name}`);

      return ability;
    } catch (error) {
      logger.error('Error creating ability:', error);
      throw error;
    }
  }

  /**
   * Get ability by ID
   */
  async getAbilityById(abilityId) {
    try {
      const ability = await CharacterAbility.findById(abilityId);

      if (!ability) {
        throw new Error('Ability not found');
      }

      return ability;
    } catch (error) {
      logger.error('Error fetching ability:', error);
      throw error;
    }
  }
}

module.exports = new CharacterManager();

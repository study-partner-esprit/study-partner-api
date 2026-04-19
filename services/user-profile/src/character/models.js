/**
 * Character System Models
 * Defines data structures for characters, abilities, and user-character associations
 */

const mongoose = require('mongoose');

// Character Schema - Master list of all available characters
const characterSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    description: {
      type: String,
      required: true
    },
    rarity: {
      type: String,
      enum: ['common', 'uncommon', 'rare', 'legendary'],
      default: 'common'
    },
    layer: {
      type: String,
      enum: ['base', 'progression', 'endgame'],
      required: true
    },
    primary_ability_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CharacterAbility',
      required: true
    },
    secondary_ability_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CharacterAbility'
    },
    abilities: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CharacterAbility'
      }
    ],
    image_asset_path: {
      type: String
    },
    lore: {
      type: String
    },
    color_theme: {
      type: String,
      default: '#ffffff'
    },
    playstyle: {
      type: String,
      enum: ['focused', 'competitive', 'social', 'hybrid']
    },
    unlock_condition: {
      type: {
        type: String,
        enum: [
          'immediate',
          'streak',
          'challenge',
          'challenges_completed',
          'group_session',
          'group_sessions',
          'rank',
          'total_xp'
        ]
      },
      value: Number // e.g., 30 for 30-day streak, 50 for 50 challenges
    },
    purchase_price_usd_cents: {
      type: Number,
      default: 0,
      min: 0
    },
    is_purchasable: {
      type: Boolean,
      default: false
    },
    is_active: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

// Character Ability Schema
const characterAbilitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true
    },
    description: {
      type: String,
      required: true
    },
    effect_type: {
      type: String,
      enum: [
        'XP_MULTIPLIER',
        'TIME_REDUCTION',
        'PLAYER_SLOT',
        'STREAK_PRESERVATION',
        'BREAK_REDUCTION',
        'ADDITIONAL_RESOURCES',
        'CHALLENGE_MULTIPLIER',
        'TEAM_XP_BOOST',
        'RANDOM_BONUS',
        'CUMULATIVE_BOOST',
        'PERFECT_SESSION_BONUS',
        'TIME_MULTIPLIER',
        'MULTI_BENEFIT'
      ],
      required: true
    },
    effect_value: mongoose.Schema.Types.Mixed, // Can be number or object
    cooldown_minutes: {
      type: Number
    },
    trigger_condition: {
      type: String,
      required: true
    },
    icon_asset_path: {
      type: String
    },
    rarity: {
      type: String,
      enum: ['common', 'uncommon', 'rare', 'legendary'],
      default: 'common'
    },
    max_effectiveness: {
      type: Number,
      default: 1.0 // 100% as 1.0
    },
    hard_cap: {
      type: Number,
      default: 1.25 // 25% cap as 1.25
    }
  },
  { timestamps: true }
);

// User Character Association Schema
const userCharacterSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true // One active character per user
    },
    starter_character_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Character',
      required: true
    },
    character_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Character',
      required: true
    },
    owned_character_ids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Character'
      }
    ],
    selected_at: {
      type: Date,
      default: Date.now
    },
    mastery_level: {
      type: Number,
      default: 0,
      min: 0,
      max: 10
    },
    mastery_points: {
      type: Number,
      default: 0
    },
    total_abilities_used: {
      type: Number,
      default: 0
    },
    unlocked_skins: [String],
    unlocked_titles: [String],
    prestige_level: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

// Character Unlock Progress Schema - Tracks user progress toward unlocking characters
const characterUnlockProgressSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    character_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Character',
      required: true
    },
    unlock_type: {
      type: String,
      enum: [
        'streak',
        'challenge',
        'challenges_completed',
        'group_session',
        'group_sessions',
        'rank',
        'total_xp'
      ],
      required: true
    },
    current_progress: {
      type: Number,
      default: 0
    },
    required_progress: {
      type: Number,
      required: true
    },
    is_unlocked: {
      type: Boolean,
      default: false
    },
    unlocked_at: {
      type: Date
    }
  },
  { timestamps: true }
);

// Ability Events Schema - Track when abilities are triggered (for analytics)
const abilityEventSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    character_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Character',
      required: true
    },
    ability_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CharacterAbility',
      required: true
    },
    session_id: {
      type: String
    },
    trigger_condition_met: {
      type: Boolean,
      required: true
    },
    effect_value: {
      type: Number
    },
    anti_abuse_flags: [String], // e.g., ['rate_limited', 'duplicate_session']
    validated: {
      type: Boolean,
      default: false
    },
    applied: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

// Character Purchase Schema - Tracks paid character unlocks
const characterPurchaseSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      required: true,
      index: true
    },
    character_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Character',
      required: true
    },
    stripe_checkout_session_id: {
      type: String,
      unique: true,
      sparse: true
    },
    stripe_payment_intent_id: {
      type: String
    },
    amount_usd_cents: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'usd'
    },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'canceled'],
      default: 'pending',
      index: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    purchased_at: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

// Create indices for performance
characterSchema.index({ layer: 1, is_active: 1 });
characterSchema.index({ rarity: 1 });
userCharacterSchema.index({ user_id: 1 });
userCharacterSchema.index({ character_id: 1 });
characterUnlockProgressSchema.index({ user_id: 1, character_id: 1 });
abilityEventSchema.index({ user_id: 1, created_at: -1 });
abilityEventSchema.index({ character_id: 1, created_at: -1 });
characterPurchaseSchema.index({ user_id: 1, createdAt: -1 });
characterPurchaseSchema.index({ user_id: 1, character_id: 1 });

module.exports = {
  Character: mongoose.model('Character', characterSchema),
  CharacterAbility: mongoose.model('CharacterAbility', characterAbilitySchema),
  UserCharacter: mongoose.model('UserCharacter', userCharacterSchema),
  CharacterUnlockProgress: mongoose.model('CharacterUnlockProgress', characterUnlockProgressSchema),
  AbilityEvent: mongoose.model('AbilityEvent', abilityEventSchema),
  CharacterPurchase: mongoose.model('CharacterPurchase', characterPurchaseSchema)
};

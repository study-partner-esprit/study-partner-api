/**
 * Character System API Routes
 * Endpoints for character selection, display, and ability tracking
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();
const characterManager = require('./character_manager');
const abilityExecutor = require('./ability_executor');
const { CharacterPurchase } = require('./models');
const { authenticate } = require('@study-partner/shared/auth');
const logger = require('@study-partner/shared/logger');

const auth = authenticate;
const USER_PROFILE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

let stripe = null;
try {
  const Stripe = require('stripe');
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
} catch (error) {
  stripe = null;
}

const getAuthenticatedUserId = (req) => req?.user?.userId || req?.user?.id;

const getPurchasableAmountInUsdCents = (character = {}) => {
  const amount = Number(character?.purchase_price_usd_cents);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.trunc(amount));
};

const isPurchasableCharacter = (character = {}) => {
  return Boolean(character?.is_purchasable) && getPurchasableAmountInUsdCents(character) > 0;
};

const ownsCharacter = (ownedCharacters = [], characterId) => {
  const target = String(characterId || '');
  return ownedCharacters.some((character) => String(character?._id || character) === target);
};

const toSafeInteger = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.trunc(Number(fallback) || 0));
  }

  return Math.max(0, Math.trunc(numeric));
};

const countXpHistoryActions = (xpHistory = [], predicate) => {
  if (!Array.isArray(xpHistory)) return 0;

  return xpHistory.reduce((count, entry) => {
    const action = String(entry?.action || '');
    return predicate(action) ? count + 1 : count;
  }, 0);
};

const extractUnlockMetricsFromGamification = (gamificationData = {}) => {
  const stats = gamificationData?.stats || {};
  const xpHistory = gamificationData?.xp_history || [];

  const challengeCountFromHistory = countXpHistoryActions(xpHistory, (action) =>
    action.toLowerCase().includes('challenge')
  );

  const groupCountFromHistory = countXpHistoryActions(xpHistory, (action) =>
    /^team_session(_host)?$/i.test(action)
  );

  return {
    totalXp: Number(gamificationData?.total_xp),
    challengesCompleted: toSafeInteger(
      stats.challengesCompleted ??
        stats.challenges_completed ??
        stats.challengeCount ??
        challengeCountFromHistory,
      challengeCountFromHistory
    ),
    groupSessions: toSafeInteger(
      stats.groupSessions ??
        stats.group_sessions ??
        stats.teamSessions ??
        stats.team_sessions ??
        groupCountFromHistory,
      groupCountFromHistory
    )
  };
};

/**
 * GET /api/characters
 * Get all available characters (filtered by layer)
 */
router.get('/characters', async (req, res) => {
  try {
    const { layer, rarity } = req.query;
    const characters = await characterManager.getAllCharacters({
      layer,
      rarity
    });

    return res.status(200).json({
      success: true,
      data: characters
    });
  } catch (error) {
    logger.error('Error fetching characters:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch characters',
      error: error.message
    });
  }
});

/**
 * GET /api/characters/base
 * Get base (Layer 1) characters for onboarding
 */
router.get('/characters/base', async (req, res) => {
  try {
    const baseCharacters = await characterManager.getBaseCharacters();

    return res.status(200).json({
      success: true,
      data: baseCharacters
    });
  } catch (error) {
    logger.error('Error fetching base characters:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch base characters',
      error: error.message
    });
  }
});

/**
 * GET /api/characters/:id
 * Get character details by ID
 */
router.get('/characters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const character = await characterManager.getCharacterById(id);

    return res.status(200).json({
      success: true,
      data: character
    });
  } catch (error) {
    logger.error('Error fetching character:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch character',
      error: error.message
    });
  }
});

/**
 * GET /api/characters/:id/abilities
 * Get all abilities for a character
 */
router.get('/characters/:id/abilities', async (req, res) => {
  try {
    const { id } = req.params;
    const character = await characterManager.getCharacterById(id);

    return res.status(200).json({
      success: true,
      data: character.abilities || []
    });
  } catch (error) {
    logger.error('Error fetching character abilities:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch character abilities',
      error: error.message
    });
  }
});

/**
 * POST /api/user/select-character
 * User selects character during onboarding (requires auth)
 */
router.post('/user/select-character', auth, async (req, res) => {
  try {
    const { characterId } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!characterId) {
      return res.status(400).json({
        success: false,
        message: 'Character ID is required'
      });
    }

    const userCharacter = await characterManager.selectCharacterForUser(userId, characterId);

    return res.status(201).json({
      success: true,
      message: 'Character selected successfully',
      data: userCharacter
    });
  } catch (error) {
    logger.error('Error selecting character:', error);
    if (String(error.message).toLowerCase().includes('already has')) {
      return res.status(409).json({
        success: false,
        message: error.message,
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to select character',
      error: error.message
    });
  }
});

/**
 * GET /api/user/owned-characters
 * Get user's owned character inventory + active selection (requires auth)
 */
router.get('/user/owned-characters', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const owned = await characterManager.getUserOwnedCharacters(userId);

    return res.status(200).json({
      success: true,
      data: owned
    });
  } catch (error) {
    logger.error('Error fetching owned characters:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch owned characters',
      error: error.message
    });
  }
});

/**
 * POST /api/user/characters/:id/purchase
 * Start Stripe checkout for purchasable character unlock (requires auth)
 */
router.post('/user/characters/:id/purchase', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const characterId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: 'Stripe is not configured'
      });
    }

    const character = await characterManager.getCharacterById(characterId);
    const amountUsdCents = getPurchasableAmountInUsdCents(character);

    if (!isPurchasableCharacter(character)) {
      return res.status(400).json({
        success: false,
        message: 'Character is not purchasable'
      });
    }

    const owned = await characterManager.getUserOwnedCharacters(userId);
    if (ownsCharacter(owned.owned_characters || [], characterId)) {
      return res.status(409).json({
        success: false,
        message: 'Character already owned'
      });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amountUsdCents,
            product_data: {
              name: `Unlock ${character.name}`,
              description: `Unlock character ${character.name} in Study Partner`
            }
          },
          quantity: 1
        }
      ],
      success_url: `${FRONTEND_URL}/checkout/character-success?session_id={CHECKOUT_SESSION_ID}&character_id=${characterId}`,
      cancel_url: `${FRONTEND_URL}/checkout/character-cancel?character_id=${characterId}`,
      metadata: {
        userId: String(userId),
        characterId: String(characterId),
        purchaseType: 'character_unlock'
      }
    });

    await CharacterPurchase.findOneAndUpdate(
      {
        stripe_checkout_session_id: checkoutSession.id
      },
      {
        $set: {
          user_id: String(userId),
          character_id: characterId,
          amount_usd_cents: amountUsdCents,
          currency: 'usd',
          status: 'pending',
          metadata: {
            characterName: character.name,
            layer: character.layer,
            checkoutSessionId: checkoutSession.id
          }
        }
      },
      { upsert: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        characterId,
        amountUsdCents,
        checkoutSessionId: checkoutSession.id,
        checkoutUrl: checkoutSession.url
      }
    });
  } catch (error) {
    logger.error('Error starting character purchase:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to start character purchase',
      error: error.message
    });
  }
});

/**
 * POST /api/user/characters/purchase/confirm
 * Confirm Stripe checkout and unlock purchased character (requires auth)
 */
router.post('/user/characters/purchase/confirm', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const sessionId = String(req.body?.sessionId || '').trim();

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required'
      });
    }

    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: 'Stripe is not configured'
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Checkout session not found'
      });
    }

    const sessionUserId = String(session?.metadata?.userId || '');
    const characterId = String(session?.metadata?.characterId || '');

    if (!sessionUserId || sessionUserId !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Session does not belong to current user'
      });
    }

    if (!characterId) {
      return res.status(422).json({
        success: false,
        message: 'Checkout metadata is incomplete'
      });
    }

    if (session.payment_status !== 'paid') {
      return res.status(409).json({
        success: false,
        message: 'Payment not completed yet',
        paymentStatus: session.payment_status || 'unknown'
      });
    }

    await characterManager.unlockCharacterForUser(userId, characterId);

    const purchase = await CharacterPurchase.findOneAndUpdate(
      {
        stripe_checkout_session_id: session.id
      },
      {
        $set: {
          user_id: String(userId),
          character_id: characterId,
          stripe_payment_intent_id: session.payment_intent || null,
          amount_usd_cents: Number(session.amount_total || 0),
          currency: session.currency || 'usd',
          status: 'succeeded',
          purchased_at: new Date(),
          metadata: session
        }
      },
      {
        upsert: true,
        new: true
      }
    ).populate('character_id');

    const owned = await characterManager.getUserOwnedCharacters(userId);

    return res.status(200).json({
      success: true,
      data: {
        purchase,
        owned
      }
    });
  } catch (error) {
    logger.error('Error confirming character purchase:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to confirm character purchase',
      error: error.message
    });
  }
});

/**
 * GET /api/user/characters/purchases
 * Get purchase history for current user (requires auth)
 */
router.get('/user/characters/purchases', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const purchases = await CharacterPurchase.find({ user_id: String(userId) })
      .populate('character_id')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: purchases
    });
  } catch (error) {
    logger.error('Error fetching character purchases:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch character purchases',
      error: error.message
    });
  }
});

/**
 * GET /api/user/character
 * Get current user's selected character (requires auth)
 */
router.get('/user/character', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userCharacter = await characterManager.getUserCharacter(userId);

    return res.status(200).json({
      success: true,
      data: userCharacter
    });
  } catch (error) {
    logger.error('Error fetching user character:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch character',
      error: error.message
    });
  }
});

/**
 * PATCH /api/user/character
 * Change current user's active character for lobby/session (must be owned)
 */
router.patch('/user/character', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const { characterId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!characterId) {
      return res.status(400).json({
        success: false,
        message: 'Character ID is required'
      });
    }

    const updated = await characterManager.changeUserCharacter(userId, characterId);

    return res.status(200).json({
      success: true,
      message: 'Character updated successfully',
      data: updated
    });
  } catch (error) {
    logger.error('Error changing user character:', error);

    if (String(error.message).toLowerCase().includes('not owned')) {
      return res.status(403).json({
        success: false,
        message: error.message,
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to change character',
      error: error.message
    });
  }
});

/**
 * GET /api/user/unlock-progress
 * Get user's unlock progress for all characters (requires auth)
 */
router.get('/user/unlock-progress', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Best-effort sync from profile + rank data so rank-gated unlocks stay fresh.
    try {
      const [gamificationResult, rankResult] = await Promise.allSettled([
        axios.get(`${USER_PROFILE_URL}/api/v1/users/gamification`, {
          headers: { Authorization: req.headers.authorization }
        }),
        axios.get(`${USER_PROFILE_URL}/api/v1/users/gamification/rank/profile`, {
          headers: { Authorization: req.headers.authorization }
        })
      ]);

      const metrics = {};

      if (gamificationResult.status === 'fulfilled') {
        Object.assign(
          metrics,
          extractUnlockMetricsFromGamification(gamificationResult.value?.data || {})
        );
      }

      if (rankResult.status === 'fulfilled') {
        metrics.currentStreak = Number(rankResult.value?.data?.profile?.currentStreak);
        metrics.rankIndex = Number(rankResult.value?.data?.profile?.rankIndex);
        metrics.rankName = rankResult.value?.data?.profile?.rankName;
      }

      await characterManager.syncUnlockProgressByMetrics(userId, metrics);
    } catch (syncError) {
      logger.warn('Unlock progress metric sync skipped:', syncError.message);
    }

    const progress = await characterManager.getUserUnlockProgress(userId);

    return res.status(200).json({
      success: true,
      data: progress
    });
  } catch (error) {
    logger.error('Error fetching unlock progress:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unlock progress',
      error: error.message
    });
  }
});

/**
 * POST /api/user/unlock-progress/sync
 * Sync unlock progress from explicit metrics payload (internal orchestration)
 */
router.post('/user/unlock-progress/sync', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const metrics = req.body?.metrics || {};

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const syncResult = await characterManager.syncUnlockProgressByMetrics(userId, metrics);

    return res.status(200).json({
      success: true,
      data: syncResult
    });
  } catch (error) {
    logger.error('Error syncing unlock progress:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync unlock progress',
      error: error.message
    });
  }
});

/**
 * POST /api/abilities/trigger
 * Trigger ability effect execution (requires auth)
 * Called after study session completion
 */
router.post('/abilities/trigger', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const { characterId, sessionData, baseXp } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!characterId || !sessionData || !baseXp) {
      return res.status(400).json({
        success: false,
        message: 'characterId, sessionData, and baseXp are required'
      });
    }

    const result = await abilityExecutor.executeAbility(userId, characterId, sessionData, baseXp);

    return res.status(200).json({
      success: result.success,
      message: result.success
        ? 'Ability applied successfully'
        : `Ability not applied: ${result.reason}`,
      data: result
    });
  } catch (error) {
    logger.error('Error triggering ability:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger ability',
      error: error.message
    });
  }
});

/**
 * GET /api/user/ability-stats
 * Get user's ability usage statistics (requires auth)
 */
router.get('/user/ability-stats', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const stats = await abilityExecutor.getAbilityStats(userId);

    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching ability stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch ability stats',
      error: error.message
    });
  }
});

/**
 * GET /api/user/ability-events
 * Get user's ability trigger event history (requires auth)
 */
router.get('/user/ability-events', auth, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const { limit } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const events = await abilityExecutor.getAbilityEventHistory(userId, parseInt(limit) || 100);

    return res.status(200).json({
      success: true,
      data: events
    });
  } catch (error) {
    logger.error('Error fetching ability events:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch ability events',
      error: error.message
    });
  }
});

// ADMIN ENDPOINTS

/**
 * POST /api/admin/characters
 * Create new character (admin only)
 */
router.post('/admin/characters', auth, async (req, res) => {
  try {
    // Check if user is admin (you would implement proper admin check)
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    const characterData = req.body;
    const character = await characterManager.createCharacter(characterData);

    return res.status(201).json({
      success: true,
      message: 'Character created successfully',
      data: character
    });
  } catch (error) {
    logger.error('Error creating character:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create character',
      error: error.message
    });
  }
});

/**
 * PUT /api/admin/characters/:id
 * Update character (admin only)
 */
router.put('/admin/characters/:id', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    const { id } = req.params;
    const updateData = req.body;

    const character = await characterManager.updateCharacter(id, updateData);

    return res.status(200).json({
      success: true,
      message: 'Character updated successfully',
      data: character
    });
  } catch (error) {
    logger.error('Error updating character:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update character',
      error: error.message
    });
  }
});

/**
 * POST /api/admin/abilities
 * Create new ability (admin only)
 */
router.post('/admin/abilities', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    const abilityData = req.body;
    const ability = await characterManager.createAbility(abilityData);

    return res.status(201).json({
      success: true,
      message: 'Ability created successfully',
      data: ability
    });
  } catch (error) {
    logger.error('Error creating ability:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create ability',
      error: error.message
    });
  }
});

module.exports = router;

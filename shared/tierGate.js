/**
 * Tier-based access control middleware.
 * Usage: tierGate('vip', 'vip_plus', 'trial')
 */
const tierGate = (...allowedTiers) => (req, res, next) => {
  const userTier = req.user?.tier || 'normal';

  // Auto-downgrade expired trials
  if (userTier === 'trial' && req.user?.trialExpiresAt && new Date(req.user.trialExpiresAt) < new Date()) {
    return res.status(403).json({
      error: 'Trial expired',
      code: 'TRIAL_EXPIRED',
      requiredTier: allowedTiers[0],
      currentTier: 'normal',
      upgradeUrl: '/pricing'
    });
  }

  if (!allowedTiers.includes(userTier)) {
    return res.status(403).json({
      error: 'Upgrade required',
      code: 'TIER_REQUIRED',
      requiredTier: allowedTiers[0],
      currentTier: userTier,
      upgradeUrl: '/pricing'
    });
  }
  next();
};

module.exports = { tierGate };

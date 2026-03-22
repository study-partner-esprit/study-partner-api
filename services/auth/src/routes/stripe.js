const express = require('express');
const Joi = require('joi');
const Stripe = require('stripe');
const { authenticate } = require('@study-partner/shared/auth');
const User = require('../models/User');
const Payment = require('../models/Payment');
const { MONTH_OPTIONS, calculatePlanPrice } = require('../config/pricing');

const router = express.Router();

const subscriptionSchema = Joi.object({
  tier: Joi.string().valid('vip', 'vip_plus').required(),
  durationMonths: Joi.number()
    .integer()
    .valid(...MONTH_OPTIONS)
    .default(1),
  successPath: Joi.string().optional().allow(''),
  cancelPath: Joi.string().optional().allow('')
});

const confirmCheckoutSchema = Joi.object({
  sessionId: Joi.string().trim().required()
});

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;

router.get('/config', (req, res) => {
  return res.json({ stripeConfigured: Boolean(stripe) });
});

function logError(label, err) {
  const message = err && err.message ? err.message : String(err);
  process.stderr.write(`[stripe] ${label}: ${message}\n`);
}

function getPriceIdByTier(tier) {
  if (tier === 'vip') return process.env.STRIPE_PRICE_ID_VIP;
  if (tier === 'vip_plus') return process.env.STRIPE_PRICE_ID_VIP_PLUS;
  return null;
}

function addMonths(baseDate, months) {
  const next = new Date(baseDate);
  next.setMonth(next.getMonth() + months);
  return next;
}

function getSubscriptionSnapshot(user) {
  const now = new Date();
  if (!user.subscriptionEndAt || !['vip', 'vip_plus'].includes(user.tier)) {
    return { hasActiveSubscription: false, daysRemaining: 0, canChangePlan: true };
  }

  const end = new Date(user.subscriptionEndAt);
  if (end <= now) {
    return { hasActiveSubscription: false, daysRemaining: 0, canChangePlan: true };
  }

  const daysRemaining = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
  return {
    hasActiveSubscription: true,
    daysRemaining,
    canChangePlan: daysRemaining <= 5
  };
}

function getFrontendBaseUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}

async function applyCheckoutSession(session, { stripeEventId = null } = {}) {
  const userId = session.metadata?.userId;
  const targetTier = session.metadata?.tier;
  const durationMonths = Number(session.metadata?.durationMonths || 1);
  const monthlyPriceCents = Number(session.metadata?.monthlyPriceCents || 0);
  const discountPercentage = Number(session.metadata?.discountPercentage || 0);

  if (!userId || !targetTier) {
    return { applied: false, reason: 'missing_metadata' };
  }

  await Payment.findOneAndUpdate(
    { stripeCheckoutSessionId: session.id },
    {
      $set: {
        stripeEventId,
        stripeSubscriptionId: session.subscription || null,
        stripeCustomerId: session.customer || null,
        durationMonths,
        monthlyPriceCents,
        discountPercentage,
        amount: session.amount_total ?? null,
        currency: session.currency || 'usd',
        status: 'succeeded',
        metadata: session
      }
    },
    { upsert: true }
  );

  const startAt = new Date();
  const endAt = addMonths(startAt, durationMonths);

  await User.findByIdAndUpdate(userId, {
    $set: {
      tier: targetTier,
      tierChangedAt: new Date(),
      subscriptionId: session.subscription || null,
      stripeCustomerId: session.customer || null,
      subscriptionStartAt: startAt,
      subscriptionEndAt: endAt,
      subscriptionDurationMonths: durationMonths,
      renewalDate: endAt,
      canChangeAfter: new Date(endAt.getTime() - 5 * 24 * 60 * 60 * 1000),
      autoRenew: false
    }
  });

  return { applied: true, userId, tier: targetTier, durationMonths };
}

async function upsertCustomer(user) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: String(user._id) }
  });

  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

router.post('/subscribe', authenticate, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured' });
    }

    const { error, value } = subscriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const current = getSubscriptionSnapshot(user);
    if (current.hasActiveSubscription && !current.canChangePlan) {
      return res.status(403).json({
        error: `Plan change is locked until the last 5 days of your current subscription (${current.daysRemaining} days left)`
      });
    }

    const pricing = calculatePlanPrice(value.tier, value.durationMonths);

    const customerId = await upsertCustomer(user);
    const frontendBase = getFrontendBaseUrl();
    const successPath = value.successPath || '/checkout/success';
    const cancelPath = value.cancelPath || '/checkout/cancel';

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: pricing.finalAmountCents,
            product_data: {
              name: `Study Partner ${value.tier === 'vip_plus' ? 'VIP+' : 'VIP'} (${pricing.durationMonths} month${pricing.durationMonths > 1 ? 's' : ''})`,
              description: `${pricing.durationMonths} month subscription prepaid${pricing.discountPercentage ? ` with ${pricing.discountPercentage}% discount` : ''}`
            }
          },
          quantity: 1
        }
      ],
      success_url: `${frontendBase}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBase}${cancelPath}`,
      metadata: {
        userId: String(user._id),
        tier: value.tier,
        durationMonths: String(pricing.durationMonths),
        monthlyPriceCents: String(pricing.monthlyPriceCents),
        discountPercentage: String(pricing.discountPercentage)
      }
    });

    await Payment.create({
      userId: user._id,
      stripeCheckoutSessionId: checkoutSession.id,
      stripeCustomerId: customerId,
      tier: value.tier,
      durationMonths: pricing.durationMonths,
      monthlyPriceCents: pricing.monthlyPriceCents,
      discountPercentage: pricing.discountPercentage,
      status: 'pending',
      currency: 'usd'
    });

    return res.json({
      checkoutUrl: checkoutSession.url,
      checkoutSessionId: checkoutSession.id
    });
  } catch (err) {
    logError('stripe_subscribe_error', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.get('/subscription/status', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      tier: user.tier,
      subscriptionId: user.subscriptionId || null,
      stripeCustomerId: user.stripeCustomerId || null,
      stripeConfigured: Boolean(stripe)
    });
  } catch (err) {
    logError('stripe_subscription_status_error', err);
    return res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

router.post('/confirm', authenticate, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured' });
    }

    const { error, value } = confirmCheckoutSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const session = await stripe.checkout.sessions.retrieve(value.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Checkout session not found' });
    }

    const sessionUserId = session.metadata?.userId;
    if (!sessionUserId || String(sessionUserId) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Session does not belong to current user' });
    }

    if (session.payment_status !== 'paid') {
      return res.status(409).json({
        error: 'Payment not completed yet',
        paymentStatus: session.payment_status || 'unknown'
      });
    }

    const result = await applyCheckoutSession(session);
    if (!result.applied) {
      return res.status(422).json({ error: 'Checkout metadata is incomplete' });
    }

    return res.json({
      success: true,
      tier: result.tier,
      durationMonths: result.durationMonths,
      source: 'confirm_endpoint'
    });
  } catch (err) {
    logError('stripe_confirm_checkout_error', err);
    return res.status(500).json({ error: 'Failed to confirm checkout session' });
  }
});

async function processWebhookEvent(event) {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    await applyCheckoutSession(session, { stripeEventId: event.id });

    return;
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;

    await Payment.findOneAndUpdate(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          stripeEventId: event.id,
          status: 'canceled',
          metadata: subscription
        }
      }
    );

    await User.findOneAndUpdate(
      { subscriptionId: subscription.id },
      {
        $set: {
          tier: 'normal',
          tierChangedAt: new Date(),
          subscriptionId: null,
          subscriptionStartAt: null,
          subscriptionEndAt: null,
          subscriptionDurationMonths: 0,
          renewalDate: null,
          canChangeAfter: null,
          autoRenew: false
        }
      }
    );
  }
}

async function webhookHandler(req, res) {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured' });
    }

    const signature = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      return res.status(400).json({ error: 'Missing Stripe webhook signature/secret' });
    }

    const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);

    const alreadyHandled = await Payment.findOne({ stripeEventId: event.id }).lean();
    if (alreadyHandled) {
      return res.json({ received: true, duplicate: true });
    }

    await processWebhookEvent(event);

    return res.json({ received: true });
  } catch (err) {
    logError('stripe_webhook_error', err);
    return res.status(400).json({ error: 'Webhook verification failed' });
  }
}

module.exports = {
  router,
  webhookHandler
};

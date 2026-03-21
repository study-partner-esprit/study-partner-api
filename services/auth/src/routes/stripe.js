const express = require('express');
const Joi = require('joi');
const Stripe = require('stripe');
const { authenticate } = require('@study-partner/shared/auth');
const User = require('../models/User');
const Payment = require('../models/Payment');

const router = express.Router();

const subscriptionSchema = Joi.object({
  tier: Joi.string().valid('vip', 'vip_plus').required(),
  successPath: Joi.string().optional().allow(''),
  cancelPath: Joi.string().optional().allow('')
});

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;

function logError(label, err) {
  const message = err && err.message ? err.message : String(err);
  process.stderr.write(`[stripe] ${label}: ${message}\n`);
}

function getPriceIdByTier(tier) {
  if (tier === 'vip') return process.env.STRIPE_PRICE_ID_VIP;
  if (tier === 'vip_plus') return process.env.STRIPE_PRICE_ID_VIP_PLUS;
  return null;
}

function getFrontendBaseUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
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

    const priceId = getPriceIdByTier(value.tier);
    if (!priceId) {
      return res.status(500).json({ error: `Missing Stripe price ID for tier: ${value.tier}` });
    }

    const customerId = await upsertCustomer(user);
    const frontendBase = getFrontendBaseUrl();
    const successPath = value.successPath || '/checkout/success';
    const cancelPath = value.cancelPath || '/checkout/cancel';

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: `${frontendBase}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBase}${cancelPath}`,
      metadata: {
        userId: String(user._id),
        tier: value.tier
      }
    });

    await Payment.create({
      userId: user._id,
      stripeCheckoutSessionId: checkoutSession.id,
      stripeCustomerId: customerId,
      tier: value.tier,
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
      stripeCustomerId: user.stripeCustomerId || null
    });
  } catch (err) {
    logError('stripe_subscription_status_error', err);
    return res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

async function processWebhookEvent(event) {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const targetTier = session.metadata?.tier;

    if (!userId || !targetTier) {
      return;
    }

    await Payment.findOneAndUpdate(
      { stripeCheckoutSessionId: session.id },
      {
        $set: {
          stripeEventId: event.id,
          stripeSubscriptionId: session.subscription || null,
          stripeCustomerId: session.customer || null,
          amount: session.amount_total ?? null,
          currency: session.currency || 'usd',
          status: 'succeeded',
          metadata: session
        }
      },
      { upsert: true }
    );

    await User.findByIdAndUpdate(userId, {
      $set: {
        tier: targetTier,
        tierChangedAt: new Date(),
        subscriptionId: session.subscription || null,
        stripeCustomerId: session.customer || null
      }
    });

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
          subscriptionId: null
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

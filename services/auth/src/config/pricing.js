const PRICING_PLANS = {
  vip: {
    monthlyPriceUsd: 9.99,
    monthlyPriceCents: 999
  },
  vip_plus: {
    monthlyPriceUsd: 19.99,
    monthlyPriceCents: 1999
  }
};

const MONTH_OPTIONS = [1, 3, 6, 12];

function getDiscountPercentage(durationMonths) {
  if (durationMonths >= 12) return 20;
  if (durationMonths >= 6) return 10;
  return 0;
}

function calculatePlanPrice(tier, durationMonths = 1) {
  const normalizedMonths = Number(durationMonths || 1);
  const plan = PRICING_PLANS[tier];

  if (!plan) {
    throw new Error(`Unsupported plan tier: ${tier}`);
  }

  if (!MONTH_OPTIONS.includes(normalizedMonths)) {
    throw new Error(`Unsupported durationMonths: ${normalizedMonths}`);
  }

  const discountPercentage = getDiscountPercentage(normalizedMonths);
  const baseAmountCents = plan.monthlyPriceCents * normalizedMonths;
  const discountAmountCents = Math.round((baseAmountCents * discountPercentage) / 100);
  const finalAmountCents = baseAmountCents - discountAmountCents;

  return {
    monthlyPriceCents: plan.monthlyPriceCents,
    monthlyPriceUsd: plan.monthlyPriceUsd,
    durationMonths: normalizedMonths,
    discountPercentage,
    baseAmountCents,
    discountAmountCents,
    finalAmountCents
  };
}

module.exports = {
  PRICING_PLANS,
  MONTH_OPTIONS,
  getDiscountPercentage,
  calculatePlanPrice
};

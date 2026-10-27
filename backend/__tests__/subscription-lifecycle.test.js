/**
 * Subscription lifecycle — the rules, tested without a database.
 *
 * Two things are being pinned here:
 *
 *  1. Money. Prices are paise integers, GST is additive, and the annual price
 *     is exactly ten monthly prices. A pricing bug is the kind that is
 *     invisible until a café is overcharged, so the arithmetic is asserted
 *     rather than assumed.
 *
 *  2. The ladder: trialing -> active -> grace -> degraded -> terminated, with
 *     the entitlements that come with each state. `computeAccess` is a pure
 *     function of (row, now) precisely so this is testable without a clock or
 *     a sweeper — pass a `now` and the answer is exact.
 */

const {
  quote,
  publicCatalogue,
  GST_RATE,
  ANNUAL_MONTHS,
  FREE_TRIAL_DAYS,
  GRACE_DAYS,
  FEATURES,
  CORE_FEATURES,
  PLANS,
  addDays,
  addMonths,
} = require('../src/config/plans');

const {
  computeAccess,
  hasFeature,
  paidUntilFor,
  SUBSCRIPTION_STATUS,
} = require('../src/services/subscriptionService');

const { TRIALING, ACTIVE, GRACE, DEGRADED, CANCELLED, TERMINATED } = SUBSCRIPTION_STATUS;

const T0 = new Date('2026-06-01T00:00:00.000Z');
const day = (n) => new Date(T0.getTime() + n * 86400000);

describe('plan catalogue — money', () => {
  it('prices Starter monthly, pre-GST and with GST', () => {
    const q = quote({ planKey: 'starter', cycle: 'monthly', outlets: 1 });

    expect(q.subtotalPaise).toBe(34900); // ₹349.00
    expect(q.gstPaise).toBe(Math.round(34900 * GST_RATE));
    expect(q.totalPaise).toBe(34900 + q.gstPaise);
    expect(q.totalRupees).toBeCloseTo(411.82, 2);
    expect(q.currency).toBe('INR');
  });

  it('charges GST on top, never inside, the listed price', () => {
    const q = quote({ planKey: 'growth', cycle: 'monthly', outlets: 1 });
    expect(q.subtotalRupees).toBe(499);
    expect(q.gstRate).toBe(0.18);
    expect(q.totalRupees).toBeGreaterThan(q.subtotalRupees);
  });

  it('prices an annual plan at exactly ten monthly prices', () => {
    for (const key of ['starter', 'growth', 'pro']) {
      expect(PLANS[key].annualPaise).toBe(PLANS[key].monthlyPaise * ANNUAL_MONTHS);
      expect(PLANS[key].annualPaise).toBeLessThan(PLANS[key].monthlyPaise * 12);
    }
  });

  it('bundles one outlet and charges per outlet beyond it', () => {
    const one = quote({ planKey: 'starter', cycle: 'monthly', outlets: 1 });
    const two = quote({ planKey: 'starter', cycle: 'monthly', outlets: 2 });
    const three = quote({ planKey: 'starter', cycle: 'monthly', outlets: 3 });

    expect(one.extraOutlets).toBe(0);
    expect(two.extraOutlets).toBe(1);
    expect(three.extraOutlets).toBe(2);
    expect(two.subtotalPaise).toBe(34900 + 14900);
    expect(three.subtotalPaise).toBe(34900 + 2 * 14900);
  });

  it('applies the same two-months-free discount to extra outlets', () => {
    const monthly = quote({ planKey: 'starter', cycle: 'monthly', outlets: 3 });
    const annual = quote({ planKey: 'starter', cycle: 'annual', outlets: 3 });

    expect(monthly.subtotalPaise * ANNUAL_MONTHS).toBe(annual.subtotalPaise);
  });

  it('orders tiers by price and marks the trial as the only free plan', () => {
    const keys = Object.values(PLANS).sort((a, b) => a.order - b.order).map((p) => p.key);
    expect(keys).toEqual(['trial', 'starter', 'growth', 'pro']);
    expect(Object.values(PLANS).filter((p) => !p.isPaid).map((p) => p.key)).toEqual(['trial']);
  });

  it('gives the trial every feature, bounded by time rather than capability', () => {
    expect(PLANS.trial.features.sort()).toEqual(Object.values(FEATURES).sort());
    expect(PLANS.starter.features).not.toContain(FEATURES.LOYALTY);
  });

  it('falls back to a sane outlet count instead of pricing nonsense', () => {
    expect(quote({ planKey: 'growth', outlets: 0 }).outlets).toBe(1);
    expect(quote({ planKey: 'growth', outlets: -5 }).outlets).toBe(1);
    expect(quote({ planKey: 'growth', outlets: 'abc' }).outlets).toBe(1);
    expect(quote({ planKey: 'growth', outlets: 2.7 }).outlets).toBe(2);
  });

  it('quotes the free trial at zero', () => {
    const q = quote({ planKey: 'trial', cycle: 'monthly', outlets: 1 });
    expect(q.subtotalPaise).toBe(0);
    expect(q.totalPaise).toBe(0);
  });

  it('publishes a catalogue with an all-in figure for the pricing page', () => {
    const cat = publicCatalogue();
    const starter = cat.find((p) => p.key === 'starter');
    expect(starter.monthly.rupees).toBe(349);
    expect(starter.monthly.withGstRupees).toBeCloseTo(411.82, 2);
    // 12 monthly prices (4188) less the annual price (3490) = 698 rupees.
    expect(starter.annualSavingsRupees).toBeCloseTo(698, 2);
    expect(cat.find((p) => p.key === 'trial').trialDays).toBe(FREE_TRIAL_DAYS);
  });
});

describe('plan catalogue — date arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays(new Date('2026-01-30T00:00:00.000Z'), 3).toISOString()).toBe(
      '2026-02-02T00:00:00.000Z'
    );
  });

  it('clamps to the last valid day instead of overflowing into the next month', () => {
    // setUTCMonth would land this on 2/3 March.
    expect(addMonths(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z'
    );
  });

  it('handles a leap year', () => {
    expect(addMonths(new Date('2028-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z'
    );
  });

  it('adds a full year for an annual period', () => {
    expect(addMonths(new Date('2026-06-01T00:00:00.000Z'), 12).toISOString()).toBe(
      '2027-06-01T00:00:00.000Z'
    );
  });
});

const activeGrowth = (overrides = {}) => ({
  planKey: 'growth',
  cycle: 'monthly',
  status: ACTIVE,
  outlets: 1,
  trialEndsAt: null,
  currentPeriodStart: day(-30),
  currentPeriodEnd: day(0),
  ...overrides,
});

describe('computeAccess — the expiry ladder', () => {
  it('is active right up to the end of the paid period', () => {
    const access = computeAccess(activeGrowth(), new Date(day(-1)));
    expect(access.status).toBe(ACTIVE);
    expect(access.isActive).toBe(true);
    expect(hasFeature(access, FEATURES.LOYALTY)).toBe(true);
  });

  it('treats the period-end instant as inclusive, then enters grace', () => {
    // The boundary instant itself still counts as paid. One millisecond later
    // the tenant is in grace.
    expect(computeAccess(activeGrowth(), new Date(day(0))).status).toBe(ACTIVE);

    const access = computeAccess(activeGrowth(), new Date(day(0).getTime() + 1));
    expect(access.status).toBe(GRACE);
    expect(access.inGrace).toBe(true);
    // Still fully entitled: a late webhook may yet succeed.
    expect(hasFeature(access, FEATURES.LOYALTY)).toBe(true);
    expect(hasFeature(access, FEATURES.ANALYTICS)).toBe(true);
  });

  it('counts the grace days down', () => {
    const access = computeAccess(activeGrowth(), new Date(day(3)));
    expect(access.status).toBe(GRACE);
    expect(access.graceDaysRemaining).toBe(GRACE_DAYS - 3);
  });

  it('degrades once grace is exhausted, keeping the counter working', () => {
    const access = computeAccess(activeGrowth(), new Date(day(GRACE_DAYS + 1)));
    expect(access.status).toBe(DEGRADED);
    expect(access.isDegraded).toBe(true);

    // The café can still take orders and settle bills.
    for (const core of CORE_FEATURES) {
      expect(hasFeature(access, core)).toBe(true);
    }
    // Paid modules are locked.
    expect(hasFeature(access, FEATURES.LOYALTY)).toBe(false);
    expect(hasFeature(access, FEATURES.ANALYTICS)).toBe(false);
    expect(hasFeature(access, FEATURES.INVOICES)).toBe(false);
  });

  it('degrades on the first instant past the grace window', () => {
    expect(computeAccess(activeGrowth(), new Date(day(GRACE_DAYS))).status).toBe(GRACE);
    expect(computeAccess(activeGrowth(), new Date(day(GRACE_DAYS + 1))).status).toBe(DEGRADED);
  });

  it('treats a trial that has run out exactly like a lapsed paid period', () => {
    const trialing = {
      planKey: 'trial',
      cycle: 'monthly',
      status: TRIALING,
      outlets: 1,
      trialEndsAt: day(0),
      currentPeriodEnd: day(0),
    };

    expect(computeAccess(trialing, new Date(day(-1))).status).toBe(TRIALING);
    expect(computeAccess(trialing, new Date(day(0))).status).toBe(TRIALING);
    expect(computeAccess(trialing, new Date(day(0).getTime() + 1)).status).toBe(GRACE);
    expect(computeAccess(trialing, new Date(day(GRACE_DAYS + 1))).status).toBe(DEGRADED);
  });

  it('gives a running trial every feature', () => {
    const access = computeAccess(
      { planKey: 'trial', status: TRIALING, outlets: 1, trialEndsAt: day(10) },
      T0
    );
    expect(access.status).toBe(TRIALING);
    expect(access.allowedFeatures.sort()).toEqual(Object.values(FEATURES).sort());
  });

  it('reports the trial countdown', () => {
    const access = computeAccess(
      { planKey: 'trial', status: TRIALING, outlets: 1, trialEndsAt: day(10) },
      T0
    );
    expect(access.daysUntilPaidUntil).toBe(10);
    expect(FREE_TRIAL_DAYS).toBe(14);
  });
});

describe('computeAccess — terminal states', () => {
  it('locks everything when terminated', () => {
    const access = computeAccess(
      activeGrowth({ status: TERMINATED, terminatedAt: day(1), terminationReason: 'abuse' }),
      T0
    );
    expect(access.isTerminated).toBe(true);
    expect(access.allowedFeatures).toEqual([]);
    expect(hasFeature(access, FEATURES.POS)).toBe(false);
  });

  it('keeps a terminated tenant terminated even when its dates say paid', () => {
    // The whole point of termination: no renewal webhook can quietly un-ban it.
    const access = computeAccess(
      activeGrowth({ status: TERMINATED, currentPeriodEnd: day(365) }),
      T0
    );
    expect(access.isTerminated).toBe(true);
    expect(access.allowedFeatures).toEqual([]);
  });

  it('keeps only core features after a cancellation', () => {
    const access = computeAccess(activeGrowth({ status: CANCELLED }), T0);
    expect(access.isCancelled).toBe(true);
    expect(hasFeature(access, FEATURES.POS)).toBe(true);
    expect(hasFeature(access, FEATURES.LOYALTY)).toBe(false);
  });
});

describe('computeAccess — fail closed', () => {
  it('degrades a tenant with no subscription row at all', () => {
    const access = computeAccess(null, T0);
    expect(access.status).toBe(DEGRADED);
    expect(hasFeature(access, FEATURES.LOYALTY)).toBe(false);
  });

  it('degrades a paid-plan row with no dates rather than granting access', () => {
    const access = computeAccess(
      { planKey: 'pro', status: ACTIVE, outlets: 1, currentPeriodEnd: null, trialEndsAt: null },
      T0
    );
    expect(access.status).toBe(DEGRADED);
    expect(hasFeature(access, FEATURES.DIGITIZATION)).toBe(false);
  });

  it('never reports a feature outside the known catalogue', () => {
    const access = computeAccess(activeGrowth(), T0);
    for (const f of access.allowedFeatures) {
      expect(Object.values(FEATURES)).toContain(f);
    }
  });
});

describe('paidUntilFor', () => {
  it('prefers the trial clock while trialling', () => {
    const sub = { status: TRIALING, trialEndsAt: day(5), currentPeriodEnd: day(99) };
    expect(paidUntilFor(sub)).toEqual(day(5));
  });

  it('uses the paid period once money has been taken', () => {
    const sub = { status: ACTIVE, trialEndsAt: day(5), currentPeriodEnd: day(99) };
    expect(paidUntilFor(sub)).toEqual(day(99));
  });

  it('is null when there is nothing to reason about', () => {
    expect(paidUntilFor(null)).toBeNull();
    expect(paidUntilFor({ status: ACTIVE })).toBeNull();
  });
});
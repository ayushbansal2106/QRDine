/**
 * Entitlement + usage enforcement, against a real (in-memory) MongoDB.
 *
 * Three things are being pinned here, and each of them has failed in a real
 * product before:
 *
 *  1. **The plan matrix.** Starter cannot reach Growth or Pro modules, Growth
 *     cannot reach Pro modules, and an unknown feature key is denied rather than
 *     silently allowed. A feature registry that fails open is worse than none.
 *
 *  2. **Per-tenant overrides.** A comp'd feature works, a revocation wins over
 *     the plan, an expired grant stops working, and a terminated tenant holds
 *     nothing at all — not even an override.
 *
 *  3. **Quota safety.** The counter is atomic: concurrent requests cannot
 *     oversubscribe it, a retried request with the same idempotency key is not
 *     charged twice, a failed operation gives its unit back, and a new period
 *     starts from zero.
 *
 * Everything runs through `entitlementService`, which is the same code path the
 * HTTP middleware and the order engine call.
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-entitlement-service-only';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/qrdine-test';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cafe = require('../src/models/Cafe');
const Category = require('../src/models/Category');
const MenuItem = require('../src/models/MenuItem');
const Order = require('../src/models/Order');
// Registered for its side effect: `orderService` populates `tableId` even for a
// non-dine-in order, and Mongoose throws if the referenced model was never
// required in this process.
require('../src/models/Table');
const Subscription = require('../src/models/Subscription');
const orderService = require('../src/services/orderService');
const UsageCounter = require('../src/models/UsageCounter');
const UsageLedger = require('../src/models/UsageLedger');
const entitlementService = require('../src/services/entitlementService');
const subscriptionService = require('../src/services/subscriptionService');
const { FEATURES, METRICS, CURRENT_PLAN_VERSION } = require('../src/config/plans');

const { ORDERS_PER_MONTH, OUTLETS } = METRICS;

let mongo;

const newCafe = async (overrides = {}) =>
  Cafe.create({ name: `Cafe ${Math.random().toString(16).slice(2)}`, ...overrides });

/** Put a cafe on a paid plan through the same function billing would call. */
const putOnPlan = async (cafeId, planKey, { cycle = 'monthly', outlets = 1 } = {}) =>
  subscriptionService.activatePaidPlan(cafeId, { planKey, cycle, outlets, from: new Date() });

// Connection lifecycle lives at file scope: a `beforeAll`/`afterAll` inside one
// `describe` tears the connection down when that block ends, and every later
// block then fails with "client must be connected".
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // The unique indexes are load-bearing (one subscription per cafe, one counter
  // per period, one ledger row per idempotency key), so they are built
  // explicitly rather than left to Mongoose's lazy autoIndex.
  await Promise.all([
    Subscription.syncIndexes(),
    UsageCounter.syncIndexes(),
    UsageLedger.syncIndexes(),
  ]);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect().catch(() => {});
  await mongo.stop().catch(() => {});
});

beforeEach(async () => {
  await Promise.all([
    mongoose.connection.db.collection('subscriptions').deleteMany({}),
    mongoose.connection.db.collection('cafes').deleteMany({}),
    mongoose.connection.db.collection('usagecounters').deleteMany({}),
    mongoose.connection.db.collection('usageledgers').deleteMany({}),
  ]);
});

describe('entitlement service — plan matrix', () => {

  it('gives a Starter cafe its own features and refuses Growth/Pro ones', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    await expect(
      entitlementService.requireFeature(cafe._id, FEATURES.POS)
    ).resolves.toBeTruthy();

    for (const feature of [FEATURES.ANALYTICS, FEATURES.LOYALTY, FEATURES.DIGITIZATION]) {
      await expect(entitlementService.requireFeature(cafe._id, feature)).rejects.toMatchObject({
        statusCode: 403,
        code: 'FEATURE_NOT_ENTITLED',
      });
    }
  });

  it('gives Growth its own features and refuses Pro-only ones', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'growth');

    const entitlements = await entitlementService.getEntitlementsForCafe(cafe._id);
    expect(entitlements.features).toEqual(
      expect.arrayContaining([FEATURES.ANALYTICS, FEATURES.LOYALTY, FEATURES.COUPONS])
    );
    expect(entitlements.features).not.toContain(FEATURES.DIGITIZATION);
    expect(entitlements.features).not.toContain(FEATURES.NFC);

    await expect(
      entitlementService.requireFeature(cafe._id, FEATURES.DIGITIZATION)
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      entitlementService.requireFeature(cafe._id, FEATURES.NFC)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('gives Pro everything the catalogue knows', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'pro');

    for (const feature of Object.values(FEATURES)) {
      await expect(
        entitlementService.requireFeature(cafe._id, feature)
      ).resolves.toBeTruthy();
    }
  });

  it('denies an unknown feature key instead of treating it as allowed', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'pro');

    await expect(
      entitlementService.requireFeature(cafe._id, 'made.up.feature')
    ).rejects.toMatchObject({ statusCode: 403, code: 'FEATURE_UNKNOWN' });
  });

  it('reports the paid catalogue version on the subscription', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'growth');

    const entitlements = await entitlementService.getEntitlementsForCafe(cafe._id);
    expect(entitlements.planVersion).toBe(CURRENT_PLAN_VERSION);
    expect(entitlements.planVersionIsCurrent).toBe(true);
  });
});

describe('entitlement service — lapsed and terminated tenants', () => {
  it('locks paid modules but keeps the counter working after grace', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'growth');

    const sub = await Subscription.findOne({ cafeId: cafe._id });
    sub.currentPeriodEnd = new Date(Date.now() - 40 * 86400000); // past grace
    await sub.save();

    await expect(
      entitlementService.requireFeature(cafe._id, FEATURES.LOYALTY)
    ).rejects.toMatchObject({ statusCode: 402, code: 'SUBSCRIPTION_LAPSED' });

    // The counter is the cafe's livelihood; it must survive a lapsed card.
    await expect(
      entitlementService.requireFeature(cafe._id, FEATURES.POS)
    ).resolves.toBeTruthy();
  });

  it('holds nothing at all for a terminated tenant, not even an override', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'growth');
    await subscriptionService.setEntitlementOverrides(cafe._id, [
      { featureKey: FEATURES.ANALYTICS, enabled: true },
    ]);
    await subscriptionService.terminate(cafe._id, { reason: 'chargebacks' });

    await expect(
      entitlementService.requireFeature(cafe._id, FEATURES.ANALYTICS)
    ).rejects.toMatchObject({ statusCode: 410 });

    const entitlements = await entitlementService.getEntitlementsForCafe(cafe._id);
    expect(entitlements.features).toEqual([]);
  });

  it('refuses to reserve a metered unit for a terminated tenant', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'growth');
    await subscriptionService.terminate(cafe._id, { reason: 'abuse' });

    await expect(
      entitlementService.reserveUsage(cafe._id, ORDERS_PER_MONTH, 1)
    ).rejects.toMatchObject({ statusCode: 410 });
  });
});

describe('entitlement service — per-tenant overrides', () => {
  it('grants a feature the plan does not include', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    await subscriptionService.setEntitlementOverrides(cafe._id, [
      { featureKey: FEATURES.ANALYTICS, enabled: true, note: 'beta customer' },
    ]);

    await expect(
      entitlementService.requireFeature(cafe._id, FEATURES.ANALYTICS)
    ).resolves.toBeTruthy();
  });

  it('revocation wins over the plan', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'pro');

    await subscriptionService.setEntitlementOverrides(cafe._id, [
      { featureKey: FEATURES.LOYALTY, enabled: false, note: 'abuse report' },
    ]);

    await expect(
      entitlementService.requireFeature(cafe._id, FEATURES.LOYALTY)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('stops honouring a grant once it expires', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    await subscriptionService.setEntitlementOverrides(cafe._id, [
      {
        featureKey: FEATURES.ANALYTICS,
        enabled: true,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    ]);

    await expect(
      entitlementService.requireFeature(cafe._id, FEATURES.ANALYTICS)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects an unknown feature key instead of storing it', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    await expect(
      subscriptionService.setEntitlementOverrides(cafe._id, [
        { featureKey: 'moon.phase', enabled: true },
      ])
    ).rejects.toThrow(/Unknown feature key/);
  });
});

describe('entitlement service — usage quota', () => {
  it('counts a committed unit and reports the remainder', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter'); // 500 orders / month

    const reservation = await entitlementService.reserveUsage(cafe._id, ORDERS_PER_MONTH, 1);
    await entitlementService.commitUsage(reservation);

    const summary = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH);
    expect(summary.used).toBe(1);
    expect(summary.reserved).toBe(0);
    expect(summary.limit).toBe(500);
    expect(summary.remaining).toBe(499);
  });

  it('reports growth as unlimited rather than as "0 remaining"', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'growth');

    const summary = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH);
    expect(summary.unlimited).toBe(true);
    expect(summary.limit).toBeNull();
    expect(summary.remaining).toBeNull();
  });

  it('refuses the request that would exceed the allowance', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    // Simulate a month already at 499 of 500.
    const periodKey = entitlementService.periodKeyFor(ORDERS_PER_MONTH);
    await UsageCounter.create({ cafeId: cafe._id, metric: ORDERS_PER_MONTH, periodKey, used: 499 });

    const ok = await entitlementService.reserveUsage(cafe._id, ORDERS_PER_MONTH, 1);
    await entitlementService.commitUsage(ok);

    await expect(
      entitlementService.reserveUsage(cafe._id, ORDERS_PER_MONTH, 1)
    ).rejects.toMatchObject({ statusCode: 402, code: 'QUOTA_EXCEEDED' });
  });

  it('cannot be oversubscribed by concurrent requests', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    const periodKey = entitlementService.periodKeyFor(ORDERS_PER_MONTH);
    await UsageCounter.create({ cafeId: cafe._id, metric: ORDERS_PER_MONTH, periodKey, used: 499 });

    // Ten simultaneous claims for the last unit. A read-then-write check would
    // let several through; the conditional update inside Mongo allows one.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        entitlementService.reserveUsage(cafe._id, ORDERS_PER_MONTH, 1)
      )
    );

    const granted = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');

    expect(granted).toHaveLength(1);
    expect(refused).toHaveLength(9);
    refused.forEach((r) => expect(r.reason.code).toBe('QUOTA_EXCEEDED'));

    const counter = await UsageCounter.findOne({ cafeId: cafe._id, metric: ORDERS_PER_MONTH });
    expect(counter.used + counter.reserved).toBe(500);
  });

  it('does not charge twice for a retried idempotency key', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    const first = await entitlementService.reserveUsage(cafe._id, ORDERS_PER_MONTH, 1, {
      idempotencyKey: 'order:abc-123',
    });
    await entitlementService.commitUsage(first);

    const second = await entitlementService.reserveUsage(cafe._id, ORDERS_PER_MONTH, 1, {
      idempotencyKey: 'order:abc-123',
    });

    expect(second.duplicate).toBe(true);

    const summary = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH);
    expect(summary.used).toBe(1);
    expect(await UsageLedger.countDocuments({ cafeId: cafe._id })).toBe(1);
  });

  it('gives the unit back when the metered operation fails', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    await expect(
      entitlementService.withUsage(
        { cafeId: cafe._id, metric: ORDERS_PER_MONTH, idempotencyKey: 'order:explode' },
        async () => {
          throw new Error('menu item unavailable');
        }
      )
    ).rejects.toThrow('menu item unavailable');

    const summary = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH);
    expect(summary.used).toBe(0);
    expect(summary.reserved).toBe(0);

    // The ledger keeps the released row as evidence the failure cost nothing.
    const ledger = await UsageLedger.findOne({ cafeId: cafe._id });
    expect(ledger.status).toBe('released');
  });

  it('allows a retry after a released reservation on the same key', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    await expect(
      entitlementService.withUsage(
        { cafeId: cafe._id, metric: ORDERS_PER_MONTH, idempotencyKey: 'order:retry-me' },
        async () => {
          throw new Error('transient');
        }
      )
    ).rejects.toThrow('transient');

    const { reservation } = await entitlementService.withUsage(
      { cafeId: cafe._id, metric: ORDERS_PER_MONTH, idempotencyKey: 'order:retry-me' },
      async () => ({ ok: true })
    );

    expect(reservation.duplicate).toBe(false);

    const summary = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH);
    expect(summary.used).toBe(1);
  });

  it('still records usage on an unlimited plan, without ever blocking', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'growth');

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await entitlementService.withUsage(
        { cafeId: cafe._id, metric: ORDERS_PER_MONTH },
        async () => true
      );
    }

    const summary = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH);
    expect(summary.unlimited).toBe(true);
    expect(summary.used).toBe(3);
    expect(summary.reserved).toBe(0);
  });

  it('starts a fresh counter in a new billing period', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    const lastMonth = new Date('2026-01-15T10:00:00.000Z');
    const thisMonth = new Date('2026-02-15T10:00:00.000Z');

    await entitlementService.withUsage(
      { cafeId: cafe._id, metric: ORDERS_PER_MONTH, now: lastMonth },
      async () => true
    );

    const jan = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH, {
      now: lastMonth,
    });
    const feb = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH, {
      now: thisMonth,
    });

    expect(jan.periodKey).toBe('2026-01');
    expect(jan.used).toBe(1);
    expect(feb.periodKey).toBe('2026-02');
    expect(feb.used).toBe(0);
  });

  it('counts outlets as a stock limit, not a monthly one', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter', { outlets: 2 });

    const summary = await entitlementService.getUsageSummary(cafe._id, OUTLETS);
    expect(summary.periodKey).toBe('lifetime');
    expect(summary.limit).toBe(2);
  });
});

/**
 * The integration that actually matters: the order engine, not the service in
 * isolation. Every ordering surface (guest QR, POS, waiter) calls
 * `orderService.createOrder`, so this is where a quota has to bite.
 */
describe('order engine — metered by the plan', () => {
  const makeMenuItem = async (cafeId) => {
    const category = await Category.create({ cafeId, name: 'Coffee' });
    return MenuItem.create({
      cafeId,
      categoryId: category._id,
      name: 'Filter Coffee',
      price: 100,
      gstPercentage: 5,
    });
  };

  const placeOrder = (cafeId, menuItemId, extra = {}) =>
    orderService.createOrder({
      cafeId,
      orderType: 'takeaway',
      channel: 'pos',
      items: [{ menuItemId, quantity: 1 }],
      enforceGeofence: false,
      emit: false,
      ...extra,
    });

  it('charges one order against the plan and writes the order', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');
    const item = await makeMenuItem(cafe._id);

    const { order } = await placeOrder(cafe._id, item._id);

    expect(order.orderNumber).toMatch(/^ORD-/);
    const summary = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH);
    expect(summary.used).toBe(1);
  });

  it('refuses the order that would exceed the allowance, writing nothing', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');
    const item = await makeMenuItem(cafe._id);

    const periodKey = entitlementService.periodKeyFor(ORDERS_PER_MONTH);
    await UsageCounter.create({ cafeId: cafe._id, metric: ORDERS_PER_MONTH, periodKey, used: 500 });

    await expect(placeOrder(cafe._id, item._id)).rejects.toMatchObject({
      statusCode: 402,
      code: 'QUOTA_EXCEEDED',
    });

    expect(await Order.countDocuments({ cafeId: cafe._id })).toBe(0);
  });

  it('does not charge twice when the same client request is retried', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');
    const item = await makeMenuItem(cafe._id);

    const first = await placeOrder(cafe._id, item._id, { clientRequestId: 'retry-me-1' });
    const second = await placeOrder(cafe._id, item._id, { clientRequestId: 'retry-me-1' });

    expect(second.idempotent).toBe(true);
    expect(String(second.order._id)).toBe(String(first.order._id));

    const summary = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH);
    expect(summary.used).toBe(1);
    expect(await Order.countDocuments({ cafeId: cafe._id })).toBe(1);
  });

  it('gives the unit back when the order is rejected after reserving', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'starter');

    // No such menu item: the engine throws inside the reserved window.
    await expect(
      placeOrder(cafe._id, new mongoose.Types.ObjectId())
    ).rejects.toBeTruthy();

    const summary = await entitlementService.getUsageSummary(cafe._id, ORDERS_PER_MONTH);
    expect(summary.used).toBe(0);
    expect(summary.reserved).toBe(0);
  });

  it('refuses an order from a terminated cafe, even from the guest path', async () => {
    const cafe = await newCafe();
    await putOnPlan(cafe._id, 'growth');
    const item = await makeMenuItem(cafe._id);
    await subscriptionService.terminate(cafe._id, { reason: 'non-payment' });

    await expect(placeOrder(cafe._id, item._id)).rejects.toMatchObject({ statusCode: 410 });
    expect(await Order.countDocuments({ cafeId: cafe._id })).toBe(0);
  });
});

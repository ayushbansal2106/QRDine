/**
 * Subscription service against a real (in-memory) MongoDB.
 *
 * `subscription-lifecycle.test.js` covers the rules as pure functions. This
 * file covers everything that only breaks with a real schema behind it: the
 * unique index on cafeId, the trial row written during signup's transaction,
 * and the save-path bugs (clearing a field, resetting a status) that a mock
 * would happily accept.
 */

'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';

const Subscription = require('../src/models/Subscription');
const Cafe = require('../src/models/Cafe');
const service = require('../src/services/subscriptionService');
const { FREE_TRIAL_DAYS } = require('../src/config/plans');

const { TERMINATED, DEGRADED, TRIALING, ACTIVE } = Subscription.SUBSCRIPTION_STATUS;

describe('subscription service — persistence', () => {
  let mongo;
  let uri;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    uri = mongo.getUri();
    await mongoose.connect(uri);
    // Build indexes explicitly. `dropDatabase()` in a beforeEach (used to be
    // here) also drops indexes, and Mongoose only builds them once at model
    // init — so after the first test the unique cafeId index was silently gone
    // and the concurrency test below proved nothing.
    await Subscription.syncIndexes();
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongo.stop().catch(() => {});
  });

  beforeEach(async () => {
    // Clear rows without dropping the collection, so indexes survive.
    await mongoose.connection.db.collection('subscriptions').deleteMany({});
    await mongoose.connection.db.collection('cafes').deleteMany({});
  });

  const newCafe = async (overrides = {}) =>
    Cafe.create({ name: `Cafe ${Math.random().toString(16).slice(2)}`, ...overrides });

  it('creates a 14-day trial the first time it is asked for', async () => {
    const cafe = await newCafe();
    const sub = await service.ensureSubscription(cafe._id);

    expect(sub.planKey).toBe('trial');
    expect(sub.status).toBe(TRIALING);
    expect(sub.outlets).toBe(1);
    expect(sub.trialEndsAt).toBeInstanceOf(Date);

    const days = Math.round((sub.trialEndsAt - Date.now()) / 86400000);
    expect(days).toBe(FREE_TRIAL_DAYS);
  });

  it('is idempotent — asking twice returns the same row', async () => {
    const cafe = await newCafe();
    const first = await service.ensureSubscription(cafe._id);
    const second = await service.ensureSubscription(cafe._id);

    expect(String(second._id)).toBe(String(first._id));
    expect(await Subscription.countDocuments({ cafeId: cafe._id })).toBe(1);
  });

  it('has a unique index on cafeId', async () => {
    const indexes = await Subscription.collection.indexes();
    const cafeIdIndex = indexes.find((i) => i.key && i.key.cafeId === 1);
    expect(cafeIdIndex).toBeDefined();
    expect(cafeIdIndex.unique).toBe(true);
  });

  it('never creates two subscriptions for one cafe, even concurrently', async () => {
    const cafe = await newCafe();

    // Ten simultaneous signups for the same tenant. The unique index on cafeId
    // is what makes this safe; without it this would create ten billable rows.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.ensureSubscription(cafe._id))
    );

    const ids = new Set(results.map((r) => String(r._id)));
    expect(ids.size).toBe(1);
    expect(await Subscription.countDocuments({ cafeId: cafe._id })).toBe(1);
  });

  it('gives a brand new cafe full trial entitlements', async () => {
    const cafe = await newCafe();
    const { access } = await service.getAccessForCafe(cafe._id);

    expect(access.status).toBe(TRIALING);
    expect(access.isPayable).toBe(true);
    expect(access.allowedFeatures).toContain('loyalty');
  });

  it('activates a paid plan and ends the trial clock', async () => {
    const cafe = await newCafe();
    await service.ensureSubscription(cafe._id);

    const sub = await service.activatePaidPlan(cafe._id, {
      planKey: 'growth',
      cycle: 'monthly',
      outlets: 1,
    });

    // Money was taken, so the trial must not also be honoured.
    expect(sub.trialEndsAt).toBeNull();
    expect(sub.status).toBe(ACTIVE);
    expect(sub.lastChargedPaise).toBe(49900);
    expect(sub.lastChargedGstPaise).toBeGreaterThan(0);

    const { access } = await service.getAccessForCafe(cafe._id);
    expect(access.status).toBe('active');
    expect(access.isTrialing).toBe(false);
    expect(access.outletLimit).toBe(1);
  });

  it('anchors an annual period to twelve months from payment, not to today', async () => {
    const cafe = await newCafe();
    const from = new Date('2026-06-01T00:00:00.000Z');

    const sub = await service.activatePaidPlan(cafe._id, {
      planKey: 'pro',
      cycle: 'annual',
      from,
    });

    expect(sub.currentPeriodStart.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(sub.currentPeriodEnd.toISOString()).toBe('2027-06-01T00:00:00.000Z');
    expect(sub.lastChargedPaise).toBe(649000);
  });

  it('refuses an unknown plan rather than silently defaulting', async () => {
    const cafe = await newCafe();
    await expect(
      service.activatePaidPlan(cafe._id, { planKey: 'platinum' })
    ).rejects.toThrow(/Unknown plan/);
  });

  it('keeps service until the period ends when a tenant cancels', async () => {
    const cafe = await newCafe();
    await service.activatePaidPlan(cafe._id, { planKey: 'growth' });

    const sub = await service.scheduleCancellation(cafe._id);
    expect(sub.cancelAtPeriodEnd).toBe(true);

    const { access } = await service.getAccessForCafe(cafe._id);
    // Paid through the end of the period, so nothing is lost yet.
    expect(access.status).toBe('active');
    expect(access.allowedFeatures).toContain('loyalty');
  });

  it('restores a cancelled tenant that changes its mind', async () => {
    const cafe = await newCafe();
    await service.activatePaidPlan(cafe._id, { planKey: 'growth' });
    await service.scheduleCancellation(cafe._id);

    const sub = await service.resumeSubscription(cafe._id);
    expect(sub.cancelAtPeriodEnd).toBe(false);
    expect(sub.cancelledAt).toBeNull();
  });

  it('locks everything on termination, with a reason', async () => {
    const cafe = await newCafe();
    await service.activatePaidPlan(cafe._id, { planKey: 'pro' });

    await service.terminate(cafe._id, { reason: 'chargeback fraud' });

    const { access } = await service.getAccessForCafe(cafe._id);
    expect(access.isTerminated).toBe(true);
    expect(access.allowedFeatures).toEqual([]);

    const stored = await Subscription.findOne({ cafeId: cafe._id });
    expect(stored.status).toBe(TERMINATED);
    expect(stored.terminationReason).toBe('chargeback fraud');
    expect(stored.terminatedAt).toBeInstanceOf(Date);
  });

  it('does not let a later payment reopen a terminated tenant', async () => {
    const cafe = await newCafe();
    await service.terminate(cafe._id, { reason: 'abuse' });

    // Someone pays again. The ban must survive it.
    await service.activatePaidPlan(cafe._id, { planKey: 'pro' });

    const { access } = await service.getAccessForCafe(cafe._id);
    expect(access.isTerminated).toBe(true);
    expect(access.allowedFeatures).toEqual([]);
  });

  it('reinstates a terminated tenant when a human says so', async () => {
    const cafe = await newCafe();
    await service.terminate(cafe._id, { reason: 'mistake' });
    await service.activatePaidPlan(cafe._id, { planKey: 'growth' });

    await service.reinstate(cafe._id);

    const { access } = await service.getAccessForCafe(cafe._id);
    expect(access.isTerminated).toBe(false);
    expect(access.status).toBe('active');
    expect(access.allowedFeatures).toContain('loyalty');
  });

  it('degrades a tenant whose paid period ended in the past', async () => {
    const cafe = await newCafe();
    // 60 days ago: a monthly period ended 30 days ago, well past the grace window.
    const longAgo = new Date(Date.now() - 60 * 86400000);

    await service.activatePaidPlan(cafe._id, { planKey: 'pro', from: longAgo });

    const { access } = await service.getAccessForCafe(cafe._id);
    expect(access.status).toBe(DEGRADED);
    expect(access.allowedFeatures.sort()).toEqual(['kds', 'pos']);
  });

  it('finds tenants due to expire, without pulling in terminated ones', async () => {
    const endingSoon = await newCafe();
    const endingLater = await newCafe();
    const banned = await newCafe();

    // Period ends ~6 days out, i.e. inside the 7-day notice window.
    await service.activatePaidPlan(endingSoon._id, {
      planKey: 'starter',
      from: new Date(Date.now() - 24 * 86400000),
    });
    await service.activatePaidPlan(endingLater._id, {
      planKey: 'starter',
      from: new Date(Date.now() + 200 * 86400000),
    });
    await service.terminate(banned._id, { reason: 'abuse' });

    const expiring = await service.findExpiring({ withinDays: 7 });
    const ids = expiring.map((s) => String(s.cafeId));

    expect(ids).toContain(String(endingSoon._id));
    expect(ids).not.toContain(String(endingLater._id));
    expect(ids).not.toContain(String(banned._id));
  });

  it('counts paid outlets, not plan flags', async () => {
    const cafe = await newCafe();
    const sub = await service.activatePaidPlan(cafe._id, {
      planKey: 'starter',
      cycle: 'annual',
      outlets: 3,
    });

    expect(sub.outlets).toBe(3);
    // 3490 + 2 extra outlets × 149 × 10 months
    expect(sub.lastChargedPaise).toBe(349000 + 2 * 149000);
  });
});
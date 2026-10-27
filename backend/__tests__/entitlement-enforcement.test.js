/**
 * Plan enforcement over real HTTP, with a real database.
 *
 * The point of this file is the attack the UI cannot stop: a valid token and a
 * hand-written request. Every test builds the same thing a customer's browser
 * builds — a JWT in an Authorization header — and then asks for something the
 * cafe has not paid for.
 *
 * What must hold:
 *   - unauthenticated  => 401
 *   - Starter asks for a Growth module => 403, from the route itself, with the
 *     controller never reached
 *   - the plan named by the client (query string, header, body) is ignored
 *   - another cafe's paid plan does not leak across tenants
 *   - a terminated tenant => 410 everywhere
 *   - a lapsed tenant => 402 for paid modules, but the counter still works
 *
 * A bare Express app is used instead of `src/app.js`: requiring the full app
 * starts background sweepers that keep the Jest event loop alive.
 */

'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-for-entitlement-enforcement-only';
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/qrdine-test';

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cafe = require('../src/models/Cafe');
const User = require('../src/models/User');
const Subscription = require('../src/models/Subscription');
const SuperAdmin = require('../src/models/SuperAdmin');
const analyticsRoutes = require('../src/routes/analyticsRoutes');
const couponRoutes = require('../src/routes/couponRoutes');
const subscriptionRoutes = require('../src/routes/subscriptionRoutes');
const superAdminRoutes = require('../src/routes/superAdminRoutes');
const subscriptionService = require('../src/services/subscriptionService');
const entitlementService = require('../src/services/entitlementService');
const { errorHandler, notFound } = require('../src/middlewares/errorMiddleware');
const { FEATURES } = require('../src/config/plans');

let mongo;
let app;

/** Double-submit CSRF value: header must equal the `csrf_token` cookie. */
const CSRF = 'a'.repeat(64);

const buildApp = () => {
  const instance = express();
  instance.use(express.json());
  instance.use(cookieParser());
  instance.use('/api/analytics', analyticsRoutes);
  instance.use('/api/coupons', couponRoutes);
  instance.use('/api/subscription', subscriptionRoutes);
  instance.use('/api/superadmin', superAdminRoutes);
  instance.use(notFound);
  instance.use(errorHandler);
  return instance;
};

const tokenFor = (user) =>
  jwt.sign({ id: String(user._id), cafeId: String(user.cafeId), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });

/** A cafe + its owner, on `planKey` (or still on the new-cafe trial). */
const makeTenant = async ({ planKey = null, email } = {}) => {
  const cafe = await Cafe.create({
    name: `Cafe ${Math.random().toString(16).slice(2)}`,
    email: email ? `${email}.cafe@example.com` : '',
  });

  const user = await User.create({
    cafeId: cafe._id,
    name: 'Owner',
    email: email || `owner-${Math.random().toString(16).slice(2)}@example.com`,
    password: 'not-used-in-these-tests',
    role: 'owner',
  });

  if (planKey) {
    await subscriptionService.activatePaidPlan(cafe._id, {
      planKey,
      cycle: 'monthly',
      outlets: 1,
      from: new Date(),
    });
  }

  return { cafe, user, token: tokenFor(user) };
};

const get = (path, token, extra = {}) => {
  const req = request(app).get(path).set('cookie', `csrf_token=${CSRF}`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  for (const [key, value] of Object.entries(extra)) req.set(key, value);
  return req;
};

describe('plan enforcement over HTTP', () => {
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([Subscription.syncIndexes()]);
    app = buildApp();
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongo.stop().catch(() => {});
  });

  beforeEach(async () => {
    await Promise.all([
      mongoose.connection.db.collection('cafes').deleteMany({}),
      mongoose.connection.db.collection('users').deleteMany({}),
      mongoose.connection.db.collection('subscriptions').deleteMany({}),
    ]);
  });

  it('rejects an unauthenticated request before any plan logic runs', async () => {
    const res = await get('/api/analytics/overview');
    expect(res.status).toBe(401);
  });

  it('refuses a Starter cafe that calls the analytics API directly', async () => {
    const { token } = await makeTenant({ planKey: 'starter' });

    const res = await get('/api/analytics/overview', token);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_NOT_ENTITLED');
    // The controller never ran: no analytics payload, and no tenant data leaked
    // alongside the refusal.
    expect(res.body.overview).toBeUndefined();
  });

  it('serves the same endpoint to a Growth cafe', async () => {
    const { token } = await makeTenant({ planKey: 'growth' });

    const res = await get('/api/analytics/overview', token);

    // 200 with a payload, or a 4xx from the report itself (e.g. no orders yet) —
    // either way it must not be the entitlement gate.
    expect(res.body.code).not.toBe('FEATURE_NOT_ENTITLED');
    expect([200, 400, 404]).toContain(res.status);
  });

  it('keeps live operational telemetry on Starter, gating only the reports', async () => {
    const { token } = await makeTenant({ planKey: 'starter' });

    // Today's revenue / active tickets are how the floor runs, not a report, so
    // the dashboard tile must not read "unavailable" on the entry plan.
    const live = await get('/api/analytics/live', token);
    expect(live.status).toBe(200);
    expect(live.body.telemetry).toBeDefined();

    // The reporting endpoints stay entitled.
    expect((await get('/api/analytics/overview', token)).status).toBe(403);
  });

  it('ignores a plan name supplied by the client', async () => {
    const { token } = await makeTenant({ planKey: 'starter' });

    const res = await get('/api/analytics/overview?planKey=pro&plan=pro&features=analytics', token, {
      'x-plan': 'pro',
      'x-features': 'analytics,loyalty,digitization',
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_NOT_ENTITLED');
  });

  it('does not let another cafe’s plan leak across tenants', async () => {
    const starter = await makeTenant({ planKey: 'starter', email: 'starter@example.com' });
    const growth = await makeTenant({ planKey: 'growth', email: 'growth@example.com' });

    expect((await get('/api/analytics/overview', growth.token)).status).not.toBe(403);
    expect((await get('/api/analytics/overview', starter.token)).status).toBe(403);

    // Each tenant's entitlements are resolved from its own row.
    const starterEnt = await entitlementService.getEntitlementsForCafe(starter.cafe._id);
    const growthEnt = await entitlementService.getEntitlementsForCafe(growth.cafe._id);
    expect(starterEnt.features).not.toContain(FEATURES.ANALYTICS);
    expect(growthEnt.features).toContain(FEATURES.ANALYTICS);
  });

  it('gates a write module too (coupons), not just reporting', async () => {
    const { token } = await makeTenant({ planKey: 'starter' });

    const res = await get('/api/coupons', token);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_NOT_ENTITLED');
  });

  it('locks a terminated tenant out with 410', async () => {
    const { cafe, token } = await makeTenant({ planKey: 'pro' });
    await subscriptionService.terminate(cafe._id, { reason: 'chargeback abuse' });

    const res = await get('/api/analytics/overview', token);

    expect(res.status).toBe(410);
  });

  it('answers 402 for a paid module once the subscription has lapsed', async () => {
    const { cafe, token } = await makeTenant({ planKey: 'growth' });

    const sub = await Subscription.findOne({ cafeId: cafe._id });
    sub.currentPeriodEnd = new Date(Date.now() - 40 * 86400000);
    await sub.save();

    const res = await get('/api/analytics/overview', token);

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_LAPSED');
  });

  it('still serves the counter to a lapsed cafe (POS stays core)', async () => {
    const { cafe, token } = await makeTenant({ planKey: 'growth' });

    const sub = await Subscription.findOne({ cafeId: cafe._id });
    sub.currentPeriodEnd = new Date(Date.now() - 40 * 86400000);
    await sub.save();

    // `/api/subscription/entitlements` is available to every authenticated
    // tenant, and reports the retained core set rather than an empty plan.
    const res = await get('/api/subscription/entitlements', token);

    expect(res.status).toBe(200);
    expect(res.body.entitlements.isDegraded).toBe(true);
    expect(res.body.entitlements.features).toEqual(expect.arrayContaining([FEATURES.POS, FEATURES.KDS]));
    expect(res.body.entitlements.features).not.toContain(FEATURES.ANALYTICS);
  });

  it('refuses the entitlement-override write from a cafe token', async () => {
    const { cafe, token } = await makeTenant({ planKey: 'starter' });

    const res = await request(app)
      .put(`/api/superadmin/cafes/${cafe._id}/entitlements`)
      .set('Authorization', `Bearer ${token}`)
      .set('cookie', `csrf_token=${CSRF}`)
      .set('x-csrf-token', CSRF)
      .send({ overrides: [{ featureKey: FEATURES.ANALYTICS, enabled: true }] });

    expect(res.status).toBe(401);
  });

  it('lets support grant and revoke a single feature, and the gate follows', async () => {
    const { cafe, token } = await makeTenant({ planKey: 'starter' });
    const admin = await SuperAdmin.create({
      email: `support-${Date.now()}@qrdine.test`,
      role: 'support',
      isActive: true,
      password: await SuperAdmin.hashPassword('correct-horse-battery-staple'),
    });
    const adminToken = jwt.sign(
      { id: String(admin._id), role: admin.role, typ: 'superadmin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const grant = await request(app)
      .put(`/api/superadmin/cafes/${cafe._id}/entitlements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('cookie', `csrf_token=${CSRF}`)
      .set('x-csrf-token', CSRF)
      .send({
        overrides: [{ featureKey: FEATURES.ANALYTICS, enabled: true, note: 'beta customer' }],
        note: 'beta customer',
      });

    expect(grant.status).toBe(200);
    expect(grant.body.entitlements.features).toContain(FEATURES.ANALYTICS);

    // The tenant's own request now passes the gate.
    const allowed = await get('/api/analytics/overview', token);
    expect(allowed.body.code).not.toBe('FEATURE_NOT_ENTITLED');

    // Revoking is a downgrade, and the very next request is refused again.
    const revoke = await request(app)
      .put(`/api/superadmin/cafes/${cafe._id}/entitlements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('cookie', `csrf_token=${CSRF}`)
      .set('x-csrf-token', CSRF)
      .send({ overrides: [{ featureKey: FEATURES.ANALYTICS, enabled: false }] });

    expect(revoke.status).toBe(200);
    expect(revoke.body.entitlements.features).not.toContain(FEATURES.ANALYTICS);
    expect((await get('/api/analytics/overview', token)).status).toBe(403);
  });

  it('exposes usage for the tenant without exposing billing secrets', async () => {
    const { token } = await makeTenant({ planKey: 'starter' });

    const res = await get('/api/subscription/entitlements', token);

    expect(res.status).toBe(200);
    const orders = res.body.usage.find((u) => u.metric === 'orders.month');
    expect(orders).toMatchObject({ limit: 500, used: 0, unlimited: false });
    // No payment credentials, provider keys or internal flags on the payload.
    expect(JSON.stringify(res.body)).not.toMatch(/razorpay|secret|apiKey/i);
  });
});

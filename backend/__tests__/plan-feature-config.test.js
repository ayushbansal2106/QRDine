/**
 * Plan configuration — the plan-wise feature matrix.
 *
 * The control plane's Plan Configuration page is not a picture of the plan
 * catalogue: it edits what each plan *includes*, one plan at a time, and the
 * result has to be what the entitlement gate actually enforces.
 *
 * What is pinned here:
 *
 *   1. The matrix loads the persisted entitlements for Starter, Growth and Pro.
 *   2. The cells are independent — editing one plan never touches another.
 *   3. A saved change is what the backend resolves, and what a protected API
 *      enforces.
 *   4. The global availability control is a separate layer: a global block
 *      still wins over a plan entitlement.
 *   5. Only a super admin may change it, and a stale edit is refused rather
 *      than silently overwriting another administrator's change.
 *   6. Usage limits and subscription enforcement are untouched.
 *
 * Everything runs over real HTTP with a real (in-memory) MongoDB, because the
 * interesting failure is the one a browser cannot cause: a hand-written
 * request from a hand-written body.
 */

'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-for-plan-feature-config-only';
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
const PlanFeatureConfig = require('../src/models/PlanFeatureConfig');
const FeatureCatalog = require('../src/models/FeatureCatalog');
const analyticsRoutes = require('../src/routes/analyticsRoutes');
const couponRoutes = require('../src/routes/couponRoutes');
const superAdminRoutes = require('../src/routes/superAdminRoutes');
const subscriptionService = require('../src/services/subscriptionService');
const entitlementService = require('../src/services/entitlementService');
const planFeatureConfigService = require('../src/services/planFeatureConfigService');
const { clearCachedCatalog } = require('../src/services/featureCatalogService');
const { errorHandler, notFound } = require('../src/middlewares/errorMiddleware');
const { FEATURES, METRICS } = require('../src/config/plans');

const CSRF = 'a'.repeat(64);

let mongo;
let app;

const buildApp = () => {
  const instance = express();
  instance.use(express.json());
  instance.use(cookieParser());
  instance.use('/api/analytics', analyticsRoutes);
  instance.use('/api/coupons', couponRoutes);
  instance.use('/api/superadmin', superAdminRoutes);
  instance.use(notFound);
  instance.use(errorHandler);
  return instance;
};

const makeAdmin = async (email, role) =>
  SuperAdmin.create({
    email,
    role,
    isActive: true,
    password: await SuperAdmin.hashPassword('correct-horse-battery-staple'),
  });

const tokenFor = (admin) =>
  jwt.sign({ id: String(admin._id), role: admin.role, typ: 'superadmin' }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });

/** Authenticated write with a valid double-submit CSRF pair. */
const write = (method, url, token, body = {}) =>
  request(app)[method](url)
    .set('Authorization', `Bearer ${token}`)
    .set('Cookie', [`csrf_token=${CSRF}`])
    .set('x-csrf-token', CSRF)
    .send(body);

const get = (url, token) => {
  const req = request(app).get(url);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
};

/** A cafe on a paid plan, with a signed-in owner token. */
const makeTenant = async (planKey) => {
  const cafe = await Cafe.create({ name: `Cafe ${Math.random().toString(16).slice(2)}` });
  const user = await User.create({
    cafeId: cafe._id,
    name: 'Owner',
    email: `owner-${Math.random().toString(16).slice(2)}@example.com`,
    password: 'not-used-in-these-tests',
    role: 'owner',
  });
  await subscriptionService.activatePaidPlan(cafe._id, {
    planKey,
    cycle: 'monthly',
    outlets: 1,
    from: new Date(),
  });
  const token = jwt.sign(
    { id: String(user._id), cafeId: String(cafe._id), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return { cafe, user, token };
};

/** The matrix as the control plane reads it. */
const readMatrix = async (token) => {
  const res = await get('/api/superadmin/plan-config', token);
  expect(res.status).toBe(200);
  return res.body;
};

const planByKey = (matrix, key) => matrix.plans.find((plan) => plan.key === key);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Subscription.syncIndexes(), PlanFeatureConfig.syncIndexes()]);
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
    mongoose.connection.db.collection('planfeatureconfigs').deleteMany({}),
    mongoose.connection.db.collection('featurecatalogs').deleteMany({}),
    mongoose.connection.db.collection('superadmins').deleteMany({}),
  ]);
  // The overlay is cached in-process; a stale one would leak the previous
  // test's configuration into this one.
  planFeatureConfigService.clearCache();
  clearCachedCatalog();
});

describe('plan configuration — reading the matrix', () => {
  it('loads the entitlements for Starter, Growth and Pro', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);

    const matrix = await readMatrix(token);

    expect(matrix.plans.map((plan) => plan.key)).toEqual(['starter', 'growth', 'pro']);
    expect(matrix.plans.map((plan) => plan.name)).toEqual(['Starter', 'Growth', 'Pro']);

    // Every registered feature is a row, with a cell per plan.
    expect(matrix.features.length).toBeGreaterThan(0);
    for (const feature of matrix.features) {
      expect(feature.key).toBeTruthy();
      expect(feature.label).toBeTruthy();
    }

    // The plan's own entitlements are what the catalogue says, per plan.
    const starter = planByKey(matrix, 'starter');
    const growth = planByKey(matrix, 'growth');
    expect(starter.features[FEATURES.POS]).toBe(true);
    expect(starter.features[FEATURES.LOYALTY]).toBe(false);
    expect(growth.features[FEATURES.LOYALTY]).toBe(true);
    expect(growth.features[FEATURES.DIGITIZATION]).toBe(false);
    expect(planByKey(matrix, 'pro').features[FEATURES.DIGITIZATION]).toBe(true);

    // The price and the billing interval come from the backend.
    // Prices are paise: ₹349/month and ₹3490/year.
    expect(starter.pricing.monthly.paise).toBe(34900);
    expect(starter.pricing.annual.paise).toBe(349000);
    expect(starter.pricing.cycles).toEqual(['monthly', 'annual']);
  });

  it('reports the plan limits alongside the features', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const matrix = await readMatrix(tokenFor(admin));

    const limitKeys = matrix.limitRows.map((row) => row.key);
    expect(limitKeys).toContain(METRICS.ORDERS_PER_MONTH);
    expect(limitKeys).toContain('includedOutlets');

    expect(planByKey(matrix, 'starter').limits[METRICS.ORDERS_PER_MONTH]).toBe(500);
    // Growth is explicitly unlimited — not "missing".
    expect(planByKey(matrix, 'growth').limits[METRICS.ORDERS_PER_MONTH]).toBeNull();
    expect(planByKey(matrix, 'starter').limits.includedOutlets).toBe(1);
  });
});

describe('plan configuration — saving', () => {
  it('changes only the plan that was edited', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);

    const before = await readMatrix(token);
    const starterVersion = planByKey(before, 'starter').version;

    const res = await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'starter',
          expectedVersion: starterVersion,
          features: { [FEATURES.LOYALTY]: true },
        },
      ],
      note: 'pilot loyalty on the entry plan',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const after = await readMatrix(token);

    // Starter changed...
    expect(planByKey(after, 'starter').features[FEATURES.LOYALTY]).toBe(true);
    // ...and nobody else did.
    expect(planByKey(after, 'growth').features[FEATURES.LOYALTY]).toBe(true);
    expect(planByKey(after, 'pro').features[FEATURES.LOYALTY]).toBe(true);
    expect(planByKey(after, 'growth').features).toEqual(planByKey(before, 'growth').features);
    expect(planByKey(after, 'pro').features).toEqual(planByKey(before, 'pro').features);
    expect(planByKey(after, 'starter').version).toBe(starterVersion + 1);
  });

  it('changes only the plan that was edited when a feature is removed', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);

    const before = await readMatrix(token);
    const growthVersion = planByKey(before, 'growth').version;

    const res = await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'growth',
          expectedVersion: growthVersion,
          features: { [FEATURES.ANALYTICS]: false },
        },
      ],
    });

    expect(res.status).toBe(200);

    const after = await readMatrix(token);
    expect(planByKey(after, 'growth').features[FEATURES.ANALYTICS]).toBe(false);
    expect(planByKey(after, 'starter').features).toEqual(planByKey(before, 'starter').features);
    expect(planByKey(after, 'pro').features).toEqual(planByKey(before, 'pro').features);
  });

  it('persists the change across a reload', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);

    const before = await readMatrix(token);
    await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'starter',
          expectedVersion: planByKey(before, 'starter').version,
          features: { [FEATURES.LOYALTY]: true },
        },
      ],
    });

    // A fresh process would read the same row: it is in the database, not in
    // the operator's browser.
    const stored = await PlanFeatureConfig.findOne({ planKey: 'starter' }).lean();
    expect(stored.features[FEATURES.LOYALTY]).toBe(true);
    expect(stored.version).toBe(2);
    expect(stored.updatedBy).toBe('ops@qrdine.test');

    planFeatureConfigService.clearCache();
    const reloaded = await readMatrix(token);
    expect(planByKey(reloaded, 'starter').features[FEATURES.LOYALTY]).toBe(true);
  });

  it('leaves the last persisted state alone when a draft is rejected', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);

    const before = await readMatrix(token);
    const res = await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'starter',
          expectedVersion: planByKey(before, 'starter').version,
          features: { 'not.a.feature': true },
        },
      ],
    });

    expect(res.status).toBe(400);

    // Nothing was written: the operator can discard the draft and still be
    // looking at the last persisted configuration.
    const after = await readMatrix(token);
    expect(planByKey(after, 'starter').features).toEqual(planByKey(before, 'starter').features);
    expect(planByKey(after, 'starter').version).toBe(planByKey(before, 'starter').version);
  });

  it('records what changed and who changed it', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);

    const before = await readMatrix(token);
    await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'growth',
          expectedVersion: planByKey(before, 'growth').version,
          features: { [FEATURES.ANALYTICS]: false },
          limits: { [METRICS.ORDERS_PER_MONTH]: 250 },
        },
      ],
      note: 'tighter growth quota',
    });

    const stored = await PlanFeatureConfig.findOne({ planKey: 'growth' }).lean();
    expect(stored.changes.length).toBeGreaterThan(0);
    const featureChange = stored.changes.find((change) => change.key === FEATURES.ANALYTICS);
    expect(featureChange).toMatchObject({ kind: 'feature', before: true, after: false });
    expect(featureChange.by).toBe('ops@qrdine.test');
    const limitChange = stored.changes.find((change) => change.key === METRICS.ORDERS_PER_MONTH);
    expect(limitChange).toMatchObject({ kind: 'limit', before: null, after: 250 });
  });
});

describe('plan configuration — enforcement', () => {
  it('resolves a tenant’s entitlements through the saved configuration', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);
    const { cafe } = await makeTenant('starter');

    expect(
      (await entitlementService.getEntitlementsForCafe(cafe._id)).features
    ).not.toContain(FEATURES.LOYALTY);

    const before = await readMatrix(token);
    await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'starter',
          expectedVersion: planByKey(before, 'starter').version,
          features: { [FEATURES.LOYALTY]: true },
        },
      ],
    });

    const entitlements = await entitlementService.getEntitlementsForCafe(cafe._id);
    expect(entitlements.features).toContain(FEATURES.LOYALTY);
    // Growth and Pro are untouched by a Starter edit.
    expect(entitlements.planKey).toBe('starter');
  });

  it('makes a protected API follow the saved configuration', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);
    const { cafe, token: tenantToken } = await makeTenant('starter');

    // Coupons are a Growth feature: refused while Starter does not include it.
    const refused = await get('/api/coupons', tenantToken);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FEATURE_NOT_ENTITLED');

    const before = await readMatrix(token);
    await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'starter',
          expectedVersion: planByKey(before, 'starter').version,
          features: { [FEATURES.COUPONS]: true },
        },
      ],
    });

    const allowed = await get('/api/coupons', tenantToken);
    expect(allowed.body.code).not.toBe('FEATURE_NOT_ENTITLED');
    expect(allowed.status).not.toBe(403);

    // And the other way round: taking the feature away closes it again.
    const after = await readMatrix(token);
    await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'starter',
          expectedVersion: planByKey(after, 'starter').version,
          features: { [FEATURES.COUPONS]: false },
        },
      ],
    });

    const closedAgain = await get('/api/coupons', tenantToken);
    expect(closedAgain.status).toBe(403);
    expect(closedAgain.body.code).toBe('FEATURE_NOT_ENTITLED');
  });

  it('keeps a global block ahead of a plan entitlement', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);
    const { cafe } = await makeTenant('growth');

    // Growth includes loyalty by default.
    expect(
      (await entitlementService.getEntitlementsForCafe(cafe._id)).features
    ).toContain(FEATURES.LOYALTY);

    // The global catalog blocks it platform-wide.
    await FeatureCatalog.create({
      features: {},
      blocked: { [FEATURES.LOYALTY]: true },
    });
    clearCachedCatalog();

    const blocked = await entitlementService.getEntitlementsForCafe(cafe._id);
    expect(blocked.features).not.toContain(FEATURES.LOYALTY);
    expect(blocked.blockedFeatures).toContain(FEATURES.LOYALTY);

    // Enabling it on the plan does not re-open a globally blocked module.
    const before = await readMatrix(token);
    await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'growth',
          expectedVersion: planByKey(before, 'growth').version,
          features: { [FEATURES.LOYALTY]: true },
        },
      ],
    });

    const stillBlocked = await entitlementService.getEntitlementsForCafe(cafe._id);
    expect(stillBlocked.features).not.toContain(FEATURES.LOYALTY);

    // The matrix reports the block, so the operator can see why the switch
    // has no effect.
    const matrix = await readMatrix(token);
    expect(matrix.globalAvailability.blocked[FEATURES.LOYALTY]).toBe(true);
  });

  it('keeps usage limits and subscription enforcement intact', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);
    const { cafe } = await makeTenant('starter');

    const before = await readMatrix(token);
    await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'starter',
          expectedVersion: planByKey(before, 'starter').version,
          features: { [FEATURES.LOYALTY]: true },
          limits: { [METRICS.ORDERS_PER_MONTH]: 120 },
        },
      ],
    });

    const summary = await entitlementService.getUsageSummary(
      cafe._id,
      METRICS.ORDERS_PER_MONTH
    );
    expect(summary.limit).toBe(120);
    expect(summary.unlimited).toBe(false);
    expect(summary.periodKey).toMatch(/^\d{4}-\d{2}$/);

    // A lapsed tenant still loses its paid modules.
    const sub = await Subscription.findOne({ cafeId: cafe._id });
    sub.currentPeriodEnd = new Date(Date.now() - 40 * 86400000);
    await sub.save();

    const lapsed = await entitlementService.getEntitlementsForCafe(cafe._id);
    expect(lapsed.isDegraded).toBe(true);
    expect(lapsed.features).toContain(FEATURES.POS);
    expect(lapsed.features).not.toContain(FEATURES.LOYALTY);
  });
});

describe('plan configuration — authorisation and validation', () => {
  it('refuses an anonymous caller', async () => {
    await request(app).get('/api/superadmin/plan-config').expect(401);
    await write('put', '/api/superadmin/plan-config', 'not-a-token', {
      plans: [{ planKey: 'starter', features: { [FEATURES.LOYALTY]: true } }],
    }).expect(401);
  });

  it('refuses a cafe owner’s token', async () => {
    const { token: cafeToken } = await makeTenant('starter');

    const res = await write('put', '/api/superadmin/plan-config', cafeToken, {
      plans: [{ planKey: 'starter', features: { [FEATURES.LOYALTY]: true } }],
    });

    expect(res.status).toBe(401);
    expect(await PlanFeatureConfig.countDocuments({})).toBe(0);
  });

  it('refuses a support operator and a readonly operator', async () => {
    const support = await makeAdmin('support@qrdine.test', 'support');
    const readonly = await makeAdmin('ro@qrdine.test', 'readonly');

    const supportRes = await write('put', '/api/superadmin/plan-config', tokenFor(support), {
      plans: [{ planKey: 'starter', features: { [FEATURES.LOYALTY]: true } }],
    });
    expect(supportRes.status).toBe(403);

    const readonlyRes = await write('put', '/api/superadmin/plan-config', tokenFor(readonly), {
      plans: [{ planKey: 'starter', features: { [FEATURES.LOYALTY]: true } }],
    });
    expect(readonlyRes.status).toBe(403);

    expect(await PlanFeatureConfig.countDocuments({})).toBe(0);

    // They may still read the matrix.
    await get('/api/superadmin/plan-config', tokenFor(support)).expect(200);
  });

  it('refuses an unknown feature key', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const res = await write('put', '/api/superadmin/plan-config', tokenFor(admin), {
      plans: [{ planKey: 'starter', features: { 'moon.phase': true } }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unknown feature key/);
    expect(await PlanFeatureConfig.countDocuments({})).toBe(0);
  });

  it('refuses an unknown plan and a plan that is not configurable', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);

    const unknown = await write('put', '/api/superadmin/plan-config', token, {
      plans: [{ planKey: 'platinum', features: {} }],
    });
    expect(unknown.status).toBe(400);

    // The free trial carries every feature on purpose; it is not part of the
    // configurable matrix.
    const trial = await write('put', '/api/superadmin/plan-config', token, {
      plans: [{ planKey: 'trial', features: { [FEATURES.LOYALTY]: false } }],
    });
    expect(trial.status).toBe(400);

    expect(await PlanFeatureConfig.countDocuments({})).toBe(0);
  });

  it('refuses a non-boolean entitlement value', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const res = await write('put', '/api/superadmin/plan-config', tokenFor(admin), {
      plans: [{ planKey: 'starter', features: { [FEATURES.LOYALTY]: 'yes' } }],
    });

    expect(res.status).toBe(400);
    expect(await PlanFeatureConfig.countDocuments({})).toBe(0);
  });

  it('refuses an invalid limit value', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);

    const notANumber = await write('put', '/api/superadmin/plan-config', token, {
      plans: [{ planKey: 'starter', limits: { [METRICS.ORDERS_PER_MONTH]: -5 } }],
    });
    expect(notANumber.status).toBe(400);

    const notUnlimited = await write('put', '/api/superadmin/plan-config', token, {
      plans: [{ planKey: 'starter', limits: { includedOutlets: null } }],
    });
    expect(notUnlimited.status).toBe(400);

    const unknownLimit = await write('put', '/api/superadmin/plan-config', token, {
      plans: [{ planKey: 'starter', limits: { 'seats.max': 40 } }],
    });
    expect(unknownLimit.status).toBe(400);

    expect(await PlanFeatureConfig.countDocuments({})).toBe(0);
  });

  it('refuses a stale edit instead of overwriting another administrator', async () => {
    const admin = await makeAdmin('ops@qrdine.test', 'superadmin');
    const token = tokenFor(admin);

    const before = await readMatrix(token);
    const version = planByKey(before, 'starter').version;

    // Somebody else saves first.
    const theirs = await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'starter',
          expectedVersion: version,
          features: { [FEATURES.LOYALTY]: true },
        },
      ],
    });
    expect(theirs.status).toBe(200);

    // This administrator is still holding the version they loaded.
    const mine = await write('put', '/api/superadmin/plan-config', token, {
      plans: [
        {
          planKey: 'starter',
          expectedVersion: version,
          features: { [FEATURES.COUPONS]: true },
        },
      ],
    });

    expect(mine.status).toBe(409);
    expect(mine.body.code).toBe('PLAN_CONFIG_CONFLICT');

    const after = await readMatrix(token);
    expect(planByKey(after, 'starter').features[FEATURES.COUPONS]).toBe(false);
    expect(planByKey(after, 'starter').features[FEATURES.LOYALTY]).toBe(true);
  });
});

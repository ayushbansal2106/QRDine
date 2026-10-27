/**
 * Super-admin control plane, end to end over real HTTP.
 *
 * Mounted on a bare Express app rather than `src/app.js`, because requiring the
 * full app starts three background sweepers that keep the Jest event loop alive
 * and have nothing to do with billing.
 *
 * The behaviour worth proving is the one an operator actually performs:
 * sign in, find a café, terminate it, and see that the café's access is gone —
 * and that a `support` account cannot do it.
 */

'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-for-super-admin-api-only';
process.env.NODE_ENV = 'test';
// config/env refuses to load without these; the test connects via mongoose
// directly rather than through src/config/db.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/qrdine-test';

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const SuperAdmin = require('../src/models/SuperAdmin');
const Cafe = require('../src/models/Cafe');
const subscriptionRoutes = require('../src/routes/subscriptionRoutes');
const superAdminRoutes = require('../src/routes/superAdminRoutes');
const subscriptionService = require('../src/services/subscriptionService');

const PASSWORD = 'correct-horse-battery-staple';
const CSRF_TOKEN = 'a'.repeat(64);

let mongo;
let app;

const buildApp = () => {
  const instance = express();
  instance.use(express.json());
  instance.use(cookieParser());
  instance.use('/api/subscription', subscriptionRoutes);
  instance.use('/api/superadmin', superAdminRoutes);
  // eslint-disable-next-line no-unused-vars
  instance.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ message: err.message, statusCode: err.statusCode });
  });
  return instance;
};

const makeAdmin = async (email, role) => {
  const password = await SuperAdmin.hashPassword(PASSWORD);
  return SuperAdmin.create({ email, role, isActive: true, password });
};

const loginAs = async (email) => {
  const res = await request(app)
    .post('/api/superadmin/login')
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token;
};

/**
 * Mint a control-plane token without going through `/login`.
 *
 * `/superadmin/login` is behind `authLimiter` (20 requests / 15 min / IP) and
 * every request in this file shares one IP, so signing in per test exhausts the
 * budget and yields 429s. Signing the token directly keeps the limiter fully
 * intact — it is a real guard and must not be loosened for tests — while login
 * behaviour itself is already covered by the suite above.
 */
const tokenFor = (admin) =>
  jwt.sign(
    { id: String(admin._id), role: admin.role, typ: 'superadmin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

/** Authenticated write with a valid double-submit CSRF pair. */
const write = (method, url, token, body = {}) =>
  request(app)[method](url)
    .set('Authorization', `Bearer ${token}`)
    .set('Cookie', [`csrf_token=${CSRF_TOKEN}`])
    .set('x-csrf-token', CSRF_TOKEN)
    .send(body);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await SuperAdmin.syncIndexes();
  app = buildApp();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect().catch(() => {});
  await mongo.stop().catch(() => {});
});

beforeEach(async () => {
  // Via the models, not raw collection names: guessing the pluralised
  // collection name silently leaves rows behind from the previous test.
  await SuperAdmin.deleteMany({});
  await Cafe.deleteMany({});
  await mongoose.connection.db.collection('subscriptions').deleteMany({});
});

const seedCafe = () =>
  Cafe.create({ name: 'Spice Route Cafe', email: 'spice@example.com', phone: '9876500000' });

describe('super admin control plane — over HTTP', () => {
  it('signs an operator in and returns a scoped token', async () => {
    await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);

    const res = await request(app)
      .post('/api/superadmin/login')
      .send({ email: 'ops@qrdine.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.admin.role).toBe('superadmin');
    // No tenant: a staff account belongs to no café.
    expect(res.body.admin.cafeId).toBeUndefined();
  });

  it('refuses a wrong password without revealing the account exists', async () => {
    await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);

    const bad = await request(app)
      .post('/api/superadmin/login')
      .send({ email: 'ops@qrdine.com', password: 'not-the-password' });
    const missing = await request(app)
      .post('/api/superadmin/login')
      .send({ email: 'nobody@qrdine.com', password: 'not-the-password' });

    expect(bad.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(bad.body.message).toBe(missing.body.message);
  });

  it('will not serve the control plane to an anonymous caller', async () => {
    await request(app).get('/api/superadmin/overview').expect(401);
  });

  it('counts tenants and monthly revenue', async () => {
    const admin = await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);
    const paid = await seedCafe();
    await subscriptionService.ensureSubscription(paid._id);
    await subscriptionService.activatePaidPlan(paid._id, { planKey: 'growth' });

    const trialCafe = await seedCafe();
    await subscriptionService.ensureSubscription(trialCafe._id);

    const res = await request(app)
      .get('/api/superadmin/overview')
      .set('Authorization', `Bearer ${await loginAs(admin.email)}`);

    expect(res.status).toBe(200);
    expect(res.body.totals.cafes).toBe(2);
    expect(res.body.totals.active).toBe(1);
    expect(res.body.totals.trialing).toBe(1);
    // ₹499 before GST. A trial is not revenue.
    expect(res.body.revenue.mrrPaise).toBe(49900);
    expect(res.body.revenue.payingTenants).toBe(1);
  });

  it('finds a tenant by name', async () => {
    const admin = await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);
    const cafe = await seedCafe();
    await subscriptionService.ensureSubscription(cafe._id);

    const token = await loginAs(admin.email);
    const res = await request(app)
      .get('/api/superadmin/cafes?q=Spice')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.cafes).toHaveLength(1);
    expect(String(res.body.cafes[0].cafeId)).toBe(String(cafe._id));
    expect(res.body.cafes[0].status).toBe('trialing');
  });

  it('terminates a tenant and revokes every entitlement', async () => {
    const admin = await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);
    const cafe = await seedCafe();
    await subscriptionService.activatePaidPlan(cafe._id, { planKey: 'pro' });

    const token = await loginAs(admin.email);
    const res = await write('post', `/api/superadmin/cafes/${cafe._id}/terminate`, token, {
      reason: 'Chargeback fraud confirmed by the bank',
    });

    expect(res.status).toBe(200);

    // The tenant's own view of itself has changed, not just the operator's.
    const { access } = await subscriptionService.getAccessForCafe(cafe._id);
    expect(access.isTerminated).toBe(true);
    expect(access.allowedFeatures).toEqual([]);

    const stored = await subscriptionService.findForCafe(cafe._id);
    expect(stored.terminationReason).toContain('Chargeback');
    expect(stored.lastChangedBy).toBe('ops@qrdine.com');
  });

  it('reinstates a terminated tenant', async () => {
    const admin = await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);
    const cafe = await seedCafe();
    await subscriptionService.activatePaidPlan(cafe._id, { planKey: 'growth' });
    await subscriptionService.terminate(cafe._id, { reason: 'error' });

    const token = await loginAs(admin.email);
    const res = await write('post', `/api/superadmin/cafes/${cafe._id}/reinstate`, token);

    expect(res.status).toBe(200);
    const { access } = await subscriptionService.getAccessForCafe(cafe._id);
    expect(access.isTerminated).toBe(false);
    expect(access.status).toBe('active');
  });

  it('refuses to terminate without a stated reason', async () => {
    const admin = await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);
    const cafe = await seedCafe();
    await subscriptionService.ensureSubscription(cafe._id);

    const token = await loginAs(admin.email);
    const res = await write('post', `/api/superadmin/cafes/${cafe._id}/terminate`, token, {});

    expect(res.status).toBe(400);
  });

  it('stops a support account terminating a customer', async () => {
    const support = await makeAdmin('support@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPPORT);
    const cafe = await seedCafe();
    await subscriptionService.ensureSubscription(cafe._id);

    const token = await loginAs(support.email);
    const res = await write('post', `/api/superadmin/cafes/${cafe._id}/terminate`, token, {
      reason: 'customer was rude to me',
    });

    expect(res.status).toBe(403);
    const { access } = await subscriptionService.getAccessForCafe(cafe._id);
    expect(access.isTerminated).toBe(false);
  });

  it('lets a support account grant a plan', async () => {
    const support = await makeAdmin('support@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPPORT);
    const cafe = await seedCafe();
    await subscriptionService.ensureSubscription(cafe._id);

    const token = await loginAs(support.email);
    const res = await write('post', `/api/superadmin/cafes/${cafe._id}/plan`, token, {
      planKey: 'growth',
      cycle: 'monthly',
      outlets: 1,
    });

    expect(res.status).toBe(200);
    expect(res.body.quote.subtotalPaise).toBe(49900);
    const { access } = await subscriptionService.getAccessForCafe(cafe._id);
    expect(access.status).toBe('active');
    expect(access.allowedFeatures).toContain('loyalty');
  });

  it('rejects a terminate with no CSRF token', async () => {
    const admin = await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);
    const cafe = await seedCafe();
    await subscriptionService.ensureSubscription(cafe._id);
    const token = await loginAs(admin.email);

    const res = await request(app)
      .post(`/api/superadmin/cafes/${cafe._id}/terminate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'no token supplied' });

    expect(res.status).toBe(403);
  });

  it('extends a trial', async () => {
    const admin = await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);
    const cafe = await seedCafe();
    const sub = await subscriptionService.ensureSubscription(cafe._id);

    const token = await loginAs(admin.email);
    const res = await write('post', `/api/superadmin/cafes/${cafe._id}/extend-trial`, token, { days: 7 });

    expect(res.status).toBe(200);
    const updated = await subscriptionService.findForCafe(cafe._id);
    // Seven days added to the existing fourteen, not replaced by seven.
    expect(updated.trialEndsAt.getTime()).toBeGreaterThan(sub.trialEndsAt.getTime());
    expect(res.body.subscription.status).toBe('trialing');
  });

  it('404s on an unknown tenant rather than acting on it', async () => {
    const admin = await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);
    const token = await loginAs(admin.email);

    const res = await write(
      'post',
      '/api/superadmin/cafes/507f1f77bcf86cd799439999/terminate',
      token,
      { reason: 'this cafe does not exist' }
    );

    expect(res.status).toBe(404);
  });

  it('reports tenants about to lapse', async () => {
    const admin = await makeAdmin('ops@qrdine.com', SuperAdmin.SUPER_ADMIN_ROLES.SUPERADMIN);
    const soon = await seedCafe();
    await subscriptionService.activatePaidPlan(soon._id, {
      planKey: 'starter',
      from: new Date(Date.now() - 24 * 86400000), // ends in ~6 days
    });

    const token = await loginAs(admin.email);
    const res = await request(app)
      .get('/api/superadmin/expiring?days=7')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(String(res.body.tenants[0].cafeId)).toBe(String(soon._id));
    expect(res.body.tenants[0].daysRemaining).toBeLessThanOrEqual(7);
  });
});

/**
 * Platform staff management — the panel equivalent of
 * `scripts/create-superadmin.js`.
 *
 * The behaviour that matters is not "can it write a row" but the two ways this
 * page can lock a team out of its own control plane: an operator removing their
 * own access, and a deactivation that does not actually take effect.
 */
describe('platform staff management', () => {
  const ROLES = SuperAdmin.SUPER_ADMIN_ROLES;

  it('creates an operator and never returns the password', async () => {
    const ops = await makeAdmin('ops@qrdine.com', ROLES.SUPERADMIN);
    const token = tokenFor(ops);

    const res = await write('post', '/api/superadmin/staff', token, {
      email: 'Asha@QRDine.com',
      name: 'Asha',
      role: ROLES.SUPPORT,
      password: 'a-sufficiently-long-password',
    });

    expect(res.status).toBe(201);
    expect(res.body.staff.email).toBe('asha@qrdine.com'); // normalised
    expect(res.body.staff.role).toBe('support');
    expect(res.body.staff).not.toHaveProperty('password');

    const stored = await SuperAdmin.findOne({ email: 'asha@qrdine.com' }).select('+password');
    expect(stored.password).not.toBe('a-sufficiently-long-password');
    expect(await stored.verifyPassword('a-sufficiently-long-password')).toBe(true);
  });

  it('lists staff without leaking hashes', async () => {
    const ops = await makeAdmin('ops@qrdine.com', ROLES.SUPERADMIN);
    const token = tokenFor(ops);

    const res = await request(app)
      .get('/api/superadmin/staff')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.staff).toHaveLength(1);
    expect(res.body.staff[0]).not.toHaveProperty('password');
    expect(res.body.currentUserId).toBeTruthy();
  });

  it('refuses a duplicate email', async () => {
    const ops = await makeAdmin('ops@qrdine.com', ROLES.SUPERADMIN);
    const token = tokenFor(ops);

    const res = await write('post', '/api/superadmin/staff', token, {
      email: 'ops@qrdine.com',
      role: ROLES.SUPPORT,
      password: 'a-sufficiently-long-password',
    });

    expect(res.status).toBe(409);
  });

  it('refuses a password shorter than 12 characters', async () => {
    const ops = await makeAdmin('ops@qrdine.com', ROLES.SUPERADMIN);
    const token = tokenFor(ops);

    const res = await write('post', '/api/superadmin/staff', token, {
      email: 'short@qrdine.com',
      role: ROLES.SUPPORT,
      password: 'tooshort',
    });

    expect(res.status).toBe(400);
    expect(await SuperAdmin.countDocuments({ email: 'short@qrdine.com' })).toBe(0);
  });

  it('refuses an unknown role', async () => {
    const ops = await makeAdmin('ops@qrdine.com', ROLES.SUPERADMIN);
    const token = tokenFor(ops);

    const res = await write('post', '/api/superadmin/staff', token, {
      email: 'rogue@qrdine.com',
      role: 'root',
      password: 'a-sufficiently-long-password',
    });

    expect(res.status).toBe(400);
  });

  it('keeps staff management away from support and readonly', async () => {
    const support = await makeAdmin('support@qrdine.com', ROLES.SUPPORT);
    const supportToken = tokenFor(support);

    await request(app)
      .get('/api/superadmin/staff')
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(403);

    const created = await write('post', '/api/superadmin/staff', supportToken, {
      email: 'self-promoted@qrdine.com',
      role: ROLES.SUPERADMIN,
      password: 'a-sufficiently-long-password',
    });
    expect(created.status).toBe(403);
    expect(await SuperAdmin.countDocuments({ email: 'self-promoted@qrdine.com' })).toBe(0);
  });

  it('refuses to let an operator demote themselves', async () => {
    const self = await makeAdmin('ops@qrdine.com', ROLES.SUPERADMIN);
    const token = tokenFor(self);

    const res = await write('patch', `/api/superadmin/staff/${self._id}`, token, {
      role: ROLES.SUPPORT,
    });

    expect(res.status).toBe(400);
    const unchanged = await SuperAdmin.findById(self._id);
    expect(unchanged.role).toBe(ROLES.SUPERADMIN);
  });

  it('refuses to let an operator deactivate themselves', async () => {
    const self = await makeAdmin('ops@qrdine.com', ROLES.SUPERADMIN);
    const token = tokenFor(self);

    const res = await write('patch', `/api/superadmin/staff/${self._id}`, token, {
      isActive: false,
    });

    expect(res.status).toBe(400);
    const unchanged = await SuperAdmin.findById(self._id);
    expect(unchanged.isActive).toBe(true);
  });

  it('kills an operator\'s session the moment they are deactivated', async () => {
    const owner = await makeAdmin('owner@qrdine.com', ROLES.SUPERADMIN);
    const other = await makeAdmin('other@qrdine.com', ROLES.SUPERADMIN);
    const ownerToken = tokenFor(owner);
    const otherToken = tokenFor(other);

    // The other operator is working normally.
    await request(app)
      .get('/api/superadmin/me')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);

    const res = await write('patch', `/api/superadmin/staff/${other._id}`, ownerToken, {
      isActive: false,
    });
    expect(res.status).toBe(200);

    // ...and is locked out on the very next request, with the token unchanged.
    const after = await request(app)
      .get('/api/superadmin/me')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(after.status).toBe(403);
  });

  it('resets a password and clears the brute-force counters', async () => {
    const owner = await makeAdmin('owner@qrdine.com', ROLES.SUPERADMIN);
    const locked = await SuperAdmin.create({
      email: 'locked@qrdine.com',
      role: ROLES.SUPPORT,
      isActive: true,
      password: await SuperAdmin.hashPassword(PASSWORD),
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    });
    const token = tokenFor(owner);

    const res = await write('post', `/api/superadmin/staff/${locked._id}/password`, token, {
      password: 'a-brand-new-long-password',
    });

    expect(res.status).toBe(200);
    const updated = await SuperAdmin.findById(locked._id).select('+password');
    expect(updated.lockedUntil).toBeNull();
    expect(updated.failedAttempts).toBe(0);
    expect(await updated.verifyPassword('a-brand-new-long-password')).toBe(true);
  });

  it('unlocks a locked operator without changing their password', async () => {
    const owner = await makeAdmin('owner@qrdine.com', ROLES.SUPERADMIN);
    const locked = await SuperAdmin.create({
      email: 'locked@qrdine.com',
      role: ROLES.SUPPORT,
      isActive: true,
      password: await SuperAdmin.hashPassword(PASSWORD),
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    });
    const token = tokenFor(owner);

    const res = await write('post', `/api/superadmin/staff/${locked._id}/unlock`, token);

    expect(res.status).toBe(200);
    const updated = await SuperAdmin.findById(locked._id).select('+password');
    expect(updated.lockedUntil).toBeNull();
    // Same credential still works — unlock is not a silent password reset.
    expect(await updated.verifyPassword(PASSWORD)).toBe(true);
  });

  it('404s on an unknown staff id', async () => {
    const ops = await makeAdmin('ops@qrdine.com', ROLES.SUPERADMIN);
    const token = tokenFor(ops);

    const res = await write(
      'patch',
      '/api/superadmin/staff/507f1f77bcf86cd799439999',
      token,
      { role: ROLES.SUPPORT }
    );

    expect(res.status).toBe(404);
  });
});
/**
 * Auth Flow — Integration Tests
 * Tests the full HTTP flow through the Express app against a real in-memory MongoDB.
 *
 * NOTE: The register-owner endpoint uses Cafe.startSession() for transactions,
 * which requires a MongoDB replica set. Since MongoMemoryServer doesn't reliably
 * support replica sets on all platforms, we test:
 *  - Register: validation-only paths (400 errors) that don't reach the transaction
 *  - Login & getCurrentUser: direct DB seeding (these exercise the full auth flow)
 */

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const {
  connect,
  closeDatabase,
  clearDatabase,
  seedCafe,
  seedUser,
} = require('./setup');

process.env.JWT_SECRET = 'integration-test-jwt-secret-key';
process.env.NODE_ENV = 'test';

let app;
beforeAll(async () => {
  await connect();
  app = require('../../src/app');
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await clearDatabase();
});

// ═══════════════════════════════════════════════════════════════════
// Register Owner — Validation Paths
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/auth/register-owner — Validation', () => {
  it('should reject missing required fields', async () => {
    const res = await request(app)
      .post('/api/auth/register-owner')
      .send({ ownerName: 'John' })
      .expect(400);

    expect(res.body.message).toBeDefined();
  });

  it('should reject short password', async () => {
    const res = await request(app)
      .post('/api/auth/register-owner')
      .send({
        ownerName: 'John',
        ownerEmail: 'john@test.com',
        password: '123',
        cafe: { name: 'Cafe', email: 'cafe@test.com' },
      })
      .expect(400);

    expect(res.body.message).toMatch(/password/i);
  });

  it('should reject missing cafe details', async () => {
    await request(app)
      .post('/api/auth/register-owner')
      .send({
        ownerName: 'John',
        ownerEmail: 'john@test.com',
        password: 'password123',
      })
      .expect(400);
  });

  it('should reject invalid email format', async () => {
    await request(app)
      .post('/api/auth/register-owner')
      .send({
        ownerName: 'John',
        ownerEmail: 'not-an-email',
        password: 'password123',
        cafe: { name: 'Cafe', email: 'cafe@test.com' },
      })
      .expect(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Login
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/auth/login', () => {
  let loginEmail;

  beforeEach(async () => {
    const cafe = await seedCafe();
    const user = await seedUser(cafe._id, { password: 'password123', name: 'Login User' });
    loginEmail = user.email;
  });

  it('should login with valid credentials and return token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: loginEmail, password: 'password123' })
      .expect(200);

    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe(loginEmail);
    expect(res.body.user).not.toHaveProperty('password');
  });

  it('should accept ownerEmail as fallback field', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ ownerEmail: loginEmail, password: 'password123' })
      .expect(200);

    expect(res.body).toHaveProperty('token');
  });

  it('should reject wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: loginEmail, password: 'wrongpassword' })
      .expect(401);

    expect(res.body.message).toMatch(/Invalid credentials/);
  });

  it('should reject non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'password123' })
      .expect(401);

    expect(res.body.message).toMatch(/Invalid credentials/);
  });

  it('should return user profile without password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: loginEmail, password: 'password123' })
      .expect(200);

    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user).toHaveProperty('cafeId');
    expect(res.body.user).toHaveProperty('name');
    expect(res.body.user).toHaveProperty('email');
    expect(res.body.user).toHaveProperty('role');
    expect(res.body.user).not.toHaveProperty('password');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Get Current User
// ═══════════════════════════════════════════════════════════════════
describe('GET /api/auth/me', () => {
  let token, userId;

  beforeEach(async () => {
    const cafe = await seedCafe();
    const user = await seedUser(cafe._id, { name: 'Me User', password: 'password123' });
    userId = user._id;

    token = jwt.sign(
      { id: user._id, cafeId: user.cafeId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  it('should return current user profile when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.user.name).toBe('Me User');
    expect(res.body.user.role).toBe('owner');
    expect(res.body.user.email).toBeDefined();
    expect(res.body.user).not.toHaveProperty('password');
  });

  it('should return 401 without token', async () => {
    const res = await request(app).get('/api/auth/me').expect(401);
    expect(res.body.message).toMatch(/not authorized/i);
  });

  it('should return 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token-here')
      .expect(401);
    expect(res.body.message).toBeDefined();
  });

  it('should return 401 with expired token', async () => {
    const expiredToken = jwt.sign(
      { id: userId, cafeId: 'cafe-123', role: 'owner' },
      process.env.JWT_SECRET,
      { expiresIn: '0s' }
    );

    // Wait a moment for the token to expire
    await new Promise(r => setTimeout(r, 1100));

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    expect(res.body.message).toBeDefined();
  });
});

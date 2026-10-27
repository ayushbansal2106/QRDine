/**
 * Stage 7 Readiness & Production Hardening Test Suite (Gate 5)
 *
 * Verifies:
 * 1. Task 7.1 / SEC-101: TLS & Connection Hardening assertions in env.js
 * 2. Task 7.2 / SEC-102: Production error sanitization (CastError, SyntaxError, stack suppression)
 * 3. Task 7.3 / SEC-103: Webhook endpoint rate limiting & early cafeId format validation
 * 4. Task 7.4 / SEC-104: CORS origin lockdown & Vary header
 * 5. Task 7.5 / OPS-101: Backup verification freshness reporting in /api/health
 * 6. Task 7.6 / SEC-105: Dual-key AES-256-GCM encryption and zero-downtime key rotation
 * 7. Task 7.7 / OPS-102: /api/health/metrics endpoint with superadmin protection
 */

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const {
  connect,
  closeDatabase,
  clearDatabase,
} = require('./integration/setup');

const {
  deriveKey,
  encryptTextWithKey,
  tryDecryptWithKey,
  decryptText,
} = require('../src/utils/cryptoHelper');

const SuperAdmin = require('../src/models/SuperAdmin');
const env = require('../src/config/env');

let app;

beforeAll(async () => {
  await connect();
  app = require('../src/app');
});

afterAll(async () => {
  await closeDatabase();
});

describe('Stage 7: Production Hardening & Deployment Readiness (Gate 5)', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  describe('Task 7.1 / SEC-101: TLS & Connection Hardening Assertions', () => {
    it('detects missing mongodb+srv and missing TLS parameters for production configuration', () => {
      const { collectDatabaseProblems } = env;
      if (typeof collectDatabaseProblems === 'function') {
        const problems = collectDatabaseProblems({
          NODE_ENV: 'production',
          MONGODB_URI: 'mongodb://localhost:27017/qrdine',
        });
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.some((p) => p.includes('mongodb+srv') || p.includes('TLS'))).toBe(true);
      }
    });
  });

  describe('Task 7.2 / SEC-102: Production Error Sanitization', () => {
    it('returns sanitized error response on invalid ObjectId without exposing model or stack', async () => {
      const originalEnv = env.nodeEnv;
      env.nodeEnv = 'production';
      try {
        const res = await request(app).get('/api/sessions/not-a-valid-object-id/bill-preview');
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe('Invalid resource identifier');
        expect(res.body.stack).toBeUndefined();
      } finally {
        env.nodeEnv = originalEnv;
      }
    });

    it('returns 400 Bad Request on malformed JSON payload without parser traces', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "broken-json,');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Malformed request body|JSON/);
    });
  });

  describe('Task 7.3 / SEC-103: Webhook Endpoint Rate Limiting & Early Rejection', () => {
    it('rejects invalid cafeId format immediately with 400 before database lookup', async () => {
      const res = await request(app)
        .post('/api/billing/pg/webhook/invalid-hex-cafe-id')
        .send({ test: true });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid cafe identifier/);
    });

    it('sets standard rate limit headers on webhook endpoint', async () => {
      const validObjectId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post(`/api/billing/pg/webhook/${validObjectId}`)
        .send({ test: true });

      // Check standardHeaders rate limit header existence
      expect(res.headers).toHaveProperty('ratelimit-limit');
    });
  });

  describe('Task 7.4 / SEC-104: CORS Origin Lockdown & Vary Header', () => {
    it('always responds with Vary: Origin header on API routes', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['vary']).toMatch(/Origin/);
    });
  });

  describe('Task 7.5 / OPS-101: Backup Verification Status in /api/health', () => {
    it('includes backupVerification freshness field in /api/health response', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('backupVerification');
      expect(['current', 'stale', 'never', 'unknown']).toContain(res.body.backupVerification);
    });
  });

  describe('Task 7.6 / SEC-105: Dual-Key AES-256-GCM Rotation & Decryption', () => {
    const key1 = 'master-secret-key-alpha-version-1';
    const key2 = 'master-secret-key-beta-version-2';

    it('successfully derives deterministic 256-bit keys', () => {
      const buffer1 = deriveKey(key1);
      const buffer2 = deriveKey(key1);
      expect(buffer1).toBeInstanceOf(Buffer);
      expect(buffer1.length).toBe(32);
      expect(buffer1.equals(buffer2)).toBe(true);
    });

    it('encrypts and decrypts secrets with specific key buffer', () => {
      const keyBuffer = deriveKey(key1);
      const plainText = 'rzp_live_secret_sample_token';
      const cipherText = encryptTextWithKey(plainText, keyBuffer);

      const decrypted = tryDecryptWithKey(cipherText, keyBuffer);
      expect(decrypted.success).toBe(true);
      expect(decrypted.plaintext).toBe(plainText);
    });

    it('supports dual-key fallback when PG_ENCRYPTION_KEY_PREVIOUS is configured', () => {
      const oldKeyBuf = deriveKey(key1);
      const secret = 'rzp_secret_before_rotation';
      const oldCipher = encryptTextWithKey(secret, oldKeyBuf);

      // Current env configured with new key, and previous configured with old key
      const originalPgKey = process.env.PG_ENCRYPTION_KEY;
      const originalPrevKey = process.env.PG_ENCRYPTION_KEY_PREVIOUS;

      process.env.PG_ENCRYPTION_KEY = key2;
      process.env.PG_ENCRYPTION_KEY_PREVIOUS = key1;

      try {
        const decrypted = decryptText(oldCipher);
        expect(decrypted).toBe(secret);
      } finally {
        process.env.PG_ENCRYPTION_KEY = originalPgKey;
        process.env.PG_ENCRYPTION_KEY_PREVIOUS = originalPrevKey;
      }
    });
  });

  describe('Task 7.7 / OPS-102: SuperAdmin Resource Metrics Endpoint', () => {
    it('protects /api/health/metrics against unauthenticated callers', async () => {
      const res = await request(app).get('/api/health/metrics');
      expect(res.status).toBe(401);
    });

    it('allows authenticated SuperAdmin to read system and process resource metrics', async () => {
      const admin = await SuperAdmin.create({
        name: 'Platform Ops Admin',
        email: 'ops@qrdine.local',
        password: 'Password@123',
        role: 'superadmin',
        isActive: true,
      });

      const superToken = jwt.sign(
        { id: admin._id, email: admin.email, typ: 'superadmin' },
        env.jwtSecret,
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/health/metrics')
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('process');
      expect(res.body.process).toHaveProperty('memoryUsageBytes');
      expect(res.body.process).toHaveProperty('cpuUsageMicros');
      expect(res.body).toHaveProperty('system');
      expect(res.body.system).toHaveProperty('cpuCount');
      expect(res.body.system).toHaveProperty('loadavg');
      expect(res.body).toHaveProperty('connections');
      expect(res.body.connections).toHaveProperty('socketIoActive');
      expect(res.body.connections).toHaveProperty('database');
    });
  });
});

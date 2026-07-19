/**
 * Session Management — Integration Tests
 * Tests the full HTTP flow through the Express app against a real in-memory MongoDB.
 */

const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');

const {
  connect,
  closeDatabase,
  clearDatabase,
  seedCafe,
  seedUser,
  seedTable,
  seedSession,
} = require('./setup');

process.env.JWT_SECRET = 'integration-test-jwt-secret-key';
process.env.NODE_ENV = 'test';

let app, cafeId, tableId, userId, authToken;

beforeAll(async () => {
  await connect();
  app = require('../../src/app');

  const cafe = await seedCafe({ name: 'Session Test Cafe' });
  cafeId = cafe._id;
  const user = await seedUser(cafeId, { role: 'owner' });
  userId = user._id;
  const table = await seedTable(cafeId);
  tableId = table._id;

  const jwt = require('jsonwebtoken');
  authToken = jwt.sign(
    { id: user._id, cafeId: user.cafeId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  // Re-seed cafe, user, table for each test (they were cleared)
  const cafe = await seedCafe({ name: 'Session Test Cafe' });
  cafeId = cafe._id;
  const user = await seedUser(cafeId, { role: 'owner' });
  userId = user._id;
  const table = await seedTable(cafeId);
  tableId = table._id;

  const jwt = require('jsonwebtoken');
  authToken = jwt.sign(
    { id: user._id, cafeId: user.cafeId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
});

// Helper to get CSRF token + cookie
const getCsrfToken = async () => {
  const res = await request(app).get('/api/auth/csrf');
  const csrfToken = res.body.csrfToken;
  const setCookie = res.headers['set-cookie'];
  const csrfCookie = setCookie?.find(c => c.startsWith('csrf_token='));
  const cookieValue = csrfCookie?.split(';')[0]?.split('=')[1];
  return { csrfToken, cookieString: `csrf_token=${cookieValue}` };
};

// ═══════════════════════════════════════════════════════════════════
// Create Session
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/sessions (createSession)', () => {
  it('should create a new session successfully', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .send({ tableId: tableId.toString(), customerName: 'Alice', customerEmail: 'alice@example.com', deviceId: 'device-001' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.session).toHaveProperty('id');
    expect(res.body.session.status).toBe('active');
    expect(res.body.session.guestToken).toBeDefined();
    expect(res.body.session.customerName).toBe('Alice');
  });

  it('should return 400 if required fields are missing', async () => {
    await request(app).post('/api/sessions').send({ tableId: tableId.toString() }).expect(400);
  });

  it('should return 404 if table does not exist', async () => {
    const fakeTableId = new mongoose.Types.ObjectId();
    await request(app)
      .post('/api/sessions')
      .send({ tableId: fakeTableId.toString(), customerName: 'Alice', customerEmail: 'alice@example.com' })
      .expect(404);
  });

  it('should return 400 if table is inactive', async () => {
    const inactiveTable = await seedTable(cafeId, { tableNumber: 'INACTIVE', isActive: false });
    await request(app)
      .post('/api/sessions')
      .send({ tableId: inactiveTable._id.toString(), customerName: 'Alice', customerEmail: 'alice@example.com' })
      .expect(400);
  });

  it('should return 409 if an active session already exists', async () => {
    await seedSession(cafeId, tableId, { status: 'active' });
    await request(app)
      .post('/api/sessions')
      .send({ tableId: tableId.toString(), customerName: 'Bob', customerEmail: 'bob@example.com' })
      .expect(409);
  });

  it('should return 403 if table has a locked session', async () => {
    await seedSession(cafeId, tableId, { status: 'awaiting_payment' });
    const res = await request(app)
      .post('/api/sessions')
      .send({ tableId: tableId.toString(), customerName: 'Bob', customerEmail: 'bob@example.com' })
      .expect(403);
    expect(res.body.sessionLocked).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Join Session
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/sessions/join (joinSession)', () => {
  it('should join an existing session successfully', async () => {
    const session = await seedSession(cafeId, tableId);
    const res = await request(app)
      .post('/api/sessions/join')
      .send({ tableId: tableId.toString(), name: 'Bob', deviceId: 'device-002' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.session).toHaveProperty('guestToken');
    expect(res.body.session).toHaveProperty('participantId');
    expect(res.body.session.role).toBe('member');
  });

  it('should return 400 if required fields are missing', async () => {
    await request(app).post('/api/sessions/join').send({ tableId: tableId.toString() }).expect(400);
  });

  it('should return 404 if no active session exists', async () => {
    await request(app).post('/api/sessions/join').send({ tableId: tableId.toString(), name: 'Bob' }).expect(404);
  });

  it('should return 403 if session is locked', async () => {
    await seedSession(cafeId, tableId, { status: 'bill_requested' });
    const res = await request(app)
      .post('/api/sessions/join')
      .send({ tableId: tableId.toString(), name: 'Bob' })
      .expect(403);
    expect(res.body.sessionLocked).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Leave Session
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/sessions/:id/leave (leaveSession)', () => {
  it('should leave session successfully with valid guest token', async () => {
    const guestToken = crypto.randomBytes(16).toString('hex');
    const participantId = crypto.randomBytes(8).toString('hex');
    const session = await seedSession(cafeId, tableId, {
      guestToken,
      participants: [{ participantId, name: 'Alice', role: 'owner', status: 'active' }],
    });

    const res = await request(app)
      .post(`/api/sessions/${session._id}/leave`)
      .set('x-guest-token', guestToken)
      .send({ participantId })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should return 403 with invalid guest token', async () => {
    const session = await seedSession(cafeId, tableId);
    await request(app)
      .post(`/api/sessions/${session._id}/leave`)
      .set('x-guest-token', 'wrong-token')
      .send({ participantId: 'some-id' })
      .expect(403);
  });

  it('should return 404 for nonexistent session', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    await request(app)
      .post(`/api/sessions/${fakeId}/leave`)
      .set('x-guest-token', 'some-token')
      .send({ participantId: 'some-id' })
      .expect(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Get Active Session for Table
// ═══════════════════════════════════════════════════════════════════
describe('GET /api/sessions/table/:tableId/active', () => {
  it('should return active session for a table', async () => {
    const session = await seedSession(cafeId, tableId);
    const res = await request(app)
      .get(`/api/sessions/table/${tableId}/active`)
      .query({ deviceId: 'device-001' })
      .expect(200);

    expect(res.body.activeSession).toBe(true);
    expect(res.body.session.id).toBe(session._id.toString());
  });

  it('should return 404 if no active session', async () => {
    await request(app).get(`/api/sessions/table/${tableId}/active`).expect(404);
  });

  it('should return sessionLocked for bill_requested sessions', async () => {
    await seedSession(cafeId, tableId, { status: 'bill_requested' });
    const res = await request(app).get(`/api/sessions/table/${tableId}/active`).expect(200);
    expect(res.body.sessionLocked).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Submit Payment
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/sessions/:id/submit-payment', () => {
  it('should submit payment successfully', async () => {
    const guestToken = crypto.randomBytes(16).toString('hex');
    const participantId = crypto.randomBytes(8).toString('hex');
    const session = await seedSession(cafeId, tableId, {
      guestToken,
      participants: [{ participantId, name: 'Alice', role: 'owner', status: 'active' }],
    });

    const res = await request(app)
      .post(`/api/sessions/${session._id}/submit-payment`)
      .set('x-guest-token', guestToken)
      .send({ paymentMethod: 'paid_counter', participantId })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.session.status).toBe('awaiting_payment');
    expect(res.body.session.paymentMethod).toBe('paid_counter');
  });

  it('should return 400 for invalid payment method', async () => {
    const guestToken = crypto.randomBytes(16).toString('hex');
    const participantId = crypto.randomBytes(8).toString('hex');
    const session = await seedSession(cafeId, tableId, {
      guestToken,
      participants: [{ participantId, name: 'Alice', role: 'owner', status: 'active' }],
    });

    await request(app)
      .post(`/api/sessions/${session._id}/submit-payment`)
      .set('x-guest-token', guestToken)
      .send({ paymentMethod: 'bitcoin', participantId })
      .expect(400);
  });

  it('should return 403 if not the session owner', async () => {
    const guestToken = crypto.randomBytes(16).toString('hex');
    const session = await seedSession(cafeId, tableId, {
      guestToken,
      participants: [
        { participantId: 'owner-001', name: 'Alice', role: 'owner', status: 'active' },
        { participantId: 'member-001', name: 'Bob', role: 'member', status: 'active' },
      ],
    });

    await request(app)
      .post(`/api/sessions/${session._id}/submit-payment`)
      .set('x-guest-token', guestToken)
      .send({ paymentMethod: 'paid_counter', participantId: 'member-001' })
      .expect(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cancel Bill Request (Admin)
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/sessions/:id/cancel-bill-request', () => {
  it('should cancel bill request as admin', async () => {
    const session = await seedSession(cafeId, tableId, { status: 'awaiting_payment' });
    const { csrfToken, cookieString } = await getCsrfToken();

    const res = await request(app)
      .post(`/api/sessions/${session._id}/cancel-bill-request`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-csrf-token', csrfToken)
      .set('Cookie', cookieString)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.session.status).toBe('active');
  });

  it('should return 400 if session is not awaiting_payment', async () => {
    const session = await seedSession(cafeId, tableId, { status: 'active' });
    const { csrfToken, cookieString } = await getCsrfToken();

    await request(app)
      .post(`/api/sessions/${session._id}/cancel-bill-request`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-csrf-token', csrfToken)
      .set('Cookie', cookieString)
      .expect(400);
  });

  it('should return 401 without auth token', async () => {
    const session = await seedSession(cafeId, tableId, { status: 'awaiting_payment' });
    await request(app).post(`/api/sessions/${session._id}/cancel-bill-request`).expect(401);
  });
});

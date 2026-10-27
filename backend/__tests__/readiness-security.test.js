/**
 * Readiness Security & Isolation Suite (Stage 1 / SEC-001 to SEC-014, CUS-005, CUS-007, CUS-012, CUS-015)
 *
 * Verifies:
 * 1. SEC-001: Tenant ID injection in body/headers overridden by JWT claims.
 * 2. SEC-002: Cross-tenant isolation (order read/update restricted to cafeId).
 * 3. SEC-003 / CUS-005: Public order tracking sanitization (no unauthorized reads by ObjectId).
 * 4. CUS-007: clientRequestId index is tenant-isolated (no cross-cafe collisions).
 * 5. CUS-012: Line item quantity upper bound ceiling (1..50).
 * 6. CUS-015: Cafe operational status and ordering paused gate (403 for diners, bypass for POS).
 * 7. SEC-007: CSRF double-cookie enforcement on state-changing admin requests.
 */

const request = require('supertest');
const mongoose = require('mongoose');

const {
  connect,
  closeDatabase,
  clearDatabase,
  seedCafe,
  seedUser,
  seedTable,
  seedCategory,
  seedMenuItem,
  seedSession,
  generateToken,
} = require('./integration/setup');

process.env.JWT_SECRET = 'readiness-security-test-jwt-secret-key';
process.env.NODE_ENV = 'test';

let app;

beforeAll(async () => {
  await connect();
  app = require('../src/app');
});

afterAll(async () => {
  await closeDatabase();
});

describe('Stage 1 Readiness & Security Test Suite', () => {
  let cafeA, cafeB;
  let ownerTokenA, ownerTokenB;
  let tableA, tableB;
  let menuItemA, menuItemB;
  let sessionA, sessionB;

  beforeEach(async () => {
    await clearDatabase();

    // Seed Cafe A and Cafe B
    cafeA = await seedCafe({ name: 'Cafe Alpha' });
    cafeB = await seedCafe({ name: 'Cafe Beta' });

    const userA = await seedUser(cafeA._id, { role: 'owner' });
    const userB = await seedUser(cafeB._id, { role: 'owner' });

    ownerTokenA = generateToken({
      id: userA._id,
      email: userA.email,
      role: 'owner',
      cafeId: cafeA._id,
    });

    ownerTokenB = generateToken({
      id: userB._id,
      email: userB.email,
      role: 'owner',
      cafeId: cafeB._id,
    });

    tableA = await seedTable(cafeA._id, { tableNumber: 'T-A1' });
    tableB = await seedTable(cafeB._id, { tableNumber: 'T-B1' });

    const catA = await seedCategory(cafeA._id, { name: 'Mains A' });
    const catB = await seedCategory(cafeB._id, { name: 'Mains B' });

    menuItemA = await seedMenuItem(cafeA._id, catA._id, { name: 'Latte', price: 150, gstPercentage: 5, isAvailable: true });
    menuItemB = await seedMenuItem(cafeB._id, catB._id, { name: 'Cappuccino', price: 160, gstPercentage: 5, isAvailable: true });

    sessionA = await seedSession(cafeA._id, tableA._id);
    sessionB = await seedSession(cafeB._id, tableB._id);
  });

  describe('SEC-001 & SEC-002: Tenant Isolation & Claim Override', () => {
    it('overrides any client-supplied cafeId in headers or query with JWT claims', async () => {
      // Owner A requests orders but supplies cafeB in query or headers
      const res = await request(app)
        .get(`/api/orders?cafeId=${cafeB._id}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-cafe-id', String(cafeB._id));

      expect(res.status).toBe(200);
      // All returned orders must belong strictly to cafeA
      for (const order of res.body.orders || []) {
        expect(String(order.cafeId)).toBe(String(cafeA._id));
      }
    });

    it('returns 404 when an admin attempts to read an order belonging to another tenant', async () => {
      // Create an order in Cafe B
      const createRes = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionB.guestToken)
        .send({
          tableId: tableB._id,
          sessionId: sessionB._id,
          items: [{ menuItemId: menuItemB._id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderBId = createRes.body.orderId;

      // Owner A tries to fetch Cafe B order via admin endpoint
      const readRes = await request(app)
        .get(`/api/orders/${orderBId}`)
        .set('Authorization', `Bearer ${ownerTokenA}`);

      expect(readRes.status).toBe(404);
      expect(readRes.body.message).toMatch(/not found/i);
    });
  });

  describe('Task 1.1: Sanitize & Bind Public Order Tracking (SEC-003, CUS-005)', () => {
    let orderAId;

    beforeEach(async () => {
      const createRes = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          items: [{ menuItemId: menuItemA._id, quantity: 2 }],
        });
      expect(createRes.status).toBe(201);
      orderAId = createRes.body.orderId;
    });

    it('returns 404 when an unauthenticated caller attempts to probe order details without token', async () => {
      const res = await request(app).get(`/api/orders/public/${orderAId}`);
      expect(res.status).toBe(404);
    });

    it('returns 404 when requested with an invalid or mismatched guest token', async () => {
      const res = await request(app)
        .get(`/api/orders/public/${orderAId}`)
        .set('x-guest-token', 'wrong-token-for-another-session');
      expect(res.status).toBe(404);
    });

    it('returns public sanitized details when authorized with the active session guest token', async () => {
      const res = await request(app)
        .get(`/api/orders/public/${orderAId}`)
        .set('x-guest-token', sessionA.guestToken);

      expect(res.status).toBe(200);
      expect(res.body.order).toBeDefined();
      expect(res.body.order.orderNumber).toBeDefined();
      expect(res.body.order.items).toHaveLength(1);
      expect(res.body.order.items[0].quantity).toBe(2);
      // Sensitive fields must not leak
      expect(res.body.order.cafeId).toBeUndefined();
      expect(res.body.order.createdByStaffId).toBeUndefined();
    });

    it('returns 404 for public order status when requested without authorized token', async () => {
      const res = await request(app).get(`/api/orders/public/${orderAId}/status`);
      expect(res.status).toBe(404);
    });

    it('returns status when authorized with active guest token', async () => {
      const res = await request(app)
        .get(`/api/orders/public/${orderAId}/status`)
        .set('x-guest-token', sessionA.guestToken);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
    });
  });

  describe('Task 1.2: Tenant-Isolate clientRequestId Index (SEC-001, CUS-007)', () => {
    it('allows two separate cafes to use the exact same clientRequestId without duplicate key collision', async () => {
      const sharedRequestId = 'client-uuid-shared-12345';

      // Cafe A creates order with sharedRequestId
      const resA = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          clientRequestId: sharedRequestId,
          items: [{ menuItemId: menuItemA._id, quantity: 1 }],
        });
      expect(resA.status).toBe(201);
      expect(resA.body.orderId).toBeDefined();

      // Cafe B creates order with the identical sharedRequestId
      const resB = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionB.guestToken)
        .send({
          tableId: tableB._id,
          sessionId: sessionB._id,
          clientRequestId: sharedRequestId,
          items: [{ menuItemId: menuItemB._id, quantity: 1 }],
        });
      expect(resB.status).toBe(201);
      expect(resB.body.orderId).toBeDefined();
      expect(String(resB.body.orderId)).not.toBe(String(resA.body.orderId));
    });

    it('returns the existing order idempotently when the same cafe retries with the same clientRequestId', async () => {
      const requestId = 'idempotent-retry-test-999';

      const firstRes = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          clientRequestId: requestId,
          items: [{ menuItemId: menuItemA._id, quantity: 1 }],
        });
      expect(firstRes.status).toBe(201);

      const secondRes = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          clientRequestId: requestId,
          items: [{ menuItemId: menuItemA._id, quantity: 1 }],
        });
      expect(secondRes.status).toBe(200);
      expect(String(secondRes.body.orderId)).toBe(String(firstRes.body.orderId));
    });
  });

  describe('Task 1.3: Enforce Order Item Quantity Ceiling (CUS-012)', () => {
    it('rejects an order when item quantity exceeds 50', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          items: [{ menuItemId: menuItemA._id, quantity: 51 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/quantity cannot exceed 50/i);
    });

    it('rejects an order when item quantity is zero, negative, or fractional', async () => {
      const zeroRes = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          items: [{ menuItemId: menuItemA._id, quantity: 0 }],
        });
      expect(zeroRes.status).toBe(400);

      const negRes = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          items: [{ menuItemId: menuItemA._id, quantity: -2 }],
        });
      expect(negRes.status).toBe(400);

      const fracRes = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          items: [{ menuItemId: menuItemA._id, quantity: 2.5 }],
        });
      expect(fracRes.status).toBe(400);
    });

    it('accepts an order with the maximum boundary quantity of 50', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          items: [{ menuItemId: menuItemA._id, quantity: 50 }],
        });

      expect(res.status).toBe(201);
      expect(res.body.orderId).toBeDefined();
    });
  });

  describe('Task 1.4: Cafe Operational & Ordering Paused Gate (CUS-015)', () => {
    it('rejects customer QR order with 403 when cafe.isOrderingPaused is true', async () => {
      // Pause ordering for Cafe A
      cafeA.isOrderingPaused = true;
      cafeA.orderingPausedReason = 'Kitchen is overwhelmed. Paused for 30 mins.';
      await cafeA.save();

      const res = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          items: [{ menuItemId: menuItemA._id, quantity: 1 }],
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Cafe is currently not accepting orders/i);
      expect(res.body.message).toMatch(/Kitchen is overwhelmed/i);
    });

    it('rejects customer QR order with 403 when outside operating hours', async () => {
      // Set operating hours to closed window (e.g. 03:00 to 03:30 am)
      cafeA.isOrderingPaused = false;
      cafeA.operatingHours = {
        enabled: true,
        openTime: '03:00',
        closeTime: '03:30',
        days: [0, 1, 2, 3, 4, 5, 6],
      };
      await cafeA.save();

      const res = await request(app)
        .post('/api/orders')
        .set('x-guest-token', sessionA.guestToken)
        .send({
          tableId: tableA._id,
          sessionId: sessionA._id,
          items: [{ menuItemId: menuItemA._id, quantity: 1 }],
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/outside operating hours|closed today/i);
    });

    it('allows counter POS channel to bypass ordering pause', async () => {
      cafeA.isOrderingPaused = true;
      cafeA.orderingPausedReason = 'Digital QR orders paused';
      await cafeA.save();

      // Get CSRF token for POS mutation
      const csrfRes = await request(app).get('/api/auth/csrf');
      const csrfToken = csrfRes.body.csrfToken;
      const csrfCookie = csrfRes.headers['set-cookie'];

      const posRes = await request(app)
        .post('/api/pos/orders')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-csrf-token', csrfToken)
        .set('Cookie', csrfCookie)
        .send({
          orderType: 'takeaway',
          items: [{ menuItemId: menuItemA._id, quantity: 1 }],
          payment: { method: 'cash', amount: 157.5 },
        });

      expect(posRes.status).toBe(201);
      expect(posRes.body.order).toBeDefined();
    });
  });

  describe('SEC-007: CSRF Double-Cookie Enforcement', () => {
    it('blocks state-changing admin mutation when x-csrf-token header is missing', async () => {
      const res = await request(app)
        .put('/api/cafe')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ name: 'Hacked Cafe Name' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/CSRF/i);
    });

    it('allows state-changing admin mutation when valid CSRF double-cookie is present', async () => {
      const csrfRes = await request(app).get('/api/auth/csrf');
      const csrfToken = csrfRes.body.csrfToken;
      const csrfCookie = csrfRes.headers['set-cookie'];

      const res = await request(app)
        .put('/api/cafe')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-csrf-token', csrfToken)
        .set('Cookie', csrfCookie)
        .send({ name: 'Updated Cafe Alpha' });

      expect(res.status).toBe(200);
      expect(res.body.cafe.name).toBe('Updated Cafe Alpha');
    });
  });
});

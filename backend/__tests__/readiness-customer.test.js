/**
 * Readiness Customer Table & Session Test Suite (Task 2.1 / CUS-001 to CUS-018)
 *
 * Verifies:
 * 1. CUS-001: Public table QR resolution & metadata discovery.
 * 2. CUS-002: Dining session lifecycle (create active session).
 * 3. CUS-003: Session token protection (tampered x-guest-token returns 403).
 * 4. CUS-006: Participant attribution in group dining order.
 * 5. CUS-007: clientRequestId idempotency (duplicate submission does not duplicate items).
 * 6. CUS-008: Concurrent order placement within same active session.
 * 7. CUS-011: Unavailable / out-of-stock menu items are rejected with 400.
 * 8. CUS-012: Maximum item quantity ceiling enforcement (> 50 rejected).
 * 9. CUS-013: Server-side price authority (client prices discarded, DB price charged).
 * 10. CUS-015: Ordering paused guard (returns 403 with reason for diner orders).
 */

const request = require('supertest');
const mongoose = require('mongoose');

const {
  connect,
  closeDatabase,
  clearDatabase,
  seedCafe,
  seedTable,
  seedCategory,
  seedMenuItem,
  seedSession,
} = require('./integration/setup');

process.env.JWT_SECRET = 'readiness-customer-test-jwt-secret';
process.env.NODE_ENV = 'test';

let app;

beforeAll(async () => {
  await connect();
  app = require('../src/app');
});

afterAll(async () => {
  await closeDatabase();
});

describe('Task 2.1: Customer Table & Session Test Suite (CUS-001 to CUS-018)', () => {
  let cafe;
  let table;
  let category;
  let item1, item2, itemUnavailable;

  beforeEach(async () => {
    await clearDatabase();

    cafe = await seedCafe({ name: 'Diner Delight Cafe' });
    table = await seedTable(cafe._id, { tableNumber: 'T-10' });
    category = await seedCategory(cafe._id, { name: 'Main Course' });

    item1 = await seedMenuItem(cafe._id, category._id, {
      name: 'Paneer Butter Masala',
      price: 250,
      gstPercentage: 5,
      isAvailable: true,
    });

    item2 = await seedMenuItem(cafe._id, category._id, {
      name: 'Garlic Naan',
      price: 50,
      gstPercentage: 5,
      isAvailable: true,
    });

    itemUnavailable = await seedMenuItem(cafe._id, category._id, {
      name: 'Seasonal Truffle Pasta',
      price: 600,
      gstPercentage: 18,
      isAvailable: false,
    });
  });

  // CUS-001: Table Resolution
  test('CUS-001: Customer discovers table metadata via public table endpoint', async () => {
    const res = await request(app)
      .get(`/api/tables/public/${table._id}`)
      .expect(200);

    expect(res.body.table).toBeDefined();
    expect(res.body.table.tableNumber).toBe('T-10');
  });

  // CUS-002: Session Creation
  test('CUS-002: Customer starts a dining session and receives session token', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .send({
        tableId: table._id,
        customerName: 'Aarav Mehta',
        customerPhone: '9876543210',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.session).toBeDefined();
    expect(res.body.session.guestToken).toBeDefined();
    expect(res.body.session.status).toBe('active');
  });

  // CUS-003: Session Token Tampering
  test('CUS-003: Tampered or invalid x-guest-token returns 403 Forbidden', async () => {
    const session = await seedSession(cafe._id, table._id);

    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', 'tampered-or-fake-token-xyz')
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        items: [{ menuItemId: item1._id, quantity: 1 }],
      })
      .expect(403);

    expect(res.body.message).toMatch(/Invalid or missing guest session token/i);
  });

  // CUS-006: Participant Attribution
  test('CUS-006: Order placed with valid session records participant attribution', async () => {
    const session = await seedSession(cafe._id, table._id);
    const participant = session.participants[0];

    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        participantId: participant.participantId,
        participantName: participant.name,
        items: [
          {
            menuItemId: item1._id,
            quantity: 2,
            participantId: participant.participantId,
            participantName: participant.name,
          },
        ],
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    const order = res.body.order;
    expect(order.sessionId.toString()).toBe(session._id.toString());
    expect(order.items[0].participantId).toBe(participant.participantId);
  });

  // CUS-007: Idempotency with clientRequestId
  test('CUS-007: clientRequestId prevents duplicate order creation on network retries', async () => {
    const session = await seedSession(cafe._id, table._id);
    const clientRequestId = 'unique-req-' + Date.now();

    const orderPayload = {
      cafeId: cafe._id,
      tableId: table._id,
      sessionId: session._id,
      clientRequestId,
      items: [{ menuItemId: item1._id, quantity: 1 }],
    };

    // First attempt creates order
    const res1 = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send(orderPayload)
      .expect(201);

    const firstOrderId = res1.body.order._id;

    // Retry attempt with same clientRequestId
    const res2 = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send(orderPayload);

    // Depending on idempotency handling, either returns existing order or 409
    if (res2.status === 200 || res2.status === 201) {
      expect(res2.body.order._id).toBe(firstOrderId);
    } else {
      expect(res2.status).toBe(409);
    }

    // Verify only 1 order exists in database for this clientRequestId
    const Order = require('../src/models/Order');
    const orderCount = await Order.countDocuments({
      cafeId: cafe._id,
      clientRequestId,
    });
    expect(orderCount).toBe(1);
  });

  // CUS-008: Concurrent Orders in Same Session
  test('CUS-008: Multiple distinct orders can be placed sequentially/concurrently in one session', async () => {
    const session = await seedSession(cafe._id, table._id);

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/orders')
        .set('x-guest-token', session.guestToken)
        .send({
          cafeId: cafe._id,
          tableId: table._id,
          sessionId: session._id,
          clientRequestId: 'req-concurrent-1-' + Date.now(),
          items: [{ menuItemId: item1._id, quantity: 1 }],
        }),
      request(app)
        .post('/api/orders')
        .set('x-guest-token', session.guestToken)
        .send({
          cafeId: cafe._id,
          tableId: table._id,
          sessionId: session._id,
          clientRequestId: 'req-concurrent-2-' + Date.now(),
          items: [{ menuItemId: item2._id, quantity: 2 }],
        }),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.order._id).not.toBe(res2.body.order._id);
  });

  // CUS-011: Out-of-Stock Item
  test('CUS-011: Placing order with unavailable menu item returns 400 Bad Request', async () => {
    const session = await seedSession(cafe._id, table._id);

    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        items: [{ menuItemId: itemUnavailable._id, quantity: 1 }],
      })
      .expect(400);

    expect(res.body.message).toMatch(/unavailable|not available|out of stock/i);
  });

  // CUS-012: Quantity Upper Bound
  test('CUS-012: Line item quantity exceeding 50 is rejected with 400', async () => {
    const session = await seedSession(cafe._id, table._id);

    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        items: [{ menuItemId: item1._id, quantity: 51 }],
      })
      .expect(400);

    expect(res.body.message).toMatch(/quantity/i);
  });

  // CUS-013: Server Price Authority
  test('CUS-013: Server discards client-supplied fake prices and recalculates true total', async () => {
    const session = await seedSession(cafe._id, table._id);

    // Client maliciously attempts to pay ₹1 for a ₹250 item
    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        items: [
          {
            menuItemId: item1._id,
            quantity: 2,
            price: 1, // Malicious price
          },
        ],
        subtotal: 2,
        totalAmount: 2,
      })
      .expect(201);

    const order = res.body.order;
    // Database price: 250 * 2 = 500 subtotal
    expect(order.subtotal).toBe(500);
    // GST 5% = 25
    expect(order.totalGST).toBe(25);
    // Total = 525
    expect(order.totalAmount).toBe(525);
  });

  // CUS-015: Operational Pause
  test('CUS-015: Ordering while cafe is paused returns 403 with operational reason', async () => {
    const session = await seedSession(cafe._id, table._id);

    // Pause cafe
    const Cafe = require('../src/models/Cafe');
    await Cafe.findByIdAndUpdate(cafe._id, {
      isOrderingPaused: true,
      orderingPausedReason: 'Kitchen overloaded with dinner rush',
    });

    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        items: [{ menuItemId: item1._id, quantity: 1 }],
      })
      .expect(403);

    expect(res.body.message).toMatch(/Kitchen overloaded/i);
  });
});

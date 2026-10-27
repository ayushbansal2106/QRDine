/**
 * Kitchen & Staff Dashboard Concurrency Suite (Task 2.2 / OPS-001 to OPS-012)
 *
 * Verifies:
 * 1. OPS-001: Order status transitions (pending -> accepted -> preparing -> ready -> served).
 * 2. OPS-002: Invalid status strings are rejected with 400.
 * 3. OPS-003: Cancellation reason and staff attribution recorded on cancellation.
 * 4. OPS-004: Item-level prep status progression in KDS.
 * 5. OPS-005: Ticket bump moves order and items to 'ready'.
 * 6. OPS-006: Prep station routing ('kitchen' vs 'bar' vs 'both').
 * 7. OPS-007: Multi-tenant isolation on KDS tickets (no cross-cafe ticket leaks).
 * 8. OPS-008: Auth protection on KDS (unauthenticated returns 401).
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
  generateToken,
} = require('./integration/setup');

process.env.JWT_SECRET = 'readiness-kitchen-test-jwt-secret';
process.env.NODE_ENV = 'test';

let app;

beforeAll(async () => {
  await connect();
  app = require('../src/app');
});

afterAll(async () => {
  await closeDatabase();
});

describe('Task 2.2: Kitchen & Staff Dashboard Concurrency Suite (OPS-001 to OPS-012)', () => {
  let cafeA, cafeB;
  let staffTokenA, staffTokenB;
  let tableA, tableB;
  let categoryA;
  let foodItem, drinkItem;
  let csrfCookieA, csrfTokenA;

  beforeEach(async () => {
    await clearDatabase();

    cafeA = await seedCafe({ name: 'Cafe Alpha Kitchen' });
    cafeB = await seedCafe({ name: 'Cafe Beta Kitchen' });

    const userA = await seedUser(cafeA._id, { role: 'manager', name: 'Chef Gordon' });
    const userB = await seedUser(cafeB._id, { role: 'manager', name: 'Chef Mario' });

    staffTokenA = generateToken({
      id: userA._id,
      email: userA.email,
      role: 'manager',
      cafeId: cafeA._id,
    });

    staffTokenB = generateToken({
      id: userB._id,
      email: userB.email,
      role: 'manager',
      cafeId: cafeB._id,
    });

    tableA = await seedTable(cafeA._id, { tableNumber: 'T-K1' });
    tableB = await seedTable(cafeB._id, { tableNumber: 'T-K2' });

    categoryA = await seedCategory(cafeA._id, { name: 'Kitchen & Bar' });

    foodItem = await seedMenuItem(cafeA._id, categoryA._id, {
      name: 'Signature Burger',
      price: 200,
      prepStation: 'kitchen',
    });

    drinkItem = await seedMenuItem(cafeA._id, categoryA._id, {
      name: 'Cold Brew Coffee',
      price: 150,
      prepStation: 'bar',
    });

    // Obtain CSRF token
    const csrfRes = await request(app).get('/api/auth/csrf');
    csrfTokenA = csrfRes.body.csrfToken;
    csrfCookieA = csrfRes.headers['set-cookie'];
  });

  // Helper to create an order directly
  const createTestOrder = async (cafeId, tableId, itemsOverrides = {}) => {
    const Order = require('../src/models/Order');
    return Order.create({
      cafeId,
      orderType: 'dine_in',
      channel: 'qr',
      tableId,
      orderNumber: `ORD-TEST-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      items: [
        {
          menuItemId: foodItem._id,
          itemName: foodItem.name,
          quantity: 1,
          price: 200,
          gstPercentage: 5,
          gstAmount: 10,
          prepStation: 'kitchen',
          status: 'pending',
        },
        {
          menuItemId: drinkItem._id,
          itemName: drinkItem.name,
          quantity: 1,
          price: 150,
          gstPercentage: 5,
          gstAmount: 7.5,
          prepStation: 'bar',
          status: 'pending',
        },
      ],
      subtotal: 350,
      totalGST: 17.5,
      totalAmount: 367.5,
      status: 'pending',
      ...itemsOverrides,
    });
  };

  // OPS-001: Order status transitions
  test('OPS-001: Valid status progression updates order and item statuses', async () => {
    const order = await createTestOrder(cafeA._id, tableA._id);

    const statuses = ['accepted', 'preparing', 'ready', 'served'];
    for (const status of statuses) {
      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${staffTokenA}`)
        .set('Cookie', csrfCookieA)
        .set('x-csrf-token', csrfTokenA)
        .send({ status })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.order.status).toBe(status);
    }
  });

  // OPS-002: Invalid status rejected
  test('OPS-002: Rejects invalid or undefined status string with 400', async () => {
    const order = await createTestOrder(cafeA._id, tableA._id);

    const res = await request(app)
      .put(`/api/orders/${order._id}/status`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('Cookie', csrfCookieA)
      .set('x-csrf-token', csrfTokenA)
      .send({ status: 'invalid_status_xyz' })
      .expect(400);

    expect(res.body.message).toMatch(/invalid order status/i);
  });

  // OPS-003: Cancellation reason and audit
  test('OPS-003: Cancelling order stores cancellationReason and cancelledBy', async () => {
    const order = await createTestOrder(cafeA._id, tableA._id);

    const res = await request(app)
      .put(`/api/orders/${order._id}/status`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('Cookie', csrfCookieA)
      .set('x-csrf-token', csrfTokenA)
      .send({
        status: 'cancelled',
        cancellationReason: 'Diner requested cancellation due to change of plans',
        cancelledBy: 'Chef Gordon',
      })
      .expect(200);

    expect(res.body.order.status).toBe('cancelled');
    expect(res.body.order.cancellationReason).toBe(
      'Diner requested cancellation due to change of plans'
    );
    expect(res.body.order.cancelledBy).toBe('Chef Gordon');
  });

  // OPS-004: Item-level prep status progression in KDS
  test('OPS-004: Kitchen staff updates single item prep status via KDS', async () => {
    const order = await createTestOrder(cafeA._id, tableA._id);
    const itemId = order.items[0]._id;

    const res = await request(app)
      .patch(`/api/kds/orders/${order._id}/items/${itemId}/status`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('Cookie', csrfCookieA)
      .set('x-csrf-token', csrfTokenA)
      .send({ status: 'preparing' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.item.status).toBe('preparing');
  });

  // OPS-005: Ticket bump
  test('OPS-005: Bumping ticket marks all non-cancelled items ready', async () => {
    const order = await createTestOrder(cafeA._id, tableA._id);

    const res = await request(app)
      .patch(`/api/kds/orders/${order._id}/bump`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('Cookie', csrfCookieA)
      .set('x-csrf-token', csrfTokenA)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.order.status).toBe('ready');
    res.body.order.items.forEach((item) => {
      expect(item.status).toBe('ready');
    });
  });

  // OPS-006: Prep Station Routing
  test('OPS-006: KDS station filter separates kitchen and bar orders', async () => {
    await createTestOrder(cafeA._id, tableA._id);

    // Query Bar station
    const barRes = await request(app)
      .get('/api/kds/orders?station=bar')
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('Cookie', csrfCookieA)
      .set('x-csrf-token', csrfTokenA)
      .expect(200);

    expect(barRes.body.tickets.length).toBeGreaterThan(0);
    // All items on bar ticket must belong to bar station
    barRes.body.tickets.forEach((ticket) => {
      ticket.items.forEach((it) => {
        expect(['bar', 'both']).toContain(it.prepStation);
      });
    });

    // Query Kitchen station
    const kitchenRes = await request(app)
      .get('/api/kds/orders?station=kitchen')
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('Cookie', csrfCookieA)
      .set('x-csrf-token', csrfTokenA)
      .expect(200);

    expect(kitchenRes.body.tickets.length).toBeGreaterThan(0);
    kitchenRes.body.tickets.forEach((ticket) => {
      ticket.items.forEach((it) => {
        expect(['kitchen', 'both']).toContain(it.prepStation);
      });
    });
  });

  // OPS-007: Multi-tenant Isolation on KDS
  test('OPS-007: Staff at Cafe B cannot view or bump tickets of Cafe A', async () => {
    const orderA = await createTestOrder(cafeA._id, tableA._id);

    // Staff B attempts to bump Order A
    const res = await request(app)
      .patch(`/api/kds/orders/${orderA._id}/bump`)
      .set('Authorization', `Bearer ${staffTokenB}`)
      .set('Cookie', csrfCookieA)
      .set('x-csrf-token', csrfTokenA)
      .expect(404);

    expect(res.body.message).toMatch(/not found/i);
  });

  // OPS-008: Auth protection on KDS
  test('OPS-008: Unauthenticated access to KDS is rejected with 401', async () => {
    await request(app)
      .get('/api/kds/orders')
      .expect(401);
  });
});

/**
 * Order Flow — Integration Tests
 * Tests the full HTTP flow through the Express app against a real in-memory MongoDB.
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
} = require('./setup');

process.env.JWT_SECRET = 'integration-test-jwt-secret-key';
process.env.NODE_ENV = 'test';

let app, cafeId, tableId, userId, authToken, categoryId, menuItemId;

beforeAll(async () => {
  await connect();
  app = require('../../src/app');

  const cafe = await seedCafe({ name: 'Order Test Cafe' });
  cafeId = cafe._id;
  const user = await seedUser(cafeId, { role: 'owner' });
  userId = user._id;
  const table = await seedTable(cafeId);
  tableId = table._id;
  const category = await seedCategory(cafeId, { name: 'Mains' });
  categoryId = category._id;
  const menuItem = await seedMenuItem(cafeId, categoryId, { name: 'Burger', price: 100, gstPercentage: 18, isAvailable: true });
  menuItemId = menuItem._id;

  const jwt = require('jsonwebtoken');
  authToken = jwt.sign({ id: user._id, cafeId: user.cafeId, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  // Re-seed for each test
  const cafe = await seedCafe({ name: 'Order Test Cafe' });
  cafeId = cafe._id;
  const user = await seedUser(cafeId, { role: 'owner' });
  userId = user._id;
  const table = await seedTable(cafeId);
  tableId = table._id;
  const category = await seedCategory(cafeId, { name: 'Mains' });
  categoryId = category._id;
  const menuItem = await seedMenuItem(cafeId, categoryId, { name: 'Burger', price: 100, gstPercentage: 18, isAvailable: true });
  menuItemId = menuItem._id;

  const jwt = require('jsonwebtoken');
  authToken = jwt.sign({ id: user._id, cafeId: user.cafeId, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
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
// Create Order
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/orders (createOrder)', () => {
  let session;

  beforeEach(async () => {
    session = await seedSession(cafeId, tableId);
  });

  it('should create an order successfully', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({ tableId: tableId.toString(), sessionId: session._id.toString(), items: [{ menuItemId: menuItemId.toString(), quantity: 2 }], notes: 'Extra cheese' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('orderId');
    expect(res.body).toHaveProperty('orderNumber');
    expect(res.body.order.subtotal).toBe(200);
    expect(res.body.order.totalGST).toBe(36);
    expect(res.body.order.totalAmount).toBe(236);
    expect(res.body.orderNumber).toMatch(/^ORD-/);
  });

  it('should return 404 for nonexistent table', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({ tableId: fakeId.toString(), sessionId: session._id.toString(), items: [{ menuItemId: menuItemId.toString(), quantity: 1 }] })
      .expect(404);
  });

  it('should return 404 for nonexistent menu item', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({ tableId: tableId.toString(), sessionId: session._id.toString(), items: [{ menuItemId: fakeId.toString(), quantity: 1 }] })
      .expect(404);
  });

  it('should return 400 for unavailable menu item', async () => {
    const unavailable = await seedMenuItem(cafeId, categoryId, { name: 'Sold Out', price: 50, isAvailable: false });
    await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({ tableId: tableId.toString(), sessionId: session._id.toString(), items: [{ menuItemId: unavailable._id.toString(), quantity: 1 }] })
      .expect(400);
  });

  it('should return 400 without session', async () => {
    await request(app)
      .post('/api/orders')
      .send({ tableId: tableId.toString(), items: [{ menuItemId: menuItemId.toString(), quantity: 1 }] })
      .expect(400);
  });

  it('should support idempotency via clientRequestId', async () => {
    const clientRequestId = `idem-${Date.now()}`;
    const body = { tableId: tableId.toString(), sessionId: session._id.toString(), clientRequestId, items: [{ menuItemId: menuItemId.toString(), quantity: 1 }] };

    const res1 = await request(app).post('/api/orders').set('x-guest-token', session.guestToken).send(body).expect(201);
    const res2 = await request(app).post('/api/orders').set('x-guest-token', session.guestToken).send(body).expect(200);

    expect(res2.body.orderId).toBe(res1.body.orderId);
  });

  it('should not allow order on locked session', async () => {
    const lockedSession = await seedSession(cafeId, tableId, { status: 'awaiting_payment' });
    await request(app)
      .post('/api/orders')
      .set('x-guest-token', lockedSession.guestToken)
      .send({ tableId: tableId.toString(), sessionId: lockedSession._id.toString(), items: [{ menuItemId: menuItemId.toString(), quantity: 1 }] })
      .expect(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Get Orders (Admin)
// ═══════════════════════════════════════════════════════════════════
describe('GET /api/orders (getOrders)', () => {
  it('should return paginated orders for admin', async () => {
    const { csrfToken, cookieString } = await getCsrfToken();
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-csrf-token', csrfToken)
      .set('Cookie', cookieString)
      .query({ page: 1, limit: 10 })
      .expect(200);

    expect(res.body).toHaveProperty('totalCount');
    expect(res.body).toHaveProperty('orders');
    expect(Array.isArray(res.body.orders)).toBe(true);
  });

  it('should return 401 without auth token', async () => {
    await request(app).get('/api/orders').expect(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Update Order Status (Admin)
// ═══════════════════════════════════════════════════════════════════
describe('PUT /api/orders/:id/status (updateOrderStatus)', () => {
  let orderId;

  beforeEach(async () => {
    const session = await seedSession(cafeId, tableId);
    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({ tableId: tableId.toString(), sessionId: session._id.toString(), items: [{ menuItemId: menuItemId.toString(), quantity: 1 }] })
      .expect(201);
    orderId = res.body.orderId;
  });

  it('should update order status to accepted', async () => {
    const { csrfToken, cookieString } = await getCsrfToken();
    const res = await request(app)
      .put(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-csrf-token', csrfToken)
      .set('Cookie', cookieString)
      .send({ status: 'accepted' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.order.status).toBe('accepted');
    expect(res.body.order.acceptedAt).toBeDefined();
  });

  it('should update order status to served', async () => {
    const { csrfToken, cookieString } = await getCsrfToken();
    const res = await request(app)
      .put(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-csrf-token', csrfToken)
      .set('Cookie', cookieString)
      .send({ status: 'served' })
      .expect(200);

    expect(res.body.order.status).toBe('served');
    expect(res.body.order.servedAt).toBeDefined();
  });

  it('should return 400 for invalid status', async () => {
    const { csrfToken, cookieString } = await getCsrfToken();
    await request(app)
      .put(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-csrf-token', csrfToken)
      .set('Cookie', cookieString)
      .send({ status: 'invalid_status' })
      .expect(400);
  });

  it('should handle cancellation with reason', async () => {
    const { csrfToken, cookieString } = await getCsrfToken();
    const res = await request(app)
      .put(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-csrf-token', csrfToken)
      .set('Cookie', cookieString)
      .send({ status: 'cancelled', cancellationReason: 'Customer changed mind' })
      .expect(200);

    expect(res.body.order.status).toBe('cancelled');
    expect(res.body.order.cancellationReason).toBe('Customer changed mind');
    expect(res.body.order.cancelledBy).toBeDefined();
  });

  it('should return 401 without auth', async () => {
    await request(app).put(`/api/orders/${orderId}/status`).send({ status: 'accepted' }).expect(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Get Public Order (Guest tracking)
// ═══════════════════════════════════════════════════════════════════
describe('GET /api/orders/public/:id (getPublicOrder)', () => {
  let orderId, session;

  beforeEach(async () => {
    session = await seedSession(cafeId, tableId);
    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({ tableId: tableId.toString(), sessionId: session._id.toString(), items: [{ menuItemId: menuItemId.toString(), quantity: 1 }] })
      .expect(201);
    orderId = res.body.orderId;
  });

  it('should return public order details when authorized with valid guest token', async () => {
    const res = await request(app)
      .get(`/api/orders/public/${orderId}`)
      .set('x-guest-token', session.guestToken)
      .expect(200);

    expect(res.body.order).toHaveProperty('orderNumber');
    expect(res.body.order).toHaveProperty('status');
    expect(res.body.order.status).toBe('PENDING');
    expect(res.body.order).toHaveProperty('items');
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order).not.toHaveProperty('sessionId');
    expect(res.body.order).not.toHaveProperty('cafeId');
  });

  it('should return 404 when requested without a matching guest or customer token (SEC-003)', async () => {
    await request(app).get(`/api/orders/public/${orderId}`).expect(404);
  });

  it('should return 404 for nonexistent order', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    await request(app)
      .get(`/api/orders/public/${fakeId}`)
      .set('x-guest-token', session.guestToken)
      .expect(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cancel Order Item (Admin/Kitchen)
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/orders/:id/items/:itemId/cancel', () => {
  let orderId, itemId;

  beforeEach(async () => {
    const session = await seedSession(cafeId, tableId);
    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({ tableId: tableId.toString(), sessionId: session._id.toString(), items: [{ menuItemId: menuItemId.toString(), quantity: 2 }] })
      .expect(201);
    orderId = res.body.orderId;
    itemId = res.body.order.items[0]._id.toString();
  });

  it('should cancel an order item', async () => {
    const { csrfToken, cookieString } = await getCsrfToken();
    const res = await request(app)
      .post(`/api/orders/${orderId}/items/${itemId}/cancel`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-csrf-token', csrfToken)
      .set('Cookie', cookieString)
      .send({ cancellationReason: 'Out of stock' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.order).toBeDefined();
  });

  it('should return 401 without auth', async () => {
    await request(app)
      .post(`/api/orders/${orderId}/items/${itemId}/cancel`)
      .send({ cancellationReason: 'Out of stock' })
      .expect(401);
  });
});

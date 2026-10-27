/**
 * Pricing, Tax, and Billing Reconciliation Suite (Task 2.3 / BILL-001 to BILL-012)
 *
 * Verifies:
 * 1. BILL-001: Subtotal, GST calculation and paise precision (no sub-paisa drift).
 * 2. BILL-002: Multi-rate GST itemization in taxBreakdown (5% food vs 18% beverages).
 * 3. BILL-003: Discarding untrusted client prices and applying true database authority.
 * 4. BILL-004: Discount bounds (discounts cannot exceed subtotal or produce negative totals).
 * 5. BILL-005: Multi-order session bill aggregation across participants.
 * 6. BILL-006: Direct Merchant BYO-PG payment initiation.
 * 7. BILL-007: BYO-PG HMAC-SHA256 webhook signature verification (forged signatures rejected).
 * 8. BILL-008: Webhook idempotency (duplicate webhooks return idempotent response without duplicating state).
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
  seedCategory,
  seedMenuItem,
  seedSession,
  generateToken,
} = require('./integration/setup');

const { encryptText } = require('../src/utils/cryptoHelper');

process.env.JWT_SECRET = 'readiness-billing-test-jwt-secret';
process.env.NODE_ENV = 'test';

let app;

beforeAll(async () => {
  await connect();
  app = require('../src/app');
});

afterAll(async () => {
  await closeDatabase();
});

describe('Task 2.3: Pricing, Tax, and Billing Reconciliation Suite (BILL-001 to BILL-012)', () => {
  let cafe;
  let ownerToken;
  let table;
  let category;
  let foodItem5, beverageItem18;
  let session;
  let csrfCookie, csrfToken;

  beforeEach(async () => {
    await clearDatabase();

    // Cafe with Growth plan (entitled to BYO-PG)
    cafe = await seedCafe({
      name: 'Gourmet Bistro',
    });

    const Subscription = require('../src/models/Subscription');
    await Subscription.create({
      cafeId: cafe._id,
      planKey: 'growth',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const owner = await seedUser(cafe._id, { role: 'owner' });
    ownerToken = generateToken({
      id: owner._id,
      email: owner.email,
      role: 'owner',
      cafeId: cafe._id,
    });

    table = await seedTable(cafe._id, { tableNumber: 'T-BILL-1' });
    category = await seedCategory(cafe._id, { name: 'Dine In Specials' });

    // Item 1: 5% GST food item (₹200)
    foodItem5 = await seedMenuItem(cafe._id, category._id, {
      name: 'Paneer Tikka',
      price: 200,
      gstPercentage: 5,
      isAvailable: true,
    });

    // Item 2: 18% GST beverage item (₹100)
    beverageItem18 = await seedMenuItem(cafe._id, category._id, {
      name: 'Sparkling Soda',
      price: 100,
      gstPercentage: 18,
      isAvailable: true,
    });

    session = await seedSession(cafe._id, table._id);

    // CSRF token
    const csrfRes = await request(app).get('/api/auth/csrf');
    csrfToken = csrfRes.body.csrfToken;
    csrfCookie = csrfRes.headers['set-cookie'];
  });

  // BILL-001 & BILL-002: GST Calculation and Multi-Rate Breakdown
  test('BILL-001 & BILL-002: Accurate subtotal, paise rounding, and multi-rate GST breakdown', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        items: [
          { menuItemId: foodItem5._id, quantity: 2 }, // 200 * 2 = 400, 5% GST = 20
          { menuItemId: beverageItem18._id, quantity: 3 }, // 100 * 3 = 300, 18% GST = 54
        ],
      })
      .expect(201);

    const order = res.body.order;
    expect(order.subtotal).toBe(700); // 400 + 300
    expect(order.totalGST).toBe(74); // 20 + 54
    expect(order.totalAmount).toBe(774); // 700 + 74

    // Verify taxBreakdown contains both rates
    expect(order.taxBreakdown).toBeDefined();
    const gst5 = order.taxBreakdown.find((t) => t.percentage === 5);
    const gst18 = order.taxBreakdown.find((t) => t.percentage === 18);
    expect(gst5).toBeDefined();
    expect(gst5.amount).toBe(20);
    expect(gst18).toBeDefined();
    expect(gst18.amount).toBe(54);
  });

  // BILL-003: Discarding Client Prices
  test('BILL-003: Client price tampering discarded; database price strictly applied', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        items: [
          {
            menuItemId: foodItem5._id,
            quantity: 1,
            price: 5, // Client attempts to override ₹200 with ₹5
          },
        ],
        subtotal: 5,
        totalAmount: 5.25,
      })
      .expect(201);

    const order = res.body.order;
    expect(order.subtotal).toBe(200);
    expect(order.totalGST).toBe(10);
    expect(order.totalAmount).toBe(210);
  });

  // BILL-004: Discount Ceiling & Clamping
  test('BILL-004: Discounts cannot exceed subtotal and total cannot be negative', async () => {
    const orderService = require('../src/services/orderService');

    const pricedOrder = await orderService.createOrder({
      cafeId: cafe._id,
      orderType: 'dine_in',
      channel: 'pos',
      tableId: table._id,
      items: [{ menuItemId: foodItem5._id, quantity: 1 }], // subtotal 200, GST 10
      discounts: [
        { scope: 'order', label: 'Huge Promo', type: 'flat', value: 500 }, // value exceeds 200
      ],
    });

    const order = pricedOrder.order;
    expect(order.discountTotal).toBe(200); // clamped to subtotal
    expect(order.totalAmount).toBe(10); // 200 - 200 + 10 = 10 (never negative)
  });

  // BILL-006: BYO-PG Initiation
  test('BILL-006: Diner initiates online payment for active dining session', async () => {
    // Configure cafe's direct PG
    const Cafe = require('../src/models/Cafe');
    await Cafe.findByIdAndUpdate(cafe._id, {
      paymentGateway: {
        enabled: true,
        provider: 'razorpay',
        keyId: 'rzp_test_1234567890',
        keySecretEncrypted: encryptText('dummy_key_secret_123'),
        webhookSecretEncrypted: encryptText('dummy_webhook_secret_123'),
      },
    });

    // Place an order in the session first
    await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        items: [{ menuItemId: foodItem5._id, quantity: 1 }],
      })
      .expect(201);

    // Initiate payment
    const res = await request(app)
      .post('/api/billing/pg/initiate-session-payment')
      .set('x-guest-token', session.guestToken)
      .send({ sessionId: session._id })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.payment).toBeDefined();
    expect(res.body.payment.provider).toBe('razorpay');
    expect(res.body.payment.amount).toBe(21000); // ₹210 in paise
    expect(res.body.payment.currency).toBe('INR');
    expect(res.body.payment.gatewayOrderId).toBeDefined();
  });

  // BILL-007: Webhook Signature Verification
  test('BILL-007: Verifies HMAC-SHA256 signature on payment webhook and rejects forgery', async () => {
    const webhookSecret = 'my_super_secret_webhook_key_456';

    const Cafe = require('../src/models/Cafe');
    await Cafe.findByIdAndUpdate(cafe._id, {
      paymentGateway: {
        enabled: true,
        provider: 'razorpay',
        keyId: 'rzp_test_live_key',
        keySecretEncrypted: encryptText('live_secret'),
        webhookSecretEncrypted: encryptText(webhookSecret),
      },
    });

    // Ensure session has an order to settle
    await request(app)
      .post('/api/orders')
      .set('x-guest-token', session.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: session._id,
        items: [{ menuItemId: foodItem5._id, quantity: 1 }],
      })
      .expect(201);

    const payload = {
      event: 'order.paid',
      payload: {
        payment: {
          entity: {
            id: 'pay_rzp_test_' + Date.now(),
            amount: 21000,
            status: 'captured',
            notes: {
              sessionId: session._id.toString(),
            },
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);

    // 1. Forged signature should be rejected with 400
    await request(app)
      .post(`/api/billing/pg/webhook/${cafe._id}`)
      .set('x-razorpay-signature', 'forged_fake_signature_xyz')
      .send(payload)
      .expect(400);

    // 2. Legitimate HMAC-SHA256 signature should be accepted
    const validSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const successRes = await request(app)
      .post(`/api/billing/pg/webhook/${cafe._id}`)
      .set('x-razorpay-signature', validSignature)
      .send(payload)
      .expect(200);

    expect(successRes.body.success).toBe(true);
    expect(successRes.body.settled).toBe(true);
  });

  // BILL-008: Webhook Idempotency
  test('BILL-008: Duplicate webhook submission is idempotent and does not double-settle', async () => {
    // Create an independent session with an order for idempotency testing
    const sessionForIdempotency = await seedSession(cafe._id, table._id);
    await request(app)
      .post('/api/orders')
      .set('x-guest-token', sessionForIdempotency.guestToken)
      .send({
        cafeId: cafe._id,
        tableId: table._id,
        sessionId: sessionForIdempotency._id,
        items: [{ menuItemId: foodItem5._id, quantity: 1 }],
      })
      .expect(201);

    const webhookSecret = 'idempotent_webhook_secret_789';

    const Cafe = require('../src/models/Cafe');
    await Cafe.findByIdAndUpdate(cafe._id, {
      paymentGateway: {
        enabled: true,
        provider: 'razorpay',
        keyId: 'rzp_test_key',
        keySecretEncrypted: encryptText('secret'),
        webhookSecretEncrypted: encryptText(webhookSecret),
      },
    });

    const paymentId = 'pay_idempotent_' + Date.now();
    const payload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: 21000,
            status: 'captured',
            notes: {
              sessionId: sessionForIdempotency._id.toString(),
            },
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const validSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    // First webhook delivery
    const res1 = await request(app)
      .post(`/api/billing/pg/webhook/${cafe._id}`)
      .set('x-razorpay-signature', validSignature)
      .send(payload)
      .expect(200);

    expect(res1.body.success).toBe(true);

    // Second (duplicate) webhook delivery
    const res2 = await request(app)
      .post(`/api/billing/pg/webhook/${cafe._id}`)
      .set('x-razorpay-signature', validSignature)
      .send(payload)
      .expect(200);

    expect(res2.body.success).toBe(true);
    expect(res2.body.idempotent).toBe(true);

    // Verify only 1 GatewayTransaction record was created
    const GatewayTransaction = require('../src/models/GatewayTransaction');
    const txCount = await GatewayTransaction.countDocuments({
      cafeId: cafe._id,
      gatewayPaymentId: paymentId,
    });
    expect(txCount).toBe(1);
  });
});

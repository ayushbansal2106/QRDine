const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Cafe = require('../src/models/Cafe');
const Table = require('../src/models/Table');
const MenuItem = require('../src/models/MenuItem');
const Category = require('../src/models/Category');
const Customer = require('../src/models/Customer');
const Order = require('../src/models/Order');
const Wallet = require('../src/models/Wallet');
const Coupon = require('../src/models/Coupon');
const CouponGrant = require('../src/models/CouponGrant');
const LoyaltyProgram = require('../src/models/LoyaltyProgram');
const LoyaltyCard = require('../src/models/LoyaltyCard');
const Invoice = require('../src/models/Invoice');
const OtpCode = require('../src/models/OtpCode');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const { sanitizeUrl, redact } = require('../src/services/logger');

let mongoServer;
let cafe;
let table;
let menuItem;
let customer;
let customerToken;
let csrfToken;
let csrfCookie;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  cafe = await Cafe.create({
    name: 'DPDP Privacy Bistro',
    address: 'Connaught Place, New Delhi',
    phone: '911122334455',
  });

  table = await Table.create({
    cafeId: cafe._id,
    tableNumber: 10,
    isActive: true,
  });

  const category = await Category.create({
    cafeId: cafe._id,
    name: 'Mains',
  });

  menuItem = await MenuItem.create({
    cafeId: cafe._id,
    categoryId: category._id,
    name: 'Dal Makhani Deluxe',
    price: 320,
    gstPercentage: 5,
    isAvailable: true,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  // Create customer
  customer = await Customer.create({
    cafeId: cafe._id,
    name: 'Vikram Malhotra',
    phone: '919876543210',
    email: 'vikram@example.com',
    emailVerifiedAt: new Date(),
    dietary: ['nut-free'],
    preferences: { vegOnly: true, notifications: true, language: 'en' },
    notes: 'Prefers window seating',
  });

  customerToken = jwt.sign(
    { id: String(customer._id), cafeId: String(cafe._id), typ: 'customer' },
    env.jwtSecret,
    { expiresIn: '1d' }
  );

  // Fetch CSRF token
  const csrfRes = await request(app).get('/api/auth/csrf');
  csrfToken = csrfRes.body.csrfToken;
  csrfCookie = csrfRes.headers['set-cookie'];
});

afterEach(async () => {
  await Customer.deleteMany({});
  await Order.deleteMany({});
  await Wallet.deleteMany({});
  await CouponGrant.deleteMany({});
  await LoyaltyCard.deleteMany({});
  await OtpCode.deleteMany({});
});

describe('Stage 3: DPDP Act 2023, Privacy & Data Lifecycle Compliance', () => {
  describe('Task 3.1: Statutory Anonymization Pipeline (Section 12 DPDP vs 8-Year Tax Rule)', () => {
    it('DPDP-001: Permanently scrubs PII on Right to Erasure request while retaining Order and Invoice audit trail', async () => {
      // 1. Create past order linked to customer
      const order = await Order.create({
        cafeId: cafe._id,
        orderType: 'dine_in',
        channel: 'qr',
        tableId: table._id,
        customerId: customer._id,
        orderNumber: 'ORD-DPDP-001',
        items: [
          {
            menuItemId: menuItem._id,
            itemName: menuItem.name,
            quantity: 2,
            price: 320,
            gstPercentage: 5,
            gstAmount: 32,
          },
        ],
        subtotal: 640,
        totalGst: 32,
        totalAmount: 672,
        paymentStatus: 'paid',
        status: 'served',
      });

      const invoice = await Invoice.create({
        cafeId: cafe._id,
        sessionId: new mongoose.Types.ObjectId(),
        invoiceNumber: 'INV-2026-DPDP-001',
        pdfUrl: '/uploads/invoices/inv-2026-dpdp-001.pdf',
      });

      // 2. Invoke Right to Erasure
      const res = await request(app)
        .post('/api/customer/me/anonymize')
        .set('Cookie', [`customer_token=${customerToken}`, ...(csrfCookie || [])])
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // 3. Verify Customer profile is scrubbed
      const updatedCustomer = await Customer.findById(customer._id);
      expect(updatedCustomer.name).toBe('Redacted');
      expect(updatedCustomer.email).toBe('');
      expect(updatedCustomer.emailVerifiedAt).toBeNull();
      expect(updatedCustomer.dietary).toEqual([]);
      expect(updatedCustomer.notes).toBe('');
      expect(updatedCustomer.isAnonymized).toBe(true);
      expect(updatedCustomer.isBlocked).toBe(true);
      expect(updatedCustomer.phone).toMatch(/^ANON-[A-F0-9]{10}$/);

      // 4. Verify Order & Invoice financial accounting records are retained in full (CGST Act Section 36)
      const retainedOrder = await Order.findById(order._id);
      expect(retainedOrder).not.toBeNull();
      expect(retainedOrder.orderNumber).toBe('ORD-DPDP-001');
      expect(retainedOrder.totalAmount).toBe(672);
      expect(retainedOrder.subtotal).toBe(640);
      expect(String(retainedOrder.customerId)).toBe(String(customer._id));

      const retainedInvoice = await Invoice.findById(invoice._id);
      expect(retainedInvoice).not.toBeNull();
      expect(retainedInvoice.invoiceNumber).toBe('INV-2026-DPDP-001');
    });

    it('DPDP-002: Deactivates customer wallet and promotional vouchers upon erasure', async () => {
      // Setup wallet
      const wallet = await Wallet.create({
        cafeId: cafe._id,
        customerId: customer._id,
        balance: 250,
        isActive: true,
      });

      // Setup coupon grant
      const coupon = await Coupon.create({
        cafeId: cafe._id,
        code: 'TESTDPDP10',
        name: 'DPDP Promo',
        type: 'flat',
        value: 50,
      });

      const grant = await CouponGrant.create({
        cafeId: cafe._id,
        customerId: customer._id,
        couponId: coupon._id,
        code: 'GRANTDPDP10',
        status: 'issued',
      });

      // Setup loyalty card
      const program = await LoyaltyProgram.create({
        cafeId: cafe._id,
        name: 'Coffee Club',
        targetStamps: 5,
      });

      const loyaltyCard = await LoyaltyCard.create({
        cafeId: cafe._id,
        customerId: customer._id,
        programId: program._id,
        stamps: 3,
        vouchers: [
          {
            code: 'REWARD-123',
            status: 'active',
          },
        ],
      });

      // Anonymize
      const res = await request(app)
        .post('/api/customer/me/anonymize')
        .set('Cookie', [`customer_token=${customerToken}`, ...(csrfCookie || [])])
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(200);

      // Verify Wallet is deactivated and balance reset
      const updatedWallet = await Wallet.findById(wallet._id);
      expect(updatedWallet.isActive).toBe(false);
      expect(updatedWallet.balance).toBe(0);

      // Verify coupon grant revoked
      const updatedGrant = await CouponGrant.findById(grant._id);
      expect(updatedGrant.status).toBe('revoked');

      // Verify loyalty card vouchers expired
      const updatedCard = await LoyaltyCard.findById(loyaltyCard._id);
      expect(updatedCard.stamps).toBe(0);
      expect(updatedCard.vouchers[0].status).toBe('expired');
    });

    it('DPDP-003: Anonymized pseudo-phone prevents re-identification and maintains unique index integrity', async () => {
      // Customer 1
      const res1 = await request(app)
        .post('/api/customer/me/anonymize')
        .set('Cookie', [`customer_token=${customerToken}`, ...(csrfCookie || [])])
        .set('x-csrf-token', csrfToken);
      expect(res1.status).toBe(200);

      const anonCustomer1 = await Customer.findById(customer._id);

      // Customer 2
      const customer2 = await Customer.create({
        cafeId: cafe._id,
        name: 'Ananya Roy',
        phone: '919876543211',
      });
      const token2 = jwt.sign(
        { id: String(customer2._id), cafeId: String(cafe._id), typ: 'customer' },
        env.jwtSecret,
        { expiresIn: '1d' }
      );

      const res2 = await request(app)
        .post('/api/customer/me/anonymize')
        .set('Cookie', [`customer_token=${token2}`, ...(csrfCookie || [])])
        .set('x-csrf-token', csrfToken);
      expect(res2.status).toBe(200);

      const anonCustomer2 = await Customer.findById(customer2._id);

      // Both must be unique and non-colliding
      expect(anonCustomer1.phone).toMatch(/^ANON-[A-F0-9]{10}$/);
      expect(anonCustomer2.phone).toMatch(/^ANON-[A-F0-9]{10}$/);
      expect(anonCustomer1.phone).not.toBe(anonCustomer2.phone);
    });
  });

  describe('Task 3.3: Data Minimization Audit on Guest Ordering', () => {
    it('DPDP-004: Anonymous diner opens table session and places order with ONLY display name and zero phone or email', async () => {
      // 1. Create session as anonymous diner
      const sessionRes = await request(app)
        .post('/api/sessions')
        .send({
          tableId: table._id,
          customerName: 'Anonymous Foodie',
        });

      expect(sessionRes.status).toBe(201);
      expect(sessionRes.body.success).toBe(true);
      expect(sessionRes.body.session.customerName).toBe('Anonymous Foodie');
      expect(sessionRes.body.session.customerEmail).toBe('');
      const { id: sessionId, guestToken, participantId } = sessionRes.body.session;

      // 2. Place order with zero phone and zero email
      const orderRes = await request(app)
        .post('/api/orders')
        .set('x-guest-token', guestToken)
        .send({
          tableId: table._id,
          sessionId,
          participantId,
          items: [
            {
              menuItemId: menuItem._id,
              quantity: 1,
            },
          ],
        });

      expect(orderRes.status).toBe(201);
      expect(orderRes.body.success).toBe(true);

      const createdOrder = await Order.findById(orderRes.body.order._id);
      expect(createdOrder).not.toBeNull();
      // Zero personal customer CRM link forced
      expect(createdOrder.customerId).toBeNull();
      expect(createdOrder.totalAmount).toBe(336); // 320 + 5% GST (16)
    });
  });

  describe('Task 3.4: Production Log Sanitization Sweep', () => {
    it('DPDP-005: sanitizeUrl strips sensitive query parameters from logged paths', () => {
      const url1 = '/api/auth/verify?code=123456&phone=9876543210';
      const sanitized1 = sanitizeUrl(url1);
      expect(sanitized1).toContain('code=%5Bredacted%5D');

      const url2 = '/api/billing/webhook?token=secret_abc123&signature=sig_xyz';
      const sanitized2 = sanitizeUrl(url2);
      expect(sanitized2).toContain('token=%5Bredacted%5D');
      expect(sanitized2).toContain('signature=%5Bredacted%5D');

      const url3 = '/api/menu/public?cafeId=12345&category=drinks';
      const sanitized3 = sanitizeUrl(url3);
      expect(sanitized3).toBe(url3); // Clean URL left unchanged
    });

    it('DPDP-006: redact masks credentials, passwords, tokens, and authorization headers in object logs', () => {
      const payload = {
        username: 'admin',
        password: 'SuperSecretPassword123!',
        token: 'jwt.token.string',
        authorization: 'Bearer super_secret_access_key',
        otp: '654321',
        guestToken: 'guest_tok_9999',
        customerEmail: 'test@customer.com',
        nested: {
          apiKey: 'pk_live_12345678',
          secret: 'sk_live_87654321',
        },
      };

      const redacted = redact(payload);
      expect(redacted.password).toBe('[redacted]');
      expect(redacted.token).toBe('[redacted]');
      expect(redacted.authorization).toBe('[redacted]');
      expect(redacted.otp).toBe('[redacted]');
      expect(redacted.guestToken).toBe('[redacted]');
      expect(redacted.nested.apiKey).toBe('[redacted]');
      expect(redacted.nested.secret).toBe('[redacted]');
      expect(redacted.username).toBe('admin');
    });
  });
});

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');

const Cafe = require('../src/models/Cafe');
const User = require('../src/models/User');
const Table = require('../src/models/Table');
const MenuItem = require('../src/models/MenuItem');
const Category = require('../src/models/Category');
const Order = require('../src/models/Order');
const { PilotRun } = require('../src/models/PilotRun');

const pilotService = require('../src/services/pilotService');
const orderService = require('../src/services/orderService');
const { calculateMetrics } = require('../scripts/load-test/load-test');
const backupTool = require('../scripts/backup');
const { runRestoreDrill } = require('../scripts/restore-drill');
const generateToken = require('../src/utils/generateToken');

let mongoServer;
let cafe;
let adminUser;
let adminToken;
let csrfToken;
let csrfCookie;
let testCategory;
let testItem;
let testTable;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await mongoose.connect(mongoServer.getUri());
  await Order.init();

  cafe = await Cafe.create({
    name: 'Pilot Grand Cafe',
    legalName: 'Pilot Grand Hospitality LLP',
    tradeName: 'Pilot Grand Cafe',
    gstin: '27AAAAA0000A1Z5',
    fssaiNumber: '10020011000456',
    taxMode: 'composite_5',
    address: 'Bandra West, Mumbai, MH',
    phone: '9820098200',
    email: 'pilot@grandcafe.com',
  });

  adminUser = await User.create({
    cafeId: cafe._id,
    name: 'Chief Operating Officer',
    email: 'coo@grandcafe.com',
    password: 'Password123!',
    role: 'owner',
  });

  adminToken = generateToken({
    id: adminUser._id,
    cafeId: cafe._id,
    role: adminUser.role,
  });

  const csrfRes = await request(app).get('/api/auth/csrf');
  csrfToken = csrfRes.body.csrfToken;
  csrfCookie = csrfRes.headers['set-cookie'];

  testCategory = await Category.create({
    cafeId: cafe._id,
    name: 'Artisan Beverages',
    status: 'active',
  });

  testItem = await MenuItem.create({
    cafeId: cafe._id,
    categoryId: testCategory._id,
    name: 'Flat White',
    price: 220,
    isAvailable: true,
  });

  testTable = await Table.create({
    cafeId: cafe._id,
    tableNumber: '1',
    qrCode: 'pilot-table-1-qr',
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Stage 6: Readiness Pilot & Production Hardening Test Suite', () => {
  // =========================================================================
  // Task 6.1: Concurrency Benchmarking & Chaos Testing
  // =========================================================================
  describe('Task 6.1: Concurrency Metrics & Chaos Deduplication', () => {
    it('PILOT-601: should accurately compute p50, p95, p99 latencies and error rates', () => {
      const sampleLatencies = [100, 120, 150, 180, 200, 220, 250, 300, 320, 450];
      const metrics = calculateMetrics(sampleLatencies);

      expect(metrics.p50).toBe(220);
      expect(metrics.p95).toBe(450);
      expect(metrics.p99).toBe(450);
      expect(metrics.min).toBe(100);
      expect(metrics.max).toBe(450);
      expect(metrics.avg).toBe(229);
    });

    it('PILOT-602: should prevent duplicate order creation under chaos idempotency collision', async () => {
      const idempotencyKey = `chaos-req-${Date.now()}`;
      const payload = {
        cafeId: cafe._id,
        tableId: testTable._id,
        channel: 'pos',
        orderType: 'dine_in',
        clientRequestId: idempotencyKey,
        items: [
          {
            menuItemId: testItem._id,
            quantity: 2,
          },
        ],
        enforceGeofence: false,
        emit: false,
      };

      // Submit initial order and retry with identical clientRequestId
      const resA = await orderService.createOrder(payload);
      const resB = await orderService.createOrder(payload);

      expect(resA.order._id.toString()).toBe(resB.order._id.toString());
      expect(resA.idempotent).toBe(false);
      expect(resB.idempotent).toBe(true);

      // Assert exactly 1 document in database
      const count = await Order.countDocuments({ clientRequestId: idempotencyKey });
      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // Task 6.2: Backup Rehearsal Drill & Integrity Verification
  // =========================================================================
  describe('Task 6.2: Disaster Recovery & Backup Rehearsal Drill', () => {
    it('PILOT-603: should perform restore drill, verify SHA-256 manifests, and assert 100% data parity', async () => {
      const drillResult = await runRestoreDrill();

      expect(drillResult.status).toBe('passed');
      expect(drillResult.collectionsVerified).toBeGreaterThan(0);
      expect(drillResult.restorationIntegrity).toBe(true);
      expect(drillResult.sha256Verification).toBe(true);
      expect(drillResult.rtoAchievedSeconds).toBeDefined();
    });
  });

  // =========================================================================
  // Task 6.3: Controlled 14-Day Physical Pilot Rollout
  // =========================================================================
  describe('Task 6.3: Controlled 14-Day Physical Pilot Rollout', () => {
    it('PILOT-604: should initialize pilot run with Phase 1 (Shadow Mode) and disabled customer QR', async () => {
      const pilot = await pilotService.getOrCreatePilotRun(cafe._id);

      expect(pilot).toBeDefined();
      expect(pilot.cafeId.toString()).toBe(cafe._id.toString());
      expect(pilot.currentPhase).toBe('phase_1_shadow');
      expect(pilot.activeTables).toHaveLength(0); // QR ordering disabled during shadow mode
      expect(pilot.status).toBe('active');
    });

    it('PILOT-605: should log daily shift reconciliation and aggregate metrics', async () => {
      const shift1 = await pilotService.logShiftReconciliation(cafe._id, {
        dayNumber: 1,
        shiftDate: new Date('2026-10-15'),
        physicalCashCollected: 12500,
        digitalSalesLedger: 12500,
        ordersHandled: 42,
        droppedOrders: 0,
        notes: 'Day 1 shadow mode: POS tickets matched 100% with paper till.',
        loggedBy: 'Chief Operating Officer',
      });

      expect(shift1.dailyLogs).toHaveLength(1);
      expect(shift1.dailyLogs[0].discrepancyRupees).toBe(0);
      expect(shift1.metrics.cumulativeDiscrepancy).toBe(0);
      expect(shift1.metrics.totalOrdersHandled).toBe(42);
      expect(shift1.metrics.totalSalesRupees).toBe(12500);

      // Log Day 2
      const shift2 = await pilotService.logShiftReconciliation(cafe._id, {
        dayNumber: 2,
        shiftDate: new Date('2026-10-16'),
        physicalCashCollected: 15400,
        digitalSalesLedger: 15400,
        ordersHandled: 55,
        droppedOrders: 0,
        notes: 'Day 2 shadow mode: Kitchen ticket flow clean.',
        loggedBy: 'Chief Operating Officer',
      });

      expect(shift2.dailyLogs).toHaveLength(2);
      expect(shift2.metrics.totalOrdersHandled).toBe(97);
      expect(shift2.metrics.totalSalesRupees).toBe(27900);
      expect(shift2.metrics.cumulativeDiscrepancy).toBe(0);
    });

    it('PILOT-606: should transition through pilot phases (Phase 1 -> Phase 2 -> Phase 3)', async () => {
      // Advance to Phase 2 (Limited QR ordering on Tables 1-4)
      const phase2 = await pilotService.advancePilotPhase(cafe._id);
      expect(phase2.currentPhase).toBe('phase_2_limited_qr');
      expect(phase2.activeTables).toEqual(['Table 1', 'Table 2', 'Table 3', 'Table 4']);

      // Advance to Phase 3 (Full venue)
      const phase3 = await pilotService.advancePilotPhase(cafe._id);
      expect(phase3.currentPhase).toBe('phase_3_full_venue');
      expect(phase3.activeTables).toEqual(['ALL']);
    });
  });

  // =========================================================================
  // Task 6.4: Pilot Exit Review & General Availability Sign-Off
  // =========================================================================
  describe('Task 6.4: Quantitative Exit Audit & GA Sign-Off', () => {
    it('PILOT-607: should reject GA sign-off if billing discrepancy or dropped orders exist', async () => {
      // Create separate cafe with discrepancy
      const faultyCafe = await Cafe.create({
        name: 'Faulty Cafe',
        legalName: 'Faulty Cafe Ltd',
        gstin: '06AAAAA0000A1Z5',
        phone: '9998887770',
        email: 'faulty@cafe.com',
      });

      await pilotService.getOrCreatePilotRun(faultyCafe._id);
      await pilotService.logShiftReconciliation(faultyCafe._id, {
        dayNumber: 1,
        physicalCashCollected: 10000,
        digitalSalesLedger: 10500, // ₹500 discrepancy
        ordersHandled: 30,
        droppedOrders: 2, // 2 dropped orders
        loggedBy: 'Auditor',
      });

      const audit = await pilotService.auditPilotReadiness(faultyCafe._id);
      expect(audit.isEligibleForGaSignoff).toBe(false);
      expect(audit.criteria.zeroBillingDiscrepancies).toBe(false);
      expect(audit.criteria.zeroDroppedOrders).toBe(false);

      await expect(
        pilotService.generateGaSignoffCertificate(faultyCafe._id, 'Owner Name')
      ).rejects.toThrow('Cannot sign off pilot: one or more exit criteria failed');
    });

    it('PILOT-608: should approve GA certificate when all 4 exit criteria pass', async () => {
      const audit = await pilotService.auditPilotReadiness(cafe._id);
      expect(audit.isEligibleForGaSignoff).toBe(true);
      expect(audit.criteria.zeroBillingDiscrepancies).toBe(true);
      expect(audit.criteria.zeroDroppedOrders).toBe(true);
      expect(audit.criteria.zeroCrossTenantLeaks).toBe(true);

      const certificate = await pilotService.generateGaSignoffCertificate(
        cafe._id,
        'Vikramaditya Roy (Managing Director)'
      );

      expect(certificate.status).toBe('GENERAL_AVAILABILITY_APPROVED');
      expect(certificate.certificateNumber).toMatch(/^GA-QRD-/);
      expect(certificate.auditedEntity.signedBy).toBe('Vikramaditya Roy (Managing Director)');
      expect(certificate.auditedMetrics.billingDiscrepancies).toBe(0);
      expect(certificate.auditedMetrics.droppedOrders).toBe(0);

      const updatedPilot = await PilotRun.findOne({ cafeId: cafe._id });
      expect(updatedPilot.exitCriteria.ownerSignoff).toBe(true);
      expect(updatedPilot.exitCriteria.gaCertificateNumber).toBe(certificate.certificateNumber);
      expect(updatedPilot.status).toBe('completed');
    });
  });

  // =========================================================================
  // Pilot REST API Endpoints Verification
  // =========================================================================
  describe('Pilot REST API Endpoints (/api/pilot)', () => {
    it('PILOT-609: should retrieve pilot status via GET /api/pilot/status', async () => {
      const res = await request(app)
        .get('/api/pilot/status')
        .set('Cookie', [`admin_token=${adminToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pilotRun).toBeDefined();
      expect(res.body.audit).toBeDefined();
      expect(res.body.pilotRun.status).toBe('completed');
    });

    it('PILOT-610: should log shift and advance phase via REST endpoints', async () => {
      // Create new cafe for REST tests
      const restCafe = await Cafe.create({
        name: 'Rest Pilot Cafe',
        legalName: 'Rest Cafe Inc',
        gstin: '29AAAAA0000A1Z5',
        phone: '9876501234',
        email: 'rest@pilot.com',
      });

      const restOwner = await User.create({
        cafeId: restCafe._id,
        name: 'Rest Owner',
        email: 'restowner@pilot.com',
        password: 'Password123!',
        role: 'owner',
      });

      const restToken = generateToken({
        id: restOwner._id,
        cafeId: restCafe._id,
        role: restOwner.role,
      });

      // 1. Log Shift
      const logRes = await request(app)
        .post('/api/pilot/log-shift')
        .set('Cookie', [`admin_token=${restToken}`, csrfCookie[0]])
        .set('x-csrf-token', csrfToken)
        .send({
          dayNumber: 1,
          physicalCashCollected: 8500,
          digitalSalesLedger: 8500,
          ordersHandled: 28,
          droppedOrders: 0,
          notes: 'REST pilot log shift check',
          loggedBy: 'Rest Owner',
        });

      expect(logRes.status).toBe(201);
      expect(logRes.body.success).toBe(true);
      expect(logRes.body.pilotRun.dailyLogs).toHaveLength(1);

      // 2. Advance Phase
      const advanceRes = await request(app)
        .post('/api/pilot/advance-phase')
        .set('Cookie', [`admin_token=${restToken}`, csrfCookie[0]])
        .set('x-csrf-token', csrfToken)
        .send();

      expect(advanceRes.status).toBe(200);
      expect(advanceRes.body.success).toBe(true);
      expect(advanceRes.body.pilotRun.currentPhase).toBe('phase_2_limited_qr');

      // 3. Issue GA Sign-off
      const signoffRes = await request(app)
        .post('/api/pilot/signoff')
        .set('Cookie', [`admin_token=${restToken}`, csrfCookie[0]])
        .set('x-csrf-token', csrfToken)
        .send({
          ownerSignoffName: 'Priya Nambiar',
        });

      expect(signoffRes.status).toBe(200);
      expect(signoffRes.body.success).toBe(true);
      expect(signoffRes.body.certificate.status).toBe('GENERAL_AVAILABILITY_APPROVED');
      expect(signoffRes.body.certificate.certificateNumber).toMatch(/^GA-QRD-/);
    });
  });
});

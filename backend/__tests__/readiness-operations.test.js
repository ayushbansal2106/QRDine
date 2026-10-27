const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');

const Cafe = require('../src/models/Cafe');
const Table = require('../src/models/Table');
const Category = require('../src/models/Category');
const MenuItem = require('../src/models/MenuItem');
const IncidentRecord = require('../src/models/IncidentRecord');
const User = require('../src/models/User');

const { validateOnboardingData, onboardRestaurant } = require('../scripts/onboard-restaurant');
const { auditMenuItem, verifyMenuRules } = require('../scripts/verify-menu-rules');
const { reportIncident, updateIncidentStatus, markCertInReported } = require('../src/services/incidentService');
const { runReleaseGateCheck } = require('../scripts/release-gate-check');
const generateToken = require('../src/utils/generateToken');

let mongoServer;
let cafe;
let adminUser;
let adminToken;
let csrfToken;
let csrfCookie;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  cafe = await Cafe.create({
    name: 'Ops Bistro',
    legalName: 'Ops Bistro Pvt Ltd',
    tradeName: 'Ops Bistro',
    gstin: '07AAAAA0000A1Z5',
    fssaiNumber: '10019011000123',
    taxMode: 'composite_5',
    address: 'Saket, New Delhi',
    phone: '9876543210',
    email: 'ops@opsbistro.com',
  });

  adminUser = await User.create({
    cafeId: cafe._id,
    name: 'General Manager',
    email: 'gm@opsbistro.com',
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
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await IncidentRecord.deleteMany({});
});

describe('Stage 4: Operational Forms & Pre-Flight Tooling', () => {
  describe('Task 4.1: Form A — Restaurant Onboarding Schema & QR Generator', () => {
    it('OPS-FORM-001: Validates Indian statutory registration format (15-char GSTIN & 14-digit FSSAI)', () => {
      // Invalid GSTIN & FSSAI
      const invalid = validateOnboardingData({
        legalName: 'Test Cafe',
        gstin: 'INVALID_GSTIN_123',
        fssaiNumber: '12345',
        tableCount: 15,
      });

      expect(invalid.isValid).toBe(false);
      expect(invalid.errors.some((e) => e.includes('GSTIN'))).toBe(true);
      expect(invalid.errors.some((e) => e.includes('FSSAI'))).toBe(true);

      // Valid GSTIN & FSSAI
      const valid = validateOnboardingData({
        legalName: 'Delhi Spice House LLP',
        tradeName: 'Spice House',
        gstin: '07AAAAA0000A1Z5',
        fssaiNumber: '10019011000123',
        tableCount: 8,
        taxMode: 'composite_5',
      });

      expect(valid.isValid).toBe(true);
      expect(valid.sanitized.gstin).toBe('07AAAAA0000A1Z5');
      expect(valid.sanitized.fssaiNumber).toBe('10019011000123');
    });

    it('OPS-FORM-002: Batch generates tables and QR codes with verified URLs', async () => {
      const result = await onboardRestaurant({
        legalName: 'Connaught Roasters Pvt Ltd',
        tradeName: 'Connaught Roasters',
        gstin: '07BBBBB0000B1Z6',
        fssaiNumber: '10019011000999',
        tableCount: 5,
        taxMode: 'composite_5',
        phone: '9988776655',
      });

      expect(result.success).toBe(true);
      expect(result.tables.length).toBe(5);

      const firstTable = result.tables[0];
      expect(String(firstTable.tableNumber)).toBe('1');
      expect(firstTable.qrCodeUrl).toMatch(/^data:image\/png;base64,/);

      // Verify in DB
      const dbTables = await Table.find({ cafeId: result.cafe._id });
      expect(dbTables.length).toBe(5);
    });
  });

  describe('Task 4.2: Form B — Menu Rules Pre-Flight Verification Script', () => {
    it('OPS-FORM-003: Audits dishes and catches missing categories, zero prices, and missing dietary tags', () => {
      const validCategories = new Set(['cat-123']);

      // Defective dish: zero price, missing category, no dietary tags
      const defectiveItem = {
        _id: 'item-1',
        name: 'Mystery Dish',
        price: 0,
        categoryId: 'orphaned-cat',
        dietaryTags: [],
        variants: [],
      };

      const result = auditMenuItem(defectiveItem, validCategories, 'composite_5');
      expect(result.issues.some((i) => i.code === 'INVALID_CATEGORY')).toBe(true);
      expect(result.issues.some((i) => i.code === 'UNPRICED_DISH')).toBe(true);
      expect(result.issues.some((i) => i.code === 'MISSING_DIETARY_TAG')).toBe(true);

      // Valid dish
      const validItem = {
        _id: 'item-2',
        name: 'Butter Naan',
        price: 60,
        categoryId: 'cat-123',
        dietaryTags: ['veg'],
        allergens: ['gluten', 'dairy'],
      };

      const validResult = auditMenuItem(validItem, validCategories, 'composite_5');
      expect(validResult.issues.length).toBe(0);
    });

    it('OPS-FORM-004: Flags undeclared allergens when ingredients or names mention common allergen triggers', () => {
      const validCategories = new Set(['cat-123']);

      const almondShake = {
        _id: 'item-3',
        name: 'Almond Pistachio Shake',
        description: 'Made with fresh milk and roasted almonds',
        price: 180,
        categoryId: 'cat-123',
        dietaryTags: ['veg'],
        allergens: [], // Missing nuts and dairy tags!
      };

      const result = auditMenuItem(almondShake, validCategories, 'composite_5');
      expect(result.warnings.some((w) => w.code === 'UNDECLARED_ALLERGEN' && w.message.includes('nuts'))).toBe(
        true
      );
      expect(result.warnings.some((w) => w.code === 'UNDECLARED_ALLERGEN' && w.message.includes('dairy'))).toBe(
        true
      );
    });
  });

  describe('Task 4.3: Form C — Production Incident Reporting Model & Triage', () => {
    it('OPS-FORM-005: Reports, sanitizes, and triages operational and security incidents', async () => {
      const incident = await reportIncident({
        title: 'Payment Gateway Webhook Timeout',
        description: 'Webhook delivery failed repeatedly from payment provider',
        severity: 'SEV-2',
        category: 'billing',
        cafeId: cafe._id,
        logs: {
          clientSecret: 'secret_12345_should_be_masked',
          password: 'db_password_123',
          statusCode: 504,
        },
        reportedBy: 'monitoring-bot',
      });

      expect(incident.incidentId).toMatch(/^INC-\d{4}-[A-F0-9]{6}$/);
      expect(incident.severity).toBe('SEV-2');
      expect(incident.status).toBe('open');

      // Assert logs were sanitized
      expect(incident.sanitizedLogs.clientSecret).toBe('[redacted]');
      expect(incident.sanitizedLogs.password).toBe('[redacted]');
      expect(incident.sanitizedLogs.statusCode).toBe(504);
    });

    it('OPS-FORM-006: Flags critical data security incidents requiring CERT-In / DPDP escalation', async () => {
      const dataBreachIncident = await reportIncident({
        title: 'Suspected Cross-Tenant Data Access Probe',
        description: 'Multiple automated requests attempted to access other tenant records',
        severity: 'SEV-1',
        category: 'data_isolation',
        isPersonalDataInvolved: true,
      });

      expect(dataBreachIncident.isPersonalDataInvolved).toBe(true);
      expect(dataBreachIncident.severity).toBe('SEV-1');

      // Triage and mark CERT-In filing completed
      const updated = await markCertInReported(
        dataBreachIncident.incidentId,
        'Filed preliminary 6-hour incident report with CERT-In portal'
      );

      expect(updated.certInReported).toBe(true);
      expect(updated.certInReportedAt).not.toBeNull();
      expect(updated.remediationNotes).toContain('CERT-In');
    });

    it('OPS-FORM-007: Incident API endpoint supports protected reporting and querying', async () => {
      // 1. Create incident via API
      const createRes = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Cookie', [`admin_token=${adminToken}`, ...(csrfCookie || [])])
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'KDS Sync Lag',
          description: 'Station kitchen experienced 10s latency in bumping orders',
          severity: 'SEV-3',
          category: 'realtime_outage',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.success).toBe(true);
      const incidentId = createRes.body.incident.incidentId;

      // 2. Query incidents via API
      const getRes = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Cookie', [`admin_token=${adminToken}`, ...(csrfCookie || [])]);

      expect(getRes.status).toBe(200);
      expect(getRes.body.incidents.some((i) => i.incidentId === incidentId)).toBe(true);
    });
  });

  describe('Task 4.4: Form D — Automated Go-Live Sign-Off Checker', () => {
    it('OPS-FORM-008: Release gate check evaluates database, compliance, and menu readiness', async () => {
      // Setup a category and valid menu item for the test cafe so menu check passes
      const cat = await Category.create({ cafeId: cafe._id, name: 'Bistro Favorites' });
      await MenuItem.create({
        cafeId: cafe._id,
        categoryId: cat._id,
        name: 'Truffle Fries',
        price: 240,
        dietaryTags: ['veg'],
        gstPercentage: 5,
        isAvailable: true,
      });

      const report = await runReleaseGateCheck();
      expect(report.reportId).toMatch(/^GATE-REPORT-\d{8}-[A-F0-9]{6}$/);
      expect(report.totalChecks).toBeGreaterThanOrEqual(5);

      // Check specific gates
      const dbCheck = report.checks.find((c) => c.id === 'GATE-01-DB-CONNECTION');
      expect(dbCheck.passed).toBe(true);

      const sanitizationCheck = report.checks.find((c) => c.id === 'GATE-05-LOG-SANITIZATION');
      expect(sanitizationCheck.passed).toBe(true);

      const backupCheck = report.checks.find((c) => c.id === 'GATE-06-INCIDENT-BACKUP');
      expect(backupCheck.passed).toBe(true);
    });
  });
});

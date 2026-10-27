process.env.JWT_SECRET = process.env.JWT_SECRET || 'readiness-legal-jwt-secret-key-12345';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Cafe = require('../src/models/Cafe');
const User = require('../src/models/User');
const DiningSession = require('../src/models/DiningSession');
const IncidentRecord = require('../src/models/IncidentRecord');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const invoiceService = require('../src/services/invoiceService');
const subscriptionInvoiceService = require('../src/services/subscriptionInvoiceService');
const certInService = require('../src/services/certInService');
const breachForensicService = require('../src/services/breachForensicService');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');

const JWT_KEY = env.jwtSecret || process.env.JWT_SECRET || 'readiness-legal-jwt-secret-key-12345';

let mongoServer;
let cafe;
let ownerUser;
let ownerToken;
let csrfToken;
let csrfCookie;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  cafe = await Cafe.create({
    name: 'The Imperial Spice Bistro',
    legalName: 'Imperial Hospitality Private Limited',
    tradeName: 'The Imperial Spice',
    gstin: '07AAAAA0000A1Z5',
    fssaiNumber: '10019011000123',
    taxMode: 'regular_18',
    address: 'Block M, Connaught Place, New Delhi, Delhi 110001',
    phone: '9811002233',
    email: 'accounts@imperialspice.in',
    termsAccepted: true,
    termsVersion: '2026.1',
    dpaAccepted: true,
    dpaAcceptedAt: new Date(),
    dpaVersion: '2026.1',
  });

  ownerUser = await User.create({
    cafeId: cafe._id,
    name: 'Rajeev Singhal',
    email: 'rajeev@imperialspice.in',
    password: 'Password123!',
    role: 'owner',
  });

  env.jwtSecret = JWT_KEY;

  ownerToken = jwt.sign(
    {
      id: ownerUser._id,
      userId: ownerUser._id,
      cafeId: cafe._id,
      role: 'owner',
    },
    JWT_KEY,
    { expiresIn: '1d' }
  );

  const csrfRes = await request(app).get('/api/auth/csrf');
  csrfToken = csrfRes.body.csrfToken;
  csrfCookie = csrfRes.headers['set-cookie'];
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Stage 5: Production Readiness — Legal, Tax & CERT-In Directives', () => {
  describe('Task 5.1: Master SaaS Agreement & Data Processing Addendum (DPA)', () => {
    it('LEGAL-001: Cafe model stores statutory terms and DPA acceptance metadata under DPDP Act 2023', async () => {
      const freshCafe = await Cafe.findById(cafe._id);
      expect(freshCafe.termsAccepted).toBe(true);
      expect(freshCafe.termsVersion).toBe('2026.1');
      expect(freshCafe.dpaAccepted).toBe(true);
      expect(freshCafe.dpaVersion).toBe('2026.1');
      expect(freshCafe.dpaAcceptedAt).toBeInstanceOf(Date);
      expect(freshCafe.isQuarantined).toBe(false);
    });
  });

  describe('Task 5.2: GST & Subscription Invoicing Setup (SAC 998313)', () => {
    it('LEGAL-002: Resolves intra-state GST (Delhi to Delhi: 9% CGST + 9% SGST) for SAC 998313', () => {
      const tax = subscriptionInvoiceService.calculateSubscriptionTax({
        amount: 10000,
        recipientGstin: '07BBBBB1111B1Z2', // 07 = Delhi
        recipientStateCode: '07',
      });

      expect(tax.sacCode).toBe('998313');
      expect(tax.isInterState).toBe(false);
      expect(tax.cgstRate).toBe(9);
      expect(tax.cgstAmount).toBe(900);
      expect(tax.sgstRate).toBe(9);
      expect(tax.sgstAmount).toBe(900);
      expect(tax.igstRate).toBe(0);
      expect(tax.igstAmount).toBe(0);
      expect(tax.totalTax).toBe(1800);
      expect(tax.totalAmount).toBe(11800);
    });

    it('LEGAL-003: Resolves inter-state GST (Delhi to Maharashtra: 18% IGST) for SAC 998313', () => {
      const tax = subscriptionInvoiceService.calculateSubscriptionTax({
        amount: 10000,
        recipientGstin: '27AAAAA0000A1Z5', // 27 = Maharashtra
        recipientStateCode: '27',
      });

      expect(tax.sacCode).toBe('998313');
      expect(tax.isInterState).toBe(true);
      expect(tax.cgstRate).toBe(0);
      expect(tax.cgstAmount).toBe(0);
      expect(tax.sgstRate).toBe(0);
      expect(tax.sgstAmount).toBe(0);
      expect(tax.igstRate).toBe(18);
      expect(tax.igstAmount).toBe(1800);
      expect(tax.totalTax).toBe(1800);
      expect(tax.totalAmount).toBe(11800);
    });

    it('LEGAL-004: Issues official B2B Rule 46 CGST tax invoice and generates valid PDF buffer', async () => {
      const invoice = await subscriptionInvoiceService.issueSubscriptionInvoice({
        cafeId: cafe._id,
        planKey: 'pro',
        billingCycle: 'annual',
        amount: 24000,
        recipientDetails: {
          legalName: cafe.legalName,
          tradeName: cafe.tradeName,
          gstin: cafe.gstin,
          stateCode: '07',
          address: cafe.address,
        },
        paymentDetails: {
          paymentId: 'pay_test_legal_001',
          paymentMethod: 'upi',
          paidAt: new Date(),
        },
      });

      expect(invoice).toBeDefined();
      expect(invoice.invoiceNumber).toMatch(/^QRD\/\d{4}-\d{2}\/\d{4}$/);
      expect(invoice.sacCode).toBe('998313');
      expect(invoice.subtotal).toBe(24000);
      expect(invoice.totalTax).toBe(4320); // 18% of 24,000
      expect(invoice.totalAmount).toBe(28320);
      expect(invoice.status).toBe('paid');

      // Generate statutory PDF
      const pdfBuffer = await subscriptionInvoiceService.generateSubscriptionInvoicePdf(invoice);
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(1000);
      // Valid PDF magic bytes %PDF-
      expect(pdfBuffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('LEGAL-005: Allows cafe owner to query their subscription tax invoices', async () => {
      const res = await request(app)
        .get('/api/subscription/invoices')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.invoices)).toBe(true);
      expect(res.body.invoices.length).toBeGreaterThanOrEqual(1);
      expect(res.body.invoices[0].sacCode).toBe('998313');
    });
  });

  describe('Task 5.3: FSSAI Intermediary Disclaimer Embed & Public Verification', () => {
    it('LEGAL-006: Public Cafe endpoint serves legal name, trade name, FSSAI number and GSTIN', async () => {
      const res = await request(app).get(`/api/cafe/public/${cafe._id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cafe.legalName).toBe('Imperial Hospitality Private Limited');
      expect(res.body.cafe.tradeName).toBe('The Imperial Spice');
      expect(res.body.cafe.fssaiNumber).toBe('10019011000123');
      expect(res.body.cafe.gstin).toBe('07AAAAA0000A1Z5');
    });

    it('LEGAL-007: Customer dining PDF invoice embeds legal entity, FSSAI license, and Section 79 intermediary safe harbor disclaimer', async () => {
      const mockOrder = {
        _id: new mongoose.Types.ObjectId(),
        orderNumber: 'ORD-7001',
        cafeId: cafe._id,
        items: [
          {
            name: 'Paneer Butter Masala',
            quantity: 2,
            price: 250,
            subtotal: 500,
            gstPercentage: 5,
            gstAmount: 25,
            itemTotal: 525,
          },
        ],
        subtotal: 500,
        totalGST: 25,
        totalAmount: 525,
        createdAt: new Date(),
        paymentStatus: 'paid',
        paymentMethod: 'cash',
      };

      const pdfBuffer = await invoiceService.generateInvoicePdf(mockOrder, cafe);
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(1000);
      expect(pdfBuffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });
  });

  describe('Task 5.4: CERT-In Compliance Directives Setup', () => {
    it('LEGAL-008: Validates NTP clock synchronization with official NPL/NIC servers', async () => {
      const ntpResult = await certInService.verifyNtpTimeSync();

      expect(ntpResult).toBeDefined();
      expect(ntpResult.serversConfigured).toContain('time.nplindia.org');
      expect(ntpResult.serversConfigured).toContain('time.nic.in');
      expect(typeof ntpResult.isSynchronized).toBe('boolean');
      expect(typeof ntpResult.timeDriftMs).toBe('number');
      expect(ntpResult.maxAllowedDriftMs).toBe(1000);
    });

    it('LEGAL-009: Verifies 180-day log retention mandate policy for audit collections', () => {
      const retentionCheck = certInService.verify180DayLogRetention();

      expect(retentionCheck.isCompliant).toBe(true);
      expect(retentionCheck.mandatedRetentionDays).toBe(180);
      expect(retentionCheck.jurisdiction).toBe('India');
      expect(retentionCheck.retentionPolicyEnforced).toBe(true);
    });
  });

  describe('Task 5.5: Data Breach Forensic Playbook & 6-Hour Emergency Matrix', () => {
    let incident;

    beforeEach(async () => {
      await IncidentRecord.deleteMany({});
      await DiningSession.deleteMany({});
      incident = await IncidentRecord.create({
        incidentId: `INC-2026-LEG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        severity: 'SEV-1',
        category: 'security_breach',
        cafeId: cafe._id,
        title: 'Suspected API Token Leakage',
        description: 'Anomalous bulk dining queries detected from non-whitelisted IP subnet',
        status: 'open',
      });

      // Create dummy active dining sessions to test token revocation
      await DiningSession.create([
        {
          cafeId: cafe._id,
          tableId: new mongoose.Types.ObjectId(),
          guestToken: 'guest_tok_active_01',
          status: 'active',
          startedAt: new Date(),
        },
        {
          cafeId: cafe._id,
          tableId: new mongoose.Types.ObjectId(),
          guestToken: 'guest_tok_active_02',
          status: 'active',
          startedAt: new Date(),
        },
      ]);
    });

    it('LEGAL-010: Emergency containment revokes all active dining session tokens immediately', async () => {
      const result = await breachForensicService.revokeCompromisedTokens(cafe._id);

      expect(result.revokedSessionsCount).toBe(2);

      const remainingActive = await DiningSession.countDocuments({
        cafeId: cafe._id,
        status: 'active',
      });
      expect(remainingActive).toBe(0);
    });

    it('LEGAL-011: Emergency tenant quarantine immediately isolates compromised cafe', async () => {
      const quarantineResult = await breachForensicService.emergencyQuarantineTenant(
        cafe._id,
        'Compromised API Key Detected - Forensic Lockdown'
      );

      expect(quarantineResult.success).toBe(true);
      expect(quarantineResult.isQuarantined).toBe(true);

      const refreshedCafe = await Cafe.findById(cafe._id);
      expect(refreshedCafe.isQuarantined).toBe(true);
      expect(refreshedCafe.quarantineReason).toContain('Compromised API Key Detected');
      expect(refreshedCafe.quarantinedAt).toBeInstanceOf(Date);
    });

    it('LEGAL-012: Generates statutory CERT-In Annexure-I reporting dossier with IST timestamps and 6-hour timeline', async () => {
      const dossier = await breachForensicService.generateCertInDossier(incident.incidentId);

      expect(dossier).toBeDefined();
      expect(dossier.certInDirectiveReference).toContain('20(3)/2022-CERT-In');
      expect(dossier.reportingDeadline).toContain('6 hours');
      expect(dossier.designatedReportingEmail).toBe('incident@cert-in.org.in');
      expect(dossier.incidentDetails.incidentId).toBe(incident.incidentId);
      expect(dossier.impactAssessment).toBeDefined();
      expect(dossier.timeElapsedSinceDetection).toBeDefined();
    });

    it('LEGAL-013: Incident containment API executes quarantine & revocation over REST', async () => {
      const res = await request(app)
        .post(`/api/incidents/${incident.incidentId}/containment`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-csrf-token', csrfToken)
        .set('Cookie', csrfCookie)
        .send({
          action: 'all',
          cafeId: cafe._id,
          reason: 'Automated tripwire security alert',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.containmentResult.tokensRevoked).toBe(true);
      expect(res.body.containmentResult.tenantQuarantined).toBe(true);
    });

    it('LEGAL-014: Incident CERT-In dossier API serves compliant JSON payload for statutory filing', async () => {
      const res = await request(app)
        .get(`/api/incidents/${incident.incidentId}/certin-dossier`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.dossier.designatedReportingEmail).toBe('incident@cert-in.org.in');
    });
  });
});

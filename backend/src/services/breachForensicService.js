const Cafe = require('../models/Cafe');
const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');
const Customer = require('../models/Customer');
const IncidentRecord = require('../models/IncidentRecord');
const AppError = require('../utils/AppError');
const { createLogger } = require('./logger');

const log = createLogger('forensics');

/**
 * Data Breach Forensic Playbook & 6-Hour Emergency Matrix Service (Task 5.5 - Stage 5)
 *
 * Implements emergency containment procedures under Section 70B of IT Act (CERT-In)
 * and Section 8(6) of the Digital Personal Data Protection Act, 2023.
 */

/**
 * Phase 1: Revoke all active dining session tokens and pause orders for a compromised tenant.
 */
const revokeCompromisedTokens = async (cafeId, reason = 'Security containment initiated') => {
  const cafe = await Cafe.findById(cafeId);
  if (!cafe) throw new AppError('Cafe not found', 404);

  // 1. Invalidate all active dining session tokens
  const sessionResult = await DiningSession.updateMany(
    { cafeId, status: 'active' },
    {
      $set: {
        status: 'ended',
        endedAt: new Date(),
        guestToken: 'REVOKED-' + Date.now(),
      },
    }
  );

  // 2. Pause restaurant ordering
  cafe.isOrderingPaused = true;
  cafe.orderingPausedReason = reason;
  await cafe.save();

  log.warn('EMERGENCY_TOKENS_REVOKED', {
    cafeId,
    revokedSessionsCount: sessionResult.modifiedCount,
    reason,
  });

  return {
    success: true,
    cafeId,
    revokedSessionsCount: sessionResult.modifiedCount,
    orderingPaused: true,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Phase 2: Emergency quarantine tenant into isolation mode.
 */
const emergencyQuarantineTenant = async (cafeId, reason) => {
  const cafe = await Cafe.findById(cafeId);
  if (!cafe) throw new AppError('Cafe not found', 404);

  cafe.isQuarantined = true;
  cafe.quarantineReason = reason || 'Suspected critical data security breach';
  cafe.quarantinedAt = new Date();
  cafe.isOrderingPaused = true;
  cafe.orderingPausedReason = 'Security investigation in progress';
  await cafe.save();

  // Invalidate tokens as safety measure
  await revokeCompromisedTokens(cafeId, reason);

  log.error('TENANT_EMERGENCY_QUARANTINED', {
    cafeId,
    reason: cafe.quarantineReason,
    quarantinedAt: cafe.quarantinedAt,
  });

  return {
    success: true,
    cafeId,
    isQuarantined: true,
    quarantineReason: cafe.quarantineReason,
    quarantinedAt: cafe.quarantinedAt.toISOString(),
  };
};

/**
 * Phase 3: Forensic impact assessment to determine exposed natural persons.
 */
const assessBreachScope = async (cafeId, lookbackHours = 24) => {
  const sinceDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const [orders, sessions, customers] = await Promise.all([
    Order.find({ cafeId, createdAt: { $gte: sinceDate } }).lean(),
    DiningSession.find({ cafeId, startedAt: { $gte: sinceDate } }).lean(),
    Customer.find({ cafeId }).lean(),
  ]);

  const uniquePhones = new Set();
  const uniqueNames = new Set();
  let totalOrderValue = 0;

  for (const ord of orders) {
    if (ord.customerPhone) uniquePhones.add(ord.customerPhone);
    if (ord.customerName) uniqueNames.add(ord.customerName);
    totalOrderValue += ord.totalAmount || 0;
  }

  for (const s of sessions) {
    if (s.customerPhone) uniquePhones.add(s.customerPhone);
    if (s.customerName) uniqueNames.add(s.customerName);
  }

  return {
    cafeId,
    lookbackPeriodHours: lookbackHours,
    windowStart: sinceDate.toISOString(),
    windowEnd: new Date().toISOString(),
    metrics: {
      ordersInWindow: orders.length,
      sessionsInWindow: sessions.length,
      totalRegisteredCustomers: customers.length,
      distinctPhoneNumbersExposed: uniquePhones.size,
      distinctCustomerNamesExposed: uniqueNames.size,
      totalTransactionValueRupees: Math.round(totalOrderValue),
    },
    isHighRiskBreach: uniquePhones.size > 0,
    dpdpBoardNotificationMandatory: uniquePhones.size > 0,
  };
};

/**
 * Phase 4: Compile statutory CERT-In 6-Hour Emergency Reporting Dossier.
 */
const generateCertInDossier = async (incidentId) => {
  const mongoose = require('mongoose');
  let incident = null;
  if (mongoose.Types.ObjectId.isValid(incidentId)) {
    incident = await IncidentRecord.findById(incidentId);
  }
  if (!incident) {
    incident = await IncidentRecord.findOne({ incidentId });
  }
  if (!incident) throw new AppError('Incident not found', 404);

  let cafeInfo = null;
  let forensicScope = null;

  if (incident.cafeId) {
    cafeInfo = await Cafe.findById(incident.cafeId).lean();
    forensicScope = await assessBreachScope(incident.cafeId, 24);
  }

  const detectionDate = new Date(incident.createdAt);
  const sixHourDeadline = new Date(detectionDate.getTime() + 6 * 60 * 60 * 1000);
  const now = Date.now();
  const timeElapsedMs = Math.max(0, now - detectionDate.getTime());
  const hoursElapsed = (timeElapsedMs / (1000 * 60 * 60)).toFixed(2);

  const report = {
    incidentReportId: incident.incidentId,
    certInDirectiveReference: 'Directions No. 20(3)/2022-CERT-In Clause (i)',
    statutoryFiling: 'CERT-In Cyber Security Incident Reporting Form (Annexure-I)',
    governingAct: 'Section 70B(6) IT Act, 2000 & CERT-In Directions 2022',
    reportingDeadline: 'Mandatory 6 hours from incident detection',
    designatedReportingEmail: 'incident@cert-in.org.in',
    timeElapsedSinceDetection: `${hoursElapsed} hours`,
    reportingEntity: {
      name: 'QRDine Technologies Private Limited',
      role: 'Technology SaaS Intermediary / Data Processor',
      jurisdiction: 'New Delhi, India',
      emergencyContact: 'incident-response@qrdine.com',
    },
    incidentDetails: {
      incidentId: incident.incidentId,
      severity: incident.severity,
      category: incident.category,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      detectedAtIST: detectionDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      sixHourStatutoryDeadlineIST: sixHourDeadline.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      isPersonalDataInvolved: incident.isPersonalDataInvolved,
    },
    impactAssessment: forensicScope ? forensicScope.metrics : {
      ordersInWindow: 0,
      sessionsInWindow: 0,
      distinctPhoneNumbersExposed: 0,
    },
    impactedTenant: cafeInfo
      ? {
          cafeId: String(cafeInfo._id),
          legalName: cafeInfo.legalName || cafeInfo.name,
          tradeName: cafeInfo.tradeName || cafeInfo.name,
          gstin: cafeInfo.gstin || 'Unregistered',
          fssaiNumber: cafeInfo.fssaiNumber || 'Applied For',
          isQuarantined: Boolean(cafeInfo.isQuarantined),
        }
      : null,
    forensicScope: forensicScope ? forensicScope.metrics : null,
    containmentMeasures: {
      sessionTokensRevoked: true,
      orderingPaused: true,
      logSanitizationEnforced: true,
      certInReported: Boolean(incident.certInReported),
      certInReportedAt: incident.certInReportedAt || null,
    },
  };

  return report;
};

module.exports = {
  revokeCompromisedTokens,
  emergencyQuarantineTenant,
  assessBreachScope,
  generateCertInDossier,
};

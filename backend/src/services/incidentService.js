const crypto = require('crypto');
const IncidentRecord = require('../models/IncidentRecord');
const { redact, createLogger } = require('./logger');
const AppError = require('../utils/AppError');

const log = createLogger('incidents');

/**
 * Production Incident Triage & Reporting Service (Form C - Task 4.3).
 */

const generateIncidentId = () => {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `INC-${year}-${rand}`;
};

/**
 * Report a production operational or security incident.
 */
const reportIncident = async ({
  title,
  description,
  severity = 'SEV-3',
  category = 'operational',
  cafeId = null,
  affectedOrderId = null,
  logs = null,
  isPersonalDataInvolved = false,
  reportedBy = 'system',
}) => {
  if (!title || !description) {
    throw new AppError('Incident title and description are required', 400);
  }

  // Ensure logs are thoroughly sanitized before storage in incident database
  const sanitizedLogs = logs ? redact(logs) : null;
  const incidentId = generateIncidentId();

  const incident = await IncidentRecord.create({
    incidentId,
    title: title.trim(),
    description: description.trim(),
    severity,
    category,
    cafeId,
    affectedOrderId,
    sanitizedLogs,
    isPersonalDataInvolved: Boolean(isPersonalDataInvolved),
    reportedBy,
    status: 'open',
  });

  // Emergency Breach Escalation: CERT-In 6-hour statutory notification requirement
  if (isPersonalDataInvolved || severity === 'SEV-1') {
    log.error('CRITICAL_SECURITY_INCIDENT_TRIGGERED', {
      incidentId: incident.incidentId,
      severity,
      category,
      isPersonalDataInvolved: incident.isPersonalDataInvolved,
      statutoryNotificationRequired: 'CERT-In (within 6 hours) & DPDP Board',
    });
  }

  return incident;
};

/**
 * Record statutory CERT-In / DPDP filing compliance.
 */
const markCertInReported = async (incidentId, remediationNotes = '') => {
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    throw new AppError('Incident not found', 404);
  }

  incident.certInReported = true;
  incident.certInReportedAt = new Date();
  if (remediationNotes) {
    incident.remediationNotes = `${incident.remediationNotes}\n${remediationNotes}`.trim();
  }
  await incident.save();
  return incident;
};

/**
 * Update status and triage resolution notes.
 */
const updateIncidentStatus = async (incidentId, { status, remediationNotes }) => {
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    throw new AppError('Incident not found', 404);
  }

  if (status) incident.status = status;
  if (remediationNotes !== undefined) incident.remediationNotes = remediationNotes;
  if (['resolved', 'closed'].includes(status) && !incident.resolvedAt) {
    incident.resolvedAt = new Date();
  }

  await incident.save();
  return incident;
};

/**
 * Query incidents with filtering.
 */
const getIncidents = async ({ cafeId, severity, status, category, limit = 50, page = 1 } = {}) => {
  const filter = {};
  if (cafeId) filter.cafeId = cafeId;
  if (severity) filter.severity = severity;
  if (status) filter.status = status;
  if (category) filter.category = category;

  const skip = (Math.max(1, page) - 1) * Math.min(100, limit);

  const [incidents, total] = await Promise.all([
    IncidentRecord.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('cafeId', 'name tradeName legalName')
      .lean(),
    IncidentRecord.countDocuments(filter),
  ]);

  return { incidents, total, page, limit };
};

const getIncidentById = async (idOrIncidentId) => {
  const mongoose = require('mongoose');
  if (mongoose.Types.ObjectId.isValid(idOrIncidentId)) {
    const byId = await IncidentRecord.findById(idOrIncidentId);
    if (byId) return byId;
  }
  return IncidentRecord.findOne({ incidentId: idOrIncidentId });
};

module.exports = {
  reportIncident,
  markCertInReported,
  updateIncidentStatus,
  getIncidents,
  getIncidentById,
  generateIncidentId,
};

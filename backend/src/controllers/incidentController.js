const incidentService = require('../services/incidentService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * Incident Controller (Form C - Task 4.3).
 */

const createIncident = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    severity,
    category,
    cafeId,
    affectedOrderId,
    logs,
    isPersonalDataInvolved,
  } = req.body;

  const incident = await incidentService.reportIncident({
    title,
    description,
    severity,
    category,
    cafeId: cafeId || req.cafeId || null,
    affectedOrderId,
    logs,
    isPersonalDataInvolved,
    reportedBy: req.user ? req.user.email || req.user.name : 'staff',
  });

  res.status(201).json({
    success: true,
    message: 'Incident reported and triaged successfully',
    incident,
  });
});

const getIncidents = asyncHandler(async (req, res) => {
  const { severity, status, category, page, limit } = req.query;

  // If user is cafe staff (not superadmin), scope by req.cafeId
  const cafeId = req.user?.role === 'superadmin' ? req.query.cafeId : req.cafeId;

  const result = await incidentService.getIncidents({
    cafeId,
    severity,
    status,
    category,
    page: parseInt(page, 10) || 1,
    limit: parseInt(limit, 10) || 20,
  });

  res.status(200).json({
    success: true,
    ...result,
  });
});

const updateIncident = asyncHandler(async (req, res) => {
  const { incidentId } = req.params;
  const { status, remediationNotes, certInReported } = req.body;

  let incident = await incidentService.updateIncidentStatus(incidentId, {
    status,
    remediationNotes,
  });

  if (certInReported) {
    incident = await incidentService.markCertInReported(incidentId, remediationNotes);
  }

  res.status(200).json({
    success: true,
    message: 'Incident updated successfully',
    incident,
  });
});

const triggerContainment = asyncHandler(async (req, res) => {
  const { incidentId } = req.params;
  const { quarantineTenant = false, action, reason } = req.body;

  const incident = await incidentService.getIncidentById(incidentId);
  if (!incident) throw new AppError('Incident not found', 404);

  const cafeId = incident.cafeId || req.cafeId;
  if (!cafeId) throw new AppError('No tenant associated with this incident', 400);

  const breachForensicService = require('../services/breachForensicService');

  const shouldQuarantine = quarantineTenant || action === 'all' || action === 'quarantine';
  let result;
  if (shouldQuarantine) {
    result = await breachForensicService.emergencyQuarantineTenant(cafeId, reason || incident.title);
  } else {
    result = await breachForensicService.revokeCompromisedTokens(cafeId, reason || incident.title);
  }

  // Update incident remediation status
  await incidentService.updateIncidentStatus(incidentId, {
    status: 'mitigated',
    remediationNotes: `Emergency containment executed: ${shouldQuarantine ? 'Tenant Quarantined & Tokens Revoked' : 'Tokens Revoked'} at ${new Date().toISOString()}`,
  });

  res.status(200).json({
    success: true,
    message: 'Emergency security containment executed successfully',
    result,
    containmentResult: {
      tenantQuarantined: shouldQuarantine,
      tokensRevoked: true,
      result,
    },
  });
});

const getCertInDossier = asyncHandler(async (req, res) => {
  const { incidentId } = req.params;
  const breachForensicService = require('../services/breachForensicService');

  const dossier = await breachForensicService.generateCertInDossier(incidentId);

  res.status(200).json({
    success: true,
    dossier,
  });
});

const getForensicAudit = asyncHandler(async (req, res) => {
  const { incidentId } = req.params;
  const { lookbackHours = 24 } = req.query;

  const incident = await incidentService.getIncidentById(incidentId);
  if (!incident) throw new AppError('Incident not found', 404);

  const cafeId = incident.cafeId || req.cafeId;
  if (!cafeId) throw new AppError('No tenant associated with this incident', 400);

  const breachForensicService = require('../services/breachForensicService');
  const audit = await breachForensicService.assessBreachScope(cafeId, parseInt(lookbackHours, 10) || 24);

  res.status(200).json({
    success: true,
    audit,
  });
});

module.exports = {
  createIncident,
  getIncidents,
  updateIncident,
  triggerContainment,
  getCertInDossier,
  getForensicAudit,
};

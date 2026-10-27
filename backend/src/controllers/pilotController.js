const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const pilotService = require('../services/pilotService');

/**
 * Controller for 14-Day Physical Pilot Rollout & GA Sign-Off (Tasks 6.3 & 6.4)
 */

const getPilotStatus = asyncHandler(async (req, res) => {
  const pilot = await pilotService.getOrCreatePilotRun(req.cafeId);
  const audit = await pilotService.auditPilotReadiness(req.cafeId);

  res.status(200).json({
    success: true,
    pilot,
    pilotRun: pilot,
    audit,
  });
});

const startPilot = asyncHandler(async (req, res) => {
  const pilot = await pilotService.getOrCreatePilotRun(req.cafeId);
  res.status(200).json({
    success: true,
    message: 'Pilot run initialized successfully',
    pilot,
    pilotRun: pilot,
  });
});

const logShift = asyncHandler(async (req, res) => {
  const {
    totalOrders,
    totalSales,
    cashCollected,
    digitalCollected,
    discrepancyAmount,
    droppedOrdersCount,
    kitchenLatencyAvgMinutes,
    staffFeedbackNotes,
  } = req.body;

  const pilot = await pilotService.logShiftReconciliation(req.cafeId, {
    totalOrders: Number(totalOrders || 0),
    totalSales: Number(totalSales || 0),
    cashCollected: Number(cashCollected || 0),
    digitalCollected: Number(digitalCollected || 0),
    discrepancyAmount: Number(discrepancyAmount || 0),
    droppedOrdersCount: Number(droppedOrdersCount || 0),
    kitchenLatencyAvgMinutes: Number(kitchenLatencyAvgMinutes || 0),
    staffFeedbackNotes: staffFeedbackNotes || '',
  });

  res.status(201).json({
    success: true,
    message: 'Daily pilot shift logged and reconciled',
    pilot,
    pilotRun: pilot,
  });
});

const advancePhase = asyncHandler(async (req, res) => {
  const pilot = await pilotService.advancePilotPhase(req.cafeId);

  res.status(200).json({
    success: true,
    message: `Pilot advanced to phase: ${pilot.currentPhase}`,
    pilot,
    pilotRun: pilot,
  });
});

const auditReadiness = asyncHandler(async (req, res) => {
  const audit = await pilotService.auditPilotReadiness(req.cafeId);

  res.status(200).json({
    success: true,
    audit,
  });
});

const issueSignoffCertificate = asyncHandler(async (req, res) => {
  const { ownerSignoffName } = req.body;
  if (!ownerSignoffName) {
    throw new AppError('ownerSignoffName is required for General Availability sign-off', 400);
  }

  const certificate = await pilotService.generateGaSignoffCertificate(
    req.cafeId,
    ownerSignoffName
  );

  res.status(200).json({
    success: true,
    message: 'General Availability (GA) certificate successfully approved and issued',
    certificate,
  });
});

module.exports = {
  getPilotStatus,
  startPilot,
  logShift,
  advancePhase,
  auditReadiness,
  issueSignoffCertificate,
};

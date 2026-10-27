const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const pgService = require('../services/pgService');
const resolveGuestToken = require('../utils/resolveGuestToken');
const DiningSession = require('../models/DiningSession');
const { createLogger } = require('../services/logger');

const log = createLogger('pg-billing');

/**
 * Initiate an online payment for a table session.
 * Customer presents their guest token or active session.
 */
const initiateSessionPayment = asyncHandler(async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    throw new AppError('sessionId is required', 400);
  }

  const session = await DiningSession.findById(sessionId);
  if (!session) {
    throw new AppError('Dining session not found', 404);
  }

  // Validate guest authorization
  const guestToken = resolveGuestToken(req);
  const isAuthorizedStaff = req.user && String(req.user.cafeId) === String(session.cafeId);
  const isAuthorizedCustomer = req.customer;

  if (!isAuthorizedStaff && !isAuthorizedCustomer && (!guestToken || session.guestToken !== guestToken)) {
    throw new AppError('Forbidden: Invalid guest session token', 403);
  }

  const paymentData = await pgService.initiatePayment({
    cafeId: session.cafeId,
    sessionId: session._id,
  });

  res.status(200).json({
    success: true,
    payment: paymentData,
  });
});

/**
 * Webhook callback from the cafe's own Payment Gateway (Razorpay/Cashfree/PhonePe).
 * Must be unauthenticated (called directly by payment gateway servers).
 */
const handleGatewayWebhook = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;
  const webhookRequestId =
    req.headers['x-webhook-request-id'] ||
    req.headers['x-razorpay-event-id'] ||
    req.headers['x-request-id'] ||
    '';
  const signature = req.headers['x-razorpay-signature'] || req.headers['x-webhook-signature'] || '';
  const rawBody = req.rawBody || JSON.stringify(req.body);

  log.info('Processing gateway webhook event', {
    cafeId,
    webhookRequestId,
    hasSignature: Boolean(signature),
    ip: req.ip,
  });

  const result = await pgService.handleWebhookEvent({
    cafeId,
    rawBody,
    signature,
    payload: req.body,
  });

  res.status(200).json(result);
});

/**
 * Get cafe's PG configuration (Admin).
 */
const getPGSettings = asyncHandler(async (req, res) => {
  const settings = await pgService.getSettings(req.cafeId);
  res.status(200).json({
    success: true,
    settings,
  });
});

/**
 * Update cafe's PG configuration (Admin: owner/manager).
 */
const updatePGSettings = asyncHandler(async (req, res) => {
  const { enabled, provider, keyId, keySecret, webhookSecret } = req.body;
  const settings = await pgService.updateSettings(req.cafeId, {
    enabled,
    provider,
    keyId,
    keySecret,
    webhookSecret,
  });

  res.status(200).json({
    success: true,
    message: 'Payment gateway settings updated successfully',
    settings,
  });
});

module.exports = {
  initiateSessionPayment,
  handleGatewayWebhook,
  getPGSettings,
  updatePGSettings,
};

const crypto = require('crypto');
const Cafe = require('../models/Cafe');
const DiningSession = require('../models/DiningSession');
const Order = require('../models/Order');
const GatewayTransaction = require('../models/GatewayTransaction');
const AppError = require('../utils/AppError');
const { encryptText, decryptText } = require('../utils/cryptoHelper');
const entitlementService = require('./entitlementService');
const { FEATURES } = require('../config/plans');
const orderService = require('./orderService');
const paymentPipeline = require('./paymentPipeline');

/**
 * Configure or update BYO-PG settings for a cafe (owner/manager).
 */
const updateSettings = async (cafeId, { enabled, provider, keyId, keySecret, webhookSecret }) => {
  const isEntitled = await entitlementService.hasFeature(cafeId, FEATURES.CUSTOM_PAYMENT_GATEWAY);
  if (!isEntitled) {
    throw new AppError(
      'Custom Payment Gateway (BYO-PG) requires a Growth or Pro plan subscription',
      402
    );
  }

  const cafe = await Cafe.findById(cafeId);
  if (!cafe) {
    throw new AppError('Cafe not found', 404);
  }

  if (!cafe.paymentGateway) {
    cafe.paymentGateway = {};
  }

  if (enabled !== undefined) {
    cafe.paymentGateway.enabled = Boolean(enabled);
  }
  if (provider !== undefined) {
    cafe.paymentGateway.provider = provider;
  }
  if (keyId !== undefined) {
    cafe.paymentGateway.keyId = String(keyId).trim();
  }
  if (keySecret) {
    cafe.paymentGateway.keySecretEncrypted = encryptText(String(keySecret).trim());
  }
  if (webhookSecret) {
    cafe.paymentGateway.webhookSecretEncrypted = encryptText(String(webhookSecret).trim());
  }

  await cafe.save();

  return {
    enabled: cafe.paymentGateway.enabled,
    provider: cafe.paymentGateway.provider,
    keyId: cafe.paymentGateway.keyId,
    hasKeySecret: Boolean(cafe.paymentGateway.keySecretEncrypted),
    hasWebhookSecret: Boolean(cafe.paymentGateway.webhookSecretEncrypted),
  };
};

/**
 * Get sanitized PG settings for cafe admin dashboard.
 */
const getSettings = async (cafeId) => {
  const isEntitled = await entitlementService.hasFeature(cafeId, FEATURES.CUSTOM_PAYMENT_GATEWAY);
  const cafe = await Cafe.findById(cafeId).select('paymentGateway').lean();

  const pg = cafe?.paymentGateway || {};
  return {
    isEntitled,
    enabled: Boolean(pg.enabled),
    provider: pg.provider || 'razorpay',
    keyId: pg.keyId || '',
    hasKeySecret: Boolean(pg.keySecretEncrypted),
    hasWebhookSecret: Boolean(pg.webhookSecretEncrypted),
  };
};

/**
 * Initiate an online payment for an open dining session (Customer QR or Session View).
 * Flow: Diner -> Cafe's own Payment Gateway -> Cafe's Bank Account.
 */
const initiatePayment = async ({ cafeId, sessionId }) => {
  const cafe = await Cafe.findById(cafeId);
  if (!cafe) {
    throw new AppError('Cafe not found', 404);
  }

  if (!cafe.paymentGateway?.enabled || !cafe.paymentGateway?.keyId) {
    throw new AppError('Online payments are not configured for this restaurant', 400);
  }

  const entitlements = await entitlementService.getEntitlementsForCafe(cafeId);
  const isEntitled = entitlementService.hasFeature(entitlements, FEATURES.CUSTOM_PAYMENT_GATEWAY);
  if (!isEntitled) {
    throw new AppError('Online payments require a Growth or Pro plan', 402);
  }

  const session = await DiningSession.findById(sessionId);
  if (!session) {
    throw new AppError('Dining session not found', 404);
  }
  if (session.status === 'closed' || session.status === 'paid') {
    throw new AppError('Dining session is already paid and closed', 400);
  }

  // Calculate session billable total
  const orders = await Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } });
  if (orders.length === 0) {
    throw new AppError('No billable items in this dining session', 400);
  }

  const { subtotal, gst: totalGST } = orderService.sumBillableItems(orders);
  let totalAdditions = 0;
  let totalDiscounts = 0;

  if (session.adjustments) {
    for (const adj of session.adjustments) {
      if (adj.type === 'addition') totalAdditions += adj.amount;
      if (adj.type === 'discount') totalDiscounts += adj.amount;
    }
  }

  const totalAmount = Math.max(0, subtotal + totalAdditions - totalDiscounts + totalGST);
  const amountPaise = Math.round(totalAmount * 100);

  const provider = cafe.paymentGateway.provider || 'razorpay';
  const receipt = `rcpt_${session._id.toString().slice(-8)}_${Date.now().toString().slice(-6)}`;

  // Generate gateway order identifier
  const gatewayOrderId = `order_${provider}_${session._id.toString()}_${Date.now()}`;

  return {
    provider,
    keyId: cafe.paymentGateway.keyId,
    amount: amountPaise,
    totalRupees: totalAmount,
    currency: 'INR',
    gatewayOrderId,
    receipt,
    sessionId: session._id,
    cafeName: cafe.name,
  };
};

/**
 * Verify HMAC SHA-256 signature on incoming gateway webhook.
 */
const verifyWebhookSignature = ({ rawBody, signature, webhookSecret }) => {
  if (!signature || !webhookSecret) return false;
  try {
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
  } catch {
    return false;
  }
};

/**
 * Handle incoming Payment Gateway Webhook with idempotency.
 */
const handleWebhookEvent = async ({ cafeId, rawBody, signature, payload }) => {
  const cafe = await Cafe.findById(cafeId);
  if (!cafe || !cafe.paymentGateway?.enabled) {
    throw new AppError('Cafe payment gateway is not active', 404);
  }

  const webhookSecret = decryptText(cafe.paymentGateway.webhookSecretEncrypted);
  if (webhookSecret) {
    const isValid = verifyWebhookSignature({ rawBody, signature, webhookSecret });
    if (!isValid) {
      throw new AppError('Invalid webhook signature', 400);
    }
  }

  // Extract payment details
  const provider = cafe.paymentGateway.provider || 'razorpay';
  const paymentEntity = payload.payload?.payment?.entity || payload;
  const paymentId = paymentEntity.id || payload.gatewayPaymentId;
  const amount = paymentEntity.amount ? paymentEntity.amount / 100 : payload.amount;
  const notes = paymentEntity.notes || payload.notes || {};
  const sessionId = notes.sessionId || payload.sessionId;

  if (!paymentId || !sessionId) {
    throw new AppError('Missing paymentId or sessionId in webhook payload', 400);
  }

  // BILL-007 Idempotency: prevent double settlement
  const existingTx = await GatewayTransaction.findOne({ cafeId, gatewayPaymentId: paymentId });
  if (existingTx) {
    return { success: true, idempotent: true, message: 'Transaction already settled' };
  }

  // Record transaction in ledger
  await GatewayTransaction.create({
    cafeId,
    sessionId,
    provider,
    gatewayOrderId: paymentEntity.order_id || payload.gatewayOrderId || '',
    gatewayPaymentId: paymentId,
    amount,
    currency: paymentEntity.currency || 'INR',
    status: 'captured',
    rawPayload: payload,
  });

  // Execute settlement pipeline
  try {
    await paymentPipeline.executePaymentPipeline(sessionId, 'paid_online', cafeId);
  } catch (err) {
    // If session was already settled concurrently, handle gracefully
    if (err.message && /already paid|closed|processing/i.test(err.message)) {
      return { success: true, idempotent: true, message: err.message };
    }
    throw err;
  }

  return { success: true, settled: true, paymentId };
};

module.exports = {
  updateSettings,
  getSettings,
  initiatePayment,
  verifyWebhookSignature,
  handleWebhookEvent,
};

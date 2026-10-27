const rateLimit = require('express-rate-limit');
const env = require('../config/env');

/**
 * Rate limiter for authentication endpoints (login, register).
 * Strict limits to prevent brute-force attacks.
 * 
 * - Development: 20 requests per 15 minutes per IP
 * - Production: 10 requests per 15 minutes per IP
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.nodeEnv === 'production' ? 10 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
  },
});

/**
 * Rate limiter for staff PIN entry (Module #08).
 * A 4–6 digit PIN has a tiny keyspace, so we cap attempts hard per IP.
 * Per-user lockout on top of this lives in the auth controller.
 *
 * - Development: 30 requests per 15 minutes per IP
 * - Production: 10 requests per 15 minutes per IP
 */
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.nodeEnv === 'production' ? 10 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many PIN attempts. Please try again in a few minutes.',
  },
});

/**
 * Global rate limiter — applies to ALL /api routes.
 *
 * Prevents a single IP from flooding the entire platform. In a multi-tenant
 * SaaS, one bad actor must not be able to degrade the experience for other
 * cafes. The production limit of 200 req/min is generous enough for any real
 * user but low enough to stop automated abuse.
 *
 * NOTE: In multi-container deployments, swap MemoryStore for a Redis-backed
 * store (rate-limit-redis) so counters are shared across instances.
 *
 * - Development: 1000 requests per minute per IP
 * - Production: 200 requests per minute per IP
 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: env.nodeEnv === 'production' ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down.',
  },
});

/**
 * Strict rate limiter for public write endpoints (order creation, session
 * creation, review submission).
 *
 * These endpoints are unauthenticated, so they are the primary DoS and spam
 * vectors. A real customer placing an order hits this at most a few times per
 * visit; an attacker writing a loop hits it in seconds.
 *
 * - Development: 50 requests per minute per IP
 * - Production: 15 requests per minute per IP
 */
const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: env.nodeEnv === 'production' ? 15 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please wait a moment before trying again.',
  },
});

/**
 * Rate limiter for public read endpoints (menu, order status).
 *
 * More generous than writes, but still caps scraping and cache-busting attacks.
 *
 * - Development: 200 requests per minute per IP
 * - Production: 60 requests per minute per IP
 */
const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: env.nodeEnv === 'production' ? 60 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down.',
  },
});

/**
 * SEC-103: Webhook endpoint rate limiter.
 *
 * Payment gateways (Razorpay, Cashfree, PhonePe) typically retry webhooks
 * at most 5 times over ~24h. A legitimate webhook endpoint should never see
 * more than ~10 calls/min from any single IP. An attacker flooding the
 * webhook causes CPU-intensive HMAC-SHA256 computations and database lookups
 * for every request.
 *
 * Key: source IP (NOT cafeId path param) to prevent enumeration bypass.
 *
 * - Development: 100 requests per minute per IP
 * - Production: 30 requests per minute per IP
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: env.nodeEnv === 'production' ? 30 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many webhook requests. Please retry later.',
  },
});

/**
 * SEC-103: Early rejection for invalid cafeId in webhook path params.
 *
 * A valid MongoDB ObjectId is a 24-character hex string. Rejecting invalid
 * formats before any database lookup prevents enumeration attacks and avoids
 * wasting resources on malformed requests.
 */
const validateWebhookCafeId = (req, res, next) => {
  const { cafeId } = req.params;
  if (!cafeId || !/^[a-fA-F0-9]{24}$/.test(cafeId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid cafe identifier',
    });
  }

  // SEC-103: Log the webhook's own request ID for audit trail reconciliation
  // with the gateway's dashboard.
  const webhookRequestId =
    req.headers['x-webhook-request-id'] ||
    req.headers['x-razorpay-event-id'] ||
    req.headers['x-request-id'] ||
    null;

  if (webhookRequestId) {
    req.webhookRequestId = webhookRequestId;
  }

  return next();
};

module.exports = {
  authLimiter,
  pinLimiter,
  globalLimiter,
  publicWriteLimiter,
  publicReadLimiter,
  webhookLimiter,
  validateWebhookCafeId,
};


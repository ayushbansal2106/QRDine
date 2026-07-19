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

module.exports = { authLimiter };

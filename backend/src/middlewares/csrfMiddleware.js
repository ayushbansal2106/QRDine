const crypto = require('crypto');

/**
 * CSRF Protection Middleware — Double Submit Cookie Pattern
 *
 * Strategy:
 *   1. A cryptographically random CSRF token is set as a non-httpOnly cookie
 *      so the frontend JavaScript can read it.
 *   2. The frontend reads the cookie value and sends it as the
 *      `x-csrf-token` request header on every state-changing request.
 *   3. This middleware validates that the header and cookie match using
 *      a constant-time comparison (crypto.timingSafeEqual).
 *
 * This is stateless — no server-side token storage required.
 */

const COOKIE_NAME = 'csrf_token';
const TOKEN_BYTES = 32; // 64 hex chars
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a new CSRF token and set it as a non-httpOnly cookie.
 * Calling it again before expiry refreshes the maxAge but preserves the token.
 */
const setCsrfToken = (req, res, next) => {
  if (typeof next === 'function') {
    // Used as middleware — set token but always continue
    _ensureCookie(req, res);
    next();
  } else {
    // Called directly (e.g., after login) — req, res only
    _ensureCookie(req, res);
  }
};

function _ensureCookie(req, res) {
  let token = req.cookies && req.cookies[COOKIE_NAME];

  if (!token || token.length !== TOKEN_BYTES * 2) {
    token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  }

  res.cookie(COOKIE_NAME, token, {
    httpOnly: false,   // Must be readable by client JS so it can send it as a header
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: MAX_AGE_MS,
    path: '/',
  });

  res.locals.csrfToken = token;
  return token;
}

/**
 * Validate CSRF token on state-changing requests (POST, PUT, PATCH, DELETE).
 * Must be placed AFTER `protect` middleware so the user is already authenticated.
 */
const validateCsrfToken = (req, res, next) => {
  // Only enforce on state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    return next();
  }

  const headerToken = req.headers['x-csrf-token'];
  const cookieToken = req.cookies && req.cookies[COOKIE_NAME];

  if (!headerToken || !cookieToken) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token missing. Please refresh the page and try again.',
    });
  }

  // Constant-time comparison to prevent timing attacks
  try {
    const headerBuffer = Buffer.from(String(headerToken));
    const cookieBuffer = Buffer.from(String(cookieToken));

    if (headerBuffer.length !== cookieBuffer.length) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token mismatch. Please refresh the page and try again.',
      });
    }

    if (!crypto.timingSafeEqual(headerBuffer, cookieBuffer)) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token mismatch. Please refresh the page and try again.',
      });
    }
  } catch {
    return res.status(403).json({
      success: false,
      message: 'CSRF validation failed.',
    });
  }

  // Refresh the cookie maxAge on success
  _ensureCookie(req, res);
  next();
};

module.exports = { setCsrfToken, validateCsrfToken };

/**
 * Resolve the guest session token from the request.
 *
 * Priority order:
 *  1. `x-guest-token` request header (backward compatibility)
 *  2. `guest_token` cookie (set as httpOnly on session create/join)
 *
 * The cookie is the primary method for the frontend since it is
 * httpOnly and not accessible from JavaScript, preventing XSS exfiltration.
 * The header fallback is kept for backward compatibility with any clients
 * that still send the token manually.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
const resolveGuestToken = (req) => {
  // 1. Check x-guest-token header first (backward compat)
  const headerToken = req.headers['x-guest-token'];
  if (headerToken && typeof headerToken === 'string' && headerToken.length > 0) {
    return headerToken;
  }

  // 2. Fallback to httpOnly guest_token cookie
  const cookieToken = req.cookies && req.cookies.guest_token;
  if (cookieToken && typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  return null;
};

module.exports = resolveGuestToken;

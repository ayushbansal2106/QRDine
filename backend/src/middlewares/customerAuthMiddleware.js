const jwt = require('jsonwebtoken');

const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const Customer = require('../models/Customer');

/**
 * Authentication for the guest-facing customer app (Module #09).
 *
 * Reads the httpOnly `customer_token` cookie — deliberately a different name
 * from the `guest_token` that scopes a single dining session, and a different
 * claim (`typ: 'customer'`) from an admin `User` token. A staff token must
 * never be accepted here, and a customer token must never be accepted by
 * `protect`; the explicit claim makes that a decision rather than a side effect
 * of a lookup miss.
 */

const CUSTOMER_COOKIE = 'customer_token';

/**
 * Resolve the customer token from the request.
 *
 * Mirrors `resolveGuestToken`: the frontend and backend run on different
 * origins, so Next reads the httpOnly cookie server-side and forwards it as
 * the `x-customer-token` header. The cookie remains the fallback for any
 * same-origin or native client, and the cookie stays httpOnly either way so
 * script cannot exfiltrate it.
 */
const resolveCustomerToken = (req) => {
  const headerToken = req.headers['x-customer-token'];
  if (headerToken && typeof headerToken === 'string') return headerToken;
  const cookieToken = req.cookies && req.cookies[CUSTOMER_COOKIE];
  if (cookieToken && typeof cookieToken === 'string') return cookieToken;
  return null;
};

const protectCustomer = asyncHandler(async (req, res, next) => {
  const token = resolveCustomerToken(req);

  if (!token) {
    throw new AppError('Sign in to view your profile', 401);
  }

  if (!env.jwtSecret) {
    throw new AppError('JWT_SECRET is not configured', 500);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError('Your session has expired. Please sign in again.', 401);
  }

  if (decoded.typ !== 'customer') {
    throw new AppError('Not authorized', 401);
  }

  // Scope the lookup by the café carried in the token so a profile can never be
  // read across tenants, even if an id were somehow reused.
  const customer = await Customer.findOne({ _id: decoded.id, cafeId: decoded.cafeId });
  if (!customer) {
    throw new AppError('Profile not found', 401);
  }
  if (customer.isBlocked) {
    throw new AppError(
      customer.blockedReason || 'This account has been suspended. Please contact the restaurant.',
      403
    );
  }

  req.customer = customer;
  req.cafeId = customer.cafeId;
  next();
});

/**
 * Attach the customer when a valid token is present, but never reject.
 *
 * Order creation accepts both a signed-in customer and an anonymous walk-in, so
 * this optional variant links the profile when there is one instead of turning
 * a missing token into a 401.
 */
const attachCustomer = asyncHandler(async (req, res, next) => {
  const token = resolveCustomerToken(req);
  if (!token || !env.jwtSecret) return next();

  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    if (decoded.typ !== 'customer') return next();

    const customer = await Customer.findOne({ _id: decoded.id, cafeId: decoded.cafeId });
    // A blocked profile is ignored here rather than rejected: the order still
    // belongs to the table, it simply is not attached to that profile.
    if (customer && !customer.isBlocked) {
      req.customer = customer;
    }
  } catch {
    // An invalid token on an optional route is simply an anonymous visitor.
  }

  return next();
});

module.exports = { protectCustomer, attachCustomer, resolveCustomerToken, CUSTOMER_COOKIE };
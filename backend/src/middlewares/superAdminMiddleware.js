const jwt = require('jsonwebtoken');

const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const SuperAdmin = require('../models/SuperAdmin');
const { SUPER_ADMIN_ROLES } = SuperAdmin;

/**
 * Guards the cross-tenant control plane.
 *
 * A super-admin token is signed with the same secret as a cafe token but
 * carries `typ: 'superadmin'`, and this middleware insists on that claim. The
 * asymmetry is deliberate and is what keeps the two roles apart:
 *
 *   - `protect` (cafe routes) does `User.findById(decoded.id)`. A SuperAdmin
 *     lives in a different collection, so a super-admin token resolves to no
 *     user and is rejected.
 *   - `protectSuperAdmin` (control-plane routes) requires `typ` and loads
 *     `SuperAdmin`, so a cafe owner's token is rejected.
 *
 * Without the `typ` check, any valid cafe token would authenticate here and a
 * single missing role check would let a café owner terminate other customers.
 */
const protectSuperAdmin = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Not authorized, token missing', 401);
  }

  const token = authHeader.split(' ')[1];
  if (!token || token.split('.').length !== 3) {
    throw new AppError('Invalid token', 401);
  }

  if (!env.jwtSecret) {
    throw new AppError('JWT_SECRET is not configured', 500);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }

  if (decoded.typ !== 'superadmin') {
    throw new AppError('Not authorized', 401);
  }

  const admin = await SuperAdmin.findById(decoded.id).select('-password');
  if (!admin) {
    throw new AppError('Not authorized', 401);
  }

  // Checked per request, not only at login: deactivating an operator must take
  // effect immediately, not whenever their token happens to expire.
  if (!admin.isActive) {
    throw new AppError('This account has been deactivated', 403);
  }

  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    throw new AppError('This account is temporarily locked', 423);
  }

  req.superAdmin = admin;
  next();
});

/**
 * Restrict an action to particular staff roles.
 *
 * Used to keep `support` accounts away from terminate/reinstate: handing out
 * plan changes is routine, but locking a paying customer out of their own
 * account is not something a support agent should be able to do unaided.
 */
const authorizeSuperAdminRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.superAdmin) {
    return next(new AppError('Not authorized', 401));
  }

  if (!allowedRoles.includes(req.superAdmin.role)) {
    return next(
      new AppError(
        `This action requires one of: ${allowedRoles.join(', ')}. Your role is ${req.superAdmin.role}.`,
        403
      )
    );
  }

  return next();
};

const superAdminRoles = SUPER_ADMIN_ROLES;

/** Roles permitted to terminate or reinstate a tenant. */
const TERMINATION_ROLES = [SUPER_ADMIN_ROLES.SUPERADMIN];

module.exports = {
  protectSuperAdmin,
  authorizeSuperAdminRoles,
  superAdminRoles,
  TERMINATION_ROLES,
};
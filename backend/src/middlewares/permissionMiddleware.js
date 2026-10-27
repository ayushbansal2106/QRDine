const AppError = require('../utils/AppError');
const { hasPermission } = require('../constants/permissions');

/**
 * Allow the request only when the user holds ALL listed permissions.
 * Usage: router.post('/', protect, tenantMiddleware, requirePermission(PERMISSIONS.POS_USE), ctrl)
 */
const requirePermission = (...permissions) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Not authorized', 401));
  }

  const allowed = permissions.every((permission) => hasPermission(req.user, permission));
  if (!allowed) {
    return next(new AppError('Forbidden: missing required permission', 403));
  }

  next();
};

/**
 * Allow the request when the user holds AT LEAST ONE of the listed permissions.
 */
const requireAnyPermission = (...permissions) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Not authorized', 401));
  }

  const allowed = permissions.some((permission) => hasPermission(req.user, permission));
  if (!allowed) {
    return next(new AppError('Forbidden: missing required permission', 403));
  }

  next();
};

module.exports = { requirePermission, requireAnyPermission };

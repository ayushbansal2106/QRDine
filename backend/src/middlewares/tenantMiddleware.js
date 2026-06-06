const AppError = require('../utils/AppError');

const tenantMiddleware = (req, res, next) => {
  if (!req.user || !req.user.cafeId) {
    return next(new AppError('Tenant context is missing', 401));
  }

  req.cafeId = req.user.cafeId;
  next();
};

module.exports = tenantMiddleware;

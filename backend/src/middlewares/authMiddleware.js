const jwt = require('jsonwebtoken');

const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');

const protect = asyncHandler(async (req, res, next) => {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  }

  if (!token) {
    throw new AppError('Not authorized, token missing', 401);
  }

  if (token.split('.').length !== 3) {
    throw new AppError(
      'Invalid auth token. Use the JWT returned by POST /api/auth/login, not JWT_SECRET from .env.',
      401
    );
  }

  if (!env.jwtSecret) {
    throw new AppError('JWT_SECRET is not configured', 500);
  }

  const decoded = jwt.verify(token, env.jwtSecret);
  const user = await User.findById(decoded.id).select('-password');

  if (!user) {
    throw new AppError('User not found', 401);
  }

  req.user = user;
  next();
});

const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Not authorized', 401));
  }

  if (!allowedRoles.includes(req.user.role)) {
    return next(new AppError('Forbidden', 403));
  }

  next();
};

module.exports = { protect, authorizeRoles };

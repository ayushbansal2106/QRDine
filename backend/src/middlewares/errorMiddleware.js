const env = require('../config/env');
const AppError = require('../utils/AppError');
const { createLogger } = require('../services/logger');
const errorTracking = require('../services/errorTracking');

const log = createLogger('error');

const notFound = (req, res, next) => {
  next(new AppError(`Route not found: ${req.originalUrl}`, 404));
};

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isServerError = statusCode >= 500;

  // Route the error to the tracker before any of the early returns below, so a
  // 400 validation failure is not reported while a 500 is silently dropped.
  if (isServerError) {
    errorTracking.captureException(err, {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      cafeId: req.cafeId || null,
      userId: req.user ? req.user._id : null,
      statusCode,
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Validation failed',
      errors: Object.values(err.errors).map((error) => error.message),
    });
  }

  // SEC-102: Mongoose CastError on invalid ObjectIDs must not leak model name
  // or path internals. A customer hitting /api/orders/abc should get a clean
  // 400, not "Cast to ObjectId failed for value \"abc\" at path \"_id\" for model \"Order\"".
  if (err.name === 'CastError') {
    if (env.nodeEnv === 'production') {
      return res.status(400).json({
        success: false,
        message: 'Invalid resource identifier',
      });
    }
    return res.status(400).json({
      success: false,
      message: `Invalid ${err.path || 'parameter'}: ${err.value}`,
      kind: err.kind,
      path: err.path,
    });
  }

  // SEC-102: Malformed JSON body (e.g. truncated, wrong content-type). Express's
  // built-in parser throws a SyntaxError with `body` and `status` properties.
  // Never reveal "Unexpected token < in JSON at position 0" to a client.
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Malformed request body',
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      message: 'Duplicate key error',
      error: err.keyValue,
    });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      message: 'Invalid or expired token',
    });
  }

  // An unexpected 500 must never leak internals (file paths, driver messages,
  // query shapes) to a customer. Log it server-side, return something opaque.
  if (isServerError) {
    log.error(`${req.method} ${req.originalUrl}`, {
      requestId: req.id,
      statusCode,
      cafeId: req.cafeId || null,
      err,
    });

    if (env.nodeEnv === 'production') {
      return res.status(statusCode).json({
        success: false,
        message: 'Something went wrong on our end. Please try again.',
      });
    }
  }

  const response = {
    success: !isServerError,
    message: err.message || 'Internal Server Error',
  };

  // Machine-readable failure reasons for the client (QUOTA_EXCEEDED,
  // FEATURE_NOT_ENTITLED, SUBSCRIPTION_LAPSED, …). Only string codes we set
  // ourselves are forwarded — Mongo driver errors use numeric codes and are
  // already handled above, so this cannot leak infrastructure detail.
  if (typeof err.code === 'string') {
    response.code = err.code;
  }
  if (err.details && typeof err.details === 'object') {
    response.details = err.details;
  }

  if (env.nodeEnv !== 'production') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = { notFound, errorHandler };


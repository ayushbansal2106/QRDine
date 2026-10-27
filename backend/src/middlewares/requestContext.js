const crypto = require('crypto');

const { createLogger, sanitizeUrl } = require('../services/logger');

const log = createLogger('request');

const HEADER = 'x-request-id';

/**
 * Give every request an id, and put it on the response.
 *
 * This is what makes a customer report actionable: the café can read the id off
 * the failed response, and that one string correlates the access log, the
 * error-tracking event and any log line emitted while handling it. Without it
 * the only correlation is a timestamp, which is ambiguous the moment two
 * requests overlap.
 *
 * An inbound `x-request-id` is trusted and reused so a request can be traced
 * across a proxy or the frontend — but it is length-capped, because an
 * unvalidated header echoed into every log line is a log-injection vector.
 */
const requestId = (req, res, next) => {
  const inbound = req.headers[HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

  const id =
    typeof candidate === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(candidate)
      ? candidate
      : crypto.randomBytes(8).toString('hex');

  req.id = id;
  res.setHeader(HEADER, id);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    // Level is chosen dynamically; the logger exposes fixed names.
    log[level]('request', {
      requestId: id,
      method: req.method,
      // originalUrl, not url: this must include the query string an operator
      // would otherwise have to guess at.
      path: sanitizeUrl(req.originalUrl),
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      cafeId: req.cafeId || null,
      userId: req.user ? req.user._id : null,
    });
  });

  next();
};

module.exports = { requestId, HEADER };
/**
 * Error tracking (Sentry) — optional, and off unless a DSN is configured.
 *
 * ── Why it must be optional ───────────────────────────────────────────────
 * Requiring `@sentry/node` at module load would mean no development, no test
 * run and no local demo works until a third-party account exists. The SDK is
 * therefore loaded lazily inside a try/catch: if it is missing, this module
 * degrades to structured logging and says so once. A missing monitoring SDK
 * must never take the ordering API down.
 *
 * ── Scrubbing happens twice ───────────────────────────────────────────────
 * `logger.redact` masks PII on the way *in*; `scrubEvent` masks it again on the
 * way *out*. That is deliberate belt-and-braces: Sentry also captures request
 * headers and cookies through its own middleware, and those never passed
 * through our logger at all. Either layer alone would leave a hole.
 */

const { createLogger, redact } = require('./logger');

const log = createLogger('errorTracking');

let Sentry = null;
let initialised = false;
let missingSdkWarned = false;

const isConfigured = () => Boolean(process.env.SENTRY_DSN);

const loadSdk = () => {
  if (Sentry) return Sentry;
  try {
    // eslint-disable-next-line global-require
    Sentry = require('@sentry/node');
    return Sentry;
  } catch {
    if (!missingSdkWarned) {
      missingSdkWarned = true;
      log.warn('SENTRY_DSN is set but @sentry/node is not installed; error tracking is disabled', {
        hint: 'npm install @sentry/node',
      });
    }
    return null;
  }
};

/**
 * Strip anything identifying from a Sentry event before it leaves the process.
 *
 * Sentry's own request middleware captures headers, cookies and (depending on
 * config) request bodies. This app holds customer phone numbers, e-mail
 * addresses, OTP codes and guest/session tokens — none of which may be handed to
 * a third party. Returns `null` to drop the event entirely.
 */
const scrubEvent = (event) => {
  if (!event || typeof event !== 'object') return null;

  const scrubbed = { ...event };

  if (scrubbed.request) {
    const headers = { ...(scrubbed.request.headers || {}) };
    for (const key of Object.keys(headers)) {
      if (/cookie|authorization|token|pin|secret/i.test(key)) headers[key] = '[redacted]';
    }
    scrubbed.request = {
      ...scrubbed.request,
      headers,
      // The body is customer data by definition.
      data: scrubbed.request.data ? redact(scrubbed.request.data) : undefined,
      cookies: undefined,
    };
  }

  if (scrubbed.user) {
    // Keep the id for grouping, drop every contact detail.
    scrubbed.user = { id: scrubbed.user.id };
  }

  if (scrubbed.extra) {
    scrubbed.extra = redact(scrubbed.extra);
  }

  if (Array.isArray(scrubbed.breadcrumbs)) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((crumb) => ({
      ...crumb,
      data: crumb.data ? redact(crumb.data) : crumb.data,
    }));
  }

  return scrubbed;
};

/**
 * Initialise error tracking. Safe to call unconditionally; returns whether it
 * actually came up, so the caller can log the truth rather than assuming.
 */
const initErrorTracking = () => {
  if (initialised) return Boolean(Sentry);

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    initialised = true;
    return false;
  }

  const sdk = loadSdk();
  if (!sdk) {
    initialised = true;
    return false;
  }

  try {
    sdk.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      // Do not send the customer's IP or geography alongside their data.
      sendDefaultPii: false,
      // The stack trace is the point; the source maps make it readable.
      attachStacktrace: true,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
      beforeSend: (event) => scrubEvent(event),
      // Breadcrumbs would otherwise record every request URL, including the
      // guest ones carrying a session token in the path.
      beforeBreadcrumb: (crumb) => scrubEvent(crumb) || crumb,
    });
    initialised = true;
    Sentry = sdk;
    log.info('Error tracking enabled', { environment: process.env.NODE_ENV });
    return true;
  } catch (err) {
    initialised = true;
    log.error('Failed to initialise error tracking; continuing without it', {
      reason: err.message,
    });
    return false;
  }
};

/**
 * Express request handler. Mounted first, so every request is associated with a
 * trace. Returns a pass-through when tracking is off, which keeps `app.js`
 * free of conditionals.
 */
const requestHandler = () => (req, res, next) => {
  if (Sentry && typeof Sentry.requestHandler === 'function') {
    return Sentry.requestHandler()(req, res, next);
  }
  return next();
};

const errorHandler = () => (err, req, res, next) => {
  if (Sentry && typeof Sentry.errorHandler === 'function') {
    return Sentry.errorHandler()(err, req, res, next);
  }
  return next(err);
};

/** Report a caught error with structured context. No-op when disabled. */
const captureException = (err, context) => {
  if (!Sentry) return false;
  try {
    Sentry.captureException(err, context ? { extra: redact(context) } : undefined);
    return true;
  } catch {
    // Never let monitoring break the request path.
    return false;
  }
};

const captureMessage = (message, context) => {
  if (!Sentry) return false;
  try {
    Sentry.captureMessage(message, context ? { extra: redact(context) } : undefined);
    return true;
  } catch {
    return false;
  }
};

/** Test seam: forget any initialised state. */
const reset = () => {
  Sentry = null;
  initialised = false;
  missingSdkWarned = false;
};

module.exports = {
  initErrorTracking,
  isConfigured,
  captureException,
  captureMessage,
  requestHandler,
  errorHandler,
  scrubEvent,
  reset,
};
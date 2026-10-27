/**
 * Structured logging.
 *
 * Why this exists: every error currently goes to `console.error`, which prints
 * a stack trace and nothing else. When a paying café reports "it broke", there
 * is no timestamp, no request id, no tenant, no route — so the only way to
 * reproduce it is to guess. In production this emits one JSON object per line,
 * which is what log aggregators actually ingest; in development it stays human
 * readable.
 *
 * Zero dependencies on purpose. This is a logging *format*, not a product, and
 * the app already depends on very little.
 *
 * ── Redaction ─────────────────────────────────────────────────────────────
 * This is the part that is not optional. The application handles customer
 * phone numbers, e-mail addresses, one-time codes, guest tokens and session
 * cookies. Those log lines are shipped to a third-party error tracker, so a
 * `console.log(req.body)` is a GDPR/DPDP problem, not just untidy output.
 *
 * `redact()` is applied to every log call and again inside the error tracker,
 * so a field added by mistake at one call site is still caught at the boundary.
 * Redaction is by *key name*, recursively, with a depth limit so a
 * self-referential object cannot hang the process.
 */

const SENSITIVE_KEY_PATTERN =
  /(pass(word|hash)?|pin|otp|secret|token|authorization|cookie|sessionid|guesttoken|guest_token|customer_token|admin_token|apikey|api_key|credential|signature|digest|cvv|passcode|authcode|accesscode|verification_?code|one_time_code|^code$|bearer)/i;

// Keys holding customer identity. Masked rather than dropped, so an operator can
// still tell "two different customers hit this" from "the same one did".
const IDENTITY_KEY_PATTERN = /^(phone|mobile|email|customeremail|owneremail|contact|address|name)$/i;

const MASK = '[redacted]';
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2000;

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Sanitize sensitive parameters from URL query strings.
 */
const sanitizeUrl = (url) => {
  if (typeof url !== 'string' || !url.includes('?')) return url;
  try {
    const [pathname, search] = url.split('?');
    const params = new URLSearchParams(search);
    for (const key of Array.from(params.keys())) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        params.set(key, MASK);
      }
    }
    return `${pathname}?${params.toString()}`;
  } catch {
    return url;
  }
};

/**
 * Recursively mask sensitive values.
 *
 * Returns a new structure; the input is never mutated, because the caller is
 * usually about to pass the same object somewhere else.
 */
const redact = (value, depth = 0) => {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    let sanitized = value;
    if (sanitized.toLowerCase().startsWith('bearer ')) {
      sanitized = `Bearer ${MASK}`;
    } else if (sanitized.includes('?')) {
      sanitized = sanitizeUrl(sanitized);
    }
    return sanitized.length > MAX_STRING_LENGTH
      ? `${sanitized.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : sanitized;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  // Errors carry a stack (potentially enormous) and often the original request.
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (value instanceof Date) return value.toISOString();

  if (depth >= MAX_DEPTH) return '[max depth]';

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redact(v, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    return items;
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = MASK;
      } else if (IDENTITY_KEY_PATTERN.test(key)) {
        out[key] = typeof val === 'string' && val ? maskIdentity(val) : MASK;
      } else {
        out[key] = redact(val, depth + 1);
      }
    }
    return out;
  }

  // Functions, symbols, etc. are noise in a log line.
  return undefined;
};

/**
 * Keep just enough of an identifier to correlate, never enough to identify.
 * `9876543210` becomes `9*****210`; an e-mail keeps its first character.
 */
const maskIdentity = (value) => {
  const str = String(value);
  if (str.includes('@')) {
    const at = str.indexOf('@');
    return `${str[0]}${MASK}${str.slice(at)}`;
  }
  if (str.length <= 2) return MASK;
  return `${str[0]}${'*'.repeat(Math.max(1, str.length - 2))}${str[str.length - 1]}`;
};

const resolveLevel = () => {
  const configured = String(process.env.LOG_LEVEL || '').toLowerCase();
  if (LEVELS[configured] !== undefined) return configured;
  return isProduction() ? 'info' : 'debug';
};

const write = (level, namespace, message, context) => {
  if (LEVELS[level] < LEVELS[resolveLevel()]) return;

  const safeContext = context ? redact(context) : undefined;

  if (isProduction()) {
    // One JSON object per line: the format every aggregator can parse without
    // a regex, and the only format that survives log rotation intact.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        service: 'qrdine-api',
        namespace,
        message: String(message),
        ...(safeContext && typeof safeContext === 'object' && !Array.isArray(safeContext)
          ? safeContext
          : safeContext !== undefined
            ? { context: safeContext }
            : {}),
      })
    );
    return;
  }

  const tag = `[${namespace}]`;
  const suffix = safeContext === undefined ? '' : ` ${JSON.stringify(safeContext)}`;
  const line = `${tag} ${message}${suffix}`;

  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
};

/**
 * A namespaced logger. `namespace` is the module or subsystem, so a log search
 * can answer "what did billing do" without matching on message text.
 */
const createLogger = (namespace) => ({
  debug: (message, context) => write('debug', namespace, message, context),
  info: (message, context) => write('info', namespace, message, context),
  warn: (message, context) => write('warn', namespace, message, context),
  error: (message, context) => write('error', namespace, message, context),
});

module.exports = { createLogger, redact, maskIdentity, sanitizeUrl, LEVELS };
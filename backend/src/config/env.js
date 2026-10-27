const dotenv = require('dotenv');

dotenv.config();

const env = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: process.env.SMTP_PORT || 587,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || 'noreply@qrdine.com',
  // Module #09 — SMS for customer sign-in OTPs. Indian transactional SMS needs
  // DLT clearance (approved sender ID + template) before any message can be
  // sent; until SMS_PROVIDER is set, smsService falls back to console mode so
  // the flow is testable, and refuses to pretend it sent anything in production.
  smsProvider: process.env.SMS_PROVIDER || 'console',
  smsAuthKey: process.env.SMS_AUTH_KEY || '',
  smsTemplateId: process.env.SMS_TEMPLATE_ID || '',
  /**
   * TEMPORARY, DEVELOPMENT ONLY.
   *
   * Pins every sign-in code to one value so the flow can be exercised before an
   * SMS provider is integrated. This removes the only thing standing between an
   * attacker who knows a customer's phone number and that customer's wallet,
   * order history and contact details — so `collectConfigProblems` below refuses
   * to boot a production server with it set.
   */
  otpFixedCode: (process.env.OTP_FIXED_CODE || '').trim(),
  // Module #18 — Google Gemini (server-side only, never exposed to the client)
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  // Verified to accept image input + a JSON responseSchema.
  // gemini-2.0-flash and gemini-2.5-flash are both retired (404).
  // Defaults to the fast model because a scan that takes 80s is worse than one
  // that takes 3s; geminiService escalates through slower/more capable models
  // only if the fast one is throttled. A live transcription off flash-lite
  // matched flash for price and category accuracy.
  // Re-verify after any model change: node scripts/probe-gemini-vision.js
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  // Module #11 — public base used when writing NFC/QR tag payloads
  frontendPublicUrl: process.env.FRONTEND_PUBLIC_URL || 'http://localhost:3000',
  apiPublicUrl: process.env.API_PUBLIC_URL || '',
  // Error tracking (BLOCKER-04). Absent DSN = disabled, never fatal: a missing
  // third-party SDK must not stop the ordering API from booting.
  sentryDsn: (process.env.SENTRY_DSN || '').trim(),
  sentryTracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  // debug | info | warn | error. Empty = the environment's default.
  logLevel: (process.env.LOG_LEVEL || '').trim(),
  // SEC-105: Dedicated encryption key for BYO-PG secrets. Must NOT be the same
  // as JWT_SECRET so rotating one does not break the other.
  pgEncryptionKey: (process.env.PG_ENCRYPTION_KEY || '').trim(),
  pgEncryptionKeyPrevious: (process.env.PG_ENCRYPTION_KEY_PREVIOUS || '').trim(),
  // SEC-104: Comma-separated allowed CORS origins. Falls back to frontendUrl
  // for single-domain deployments.
  allowedOrigins: (() => {
    const raw = (process.env.ALLOWED_ORIGINS || '').trim();
    if (raw) return raw.split(',').map((o) => o.trim()).filter(Boolean);
    return null; // null = fall back to frontendUrl
  })(),
};

/**
 * Fail fast on missing or unsafe configuration.
 *
 * Without this the process happily boots with no JWT_SECRET and then either
 * throws deep inside `jsonwebtoken` or, worse, signs tokens with a guessable
 * default. A subscription product must refuse to start rather than serve
 * insecurely.
 */
const REQUIRED_IN_PRODUCTION = ['MONGODB_URI', 'JWT_SECRET', 'PG_ENCRYPTION_KEY'];

/**
 * Every reason the current configuration is unsafe, in one place.
 *
 * Extracted from `validateConfig` so the rules can be unit tested — a guard that
 * calls `process.exit` is otherwise only ever exercised by actually booting a
 * broken server.
 */
function collectConfigProblems() {
  const problems = [];

  const requiredKeys = env.nodeEnv === 'production'
    ? REQUIRED_IN_PRODUCTION
    : ['MONGODB_URI', 'JWT_SECRET'];

  for (const key of requiredKeys) {
    if (!process.env[key]) problems.push(`${key} is not set`);
  }

  if (env.nodeEnv === 'production') {
    const secret = process.env.JWT_SECRET || '';
    if (secret && secret.length < 32) {
      problems.push('JWT_SECRET must be at least 32 characters in production');
    }
    if (secret.includes('change') || secret.includes('test') || secret.includes('dev')) {
      problems.push('JWT_SECRET still looks like a placeholder value');
    }
    if (env.frontendUrl.includes('localhost')) {
      problems.push('FRONTEND_URL still points at localhost in production');
    }
    // An http:// frontend in production leaks the admin session cookie in clear.
    if (env.frontendPublicUrl.startsWith('http://')) {
      problems.push('FRONTEND_PUBLIC_URL must use https in production');
    }
    // A fixed OTP is a deliberate authentication bypass: anyone who knows a
    // phone number can sign in as that customer. Never acceptable in production,
    // whatever the reason it was switched on.
    if (env.otpFixedCode) {
      problems.push(
        'OTP_FIXED_CODE is set — a shared sign-in code would let anyone impersonate any customer. Remove it before deploying.'
      );
    }

    // SEC-104: Validate ALLOWED_ORIGINS in production.
    if (env.allowedOrigins) {
      for (const origin of env.allowedOrigins) {
        if (origin.startsWith('http://')) {
          problems.push(`ALLOWED_ORIGINS contains a non-HTTPS origin: ${origin}`);
        }
        if (/localhost|127\.0\.0\.1/.test(origin)) {
          problems.push(`ALLOWED_ORIGINS contains a localhost origin: ${origin}`);
        }
      }
    }

    problems.push(...collectDatabaseProblems());
  }

  // SEC-102: Warn if `npm start` is used without NODE_ENV=production.
  if (
    process.env.npm_lifecycle_event === 'start' &&
    env.nodeEnv !== 'production'
  ) {
    problems.push(
      'NODE_ENV is not "production" but the process was started with `npm start`. Set NODE_ENV=production or use `npm run dev` for development.'
    );
  }

  return problems;
}

/**
 * Rules about the production *database*, kept apart so they can be tested
 * directly and reasoned about on their own.
 *
 * The failure these guard against is not subtle but it is late: the process
 * boots happily, signs a customer up, and the write vanishes. Every item here
 * is checked before a single request is served rather than discovered later.
 */
function collectDatabaseProblems(overrides = {}) {
  const problems = [];
  const nodeEnv = overrides.NODE_ENV !== undefined ? overrides.NODE_ENV : env.nodeEnv;
  const uri = overrides.MONGODB_URI !== undefined ? overrides.MONGODB_URI : (env.mongodbUri || '');

  // Self-guarding rather than relying on the caller to remember: these rules
  // describe a production deployment, and a developer pointed at a local
  // mongod is doing the right thing.
  if (nodeEnv !== 'production') return problems;
  if (!uri) return problems; // Already reported as a missing required key.

  let parsed = null;
  try {
    parsed = new URL(uri);
  } catch {
    problems.push('MONGODB_URI is not a valid connection string');
    return problems;
  }

  // SEC-101: Production must use mongodb+srv (Atlas / equivalent managed cluster).
  if (parsed.protocol !== 'mongodb+srv:') {
    problems.push(
      'MONGODB_URI must use mongodb+srv:// with TLS in production. A plain mongodb:// URI risks plaintext connections and skips Atlas topology discovery.'
    );
  }

  // A local or self-hosted instance is the single most dangerous thing to ship,
  // because it means the only copy of every order and customer phone number
  // lives on one disk. Atlas (or an equivalent managed, replicating cluster) is
  // the baseline.
  if (/^(mongodb:\/\/)?(localhost|127\.0\.0\.1)/.test(uri)) {
    problems.push(
      'MONGODB_URI points at a local database. Production must use a managed cluster with automated backups.'
    );
  }

  // Owner registration runs in a transaction (`Cafe.startSession()`), and
  // transactions require a replica set or a mongos. A standalone `mongod`
  // rejects them at runtime, so signup would fail only when a real customer
  // tried to register.
  if (parsed.protocol === 'mongodb:' && !uri.includes('replicaSet=')) {
    const selfHostedSingleNode = /@(localhost|127\.0\.0\.1)/.test(uri);
    if (selfHostedSingleNode) {
      problems.push(
        'MONGODB_URI has no replicaSet and host registration uses a transaction, which a standalone mongod cannot run. Use a replica set or Atlas.'
      );
    }
  }

  // With no database in the path, Mongoose silently connects to a database
  // literally named `test`. On Atlas that is a brand new, empty database that
  // looks perfectly healthy while holding nothing.
  const dbName = parsed.pathname.replace(/^\//, '').trim();
  if (!dbName) {
    problems.push(
      'MONGODB_URI has no database name. Mongoose would default to a database called "test". Put the name in the URI, e.g. .../qrdine?retryWrites=true'
    );
  } else if (dbName === 'test') {
    problems.push('MONGODB_URI names the database "test". Point it at a real database name.');
  }

  // Retryable writes are what let a transient network blip replay a write
  // instead of losing it. Atlas provides them by default; a hand-written URI
  // has to ask.
  if (parsed.protocol === 'mongodb+srv:') {
    const params = parsed.searchParams;
    if (!params.has('retryWrites')) {
      problems.push('MONGODB_URI should set retryWrites=true so a network blip cannot lose a write.');
    }
    if (params.get('retryWrites') === 'false') {
      problems.push('MONGODB_URI has retryWrites=false, so a transient network failure can silently drop a write.');
    }
    if (!params.has('w') && !params.has('w=majority')) {
      problems.push('MONGODB_URI should set w=majority so a write is acknowledged only once it is replicated.');
    }
  }

  return problems;
}

function validateConfig() {
  const problems = collectConfigProblems();

  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(
      [
        '',
        '[config] Refusing to start — invalid configuration:',
        ...problems.map((p) => `  - ${p}`),
        '',
      ].join('\n')
    );
    process.exit(1);
  }
}

validateConfig();

// Loud at boot rather than quiet: a developer who forgets this is running with
// a bypass should never have to guess why sign-in "just works" for any number.
if (env.otpFixedCode) {
  // eslint-disable-next-line no-console
  console.warn(
    `\n[config] WARNING — OTP_FIXED_CODE is set to "${env.otpFixedCode}". Every sign-in code is the same and any phone number can be impersonated. Development only.\n`
  );
}

// A warning rather than a startup failure: running without error tracking is
// survivable, but not knowing that you are is not. This is the difference
// between "we chose not to pay for Sentry" and "we forgot".
if (env.nodeEnv === 'production' && !env.sentryDsn) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n[config] WARNING — SENTRY_DSN is not set. Errors will only reach stdout, so a customer reporting a failure cannot be diagnosed. Set it before launch.\n'
  );
}

module.exports = env;
module.exports.collectConfigProblems = collectConfigProblems;
module.exports.collectDatabaseProblems = collectDatabaseProblems;


const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const { globalLimiter } = require('./middlewares/rateLimiter');

const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const menuRoutes = require('./routes/menuRoutes');
const tableRoutes = require('./routes/tableRoutes');
const orderRoutes = require('./routes/orderRoutes');
const requestRoutes = require('./routes/requestRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const billingRoutes = require('./routes/billingRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const cafeRoutes = require('./routes/cafeRoutes');
const userRoutes = require('./routes/userRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const posRoutes = require('./routes/posRoutes');
const kdsRoutes = require('./routes/kdsRoutes');
const customerRoutes = require('./routes/customerRoutes');
// Guest-facing customer app (Module #09). Deliberately singular so it never
// shadows the admin CRM router mounted at /api/customers.
const customerAppRoutes = require('./routes/customerAppRoutes');
const auditRoutes = require('./routes/auditRoutes');
const shiftRoutes = require('./routes/shiftRoutes');
const couponRoutes = require('./routes/couponRoutes');
const loyaltyRoutes = require('./routes/loyaltyRoutes');
const walletRoutes = require('./routes/walletRoutes');
const walletsRoutes = require('./routes/walletsRoutes');
const scratchRoutes = require('./routes/scratchRoutes');
const waiterRoutes = require('./routes/waiterRoutes');
const geofenceRoutes = require('./routes/geofenceRoutes');
const nfcRoutes = require('./routes/nfcRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const pgBillingRoutes = require('./routes/pgBillingRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const pilotRoutes = require('./routes/pilotRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const swaggerSpec = require('./docs/swaggerSpec');
const mongoose = require('mongoose');
const { notFound, errorHandler } = require('./middlewares/errorMiddleware');
const { requestId } = require('./middlewares/requestContext');
const errorTracking = require('./services/errorTracking');
const os = require('os');
const socketService = require('./services/socketService');
const { protectSuperAdmin } = require('./middlewares/superAdminMiddleware');
const asyncHandler = require('./utils/asyncHandler');

const env = require('./config/env');

const app = express();

// Error tracking must be the very first middleware so a crash anywhere else in
// the chain is still captured. A no-op pass-through when no DSN is set.
app.use(errorTracking.requestHandler());

// Assigns req.id and logs one structured line per completed request.
app.use(requestId);

// Behind a load balancer / reverse proxy (nginx, Heroku, Render, Fly) this makes
// req.ip the real client address, so rate limiting and audit logs are not all
// attributed to the proxy itself.
app.set('trust proxy', 1);

// SEC-104: CORS Origin Lockdown.
// In production, only explicitly allowed origins can make cross-origin requests.
// In development, localhost variants are accepted for convenience.
const normalizeUrl = (url) => (url ? url.trim().replace(/\/+$/, '') : '');

const resolveAllowedOrigins = () => {
  let origins = [];
  if (env.allowedOrigins && env.allowedOrigins.length > 0) {
    origins = env.allowedOrigins;
  } else if (env.frontendUrl) {
    origins = [env.frontendUrl];
  }

  // Strip trailing slashes so `https://example.com/` matches `https://example.com`
  const normalized = origins.map(normalizeUrl).filter(Boolean);

  if (env.nodeEnv !== 'production') {
    return Array.from(new Set([...normalized, 'http://localhost:3000', 'http://127.0.0.1:3000']));
  }
  return normalized;
};

const allowedOrigins = resolveAllowedOrigins();

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header (server-to-server, curl, health checks).
    if (!origin) return callback(null, true);
    const incoming = normalizeUrl(origin);
    const isAllowed = allowedOrigins.some((allowed) => allowed === incoming);
    if (isAllowed) return callback(null, true);
    // In development, be lenient but warn.
    if (env.nodeEnv !== 'production') return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} is not allowed`));
  },
  credentials: true,
}));

// SEC-104: Vary: Origin so CDN/proxy caches don't serve a response with the
// wrong Access-Control-Allow-Origin to a different origin.
app.use((req, res, next) => {
  res.setHeader('Vary', 'Origin');
  next();
});

// Root endpoint for platform health probes (Render / load balancers)
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'QRDine API',
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// --- Health check -----------------------------------------------------
// Load balancers and uptime monitors need an unauthenticated, cheap endpoint
// that does not require a database round-trip to answer.
app.get('/api/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = states[mongoose.connection.readyState] || 'unknown';

  // OPS-101: Check backup verification freshness from the verification log.
  let backupVerification = 'unknown';
  try {
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, '..', 'backups', 'verification-log.jsonl');
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      const lastOk = [...lines]
        .reverse()
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .find((e) => e && e.status === 'BACKUP_VERIFY_OK');

      if (lastOk && lastOk.timestamp) {
        const ageMs = Date.now() - new Date(lastOk.timestamp).getTime();
        const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
        backupVerification = ageMs <= FOURTEEN_DAYS_MS ? 'current' : 'stale';
      } else {
        backupVerification = 'never';
      }
    } else {
      backupVerification = 'never';
    }
  } catch {
    backupVerification = 'error';
  }

  res.status(dbState === 'connected' ? 200 : 503).json({
    success: dbState === 'connected',
    status: dbState === 'connected' ? 'ok' : 'degraded',
    database: dbState,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    backupVerification,
  });
});

// OPS-102: Process and system resource metrics endpoint for monitoring and APM.
// Protected by superadmin authentication.
app.get(
  '/api/health/metrics',
  protectSuperAdmin,
  asyncHandler(async (req, res) => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    let socketCount = 0;
    const io = socketService.getIO();
    if (io) {
      if (io.engine && typeof io.engine.clientsCount === 'number') {
        socketCount = io.engine.clientsCount;
      } else if (io.sockets && io.sockets.sockets) {
        socketCount = io.sockets.sockets.size;
      }
    }

    let dbPoolStats = {
      readyState: mongoose.connection.readyState,
    };
    try {
      if (mongoose.connection.readyState === 1 && mongoose.connection.db?.admin) {
        const serverStatus = await mongoose.connection.db.admin().serverStatus();
        if (serverStatus && serverStatus.connections) {
          dbPoolStats.connections = serverStatus.connections;
        }
      }
    } catch {
      // serverStatus non-fatal
    }

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      process: {
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        memoryUsageBytes: {
          rss: mem.rss,
          heapTotal: mem.heapTotal,
          heapUsed: mem.heapUsed,
          external: mem.external,
          arrayBuffers: mem.arrayBuffers,
        },
        cpuUsageMicros: cpu,
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        cpuCount: os.cpus().length,
        loadavg: os.loadavg(),
        freeMemoryBytes: os.freemem(),
        totalMemoryBytes: os.totalmem(),
      },
      connections: {
        socketIoActive: socketCount,
        database: dbPoolStats,
      },
    });
  })
);

if (env.nodeEnv !== 'production') {
  app.get('/api/debug-sentry', (req, res) => {
    errorTracking.captureMessage('Debug Sentry verification event', {
      source: 'debug-route',
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true, message: 'Debug Sentry event dispatched' });
  });
}


// Parse cookies (needed for CSRF token validation)
app.use(cookieParser());

// Security headers
app.use(helmet());

// Body parser with size limit (prevents large payload DoS)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Gzip/deflate compression for all responses
app.use(compression());

// Global rate limiter across all /api routes
app.use('/api', globalLimiter);

const { sanitizeUrl } = require('./services/logger');
morgan.token('sanitized-url', (req) => sanitizeUrl(req.originalUrl || req.url));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan(':method :sanitized-url :status :response-time ms - :res[content-length]'));
}

// Serve static files (invoice PDFs)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

if (env.nodeEnv !== 'production') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/billing/pg', pgBillingRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/cafe', cafeRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/kds', kdsRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/customer', customerAppRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/wallets', walletsRoutes);
app.use('/api/scratch', scratchRoutes);
app.use('/api/waiter', waiterRoutes);
app.use('/api/geofence', geofenceRoutes);
app.use('/api/nfc', nfcRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/pilot', pilotRoutes);
// Cross-tenant control plane. Separate router, separate auth middleware,
// separate collection — nothing here is reachable with a cafe owner's token.
app.use('/api/superadmin', superAdminRoutes);


app.use(notFound);
app.use(errorHandler);

// Tables that were scanned and then abandoned otherwise hold their session open
// forever, so the floor plan shows them occupied and the next scan is told a
// session is already running. A background sweep closes the empty ones.
require('./services/sessionLifecycleService').startIdleSessionSweeper();

module.exports = app;

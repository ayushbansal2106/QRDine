const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const env = require('./config/env');

// Before `./app`: error tracking must be initialised before any request
// middleware that might throw is registered.
const errorTracking = require('./services/errorTracking');
errorTracking.initErrorTracking();

const { createLogger } = require('./services/logger');
const app = require('./app');
const connectDB = require('./config/db');
const socketService = require('./services/socketService');
const { startSessionRecoverySweeper } = require('./services/sessionLifecycleService');
const { startCouponGrantSweeper } = require('./services/couponGrantService');
const planFeatureConfigService = require('./services/planFeatureConfigService');

const log = createLogger('server');

const startServer = async () => {
  await connectDB();

  // Load the persisted plan configuration before the first request arrives, so
  // pricing, the pricing page and the entitlement gate all start from the
  // same picture of what each plan includes.
  await planFeatureConfigService.ensureLoaded().catch((err) => {
    log.error('failed to load the plan configuration', { err });
  });

  // A session left mid-settlement by a previous process holds a lock nobody
  // will ever release. Reopen them before the first request arrives, so the
  // tables are on the bills board again rather than invisible.
  startSessionRecoverySweeper();

  // "Inactive for 30 days" becomes true while nobody is looking, so personal
  // offer codes are issued on a timer rather than at sign-up.
  startCouponGrantSweeper();

  const server = http.createServer(app);

  // SEC-104: Use the same allowedOrigins array as app.js CORS config.
  // This eliminates the inconsistency of reading process.env.FRONTEND_URL
  // directly and ensures Socket.IO handshakes are validated against the
  // same allowlist as HTTP requests.
  const socketOrigins = (() => {
    if (env.nodeEnv !== 'production') {
      return [env.frontendUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'];
    }
    if (env.allowedOrigins && env.allowedOrigins.length > 0) {
      return env.allowedOrigins;
    }
    return [env.frontendUrl];
  })();

  const io = new Server(server, {
    cors: {
      origin: socketOrigins,
      credentials: true,
    },
  });

  /**
   * Graceful shutdown.
   *
   * Every orchestrator — Docker, Render, Fly, Kubernetes, systemd — stops a
   * container with SIGTERM. Without this handler Node exits immediately and
   * every in-flight order write is cut mid-query, and every admin looking at a
   * live KDS sees the socket drop with no explanation.
   *
   * `server.close()` stops accepting new connections and waits for in-flight
   * requests; draining the Socket.IO connections tells the browser to reconnect
   * (and it will, to the new container) instead of showing a silent stall. The
   * hard timeout exists because a stuck connection must not block a deploy
   * forever — the platform will SIGKILL us after its own grace period anyway.
   */
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('graceful shutdown started', { signal });

    const hardExit = setTimeout(() => {
      log.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 15000);
    hardExit.unref();

    io.close(() => {
      server.close(async () => {
        try {
          await mongoose.connection.close(false);
          log.info('graceful shutdown complete');
          process.exit(0);
        } catch (err) {
          log.error('error while closing the database connection', { err });
          process.exit(1);
        }
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // SEC-102: Unhandled promise rejections and uncaught exceptions must go
  // through the structured logger and error tracker rather than dumping raw
  // stack traces to stderr. After logging, initiate graceful shutdown instead
  // of leaving the process in an indeterminate state.
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.error('unhandled promise rejection — initiating shutdown', { err });
    errorTracking.captureException(err, { phase: 'unhandledRejection' });
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    log.error('uncaught exception — initiating shutdown', { err });
    errorTracking.captureException(err, { phase: 'uncaughtException' });
    shutdown('uncaughtException');
  });

  socketService.init(io);

  io.on('connection', (socket) => {
    log.debug('socket connected', { socketId: socket.id });

    socket.on('join-cafe', (cafeId) => {
      // Authenticate admin socket to prevent cross-tenant data leaks
      let token = (socket.handshake.auth && socket.handshake.auth.token) || null;
      if (!token && socket.handshake.headers.cookie) {
        const cookies = socket.handshake.headers.cookie.split(';');
        const adminCookie = cookies.find((c) => c.trim().startsWith('admin_token='));
        if (adminCookie) {
          token = adminCookie.trim().split('=')[1];
        }
      }

      if (token) {
        try {
          const decoded = jwt.verify(token, env.jwtSecret);
          if (decoded.role === 'superadmin' || String(decoded.cafeId) === String(cafeId)) {
            socket.join(`cafe-${cafeId}`);
            log.info('authenticated socket joined cafe room', { socketId: socket.id, cafeId, userId: decoded.id });
            return;
          }
          log.warn('unauthorized socket tried to join other cafe room', { socketId: socket.id, cafeId, tokenCafeId: decoded.cafeId });
          return;
        } catch (err) {
          log.warn('invalid token for socket join-cafe', { socketId: socket.id, error: err.message });
          return;
        }
      }

      // In non-production environments, allow joining with a warning for convenient development
      if (env.nodeEnv !== 'production') {
        socket.join(`cafe-${cafeId}`);
        log.warn('socket joined cafe room without auth in development mode', { socketId: socket.id, cafeId });
      } else {
        log.warn('rejected unauthenticated socket join-cafe in production', { socketId: socket.id, cafeId });
      }
    });

    socket.on('join-order', (orderId) => {
      socket.join(`order-${orderId}`);
      log.debug('socket joined order room', { socketId: socket.id, orderId });
    });

    socket.on('join-session', (sessionId) => {
      socket.join(`session-${sessionId}`);
      log.debug('socket joined session room', { socketId: socket.id, sessionId });
    });

    socket.on('disconnect', () => {
      log.debug('socket disconnected', { socketId: socket.id });
    });
  });

  server.listen(env.port, () => {
    log.info('server listening', { port: env.port, env: env.nodeEnv });
  });
};

startServer().catch((error) => {
  // Structured, and the tracker gets a chance to report a boot failure — which
  // is otherwise the one error that happens when nobody is watching.
  log.error('failed to start server', { err: error });
  errorTracking.captureException(error, { phase: 'startup' });
  process.exit(1);
});



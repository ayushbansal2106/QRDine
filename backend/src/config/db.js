const mongoose = require('mongoose');
const env = require('./env');
const { createLogger } = require('../services/logger');

const log = createLogger('db');

const isProduction = env.nodeEnv === 'production';

// Register connection lifecycle listeners once
mongoose.connection.on('disconnected', () => {
  log.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  log.error('MongoDB connection error', { err });
});

mongoose.connection.on('reconnected', () => {
  log.info('MongoDB reconnected');
});

// SEC-101: In production, log the TLS cipher suite to prove encryption is active.
mongoose.connection.on('connected', () => {
  if (!isProduction) return;
  try {
    const client = mongoose.connection.getClient();
    const topology = client.topology;
    if (topology && topology.s && topology.s.options) {
      const tlsEnabled = topology.s.options.tls || topology.s.options.ssl;
      log.info('MongoDB TLS status', { tls: Boolean(tlsEnabled) });
    }
    // Log connection pool and topology details
    log.info('MongoDB production connection verified', {
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
    });
  } catch (err) {
    log.warn('Could not read TLS details from connection', { reason: err.message });
  }
});

/**
 * Production-hardened connection options.
 *
 * In production, TLS is mandatory and certificate validation is strict: a
 * misconfigured or MITM'd connection is refused rather than silently
 * downgraded. Development retains defaults so a local `mongod` works.
 */
const buildConnectionOptions = () => {
  const base = {
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  };

  if (!isProduction) return base;

  return {
    ...base,
    // SEC-101: Enforce TLS in production. `mongodb+srv` implies TLS, but
    // explicit is better than implicit — especially if someone pastes a
    // `mongodb://` URI by mistake.
    tls: true,
    tlsAllowInvalidCertificates: false,
    tlsAllowInvalidHostnames: false,
    retryWrites: true,
    w: 'majority',
  };
};

const connectDB = async () => {
  if (!env.mongodbUri) {
    throw new Error(
      'MONGODB_URI is not defined. Create backend/.env with a MongoDB Atlas connection string. See docs/MONGODB_ATLAS_SETUP.md.'
    );
  }

  await mongoose.connect(env.mongodbUri, buildConnectionOptions());

  log.info('MongoDB connected successfully');
};

module.exports = connectDB;

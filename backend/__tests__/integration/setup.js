/**
 * Integration Test Setup
 * Uses mongodb-memory-server with proper lifecycle management.
 * Connects BEFORE the app is required so Mongoose models can execute.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

let mongoServer;

// ─── Safety Guard ────────────────────────────────────────────────
/**
 * These helpers call `dropDatabase()` and `deleteMany({})` with no filter.
 * They are only ever safe against a throwaway in-memory server, so refuse to
 * run against anything else rather than trust that `connect()` ran first.
 */
const assertDisposableHost = () => {
  const host = mongoose.connection.host || '';
  const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (!isLocal) {
    throw new Error(
      `REFUSING TO RUN: tests would drop the database at "${mongoose.connection.name}" on host "${host}", ` +
        'which is not a local in-memory server. This would destroy real data.'
    );
  }
};

// ─── Database Lifecycle ──────────────────────────────────────────

const connect = async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
};

const closeDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    assertDisposableHost();
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
};

const clearDatabase = async () => {
  if (mongoose.connection.readyState !== 1) return;
  assertDisposableHost();

  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
};

// ─── Auth Helpers ────────────────────────────────────────────────

const generateToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

// ─── Seed Helpers ────────────────────────────────────────────────

const seedCafe = async (overrides = {}) => {
  const Cafe = require('../../src/models/Cafe');
  return Cafe.create({
    name: 'Integration Test Cafe',
    address: '123 Test St',
    phone: '555-0100',
    ...overrides,
  });
};

const seedUser = async (cafeId, overrides = {}) => {
  const User = require('../../src/models/User');
  const { password: rawPassword, ...restOverrides } = overrides;
  const password = rawPassword || 'password123';
  const hashedPassword = await bcrypt.hash(password, 10);

  return User.create({
    cafeId,
    name: 'Test Owner',
    email: `owner-${crypto.randomBytes(4).toString('hex')}@test.com`,
    password: hashedPassword,
    role: 'owner',
    ...restOverrides,
  });
};

const seedTable = async (cafeId, overrides = {}) => {
  const Table = require('../../src/models/Table');
  return Table.create({
    cafeId,
    tableNumber: `T-${crypto.randomBytes(4).toString('hex')}`,
    isActive: true,
    ...overrides,
  });
};

const seedCategory = async (cafeId, overrides = {}) => {
  const Category = require('../../src/models/Category');
  return Category.create({
    cafeId,
    name: `Cat-${crypto.randomBytes(4).toString('hex')}`,
    displayOrder: 0,
    ...overrides,
  });
};

const seedMenuItem = async (cafeId, categoryId, overrides = {}) => {
  const MenuItem = require('../../src/models/MenuItem');
  return MenuItem.create({
    cafeId,
    categoryId,
    name: `Item-${crypto.randomBytes(4).toString('hex')}`,
    description: 'Test item',
    price: 100,
    gstPercentage: 18,
    isAvailable: true,
    ...overrides,
  });
};

const seedSession = async (cafeId, tableId, overrides = {}) => {
  const DiningSession = require('../../src/models/DiningSession');
  const guestToken = overrides.guestToken || crypto.randomBytes(16).toString('hex');
  const participantId = overrides.participantId || crypto.randomBytes(8).toString('hex');

  return DiningSession.create({
    cafeId,
    tableId,
    customerName: 'Test Customer',
    customerEmail: `customer-${crypto.randomBytes(4).toString('hex')}@test.com`,
    guestToken,
    participants: [
      {
        participantId,
        name: 'Test Customer',
        email: `customer-${crypto.randomBytes(4).toString('hex')}@test.com`,
        role: 'owner',
        deviceId: 'test-device',
        status: 'active',
      },
    ],
    status: 'active',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  });
};

module.exports = {
  connect,
  closeDatabase,
  clearDatabase,
  generateToken,
  seedCafe,
  seedUser,
  seedTable,
  seedCategory,
  seedMenuItem,
  seedSession,
};

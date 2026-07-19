/**
 * Test Setup — Mocks all external dependencies (MongoDB, Socket.IO)
 * so tests can run without a real database connection.
 */

// ─── Express Request / Response Helpers ─────────────────────────
function mockReq(overrides = {}) {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    cookies: {},
    user: null,
    cafeId: null,
    ...overrides,
  };
}

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    _statusCode: null,
    _jsonData: null,
  };

  // Capture status + json for assertions
  res.status.mockImplementation((code) => {
    res._statusCode = code;
    return res;
  });
  res.json.mockImplementation((data) => {
    res._jsonData = data;
    return res;
  });

  return res;
}

function mockNext() {
  return jest.fn();
}

// ─── Auth Helpers ───────────────────────────────────────────────
const jwt = require('jsonwebtoken');

function generateTestToken(payload) {
  return jwt.sign(
    {
      id: payload.id || 'test-user-id',
      cafeId: payload.cafeId || 'test-cafe-id',
      role: payload.role || 'owner',
    },
    process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only',
    { expiresIn: '1h' }
  );
}

// ─── Cleanup ────────────────────────────────────────────────────
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

module.exports = {
  mockReq,
  mockRes,
  mockNext,
  generateTestToken,
};

/**
 * Authentication Flow Tests
 * Tests: registerOwner, login, getCurrentUser
 */

const bcrypt = require('bcryptjs');
const { mockReq, mockRes, mockNext } = require('./setup');

// ─── Module-level mock functions (persists across tests) ────────
const mockUserFindOne = jest.fn();
const mockUserCreate = jest.fn();
const mockCafeFindOne = jest.fn();
const mockCafeCreate = jest.fn();
const mockCafeStartSession = jest.fn();
const mockUserFindById = jest.fn();
const mockGenerateToken = jest.fn();

// ─── Register mocks ONCE at top level ───────────────────────────
jest.mock('../src/models/User', () => {
  const User = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-user-id';
    this.save = jest.fn().mockResolvedValue(true);
  };
  User.findOne = (...a) => mockUserFindOne(...a);
  User.create = (...a) => mockUserCreate(...a);
  User.findById = (...a) => mockUserFindById(...a);
  return User;
});

jest.mock('../src/models/Cafe', () => {
  const Cafe = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-cafe-id';
    this.save = jest.fn().mockResolvedValue(true);
  };
  Cafe.findOne = (...a) => mockCafeFindOne(...a);
  Cafe.create = (...a) => mockCafeCreate(...a);
  Cafe.startSession = (...a) => mockCafeStartSession(...a);
  return Cafe;
});

jest.mock('../src/utils/generateToken', () => (...a) => mockGenerateToken(...a));

// ─── Load controller ONCE ───────────────────────────────────────
const { registerOwner, login, getCurrentUser } = require('../src/controllers/authController');

// ─── Clear mocks between tests ──────────────────────────────────
afterEach(() => {
  jest.clearAllMocks();
});

// ─── Register Owner ─────────────────────────────────────────────
describe('Auth — registerOwner', () => {
  const validBody = {
    ownerName: 'John Doe',
    ownerEmail: 'john@example.com',
    password: 'password123',
    cafe: { name: 'Test Cafe', email: 'cafe@example.com', address: '123 Main St', phone: '555-0100' },
  };

  beforeEach(() => {
    mockGenerateToken.mockReturnValue('mock-jwt-token');
  });

  it('should register a new owner and cafe successfully', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    mockUserFindOne.mockResolvedValue(null);
    mockCafeFindOne.mockResolvedValue(null);
    mockCafeStartSession.mockResolvedValue({
      withTransaction: jest.fn().mockImplementation(async (fn) => fn()),
      endSession: jest.fn(),
    });
    mockCafeCreate.mockResolvedValue([{ _id: 'cafe-123', name: 'Test Cafe' }]);
    mockUserCreate.mockResolvedValue([{ _id: 'user-123', cafeId: 'cafe-123', name: 'John Doe', email: 'john@example.com', role: 'owner', createdAt: new Date(), updatedAt: new Date() }]);

    await registerOwner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Owner registration successful', token: 'mock-jwt-token' }));
    expect(mockGenerateToken).toHaveBeenCalledWith({ id: 'user-123', cafeId: 'cafe-123', role: 'owner' });
  });

  it('should reject registration if user email already exists', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    mockUserFindOne.mockResolvedValue({ _id: 'existing-user' });

    await registerOwner(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'An account with this email already exists', statusCode: 409 }));
  });

  it('should reject registration if cafe email already exists', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    mockUserFindOne.mockResolvedValue(null);
    mockCafeFindOne.mockResolvedValue({ _id: 'existing-cafe' });

    await registerOwner(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'A cafe with this email already exists', statusCode: 409 }));
  });

  it('should normalize email to lowercase', async () => {
    const req = mockReq({ body: { ...validBody, ownerEmail: 'JOHN@EXAMPLE.COM', cafe: { ...validBody.cafe, email: 'CAFE@EXAMPLE.COM' } } });
    const res = mockRes();
    const next = mockNext();

    mockUserFindOne.mockResolvedValue(null);
    mockCafeFindOne.mockResolvedValue(null);
    mockCafeStartSession.mockResolvedValue({ withTransaction: jest.fn().mockImplementation(async (fn) => fn()), endSession: jest.fn() });
    mockCafeCreate.mockResolvedValue([{ _id: 'cafe-123', name: 'Test Cafe' }]);
    mockUserCreate.mockResolvedValue([{ _id: 'user-123', cafeId: 'cafe-123', name: 'John Doe', email: 'john@example.com', role: 'owner' }]);

    await registerOwner(req, res, next);

    expect(mockUserFindOne).toHaveBeenCalledWith({ email: 'john@example.com' });
    expect(mockCafeFindOne).toHaveBeenCalledWith({ email: 'cafe@example.com' });
  });
});

// ─── Login ──────────────────────────────────────────────────────
describe('Auth — login', () => {
  beforeEach(() => {
    mockGenerateToken.mockReturnValue('mock-jwt-token');
  });

  it('should login successfully with valid credentials', async () => {
    const hashedPassword = await bcrypt.hash('password123', 10);
    const mockUser = { _id: 'user-123', cafeId: 'cafe-123', name: 'John Doe', email: 'john@example.com', password: hashedPassword, role: 'owner', createdAt: new Date(), updatedAt: new Date() };

    const req = mockReq({ body: { email: 'john@example.com', password: 'password123' } });
    const res = mockRes();
    const next = mockNext();

    mockUserFindOne.mockResolvedValue(mockUser);

    await login(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Login successful', token: 'mock-jwt-token' }));
  });

  it('should reject login with non-existent email', async () => {
    const req = mockReq({ body: { email: 'nobody@example.com', password: 'password123' } });
    const res = mockRes();
    const next = mockNext();

    mockUserFindOne.mockResolvedValue(null);

    await login(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid credentials', statusCode: 401 }));
  });

  it('should reject login with wrong password', async () => {
    const hashedPassword = await bcrypt.hash('correctpassword', 10);
    const req = mockReq({ body: { email: 'john@example.com', password: 'wrongpassword' } });
    const res = mockRes();
    const next = mockNext();

    mockUserFindOne.mockResolvedValue({ _id: 'user-123', email: 'john@example.com', password: hashedPassword });

    await login(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid credentials', statusCode: 401 }));
  });

  it('should accept ownerEmail as fallback for email field', async () => {
    const hashedPassword = await bcrypt.hash('password123', 10);
    const mockUser = { _id: 'user-123', cafeId: 'cafe-123', name: 'John Doe', email: 'john@example.com', password: hashedPassword, role: 'owner', createdAt: new Date(), updatedAt: new Date() };

    const req = mockReq({ body: { ownerEmail: 'john@example.com', password: 'password123' } });
    const res = mockRes();
    const next = mockNext();

    mockUserFindOne.mockResolvedValue(mockUser);

    await login(req, res, next);

    expect(mockUserFindOne).toHaveBeenCalledWith({ email: 'john@example.com' });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─── Get Current User ───────────────────────────────────────────
describe('Auth — getCurrentUser', () => {
  it('should return the authenticated user profile', async () => {
    const mockUser = { _id: 'user-123', cafeId: 'cafe-123', name: 'John Doe', email: 'john@example.com', role: 'owner', createdAt: new Date(), updatedAt: new Date() };

    const req = mockReq({ user: { _id: 'user-123' } });
    const res = mockRes();
    const next = mockNext();

    mockUserFindById.mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

    await getCurrentUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ email: 'john@example.com', role: 'owner' }) }));
  });

  it('should return 404 if user not found', async () => {
    const req = mockReq({ user: { _id: 'deleted-user' } });
    const res = mockRes();
    const next = mockNext();

    mockUserFindById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

    await getCurrentUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'User not found', statusCode: 404 }));
  });

  it('should not include password in the response', async () => {
    const req = mockReq({ user: { _id: 'user-123' } });
    const res = mockRes();
    const next = mockNext();

    mockUserFindById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-123', name: 'John Doe', email: 'john@example.com', password: 'secret' }) });

    await getCurrentUser(req, res, next);

    expect(res.json.mock.calls[0][0].user).not.toHaveProperty('password');
  });
});

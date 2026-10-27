/**
 * Module #08 — Staff PIN login tests
 * Tests: pinLogin, getOperators
 */

const bcrypt = require('bcryptjs');
const { mockReq, mockRes, mockNext } = require('./setup');

const mockUserFindOne = jest.fn();
const mockUserFind = jest.fn();
const mockGenerateToken = jest.fn();
// pinLogin now refuses to mint a token for a terminated tenant.
const mockGetAccessForCafe = jest.fn();

jest.mock('../src/models/User', () => {
  const User = function (data) {
    Object.assign(this, data);
  };
  User.findOne = (...a) => mockUserFindOne(...a);
  User.find = (...a) => mockUserFind(...a);
  return User;
});

jest.mock('../src/models/Cafe', () => ({}));

jest.mock('../src/utils/generateToken', () => (...a) => mockGenerateToken(...a));

jest.mock('../src/services/subscriptionService', () => ({
  getAccessForCafe: (...a) => mockGetAccessForCafe(...a),
  ensureSubscription: jest.fn(),
}));

const { pinLogin, getOperators } = require('../src/controllers/authController');

afterEach(() => {
  jest.clearAllMocks();
});

beforeEach(() => {
  // Default: tenant in good standing. The terminated test overrides this.
  mockGetAccessForCafe.mockResolvedValue({
    subscription: { status: 'trialing' },
    access: { isTerminated: false },
  });
});

const makeUser = (overrides = {}) => ({
  _id: 'user-1',
  cafeId: 'cafe-1',
  name: 'Asha',
  email: 'asha@example.com',
  role: 'cashier',
  permissions: [],
  pinEnabled: true,
  isActive: true,
  pinAttempts: 0,
  pinLockedUntil: null,
  save: jest.fn().mockResolvedValue(true),
  ...overrides,
});

describe('Auth — pinLogin', () => {
  it('returns a token when the PIN matches', async () => {
    const pinHash = await bcrypt.hash('1234', 10);
    const user = makeUser({ pinHash });
    mockUserFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    mockGenerateToken.mockReturnValue('pin-token');

    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'owner-1' }, body: { userId: 'user-1', pin: '1234' } });
    const res = mockRes();
    const next = mockNext();

    await pinLogin(req, res, next);

    expect(mockGenerateToken).toHaveBeenCalledWith({ id: 'user-1', cafeId: 'cafe-1', role: 'cashier' });
    expect(user.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'pin-token', user: expect.objectContaining({ role: 'cashier' }) })
    );
  });

  it('rejects a wrong PIN and increments the attempt counter', async () => {
    const pinHash = await bcrypt.hash('1234', 10);
    const user = makeUser({ pinHash, pinAttempts: 0 });
    mockUserFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'owner-1' }, body: { userId: 'user-1', pin: '9999' } });
    const res = mockRes();
    const next = mockNext();

    await pinLogin(req, res, next);

    expect(user.pinAttempts).toBe(1);
    expect(user.save).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('locks the account after the maximum failed attempts', async () => {
    const pinHash = await bcrypt.hash('1234', 10);
    const user = makeUser({ pinHash, pinAttempts: 4 });
    mockUserFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'owner-1' }, body: { userId: 'user-1', pin: '0000' } });
    const res = mockRes();
    const next = mockNext();

    await pinLogin(req, res, next);

    expect(user.pinLockedUntil).toBeInstanceOf(Date);
    expect(user.pinAttempts).toBe(0);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 429 }));
  });

  it('rejects when the account is currently locked', async () => {
    const pinHash = await bcrypt.hash('1234', 10);
    const user = makeUser({ pinHash, pinLockedUntil: new Date(Date.now() + 10 * 60 * 1000) });
    mockUserFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'owner-1' }, body: { userId: 'user-1', pin: '1234' } });
    const res = mockRes();
    const next = mockNext();

    await pinLogin(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 429 }));
  });

  it('rejects when PIN login is not enabled for the operator', async () => {
    const user = makeUser({ pinHash: null, pinEnabled: false });
    mockUserFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'owner-1' }, body: { userId: 'user-1', pin: '1234' } });
    const res = mockRes();
    const next = mockNext();

    await pinLogin(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('refuses a valid PIN when the tenant is terminated', async () => {
    const pinHash = await bcrypt.hash('1234', 10);
    const user = makeUser({ pinHash });
    mockUserFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    mockGetAccessForCafe.mockResolvedValue({
      subscription: { status: 'terminated' },
      access: { isTerminated: true },
    });

    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'owner-1' }, body: { userId: 'user-1', pin: '1234' } });
    const res = mockRes();
    const next = mockNext();

    await pinLogin(req, res, next);

    // An operator switch must not be a way back into a suspended account.
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 410 }));
  });

  it('rejects a malformed PIN before touching the database', async () => {
    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'owner-1' }, body: { userId: 'user-1', pin: 'abcd' } });
    const res = mockRes();
    const next = mockNext();

    await pinLogin(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockUserFindOne).not.toHaveBeenCalled();
  });
});

describe('Auth — getOperators', () => {
  it('lists active operators for the tenant', async () => {
    const operators = [
      { _id: 'user-1', name: 'Asha', role: 'cashier', pinEnabled: true },
      { _id: 'user-2', name: 'Ravi', role: 'barista', pinEnabled: false },
    ];
    mockUserFind.mockReturnValue({
      select: () => ({ sort: () => Promise.resolve(operators) }),
    });

    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'owner-1' } });
    const res = mockRes();
    const next = mockNext();

    await getOperators(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        currentUserId: 'owner-1',
        operators: [
          { id: 'user-1', name: 'Asha', role: 'cashier', pinEnabled: true },
          { id: 'user-2', name: 'Ravi', role: 'barista', pinEnabled: false },
        ],
      })
    );
  });
});

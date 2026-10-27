/**
 * Super-admin authentication and privilege boundaries.
 *
 * The one thing that must never be wrong here: a café owner's token must not
 * open the control plane, and a super-admin token must not open a café's data.
 * Everything else in this file is secondary to that, so the tests are written
 * as attempts to *cross* the boundary rather than as happy-path checks.
 */

'use strict';

// Set before env.js is required: the middleware refuses to run without it.
process.env.JWT_SECRET = 'test-jwt-secret-for-super-admin-tests-only';
process.env.NODE_ENV = 'test';

const jwt = require('jsonwebtoken');
const { mockReq, mockRes, mockNext } = require('./setup');

const mockSuperAdminFindById = jest.fn();
const mockSuperAdminFindOne = jest.fn();

jest.mock('../src/models/SuperAdmin', () => {
  const SuperAdmin = function (data) {
    Object.assign(this, data);
  };
  SuperAdmin.findById = (...a) => mockSuperAdminFindById(...a);
  SuperAdmin.findOne = (...a) => mockSuperAdminFindOne(...a);
  SuperAdmin.SUPER_ADMIN_ROLES = {
    SUPERADMIN: 'superadmin',
    SUPPORT: 'support',
    READONLY: 'readonly',
  };
  SuperAdmin.hashPassword = jest.fn(async (p) => `hashed:${p}`);
  return SuperAdmin;
});

const {
  protectSuperAdmin,
  authorizeSuperAdminRoles,
} = require('../src/middlewares/superAdminMiddleware');
const { login, terminateCafe, LOGIN_MAX_ATTEMPTS } = require('../src/controllers/superAdminController');

const secret = process.env.JWT_SECRET;

const cafeOwnerToken = jwt.sign({ id: 'cafe-user-1', cafeId: 'cafe-1', role: 'owner' }, secret);
const superAdminToken = jwt.sign({ id: 'sa-1', role: 'superadmin', typ: 'superadmin' }, secret);
const bareToken = jwt.sign({ id: 'sa-1', role: 'superadmin' }, secret); // no `typ`

const mockSelectQuery = (value) => {
  const q = Promise.resolve(value);
  q.select = jest.fn().mockResolvedValue(value);
  return q;
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('protectSuperAdmin — crossing the boundary', () => {
  it('rejects a cafe owner token', async () => {
    const req = mockReq({ headers: { authorization: `Bearer ${cafeOwnerToken}` } });
    const next = mockNext();

    await protectSuperAdmin(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(req.superAdmin).toBeUndefined();
    // It must not even look up a staff account for a cafe user.
    expect(mockSuperAdminFindById).not.toHaveBeenCalled();
  });

  it('rejects a token with no typ claim', async () => {
    const req = mockReq({ headers: { authorization: `Bearer ${bareToken}` } });
    const next = mockNext();

    await protectSuperAdmin(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ id: 'sa-1', typ: 'superadmin' }, 'not-the-secret');
    const req = mockReq({ headers: { authorization: `Bearer ${forged}` } });
    const next = mockNext();

    await protectSuperAdmin(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects a request with no Authorization header', async () => {
    const next = mockNext();
    await protectSuperAdmin(mockReq({}), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('accepts a valid super-admin token', async () => {
    const admin = { _id: 'sa-1', email: 'ops@qrdine.com', role: 'superadmin', isActive: true };
    mockSuperAdminFindById.mockReturnValue(mockSelectQuery(admin));

    const req = mockReq({ headers: { authorization: `Bearer ${superAdminToken}` } });
    const next = mockNext();

    await protectSuperAdmin(req, mockRes(), next);

    // `next()` with no arguments is success; an error would be next(err).
    expect(next).toHaveBeenCalledWith();
    expect(req.superAdmin).toBe(admin);
  });

  it('rejects a deactivated operator even with a valid unexpired token', async () => {
    // Deactivation must take effect now, not at token expiry.
    mockSuperAdminFindById.mockReturnValue(
      mockSelectQuery({ _id: 'sa-1', role: 'superadmin', isActive: false })
    );

    const req = mockReq({ headers: { authorization: `Bearer ${superAdminToken}` } });
    const next = mockNext();

    await protectSuperAdmin(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  
});

describe('authorizeSuperAdminRoles', () => {
  const run = (role, allowed) => {
    const req = mockReq({ superAdmin: { role } });
    const next = mockNext();
    authorizeSuperAdminRoles(...allowed)(req, mockRes(), next);
    return next;
  };

  it('lets a superadmin terminate', () => {
    expect(run('superadmin', ['superadmin'])).toHaveBeenCalledWith();
  });

  it('stops a support agent terminating a customer', () => {
    const next = run('support', ['superadmin']);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('stops a read-only account changing anything', () => {
    const next = run('readonly', ['superadmin', 'support']);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('refuses with no operator context at all', () => {
    const next = mockNext();
    authorizeSuperAdminRoles('superadmin')(mockReq({}), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});

describe('super admin login', () => {
  const adminWith = (overrides = {}) => ({
    _id: 'sa-1',
    email: 'ops@qrdine.com',
    role: 'superadmin',
    isActive: true,
    failedAttempts: 0,
    lockedUntil: null,
    verifyPassword: jest.fn(),
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  });

  it('returns a token carrying the superadmin typ', async () => {
    const admin = adminWith({ verifyPassword: jest.fn().mockResolvedValue(true) });
    mockSuperAdminFindOne.mockReturnValue(mockSelectQuery(admin));

    const res = mockRes();
    await login(mockReq({ body: { email: 'OPS@QRDINE.com', password: 'correct-horse-battery' } }), res, mockNext());

    expect(res._statusCode).toBe(200);
    const decoded = jwt.verify(res._jsonData.token, secret);
    expect(decoded.typ).toBe('superadmin');
    expect(decoded.id).toBe('sa-1');
    // The café claim must be absent: there is no tenant for a staff account.
    expect(decoded.cafeId).toBeUndefined();
  });

  it('never leaks whether an email exists', async () => {
    mockSuperAdminFindOne.mockReturnValue(mockSelectQuery(null));

    const missing = mockRes();
    const missingNext = mockNext();
    await login(mockReq({ body: { email: 'nobody@qrdine.com', password: 'whatever-123' } }), missing, missingNext);

    const wrongPasswordAdmin = adminWith({ verifyPassword: jest.fn().mockResolvedValue(false) });
    mockSuperAdminFindOne.mockReturnValue(mockSelectQuery(wrongPasswordAdmin));

    const wrong = mockRes();
    const wrongNext = mockNext();
    await login(mockReq({ body: { email: 'ops@qrdine.com', password: 'wrong-password' } }), wrong, wrongNext);

    // Identical status and message, so emails cannot be enumerated.
    expect(missingNext.mock.calls[0][0].statusCode).toBe(wrongNext.mock.calls[0][0].statusCode);
    expect(missingNext.mock.calls[0][0].message).toBe(wrongNext.mock.calls[0][0].message);
  });

  it('locks the account after repeated failures', async () => {
    const admin = adminWith({
      failedAttempts: LOGIN_MAX_ATTEMPTS - 1,
      verifyPassword: jest.fn().mockResolvedValue(false),
    });
    mockSuperAdminFindOne.mockReturnValue(mockSelectQuery(admin));

    const next = mockNext();
    await login(mockReq({ body: { email: 'ops@qrdine.com', password: 'nope' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 423 }));
    expect(admin.lockedUntil).toBeInstanceOf(Date);
  });

  it('refuses a locked account before even checking the password', async () => {
    const admin = adminWith({ lockedUntil: new Date(Date.now() + 60000) });
    mockSuperAdminFindOne.mockReturnValue(mockSelectQuery(admin));

    const next = mockNext();
    await login(mockReq({ body: { email: 'ops@qrdine.com', password: 'anything' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 423 }));
    expect(admin.verifyPassword).not.toHaveBeenCalled();
  });

  it('clears the failure counter on a good login', async () => {
    const admin = adminWith({
      failedAttempts: 3,
      verifyPassword: jest.fn().mockResolvedValue(true),
    });
    mockSuperAdminFindOne.mockReturnValue(mockSelectQuery(admin));

    await login(mockReq({ body: { email: 'ops@qrdine.com', password: 'correct-horse' } }), mockRes(), mockNext());

    expect(admin.failedAttempts).toBe(0);
    expect(admin.lockedUntil).toBeNull();
    expect(admin.lastLoginAt).toBeInstanceOf(Date);
  });

  it('rejects a deactivated operator', async () => {
    mockSuperAdminFindOne.mockReturnValue(mockSelectQuery(adminWith({ isActive: false })));

    const next = mockNext();
    await login(mockReq({ body: { email: 'ops@qrdine.com', password: 'correct-horse' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('requires both fields', async () => {
    const next = mockNext();
    await login(mockReq({ body: { email: 'ops@qrdine.com' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('terminateCafe — input validation', () => {
  const runTerminate = async (body) => {
    const next = mockNext();
    const res = mockRes();
    await terminateCafe(mockReq({ params: { cafeId: 'cafe-1' }, body, superAdmin: { email: 'ops@qrdine.com', role: 'superadmin' } }), res, next);
    return { next, res };
  };

  it('requires a reason', async () => {
    const { next } = await runTerminate({});
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('requires the reason to be meaningful, not one character', async () => {
    const { next } = await runTerminate({ reason: 'x' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});
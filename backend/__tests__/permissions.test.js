/**
 * Module #08 — granular RBAC.
 *
 * Guards the whole permission-based surface (pos, kds, geofence, nfc, reviews),
 * so the rules themselves are worth pinning down: owner always wins, an explicit
 * per-user list overrides role defaults, and a missing user is never allowed.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  getDefaultPermissions,
  getEffectivePermissions,
  hasPermission,
} = require('../src/constants/permissions');

const { requirePermission, requireAnyPermission } = require('../src/middlewares/permissionMiddleware');

describe('permission catalog', () => {
  it('exposes every module capability, including the newer ones', () => {
    expect(PERMISSIONS.POS_USE).toBe('pos.use');
    expect(PERMISSIONS.GEOFENCE_MANAGE).toBe('geofence.manage');
    expect(PERMISSIONS.NFC_MANAGE).toBe('nfc.manage');
    expect(PERMISSIONS.REVIEW_MANAGE).toBe('review.manage');
    expect(PERMISSIONS.REVIEW_RESPONSE).toBe('review.response');
  });

  it('gives the owner every permission', () => {
    expect(ROLE_PERMISSIONS.owner).toEqual(ALL_PERMISSIONS);
    expect(getEffectivePermissions({ role: 'owner' })).toEqual(ALL_PERMISSIONS);
  });

  it('gives a cashier POS, order view/status and the drawer — nothing else', () => {
    const cashier = getDefaultPermissions('cashier');
    expect(cashier).toEqual(expect.arrayContaining([PERMISSIONS.POS_USE, PERMISSIONS.DRAWER_OPEN]));
    expect(cashier).not.toContain(PERMISSIONS.ORDER_REFUND);
    expect(cashier).not.toContain(PERMISSIONS.STAFF_MANAGE);
  });

  it('does not give a barista cashier-level powers', () => {
    const barista = getDefaultPermissions('barista');
    expect(barista).toEqual([PERMISSIONS.KDS_USE, PERMISSIONS.ORDER_VIEW, PERMISSIONS.ORDER_STATUS]);
    expect(barista).not.toContain(PERMISSIONS.POS_USE);
  });

  it('falls back to staff defaults for an unknown role', () => {
    expect(getDefaultPermissions('wizard')).toEqual(ROLE_PERMISSIONS.staff);
  });

  it('lists exactly the six staff roles', () => {
    expect(ROLES.sort()).toEqual(['barista', 'cashier', 'manager', 'owner', 'staff', 'waiter']);
  });

  it('lets a per-user list override the role defaults in both directions', () => {
    const user = { role: 'cashier', permissions: [PERMISSIONS.ORDER_REFUND] };
    expect(getEffectivePermissions(user)).toEqual([PERMISSIONS.ORDER_REFUND]);
    expect(hasPermission(user, PERMISSIONS.POS_USE)).toBe(false);
    expect(hasPermission(user, PERMISSIONS.ORDER_REFUND)).toBe(true);
  });

  it('returns an empty set for a missing user', () => {
    expect(getEffectivePermissions(null)).toEqual([]);
    expect(hasPermission(undefined, PERMISSIONS.POS_USE)).toBe(false);
  });
});

describe('requirePermission', () => {
  it('passes a user holding the permission', () => {
    const next = mockNext();
    requirePermission(PERMISSIONS.POS_USE)(
      mockReq({ user: { role: 'cashier' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks a user without the permission with 403', () => {
    const next = mockNext();
    requirePermission(PERMISSIONS.ORDER_REFUND)(
      mockReq({ user: { role: 'cashier' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('requires ALL listed permissions, not just one', () => {
    const next = mockNext();
    requirePermission(PERMISSIONS.POS_USE, PERMISSIONS.STAFF_MANAGE)(
      mockReq({ user: { role: 'cashier' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('lets an owner through any combination', () => {
    const next = mockNext();
    requirePermission(PERMISSIONS.GEOFENCE_MANAGE, PERMISSIONS.NFC_MANAGE)(
      mockReq({ user: { role: 'owner' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects an unauthenticated request with 401', () => {
    const next = mockNext();
    requirePermission(PERMISSIONS.POS_USE)(mockReq({ user: null }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});

describe('requireAnyPermission', () => {
  it('passes when any one permission is held', () => {
    const next = mockNext();
    requireAnyPermission(PERMISSIONS.ORDER_REFUND, PERMISSIONS.POS_USE)(
      mockReq({ user: { role: 'cashier' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks when none are held', () => {
    const next = mockNext();
    requireAnyPermission(PERMISSIONS.ORDER_REFUND, PERMISSIONS.STAFF_MANAGE)(
      mockReq({ user: { role: 'waiter' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('rejects an unauthenticated request with 401', () => {
    const next = mockNext();
    requireAnyPermission(PERMISSIONS.POS_USE)(mockReq({ user: null }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});

describe('tenant isolation', () => {
  const tenantMiddleware = require('../src/middlewares/tenantMiddleware');

  it('derives cafeId from the authenticated user, not the request body', () => {
    const req = mockReq({ user: { cafeId: 'cafe-a' }, body: { cafeId: 'cafe-b' } });
    tenantMiddleware(req, mockRes(), mockNext());
    expect(req.cafeId).toBe('cafe-a');
  });

  it('refuses a request with no tenant context', () => {
    const next = mockNext();
    tenantMiddleware(mockReq({ user: { role: 'owner' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
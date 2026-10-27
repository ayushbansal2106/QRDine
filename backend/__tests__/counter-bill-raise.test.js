/**
 * ISSUE-49 — a cashier could not settle a table, and a guest who walked up to
 * the counter had no way to get a bill raised for their table.
 *
 * Two faults, both on the counter path:
 *
 * **49a — /bills was role-locked, not permission-locked.** Every billing route
 * sat behind `authorizeRoles('owner', 'manager')`, so a cashier could not open
 * the bills board at all. Taking payment is the core counter job, so the role
 * wall blocked exactly the person it was meant for.
 *
 * The fix splits billing into three capabilities — `bill.view`, `bill.pay` and
 * `bill.adjust`. Cashier gets view + pay, because discounting or comping a table
 * is the one action on a bill that quietly loses the cafe money, so that stays a
 * manager's call.
 *
 * **49b — no way to raise a bill from the till.** A guest who asks for the bill
 * at the counter never touched the app, so their session stayed `active`
 * forever: the board showed "Customer is still ordering..." with no action, and
 * `mark-paid` was never reachable. `requestBillForTable` moves such a session to
 * `awaiting_payment` — the same state the guest's own button produces — from
 * where the existing payment flow applies unchanged.
 *
 * The rule pinned hardest here: raising a bill is **not** gated on the food
 * being served. A guest is entitled to pay and leave.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';
const TABLE_ID = '507f1f77bcf86cd799439099';
const SESSION_ID = '507f1f77bcf86cd799439088';

const mockSessionFindOne = jest.fn();
const mockSessionFindById = jest.fn();
const mockOrderFind = jest.fn();

jest.mock('../src/models/DiningSession', () => ({
  findOne: (...a) => {
    const q = Promise.resolve(mockSessionFindOne(...a));
    q.populate = () => q;
    return q;
  },
  findById: (...a) => {
    const q = Promise.resolve(mockSessionFindById(...a));
    q.populate = () => q;
    return q;
  },
}));

jest.mock('../src/models/Order', () => ({
  find: (...a) => Promise.resolve(mockOrderFind(...a) || []),
  countDocuments: jest.fn(),
}));

jest.mock('../src/models/Table', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
}));

const mockEmitSessionActivity = jest.fn();
const mockEmitSessionBillRequested = jest.fn();
const mockEmitPaymentAwaiting = jest.fn();

jest.mock('../src/services/socketService', () => ({
  emitSessionActivity: (...a) => mockEmitSessionActivity(...a),
  emitSessionBillRequested: (...a) => mockEmitSessionBillRequested(...a),
  emitPaymentAwaiting: (...a) => mockEmitPaymentAwaiting(...a),
  emitBillUpdated: jest.fn(),
  emitBillCancelled: jest.fn(),
  emitParticipantJoined: jest.fn(),
  emitOwnershipTransferred: jest.fn(),
  emitNewOrder: jest.fn(),
  emitOrderUpdated: jest.fn(),
  emitNewOrderItem: jest.fn(),
  emitItemAdded: jest.fn(),
  emitMetricsUpdated: jest.fn(),
  emitSessionPaid: jest.fn(),
  emitBillRequested: jest.fn(),
  emitStatusUpdate: jest.fn(),
  emitTableStatusChanged: jest.fn(),
  emitItemCancelled: jest.fn(),
  emitMenuAvailability: jest.fn(),
  emitParticipantLeft: jest.fn(),
  emitSessionEnded: jest.fn(),
  toCafeRoom: jest.fn(),
  toSessionRoom: jest.fn(),
}));

jest.mock('../src/services/paymentPipeline', () => ({
  executePaymentPipeline: jest.fn(),
}));

jest.mock('../src/services/sessionLifecycleService', () => ({
  closeSessionManually: jest.fn(),
}));

const { requestBillForTable } = require('../src/controllers/sessionController');
const { PERMISSIONS, getDefaultPermissions, hasPermission } = require('../src/constants/permissions');

// Fixtures must be factories: the controller mutates and saves the session.
const session = (over = {}) => ({
  _id: SESSION_ID,
  cafeId: CAFE_ID,
  tableId: { _id: TABLE_ID, tableNumber: 4 },
  status: 'active',
  paymentMethod: 'pending',
  customerName: 'Ayush',
  participants: [],
  adjustments: [],
  addActivity: jest.fn(),
  save: jest.fn().mockResolvedValue(undefined),
  ...over,
});

const order = (over = {}) => ({
  status: 'pending',
  discountTotal: 0,
  items: [{ price: 100, quantity: 2, gstAmount: 9, status: 'served' }],
  ...over,
});

const cashier = { _id: 'u1', cafeId: CAFE_ID, role: 'cashier' };
const manager = { _id: 'u2', cafeId: CAFE_ID, role: 'manager' };

const req = (user = cashier) => mockReq({ params: { id: SESSION_ID }, cafeId: CAFE_ID, user });

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionFindOne.mockResolvedValue(session());
  mockOrderFind.mockResolvedValue([order()]);
});

describe('ISSUE-49a — the bills board is permission-gated, not role-locked', () => {
  it('lets a cashier view the board and take a payment', () => {
    const perms = getDefaultPermissions('cashier');
    expect(hasPermission({ role: 'cashier' }, PERMISSIONS.BILL_VIEW)).toBe(true);
    expect(hasPermission({ role: 'cashier' }, PERMISSIONS.BILL_PAY)).toBe(true);
    expect(perms).toEqual(expect.arrayContaining([PERMISSIONS.BILL_VIEW, PERMISSIONS.BILL_PAY]));
  });

  it('still refuses a cashier the one action that costs the cafe money', () => {
    // Discounting, comping or manually adding to a bill must stay a manager's
    // decision. This is the half of the split that must not drift.
    expect(hasPermission(cashier, PERMISSIONS.BILL_ADJUST)).toBe(false);
    expect(hasPermission(manager, PERMISSIONS.BILL_ADJUST)).toBe(true);
  });

  it('keeps a waiter and a barista off the bills board entirely', () => {
    // They may take orders but never handle money.
    for (const role of ['waiter', 'barista']) {
      expect(hasPermission({ role }, PERMISSIONS.BILL_VIEW)).toBe(false);
      expect(hasPermission({ role }, PERMISSIONS.BILL_PAY)).toBe(false);
    }
  });

  it('does not hand a cashier the revenue reports that ride on /billing', () => {
    // Opening /bills must not become a side door into settlement totals.
    expect(hasPermission(cashier, PERMISSIONS.REPORT_VIEW)).toBe(false);
  });

  it('gives the owner every billing capability', () => {
    for (const p of [PERMISSIONS.BILL_VIEW, PERMISSIONS.BILL_PAY, PERMISSIONS.BILL_ADJUST]) {
      expect(hasPermission({ role: 'owner' }, p)).toBe(true);
    }
  });

  it('respects an explicit per-user permission override', () => {
    // A cafe may promote one cashier to adjust bills; the defaults are only a
    // fallback, not a hard rule.
    const promoted = { role: 'cashier', permissions: [PERMISSIONS.BILL_ADJUST] };
    expect(hasPermission(promoted, PERMISSIONS.BILL_ADJUST)).toBe(true);
  });
});

describe('ISSUE-49b — a bill can be raised from the counter', () => {
  it('moves a counter-raised table to awaiting_payment', async () => {
    const s = session({ status: 'active' });
    mockSessionFindOne.mockResolvedValue(s);

    const res = mockRes();
    await requestBillForTable(req(), res, mockNext());

    expect(s.status).toBe('awaiting_payment');
    expect(s.save).toHaveBeenCalled();
    expect(res._statusCode).toBe(200);
  });

  it('does not gate the request on the food being served', async () => {
    // The whole point: a guest may pay and leave while the kitchen is still
    // working. A `pending` order must not block the request.
    mockOrderFind.mockResolvedValue([order({ status: 'pending' })]);

    const res = mockRes();
    await requestBillForTable(req(), res, mockNext());

    expect(res._statusCode).toBe(200);
  });

  it('treats a double-tap as success rather than an error', async () => {
    // The cashier will double-tap under pressure; refusing would read as a fault.
    const already = session({ status: 'awaiting_payment' });
    mockSessionFindOne.mockResolvedValue(already);

    const res = mockRes();
    await requestBillForTable(req(), res, mockNext());

    expect(res._statusCode).toBe(200);
    expect(res._jsonData.alreadyRequested).toBe(true);
    // Idempotent: a repeat tap must not re-write or re-emit anything.
    expect(already.save).not.toHaveBeenCalled();
    expect(already.status).toBe('awaiting_payment');
  });

  it('refuses to bill a table whose money has already been taken', async () => {
    // `paid`/`closed` means the cafe already has this table's money; raising a
    // bill again would be a double charge waiting to happen.
    for (const status of ['paid', 'closed']) {
      mockSessionFindOne.mockResolvedValue(session({ status }));
      const next = mockNext();
      await requestBillForTable(req(), mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    }
  });

  it('refuses a bill with nothing billable on it', async () => {
    // A ₹0 "sale" is the kind of row that quietly corrupts revenue reporting.
    mockOrderFind.mockResolvedValue([]);

    const next = mockNext();
    await requestBillForTable(req(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('never bills a table belonging to another cafe', async () => {
    // Tenant isolation: the lookup is scoped, so a cross-cafe id simply misses.
    mockSessionFindOne.mockResolvedValue(null);

    const next = mockNext();
    await requestBillForTable(req(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockOrderFind).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the caller cafe', async () => {
    await requestBillForTable(req(), mockRes(), mockNext());

    expect(mockSessionFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: SESSION_ID, cafeId: CAFE_ID })
    );
  });

  it('tells the kitchen and the guest, and records who raised it', async () => {
    const s = session({ status: 'active' });
    mockSessionFindOne.mockResolvedValue(s);

    await requestBillForTable(req(cashier), mockRes(), mockNext());

    // The guest's app flips to "bill raised" without them doing anything.
    expect(mockEmitSessionBillRequested).toHaveBeenCalledWith(SESSION_ID);
    expect(mockEmitPaymentAwaiting).toHaveBeenCalled();
    // The ledger must say a human did this, not a guest.
    expect(s.addActivity).toHaveBeenCalledWith(
      'bill_requested',
      expect.stringContaining('counter')
    );
  });
});
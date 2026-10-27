/**
 * ISSUE-32 — nothing ever closed a dining session, so sales history was empty.
 *
 * `/admin/sales` reads closed sessions. In practice a session was only ever
 * closed by the payment pipeline, so a cafe that had never rung up a table bill
 * reported total revenue of ₹0 no matter what it had taken — and the table list
 * filled with sessions nobody had left.
 *
 * Three rules now close a session: settling the bill, a manager closing it by
 * hand, and a sweep of tables that were scanned and then abandoned. The
 * dangerous part is the sweep, so these tests pin its limits as hard as its
 * behaviour.
 */

const CAFE_ID = 'cafe-001';
const USER = { _id: 'staff-1', name: 'Asha', role: 'owner' };

const mockSessionFindOne = jest.fn();
const mockSessionFind = jest.fn();
const mockSessionUpdateMany = jest.fn();
const mockSessionSave = jest.fn();
const mockOrderFind = jest.fn();
const mockOrderAggregate = jest.fn();
const mockOrderUpdateMany = jest.fn();
const mockAudit = jest.fn();
const mockEmitActivity = jest.fn();
const mockEmitMetrics = jest.fn();

jest.resetModules();

jest.doMock('../src/models/DiningSession', () => {
  const DiningSession = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'session-1';
    this.activityFeed = data.activityFeed || [];
    this.addActivity = function (type, message) {
      this.activityFeed.push({ type, message, timestamp: new Date() });
    };
    this.save = (...a) => mockSessionSave(...a);
  };
  DiningSession.findOne = (...a) => mockSessionFindOne(...a);
  DiningSession.find = (...a) => {
    const q = Promise.resolve(mockSessionFind(...a));
    q.select = () => q;
    return q;
  };
  DiningSession.updateMany = (...a) => mockSessionUpdateMany(...a);
  return DiningSession;
});

jest.doMock('../src/models/Order', () => ({
  find: (...a) => mockOrderFind(...a),
  aggregate: (...a) => mockOrderAggregate(...a),
  updateMany: (...a) => mockOrderUpdateMany(...a),
}));

jest.doMock('../src/services/orderService', () => {
  const round2 = (n) => Number(n.toFixed(2));
  const real = jest.requireActual('../src/services/orderService');
  return {
    round2,
    isBillableItem: real.isBillableItem,
    sumBillableItems: real.sumBillableItems,
  };
});
jest.doMock('../src/services/auditService', () => ({ recordEvent: (...a) => mockAudit(...a) }));
jest.doMock('../src/services/socketService', () => ({
  emitSessionActivity: (...a) => mockEmitActivity(...a),
  emitMetricsUpdated: (...a) => mockEmitMetrics(...a),
}));

const {
  sweepIdleSessions,
  closeSessionManually,
  IDLE_SWEEP_MINUTES,
} = require('../src/services/sessionLifecycleService');

const order = (overrides = {}) => ({
  _id: 'o1',
  status: 'served',
  paymentStatus: 'paid',
  totalAmount: 300,
  items: [{ price: 250, quantity: 1, gstAmount: 50, status: 'served' }],
  ...overrides,
});

const session = (overrides = {}) => ({
  _id: 'session-1',
  cafeId: CAFE_ID,
  tableId: 'table-1',
  status: 'active',
  adjustments: [],
  subtotal: 0,
  gst: 0,
  totalAmount: 0,
  addActivity() {},
  save: (...a) => mockSessionSave(...a),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionSave.mockResolvedValue(undefined);
  mockAudit.mockResolvedValue({});
  mockOrderUpdateMany.mockResolvedValue({});
  mockSessionUpdateMany.mockResolvedValue({});
  mockEmitActivity.mockReturnValue(undefined);
  mockEmitMetrics.mockReturnValue(undefined);
});

describe('ISSUE-32 — idle session sweep', () => {
  it('closes a table that was scanned and then abandoned', async () => {
    mockSessionFind.mockResolvedValue([
      { _id: 'session-1', cafeId: CAFE_ID, tableId: 'table-1' },
    ]);
    mockOrderAggregate.mockResolvedValue([]); // no orders were ever placed

    const result = await sweepIdleSessions({});

    expect(result.swept).toBe(1);
    expect(mockSessionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $in: ['session-1'] } }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'abandoned' }),
      })
    );
  });

  it('leaves a table alone when it has orders, however long it has been quiet', async () => {
    // Guests are eating. They are not tapping the app, and closing their table
    // would strand a real bill.
    mockSessionFind.mockResolvedValue([
      { _id: 'session-1', cafeId: CAFE_ID, tableId: 'table-1' },
    ]);
    mockOrderAggregate.mockResolvedValue([{ _id: 'session-1', count: 2 }]);

    const result = await sweepIdleSessions({});

    expect(result.swept).toBe(0);
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
  });

  it('only considers sessions that are actually open', async () => {
    await sweepIdleSessions({});

    expect(mockSessionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        // `bill_requested` and `awaiting_payment` are excluded on purpose: a
        // guest who asked for the bill is walking to the counter, and the app
        // being quiet is exactly what that looks like.
        status: { $in: ['active'] },
        lastActivityAt: { $lt: expect.any(Date) },
      })
    );
  });

  it('respects the ten-minute idle window', async () => {
    await sweepIdleSessions({ idleMinutes: 10 });

    const filter = mockSessionFind.mock.calls[0][0];
    const cutoff = filter.lastActivityAt.$lt.getTime();
    const expected = Date.now() - IDLE_SWEEP_MINUTES * 60 * 1000;
    // Allow a second of slack for execution time.
    expect(Math.abs(cutoff - expected)).toBeLessThan(1000);
  });

  it('does nothing when there are no candidates', async () => {
    mockSessionFind.mockResolvedValue([]);

    const result = await sweepIdleSessions({});

    expect(result).toEqual({ swept: 0, sessionIds: [] });
    expect(mockOrderAggregate).not.toHaveBeenCalled();
  });
});

describe('ISSUE-32 — manager manual close', () => {
  it('closes a settled table and records the totals', async () => {
    mockSessionFindOne.mockResolvedValue(session({ status: 'awaiting_payment' }));
    mockOrderFind.mockResolvedValue([order()]);

    const result = await closeSessionManually({
      sessionId: 'session-1',
      cafeId: CAFE_ID,
      user: USER,
      reason: 'Table cleared',
    });

    expect(result.session.status).toBe('closed');
    expect(result.session.totalAmount).toBe(300);
    expect(result.session.endedAt).toEqual(expect.any(Date));
    expect(mockSessionSave).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session.closed', amount: 300 })
    );
  });

  it('refuses to strand money: unpaid orders block the close', async () => {
    mockSessionFindOne.mockResolvedValue(session());
    mockOrderFind.mockResolvedValue([order(), order({ _id: 'o2', paymentStatus: 'unpaid', totalAmount: 200 })]);

    await expect(
      closeSessionManually({ sessionId: 'session-1', cafeId: CAFE_ID, user: USER, reason: '' })
    ).rejects.toThrow(/unpaid order/i);

    expect(mockSessionSave).not.toHaveBeenCalled();
  });

  it('writes off unpaid orders only when told to, and leaves a ledger trail', async () => {
    mockSessionFindOne.mockResolvedValue(session());
    mockOrderFind.mockResolvedValue([order(), order({ _id: 'o2', paymentStatus: 'unpaid', totalAmount: 200 })]);

    const result = await closeSessionManually({
      sessionId: 'session-1',
      cafeId: CAFE_ID,
      user: USER,
      reason: 'Guest walked out',
      writeOff: true,
    });

    expect(result.writtenOffAmount).toBe(200);
    expect(mockOrderUpdateMany).toHaveBeenCalledWith(
      { _id: { $in: expect.any(Array) } },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'cancelled' }) })
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session.closed_writeoff' })
    );
  });

  it('refuses a session that is already paid or closed', async () => {
    mockSessionFindOne.mockResolvedValue(session({ status: 'closed' }));

    await expect(
      closeSessionManually({ sessionId: 'session-1', cafeId: CAFE_ID, user: USER, reason: '' })
    ).rejects.toThrow(/already closed/i);

    expect(mockSessionSave).not.toHaveBeenCalled();
  });

  it('cannot be pointed at another cafe', async () => {
    mockSessionFindOne.mockResolvedValue(null);

    await expect(
      closeSessionManually({ sessionId: 'session-1', cafeId: 'other-cafe', user: USER, reason: '' })
    ).rejects.toThrow(/Session not found/i);

    expect(mockSessionFindOne).toHaveBeenCalledWith({
      _id: 'session-1',
      cafeId: 'other-cafe',
    });
  });
});

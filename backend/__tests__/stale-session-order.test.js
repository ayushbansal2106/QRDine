/**
 * Regression guard — a returning guest must never be blocked by last visit's session.
 *
 * The guest pays, closes the tab, and comes back next week to the same table.
 * The stored session id still points at last week's *closed* session, and the
 * order was posted against it. Two distinct failures lived there:
 *
 *   1. the client trusted a persisted id it never re-checked, so the guest was
 *      told "a valid dining session is required to place an order"; and
 *   2. the server accepted an order into a closed session, which is worse — the
 *      dishes joined a bill that had already been settled and were never paid
 *      for.
 */
const mockTableFindById = jest.fn();
const mockSessionFindById = jest.fn();
const mockOrderFind = jest.fn();
const mockCustomerUpsertByPhone = jest.fn();

jest.mock('../src/models/Table', () => ({
  findById: (...a) => mockTableFindById(...a),
  findOne: jest.fn(),
}));
jest.mock('../src/models/DiningSession', () => ({
  findById: (...a) => mockSessionFindById(...a),
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
}));
jest.mock('../src/models/Order', () => ({
  find: (...a) => mockOrderFind(...a),
  findOne: jest.fn(),
}));
jest.mock('../src/services/orderService', () => ({
  createOrder: jest.fn(),
  isBillableItem: jest.fn(),
  sumBillableItems: jest.fn(),
  round2: jest.fn(),
}));
jest.mock('../src/services/customerService', () => ({
  upsertByPhone: (...a) => mockCustomerUpsertByPhone(...a),
}));
jest.mock('../src/services/socketService', () => ({
  emitSessionActivity: jest.fn(),
  emitNewOrder: jest.fn(),
  emitItemCancelled: jest.fn(),
  emitStatusUpdate: jest.fn(),
  emitSessionPaid: jest.fn(),
  emitSessionClosed: jest.fn(),
}));
jest.mock('../src/services/telemetryService', () => ({ emitRefresh: jest.fn() }));

const orderService = require('../src/services/orderService');
const { createOrder } = require('../src/controllers/orderController');
const { mockReq, mockRes, mockNext } = require('./setup');

const tableId = '6ac08fb2dc276e3c59831d62';
const cafeId = '6ac08f59dc276e3c59831d60';
const sessionId = '6ac116d7b6e3a15afc39e87e';
const guestToken = 'fea8e1945b1be43a19fdac78575ed229';

const sessionIn = (status) => ({
  _id: sessionId,
  cafeId,
  tableId,
  status,
  guestToken,
  customerName: 'Ayush',
  addActivity: jest.fn(),
  save: jest.fn().mockResolvedValue(undefined),
});

const req = (overrides = {}) =>
  mockReq({
    body: {
      tableId,
      sessionId,
      items: [{ menuItemId: 'item-1', quantity: 1 }],
      clientRequestId: null,
      ...overrides.body,
    },
    headers: { 'x-guest-token': guestToken },
    ...overrides,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockTableFindById.mockResolvedValue({ _id: tableId, cafeId, isActive: true });
  mockCustomerUpsertByPhone.mockResolvedValue(null);
  orderService.createOrder.mockResolvedValue({
    order: { _id: 'order-1', orderNumber: 'ORD-1' },
    idempotent: false,
    couponApplied: null,
    couponNotice: null,
    voucherApplied: null,
    voucherNotice: null,
  });
});

describe('placing an order into a session from a previous visit', () => {
  it('refuses a closed session instead of quietly adding to a settled bill', async () => {
    mockSessionFindById.mockResolvedValue(sessionIn('closed'));

    const res = mockRes();
    const next = mockNext();
    await createOrder(req(), res, next);

    expect(orderService.createOrder).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, message: expect.stringMatching(/session has ended/i) })
    );
  });

  it.each(['abandoned', 'paid', 'processing', 'left'])(
    'refuses a %s session too',
    async (status) => {
      mockSessionFindById.mockResolvedValue(sessionIn(status));

      const next = mockNext();
      await createOrder(req(), res_unused(), next);

      expect(orderService.createOrder).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 409 })
      );
    }
  );

  it('still accepts an active session', async () => {
    mockSessionFindById.mockResolvedValue(sessionIn('active'));

    const res = mockRes();
    const next = mockNext();
    await createOrder(req(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(orderService.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, channel: 'qr' })
    );
  });

  it('keeps telling the guest to settle the bill first when that is the real reason', async () => {
    mockSessionFindById.mockResolvedValue(sessionIn('awaiting_payment'));

    const next = mockNext();
    await createOrder(req(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, message: expect.stringMatching(/settling the bill/i) })
    );
  });

  it('names the failure in a way the client can act on', async () => {
    mockSessionFindById.mockResolvedValue(sessionIn('closed'));

    const next = mockNext();
    await createOrder(req(), mockRes(), next);

    const [error] = next.mock.calls[0];
    // The client's only correct response is to open a fresh session for the
    // table, so the message has to say a session is what ended.
    expect(error.message).toMatch(/session/i);
    expect(error.statusCode).toBe(409);
  });
});

/** A throwaway response for the table-driven cases. */
function res_unused() {
  return mockRes();
}
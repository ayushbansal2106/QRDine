/**
 * ISSUE-31 — the POS created the order before it took the payment.
 *
 * The till had two write steps: `POST /pos/orders` then
 * `POST /pos/orders/:id/payments`. Between them sat a real window in which an
 * order existed but was unpaid. Hitting it was easy and the consequences were
 * silent:
 *
 *   • the cashier opened "Take Payment", then walked away or mistyped a tender
 *     and pressed Clear — the order stayed behind as `status: 'pending'`,
 *     visible on the orders board and the kitchen;
 *   • a paid POS order kept `status: 'pending'` forever, because
 *     `recordManualPayment` sets `paymentStatus` and never advances `status`.
 *     Order history matched on status, so the customer never saw their order and
 *     the owner's order counts and spend were short by every counter sale.
 *
 * `checkoutPosOrder` collapses both steps into one request and writes the order
 * born settled. These tests pin the properties that fix depends on.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';
const TABLE_ID = '507f191e810c19729de860ea';

const chainable = (value) => {
  const q = Promise.resolve(value);
  q.sort = () => q;
  q.limit = () => q;
  q.skip = () => q;
  q.select = () => q;
  q.populate = () => q;
  q.lean = () => Promise.resolve(value);
  return q;
};

const mockTableFindOne = jest.fn();
const mockCreateOrder = jest.fn();
const mockRecordManualPayment = jest.fn();
const mockUpsertByPhone = jest.fn();
const mockWalletDebit = jest.fn();
const mockValidateVoucher = jest.fn();
const mockRedeemVoucher = jest.fn();

jest.resetModules();

jest.doMock('../src/models/Order', () => ({
  findOne: () => chainable(null),
}));
jest.doMock('../src/models/Table', () => ({ findOne: (...a) => mockTableFindOne(...a) }));
jest.doMock('../src/models/Category', () => ({ find: () => chainable([]) }));
jest.doMock('../src/models/MenuItem', () => ({ find: () => chainable([]) }));
jest.doMock('../src/models/Cafe', () => ({ findById: jest.fn() }));

jest.doMock('../src/services/orderService', () => ({
  createOrder: (...a) => mockCreateOrder(...a),
  recordManualPayment: (...a) => mockRecordManualPayment(...a),
  applyDiscounts: jest.fn(({ subtotal, discounts }) => ({
    discounts,
    discountTotal: discounts.reduce((s, d) => s + (d.value || 0), 0),
  })),
  round2: (n) => Number(n.toFixed(2)),
}));

jest.doMock('../src/services/walletService', () => ({ debit: (...a) => mockWalletDebit(...a) }));
jest.doMock('../src/services/customerService', () => ({
  upsertByPhone: (...a) => mockUpsertByPhone(...a),
  recordVisit: jest.fn().mockResolvedValue({}),
}));
jest.doMock('../src/services/loyaltyService', () => ({
  earnStamps: jest.fn().mockResolvedValue({}),
  validateVoucher: (...a) => mockValidateVoucher(...a),
  redeemVoucher: (...a) => mockRedeemVoucher(...a),
}));
jest.doMock('../src/services/scratchService', () => ({ maybeIssueCard: jest.fn().mockResolvedValue(null) }));
jest.doMock('../src/services/auditService', () => ({ recordEvent: jest.fn().mockResolvedValue({}) }));
jest.doMock('../src/services/socketService', () => ({
  emitNewOrder: jest.fn(),
  emitMetricsUpdated: jest.fn(),
}));

const { checkoutPosOrder } = require('../src/controllers/posController');

const makeOrder = (overrides = {}) => ({
  _id: 'order-1',
  orderNumber: 'ORD-20260719-0001',
  cafeId: CAFE_ID,
  status: 'served',
  paymentStatus: 'unpaid',
  subtotal: 1000,
  totalGST: 50,
  discountTotal: 0,
  serviceCharge: 0,
  totalAmount: 1050,
  discounts: [],
  items: [],
  customerId: null,
  payments: [],
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const validBody = (overrides = {}) => ({
  orderType: 'dine_in',
  tableId: TABLE_ID,
  items: [{ menuItemId: 'm1', quantity: 1 }],
  tenders: [{ method: 'cash', amount: 1050 }],
  ...overrides,
});

const owner = { _id: 'staff-1', name: 'Asha', role: 'owner', permissions: [] };

beforeEach(() => {
  jest.clearAllMocks();
  mockTableFindOne.mockResolvedValue({ _id: TABLE_ID, cafeId: CAFE_ID, isActive: true });
  mockCreateOrder.mockResolvedValue({
    order: makeOrder(),
    idempotent: false,
    couponApplied: null,
  });
  mockRecordManualPayment.mockImplementation(async (order) => {
    order.paymentStatus = 'paid';
    return order;
  });
});

describe('ISSUE-31 — a counter sale is created and settled in one request', () => {
  it('writes no order when the tender list is missing', async () => {
    // The whole point: a malformed till entry must not leave a half-placed order.
    const req = mockReq({ cafeId: CAFE_ID, user: owner, body: validBody({ tenders: [] }) });
    const next = mockNext();

    await checkoutPosOrder(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/tender/i) }));
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('rejects a malformed tender before writing anything', async () => {
    const req = mockReq({
      cafeId: CAFE_ID,
      user: owner,
      body: validBody({ tenders: [{ method: 'crypto', amount: 1050 }] }),
    });
    const next = mockNext();

    await checkoutPosOrder(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/Unsupported payment method/i) })
    );
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('creates the order already settled, not as a pending kitchen ticket', async () => {
    const req = mockReq({ cafeId: CAFE_ID, user: owner, body: validBody() });
    const res = mockRes();

    await checkoutPosOrder(req, res, mockNext());

    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'pos',
        // `accepted` routes it directly to KDS for kitchen preparation while marked paid
        initialStatus: 'accepted',
        createdByStaffId: owner._id,
      })
    );
    expect(mockRecordManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmount: 1050 }),
      validBody().tenders,
      owner._id
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res._jsonData.success).toBe(true);
  });

  it('links the sale to the CRM profile for the dialled number', async () => {
    mockUpsertByPhone.mockResolvedValue({ _id: 'cust-1' });
    mockCreateOrder.mockResolvedValue({
      order: makeOrder({ customerId: 'cust-1' }),
      idempotent: false,
      couponApplied: null,
    });

    const req = mockReq({
      cafeId: CAFE_ID,
      user: owner,
      body: validBody({ customerPhone: '9876543210', customerName: 'Ravi' }),
    });

    await checkoutPosOrder(req, mockRes(), mockNext());

    expect(mockUpsertByPhone).toHaveBeenCalledWith({
      cafeId: CAFE_ID,
      phone: '9876543210',
      name: 'Ravi',
    });
    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1' })
    );
  });

  it('does not settle twice when a client replays the same request id', async () => {
    // Idempotent replay returns the original order. Settling it again would
    // double-debit the wallet and stamp loyalty twice for one cup of coffee.
    mockCreateOrder.mockResolvedValue({ order: makeOrder(), idempotent: true, couponApplied: null });

    const req = mockReq({ cafeId: CAFE_ID, user: owner, body: validBody() });
    const res = mockRes();

    await checkoutPosOrder(req, res, mockNext());

    expect(mockRecordManualPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('requires a live table for dine-in orders', async () => {
    mockTableFindOne.mockResolvedValue(null);

    const req = mockReq({ cafeId: CAFE_ID, user: owner, body: validBody() });
    const next = mockNext();

    await checkoutPosOrder(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Table not found/i) }));
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('does not require a table for a takeaway', async () => {
    const req = mockReq({
      cafeId: CAFE_ID,
      user: owner,
      body: validBody({ orderType: 'takeaway', tableId: undefined }),
    });

    await checkoutPosOrder(req, mockRes(), mockNext());

    expect(mockTableFindOne).not.toHaveBeenCalled();
    expect(mockCreateOrder).toHaveBeenCalledWith(expect.objectContaining({ tableId: null }));
  });

  it('refuses a wallet tender with no customer behind it', async () => {
    const req = mockReq({
      cafeId: CAFE_ID,
      user: owner,
      body: validBody({ tenders: [{ method: 'wallet', amount: 1050 }] }),
    });
    const next = mockNext();

    await checkoutPosOrder(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/phone number is required/i) })
    );
    expect(mockWalletDebit).not.toHaveBeenCalled();
  });
});

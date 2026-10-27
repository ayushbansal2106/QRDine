/**
 * POS (#02) and KDS (#07) controllers.
 *
 * These two surfaces are where money and timing go wrong in a real cafe, so the
 * assertions focus on server-side pricing, tender validation, wallet debiting,
 * station routing and item-level bumping.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';

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

// ── POS ───────────────────────────────────────────────────────

const mockCategoryFind = jest.fn();
const mockMenuItemFind = jest.fn();
const mockTableFind = jest.fn();
const mockPosOrderFindOne = jest.fn();
const mockPosCreateOrder = jest.fn();
const mockRecordManualPayment = jest.fn();
const mockWalletDebit = jest.fn();
const mockUpsertByPhone = jest.fn();
const mockLoyaltyEarn = jest.fn().mockResolvedValue({});
const mockScratchIssue = jest.fn().mockResolvedValue(null);
const mockPosAudit = jest.fn().mockResolvedValue({});

jest.resetModules();

jest.doMock('../src/models/Category', () => ({ find: (...a) => chainable(mockCategoryFind(...a)) }));
jest.doMock('../src/models/MenuItem', () => ({ find: (...a) => chainable(mockMenuItemFind(...a)) }));
jest.doMock('../src/models/Table', () => ({ find: (...a) => chainable(mockTableFind(...a)) }));
jest.doMock('../src/models/Order', () => ({
  findOne: (...a) => {
    const q = Promise.resolve(mockPosOrderFindOne(...a));
    q.populate = () => q;
    return q;
  },
}));
jest.doMock('../src/models/Cafe', () => ({ findById: jest.fn() }));

jest.doMock('../src/services/orderService', () => ({
  createOrder: (...a) => mockPosCreateOrder(...a),
  recordManualPayment: (...a) => mockRecordManualPayment(...a),
  resolveItemPricing: jest.fn(),
}));

jest.doMock('../src/services/walletService', () => ({
  debit: (...a) => mockWalletDebit(...a),
  credit: jest.fn(),
}));

jest.doMock('../src/services/customerService', () => ({
  upsertByPhone: (...a) => mockUpsertByPhone(...a),
  recordVisit: jest.fn().mockResolvedValue({}),
}));

jest.doMock('../src/services/loyaltyService', () => ({ earnStamps: (...a) => mockLoyaltyEarn(...a) }));
jest.doMock('../src/services/scratchService', () => ({ maybeIssueCard: (...a) => mockScratchIssue(...a) }));
jest.doMock('../src/services/auditService', () => ({ recordEvent: (...a) => mockPosAudit(...a) }));
jest.doMock('../src/services/socketService', () => ({
  emitNewOrder: jest.fn(),
  emitStatusUpdate: jest.fn(),
  emitMetricsUpdated: jest.fn(),
  emitWalletUpdated: jest.fn(),
  emitLoyaltyUpdated: jest.fn(),
  emitScratchIssued: jest.fn(),
}));

const posController = require('../src/controllers/posController');

// ── KDS ───────────────────────────────────────────────────────

jest.resetModules();

const mockKdsOrderFind = jest.fn();
const mockKdsOrderFindOne = jest.fn();
const mockKdsOrderSave = jest.fn();
const mockKdsItemUpdated = jest.fn();
const mockKdsTicketBumped = jest.fn();

jest.doMock('../src/models/Order', () => ({
  find: (...a) => chainable(mockKdsOrderFind(...a)),
  findOne: (...a) => {
    const q = Promise.resolve(mockKdsOrderFindOne(...a));
    q.populate = () => q;
    return q;
  },
}));
jest.doMock('../src/services/socketService', () => ({
  emitKdsItemUpdated: (...a) => mockKdsItemUpdated(...a),
  emitKdsTicketBumped: (...a) => mockKdsTicketBumped(...a),
  emitStatusUpdate: jest.fn(),
}));

const kdsController = require('../src/controllers/kdsController');

beforeEach(() => jest.clearAllMocks());

// ── POS tests ─────────────────────────────────────────────────

describe('POS — catalog', () => {
  it('returns the catalog with the caller’s discount/refund capability flags', async () => {
    mockCategoryFind.mockResolvedValue([{ _id: 'c1', name: 'Coffee' }]);
    mockMenuItemFind.mockResolvedValue([{ _id: 'm1', name: 'Latte' }]);
    mockTableFind.mockResolvedValue([{ _id: 't1', tableNumber: '1' }]);

    const res = mockRes();
    await posController.getPosCatalog(
      mockReq({ cafeId: CAFE_ID, user: { role: 'cashier' } }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(200);
    expect(res._jsonData.canDiscount).toBe(false);
    expect(res._jsonData.canRefund).toBe(false);
  });

  it('tells a manager they may discount and refund', async () => {
    mockCategoryFind.mockResolvedValue([]);
    mockMenuItemFind.mockResolvedValue([]);
    mockTableFind.mockResolvedValue([]);

    const res = mockRes();
    await posController.getPosCatalog(
      mockReq({ cafeId: CAFE_ID, user: { role: 'manager' } }),
      res,
      mockNext()
    );

    expect(res._jsonData.canDiscount).toBe(true);
    expect(res._jsonData.canRefund).toBe(true);
  });

  it('scopes the catalog to the tenant', async () => {
    mockCategoryFind.mockResolvedValue([]);
    mockMenuItemFind.mockResolvedValue([]);
    mockTableFind.mockResolvedValue([]);

    await posController.getPosCatalog(mockReq({ cafeId: CAFE_ID, user: {} }), mockRes(), mockNext());

    expect(mockCategoryFind).toHaveBeenCalledWith({ cafeId: CAFE_ID });
    expect(mockMenuItemFind).toHaveBeenCalledWith({ cafeId: CAFE_ID, isAvailable: true });
  });
});

describe('POS — create order', () => {
  const pricedOrder = { _id: 'o1', orderNumber: 'ORD-1', totalAmount: 450, items: [{ menuItemId: 'm1' }] };

  beforeEach(() => {
    mockPosCreateOrder.mockResolvedValue({ order: pricedOrder, idempotent: false });
    mockTableFind.mockResolvedValue([]);
  });

  it('rejects an order with no items', async () => {
    const next = mockNext();
    await posController.createPosOrder(mockReq({ cafeId: CAFE_ID, user: {}, body: { items: [] } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects an unknown order type', async () => {
    const next = mockNext();
    await posController.createPosOrder(
      mockReq({ cafeId: CAFE_ID, user: {}, body: { items: [{ menuItemId: 'm1', quantity: 1 }], orderType: 'drone' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('creates a counter order through the shared engine with staff attribution', async () => {
    mockTableFind.mockResolvedValue([]);

    const res = mockRes();
    await posController.createPosOrder(
      mockReq({
        cafeId: CAFE_ID,
        user: { _id: 'u1', name: 'Asha' },
        body: { items: [{ menuItemId: 'm1', quantity: 2 }], orderType: 'takeaway' },
      }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(201);
    expect(mockPosCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({ cafeId: CAFE_ID, channel: 'pos', orderType: 'takeaway', createdByStaffId: 'u1' })
    );
  });

  it('never runs the geofence on a counter order', async () => {
    mockTableFind.mockResolvedValue([]);

    await posController.createPosOrder(
      mockReq({
        cafeId: CAFE_ID,
        user: { _id: 'u1' },
        body: { items: [{ menuItemId: 'm1', quantity: 1 }], orderType: 'takeaway' },
      }),
      mockRes(),
      mockNext()
    );

    expect(mockPosCreateOrder).toHaveBeenCalledWith(expect.objectContaining({ enforceGeofence: false }));
  });

  it('returns 200 rather than 201 on an idempotent replay', async () => {
    mockPosCreateOrder.mockResolvedValue({ order: pricedOrder, idempotent: true });
    mockTableFind.mockResolvedValue([]);

    const res = mockRes();
    await posController.createPosOrder(
      mockReq({
        cafeId: CAFE_ID,
        user: { _id: 'u1' },
        body: { items: [{ menuItemId: 'm1', quantity: 1 }], orderType: 'takeaway' },
      }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(200);
  });
});

describe('POS — payments', () => {
  const order = () => ({
    _id: 'o1',
    totalAmount: 450,
    paymentStatus: 'unpaid',
    customerId: null,
    items: [],
  });

  it('rejects an empty tender list', async () => {
    const next = mockNext();
    await posController.recordPosPayment(mockReq({ cafeId: CAFE_ID, params: { id: 'o1' }, body: { tenders: [] } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects an unsupported tender method (no gateway yet)', async () => {
    const next = mockNext();
    await posController.recordPosPayment(
      mockReq({
        cafeId: CAFE_ID,
        params: { id: 'o1' },
        user: { _id: 'u1' },
        body: { tenders: [{ method: 'razorpay', amount: 450 }] },
      }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects a non-positive tender amount', async () => {
    const next = mockNext();
    await posController.recordPosPayment(
      mockReq({
        cafeId: CAFE_ID,
        params: { id: 'o1' },
        user: { _id: 'u1' },
        body: { tenders: [{ method: 'cash', amount: 0 }] },
      }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('refuses to double-pay an order', async () => {
    mockPosOrderFindOne.mockResolvedValue({ ...order(), paymentStatus: 'paid' });
    const next = mockNext();

    await posController.recordPosPayment(
      mockReq({
        cafeId: CAFE_ID,
        params: { id: 'o1' },
        user: { _id: 'u1' },
        body: { tenders: [{ method: 'cash', amount: 450 }] },
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('records a split tender (cash + UPI) through the shared pipeline', async () => {
    mockPosOrderFindOne.mockResolvedValue(order());

    const res = mockRes();
    await posController.recordPosPayment(
      mockReq({
        cafeId: CAFE_ID,
        params: { id: 'o1' },
        user: { _id: 'u1', name: 'Asha' },
        body: { tenders: [{ method: 'cash', amount: 200 }, { method: 'upi_manual', amount: 250 }] },
      }),
      res,
      mockNext()
    );

    expect(mockRecordManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'o1' }),
      expect.arrayContaining([expect.objectContaining({ method: 'cash' })]),
      'u1'
    );
    expect(res._statusCode).toBe(200);
  });

  it('debits the wallet before marking a wallet tender paid', async () => {
    mockPosOrderFindOne.mockResolvedValue({ ...order(), customerId: 'c1' });
    mockWalletDebit.mockResolvedValue({ wallet: { balance: 550 } });

    await posController.recordPosPayment(
      mockReq({
        cafeId: CAFE_ID,
        params: { id: 'o1' },
        user: { _id: 'u1', name: 'Asha' },
        body: { tenders: [{ method: 'wallet', amount: 450 }] },
      }),
      mockRes(),
      mockNext()
    );

    expect(mockWalletDebit).toHaveBeenCalledWith(
      expect.objectContaining({ cafeId: CAFE_ID, customerId: 'c1', amount: 450, type: 'payment' })
    );
  });

  it('refuses a wallet tender when the order has no linked customer', async () => {
    mockPosOrderFindOne.mockResolvedValue(order());
    const next = mockNext();

    await posController.recordPosPayment(
      mockReq({
        cafeId: CAFE_ID,
        params: { id: 'o1' },
        user: { _id: 'u1' },
        body: { tenders: [{ method: 'wallet', amount: 450 }] },
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockWalletDebit).not.toHaveBeenCalled();
  });

  it('404s an order from another tenant', async () => {
    mockPosOrderFindOne.mockResolvedValue(null);
    const next = mockNext();

    await posController.recordPosPayment(
      mockReq({
        cafeId: CAFE_ID,
        params: { id: 'o1' },
        user: { _id: 'u1' },
        body: { tenders: [{ method: 'cash', amount: 450 }] },
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

// ── KDS tests ─────────────────────────────────────────────────

describe('KDS — ticket feed', () => {
  const ticket = (overrides = {}) => ({
    _id: 'o1',
    orderNumber: 'ORD-1',
    orderType: 'dine_in',
    status: 'pending',
    createdAt: new Date(),
    tableId: { tableNumber: '4' },
    notes: '',
    items: [
      { _id: 'i1', itemName: 'Latte', quantity: 1, prepStation: 'bar', status: 'pending', modifiers: [], notes: '', seat: null },
      { _id: 'i2', itemName: 'Toastie', quantity: 2, prepStation: 'kitchen', status: 'pending', modifiers: [], notes: '', seat: 'A' },
      { _id: 'i3', itemName: 'Salad', quantity: 1, prepStation: 'both', status: 'pending', modifiers: [], notes: '', seat: null },
    ],
    ...overrides,
  });

  it('returns all open tickets by default', async () => {
    mockKdsOrderFind.mockResolvedValue([ticket()]);

    const res = mockRes();
    await kdsController.getKdsOrders(mockReq({ cafeId: CAFE_ID, query: {} }), res, mockNext());

    expect(res._jsonData.tickets).toHaveLength(1);
    expect(res._jsonData.tickets[0].items).toHaveLength(3);
  });

  it('filters to the bar station, keeping items routed to both', async () => {
    mockKdsOrderFind.mockResolvedValue([ticket()]);

    const res = mockRes();
    await kdsController.getKdsOrders(mockReq({ cafeId: CAFE_ID, query: { station: 'bar' } }), res, mockNext());

    const names = res._jsonData.tickets[0].items.map((i) => i.itemName);
    expect(names).toEqual(['Latte', 'Salad']);
  });

  it('drops a ticket that has nothing for that station', async () => {
    mockKdsOrderFind.mockResolvedValue([ticket()]);

    const res = mockRes();
    await kdsController.getKdsOrders(mockReq({ cafeId: CAFE_ID, query: { station: 'kitchen' } }), res, mockNext());

    const names = res._jsonData.tickets[0].items.map((i) => i.itemName);
    expect(names).toEqual(['Toastie', 'Salad']);
  });

  it('scopes the feed to the tenant and to open statuses only', async () => {
    mockKdsOrderFind.mockResolvedValue([]);

    await kdsController.getKdsOrders(mockReq({ cafeId: CAFE_ID, query: {} }), mockRes(), mockNext());

    expect(mockKdsOrderFind).toHaveBeenCalledWith(
      expect.objectContaining({ cafeId: CAFE_ID })
    );
    const filter = mockKdsOrderFind.mock.calls[0][0];
    expect(filter.status.$in).not.toContain('cancelled');
    expect(filter.status.$in).not.toContain('served');
  });

  it('computes elapsed seconds for the urgency colour', async () => {
    const old = new Date(Date.now() - 600000);
    mockKdsOrderFind.mockResolvedValue([ticket({ createdAt: old })]);

    const res = mockRes();
    await kdsController.getKdsOrders(mockReq({ cafeId: CAFE_ID, query: {} }), res, mockNext());

    expect(res._jsonData.tickets[0].elapsedSeconds).toBeGreaterThanOrEqual(600);
  });
});

describe('KDS — item and ticket bumps', () => {
  const makeItem = () => ({ _id: 'i1', itemName: 'Latte', status: 'pending', save: jest.fn().mockResolvedValue(true) });
  const order = (items) => ({
    _id: 'o1',
    cafeId: CAFE_ID,
    status: 'pending',
    items,
    save: jest.fn().mockResolvedValue(true),
  });

  it('bumps a single item to ready and broadcasts it', async () => {
    const item = makeItem();
    mockKdsOrderFindOne.mockResolvedValue(order([item]));

    const res = mockRes();
    await kdsController.updateKdsItemStatus(
      mockReq({ cafeId: CAFE_ID, params: { orderId: 'o1', itemId: 'i1' }, body: { status: 'ready' } }),
      res,
      mockNext()
    );

    expect(item.status).toBe('ready');
    expect(mockKdsItemUpdated).toHaveBeenCalled();
    expect(res._statusCode).toBe(200);
  });

  it('rejects an invalid item status', async () => {
    mockKdsOrderFindOne.mockResolvedValue(order([makeItem()]));
    const next = mockNext();

    await kdsController.updateKdsItemStatus(
      mockReq({ cafeId: CAFE_ID, params: { orderId: 'o1', itemId: 'i1' }, body: { status: 'teleported' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('404s an item that is not on the ticket', async () => {
    mockKdsOrderFindOne.mockResolvedValue(order([makeItem()]));
    const next = mockNext();

    await kdsController.updateKdsItemStatus(
      mockReq({ cafeId: CAFE_ID, params: { orderId: 'o1', itemId: 'nope' }, body: { status: 'ready' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('bumps a whole ticket to ready', async () => {
    const item = makeItem();
    const ticket = order([item]);
    mockKdsOrderFindOne.mockResolvedValue(ticket);

    const res = mockRes();
    await kdsController.bumpKdsTicket(
      mockReq({ cafeId: CAFE_ID, params: { orderId: 'o1' }, body: { status: 'ready' } }),
      res,
      mockNext()
    );

    expect(ticket.status).toBe('ready');
    expect(item.status).toBe('ready');
    expect(mockKdsTicketBumped).toHaveBeenCalled();
  });

  it('refuses to bump an order from another tenant', async () => {
    mockKdsOrderFindOne.mockResolvedValue(null);
    const next = mockNext();

    await kdsController.bumpKdsTicket(
      mockReq({ cafeId: CAFE_ID, params: { orderId: 'o1' }, body: { status: 'ready' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});
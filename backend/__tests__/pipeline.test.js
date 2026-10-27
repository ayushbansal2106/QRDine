/**
 * Module #03 — omnichannel pipeline: add-to-tab, table reassignment and
 * coin/credit reconciliation.
 *
 * The pricing rules here are the ones that silently corrupt money if they are
 * wrong, so they are asserted directly rather than through the controller only.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';

const mockTableFindOne = jest.fn();
const mockSessionFindOne = jest.fn();
const mockWalletCredit = jest.fn();
const mockAuditRecordEvent = jest.fn().mockResolvedValue({});
const mockEmitNewOrder = jest.fn();
const mockEmitStatusUpdate = jest.fn();
const mockEmitTableStatusChanged = jest.fn();
const mockEmitRefresh = jest.fn();
const mockResolveLineItems = jest.fn();

jest.mock('../src/models/Table', () => ({
  // reassignTable chains `.select('tableNumber')` for the previous table.
  findOne: (...a) => {
    const query = Promise.resolve(mockTableFindOne(...a));
    query.select = () => query;
    return query;
  },
}));

jest.mock('../src/models/DiningSession', () => ({
  findOne: (...a) => mockSessionFindOne(...a),
}));

jest.mock('../src/models/Order', () => ({
  findOne: jest.fn(),
}));

jest.mock('../src/services/walletService', () => ({
  credit: (...a) => mockWalletCredit(...a),
}));

jest.mock('../src/services/auditService', () => ({
  recordEvent: (...a) => mockAuditRecordEvent(...a),
}));

jest.mock('../src/services/socketService', () => ({
  emitNewOrder: (...a) => mockEmitNewOrder(...a),
  emitStatusUpdate: (...a) => mockEmitStatusUpdate(...a),
  emitTableStatusChanged: (...a) => mockEmitTableStatusChanged(...a),
}));

jest.mock('../src/services/telemetryService', () => ({
  emitRefresh: (...a) => mockEmitRefresh(...a),
}));

// orderService is partially mocked: keep round2 + createOrder real, stub the
// pricing query so these tests focus on pipeline behaviour.
jest.mock('../src/services/orderService', () => {
  const actual = jest.requireActual('../src/services/orderService');
  return {
    ...actual,
    resolveLineItems: (...a) => mockResolveLineItems(...a),
  };
});

const service = require('../src/services/orderReconciliationService');

const makeItem = (overrides = {}) => ({
  menuItemId: 'm1',
  itemName: 'Latte',
  quantity: 2,
  price: 150,
  gstPercentage: 5,
  gstAmount: 15,
  status: 'pending',
  prepStation: 'kitchen',
  modifiers: [],
  ...overrides,
});

const makeOrder = (overrides = {}) => ({
  _id: 'order-1',
  cafeId: CAFE_ID,
  orderNumber: 'ORD-1',
  status: 'pending',
  channel: 'qr',
  orderType: 'dine_in',
  tableId: 'table-1',
  sessionId: 'session-1',
  items: [makeItem()],
  subtotal: 300,
  totalGST: 30,
  serviceCharge: 0,
  discountTotal: 0,
  discounts: [],
  taxBreakdown: [{ percentage: 5, amount: 30 }],
  totalAmount: 330,
  payments: [],
  refunds: [],
  save: jest.fn().mockResolvedValue(true),
  ...overrides,
});

afterEach(() => jest.clearAllMocks());

// ── Totals ─────────────────────────────────────────────────────

describe('recomputeTotals', () => {
  it('excludes cancelled items from the totals', () => {
    const order = makeOrder({
      items: [makeItem(), makeItem({ itemName: 'Cancelled', status: 'cancelled', quantity: 1, price: 200, gstAmount: 20 })],
      subtotal: 0,
      totalGST: 0,
      totalAmount: 0,
    });

    service.recomputeTotals(order);

    // gstAmount is the LINE total (150 x 2 @ 5% = 15), so the live item is 15.
    expect(order.subtotal).toBe(300);
    expect(order.totalGST).toBe(15);
    expect(order.totalAmount).toBe(315);
  });

  it('keeps a percentage discount proportional to the new subtotal', () => {
    const order = makeOrder({
      items: [makeItem(), makeItem({ quantity: 1, price: 100, gstAmount: 5 })],
      discounts: [{ type: 'percent', value: 10, amount: 0 }],
    });

    service.recomputeTotals(order);

    // subtotal 400, 10% off = 40, GST 20 → total 380
    expect(order.subtotal).toBe(400);
    expect(order.discountTotal).toBe(40);
    expect(order.totalAmount).toBe(380);
  });

  it('never produces a negative total', () => {
    const order = makeOrder({
      items: [makeItem()],
      discounts: [{ type: 'flat', value: 5000, amount: 0 }],
    });

    service.recomputeTotals(order);

    expect(order.totalAmount).toBeGreaterThanOrEqual(0);
    expect(order.discountTotal).toBeLessThanOrEqual(order.subtotal);
  });
});

// ── Add to tab ─────────────────────────────────────────────────

describe('addItemsToOrder', () => {
  beforeEach(() => {
    mockResolveLineItems.mockResolvedValue({
      resolvedItems: [makeItem({ itemName: 'Croissant', quantity: 1, price: 120, gstAmount: 12 })],
      subtotal: 120,
      totalGST: 12,
      taxBreakdown: [{ percentage: 5, amount: 12 }],
    });
  });

  it('appends items and recomputes the bill', async () => {
    const order = makeOrder();

    await service.addItemsToOrder({ cafeId: CAFE_ID, order, items: [{ menuItemId: 'm2', quantity: 1 }] });

    expect(order.items).toHaveLength(2);
    expect(order.subtotal).toBe(420);
    expect(order.totalAmount).toBe(447);
    expect(order.save).toHaveBeenCalled();
  });

  it('prices added items on the server, never from the request body', async () => {
    const order = makeOrder();

    await service.addItemsToOrder({
      cafeId: CAFE_ID,
      order,
      items: [{ menuItemId: 'm2', quantity: 1, price: 1 }],
    });

    expect(mockResolveLineItems).toHaveBeenCalledWith({ cafeId: CAFE_ID, items: [{ menuItemId: 'm2', quantity: 1, price: 1 }] });
    expect(order.totalAmount).toBe(447); // priced from the menu, not the 1 rupee sent
  });

  it('inherits the ticket status so the KDS is not re-fired', async () => {
    const order = makeOrder({ status: 'preparing' });

    await service.addItemsToOrder({ cafeId: CAFE_ID, order, items: [{ menuItemId: 'm2', quantity: 1 }] });

    expect(order.items[1].status).toBe('preparing');
  });

  it('refuses to add items to a served order', async () => {
    const order = makeOrder({ status: 'served' });

    await expect(
      service.addItemsToOrder({ cafeId: CAFE_ID, order, items: [{ menuItemId: 'm2', quantity: 1 }] })
    ).rejects.toThrow(/still open/i);
  });

  it('refuses an empty item list', async () => {
    await expect(service.addItemsToOrder({ cafeId: CAFE_ID, order: makeOrder(), items: [] })).rejects.toThrow(
      /at least one item/i
    );
  });
});

// ── Reassign table ─────────────────────────────────────────────

describe('reassignTable', () => {
  it('moves the order and its dining session together', async () => {
    const order = makeOrder();
    const target = { _id: 'table-9', tableNumber: '9', isActive: true };
    const previous = { _id: 'table-1', tableNumber: '1' };
    const session = {
      _id: 'session-1',
      tableId: 'table-1',
      status: 'active',
      addActivity: jest.fn(),
      save: jest.fn().mockResolvedValue(true),
    };

    mockTableFindOne
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(previous);
    mockSessionFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(session);

    const result = await service.reassignTable({
      cafeId: CAFE_ID,
      order,
      tableId: 'table-9',
      staffId: 'u1',
      reason: 'guests asked',
    });

    expect(order.tableId).toEqual('table-9');
    expect(session.tableId).toEqual('table-9');
    expect(result.session).toBe(session);
    expect(mockAuditRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'order.table_reassigned' })
    );
  });

  it('rejects a table from another cafe', async () => {
    mockTableFindOne.mockResolvedValue(null);
    await expect(
      service.reassignTable({ cafeId: CAFE_ID, order: makeOrder(), tableId: 'table-9' })
    ).rejects.toThrow(/not found/i);
  });

  it('rejects an inactive target table', async () => {
    mockTableFindOne.mockResolvedValue({ _id: 'table-9', tableNumber: '9', isActive: false });
    await expect(
      service.reassignTable({ cafeId: CAFE_ID, order: makeOrder(), tableId: 'table-9' })
    ).rejects.toThrow(/inactive/i);
  });

  it('refuses when the target table is already settling its bill', async () => {
    mockTableFindOne.mockResolvedValueOnce({ _id: 'table-9', tableNumber: '9', isActive: true });
    mockSessionFindOne.mockResolvedValueOnce({ _id: 's9', status: 'awaiting_payment' });

    await expect(
      service.reassignTable({ cafeId: CAFE_ID, order: makeOrder(), tableId: 'table-9' })
    ).rejects.toThrow(/settling its bill/i);
  });

  it('refuses to move a served order', async () => {
    await expect(
      service.reassignTable({ cafeId: CAFE_ID, order: makeOrder({ status: 'served' }), tableId: 'table-9' })
    ).rejects.toThrow(/open, unserved/i);
  });
});

// ── Refund reconciliation ──────────────────────────────────────

describe('reconcileRefund', () => {
  const paidOrder = (overrides = {}) =>
    makeOrder({
      paymentStatus: 'paid',
      payments: [{ method: 'cash', amount: 330 }, { method: 'wallet', amount: 120 }],
      ...overrides,
    });

  it('refunds part of the bill and marks it partially refunded', async () => {
    const order = paidOrder();

    const result = await service.reconcileRefund({
      cafeId: CAFE_ID,
      order,
      amount: 100,
      method: 'cash',
      reason: 'item unavailable',
      staffId: 'u1',
    });

    expect(result.order.paymentStatus).toBe('partially_refunded');
    expect(result.refund.destination).toBe('external');
    expect(mockAuditRecordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'order.refund' }));
  });

  it('credits the wallet when the tender was the wallet', async () => {
    mockWalletCredit.mockResolvedValue({
      wallet: { balance: 620 },
      transaction: { _id: 'txn-1' },
    });
    const order = paidOrder({ customerId: 'customer-1' });

    const result = await service.reconcileRefund({
      cafeId: CAFE_ID,
      order,
      amount: 120,
      method: 'wallet',
      reason: 'order cancelled',
    });

    expect(mockWalletCredit).toHaveBeenCalledWith(
      expect.objectContaining({ cafeId: CAFE_ID, amount: 120, type: 'refund' })
    );
    expect(result.walletReconciliation.balance).toBe(620);
  });

  it('caps the refund at what was actually collected', async () => {
    const order = paidOrder();

    await expect(
      service.reconcileRefund({ cafeId: CAFE_ID, order, amount: 5000, method: 'cash', reason: 'oops' })
    ).rejects.toThrow(/cannot exceed/i);
  });

  it('accounts for a previous refund when computing the cap', async () => {
    const order = paidOrder({ refunds: [{ amount: 400, method: 'cash' }] });

    await expect(
      service.reconcileRefund({ cafeId: CAFE_ID, order, amount: 100, method: 'cash', reason: 'more' })
    ).rejects.toThrow(/cannot exceed/i);
  });

  it('refuses to refund an order with no collected payment', async () => {
    await expect(
      service.reconcileRefund({ cafeId: CAFE_ID, order: makeOrder(), amount: 10, method: 'cash', reason: 'x' })
    ).rejects.toThrow(/no collected payment/i);
  });

  it('flags the order as fully refunded when everything is returned', async () => {
    const order = paidOrder({ payments: [{ method: 'cash', amount: 330 }] });

    const result = await service.reconcileRefund({
      cafeId: CAFE_ID,
      order,
      method: 'cash',
      reason: 'full refund',
    });

    expect(result.order.paymentStatus).toBe('refunded');
  });
});
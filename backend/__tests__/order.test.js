/**
 * Order Processing Flow Tests
 * Tests: createOrder, updateOrderStatus, cancelOrderItem, getOrders, getOrder
 */

const { mockReq, mockRes, mockNext } = require('./setup');

// ─── Module-level mock functions ────────────────────────────────
const mockOrderFind = jest.fn();
const mockOrderFindOne = jest.fn();
const mockOrderFindById = jest.fn();
const mockOrderCreate = jest.fn();
const mockOrderCountDocuments = jest.fn();
const mockTableFindById = jest.fn();
const mockMenuItemFindOne = jest.fn();
const mockDiningSessionFindById = jest.fn();
const mockResolveGuestToken = jest.fn();
const mockSocketEmitNewOrder = jest.fn();
const mockSocketEmitStatusUpdate = jest.fn();
const mockSocketEmitSessionActivity = jest.fn();
const mockSocketEmitBillUpdated = jest.fn();
const mockSocketEmitItemCancelled = jest.fn();
const mockSocketEmitOrderCreatedSession = jest.fn();

// ─── Register mocks ONCE at top level ───────────────────────────
jest.mock('../src/models/Order', () => {
  const Order = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-order-id';
    this.save = jest.fn().mockResolvedValue(true);
    this.items = data.items || [];
    this.items.id = jest.fn((id) => this.items.find(i => String(i._id) === String(id)));
  };
  Order.find = (...a) => mockOrderFind(...a);
  Order.findOne = (...a) => mockOrderFindOne(...a);
  Order.findById = (...a) => mockOrderFindById(...a);
  Order.create = (...a) => mockOrderCreate(...a);
  Order.countDocuments = (...a) => mockOrderCountDocuments(...a);
  return Order;
});

jest.mock('../src/models/Table', () => {
  const Table = function (data) { Object.assign(this, data); this._id = data._id || 'mock-table-id'; };
  Table.findById = (...a) => mockTableFindById(...a);
  return Table;
});

jest.mock('../src/models/MenuItem', () => {
  const MenuItem = function (data) { Object.assign(this, data); this._id = data._id || 'mock-menu-item-id'; };
  MenuItem.findOne = (...a) => mockMenuItemFindOne(...a);
  return MenuItem;
});

jest.mock('../src/models/DiningSession', () => {
  const DiningSession = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-session-id';
    this.save = jest.fn().mockResolvedValue(true);
    this.addActivity = jest.fn();
  };
  DiningSession.findById = (...a) => mockDiningSessionFindById(...a);
  return DiningSession;
});

jest.mock('../src/services/socketService', () => ({
  emitNewOrder: (...a) => mockSocketEmitNewOrder(...a),
  emitStatusUpdate: (...a) => mockSocketEmitStatusUpdate(...a),
  emitSessionActivity: (...a) => mockSocketEmitSessionActivity(...a),
  emitBillUpdated: (...a) => mockSocketEmitBillUpdated(...a),
  emitItemCancelled: (...a) => mockSocketEmitItemCancelled(...a),
  emitOrderCreatedSession: (...a) => mockSocketEmitOrderCreatedSession(...a),
}));

jest.mock('../src/utils/resolveGuestToken', () => (...a) => mockResolveGuestToken(...a));

// ─── Load controller ONCE ───────────────────────────────────────
const Order = require('../src/models/Order');
const { createOrder, updateOrderStatus, cancelOrderItem, getOrders, getOrder } = require('../src/controllers/orderController');

afterEach(() => { jest.clearAllMocks(); });

// ─── Helpers ────────────────────────────────────────────────────
const cafeId = 'cafe-001';
const tableId = 'table-001';
const sessionId = 'session-001';
const menuItemId = 'menu-001';
const orderId = 'order-001';
const guestToken = 'valid-guest-token-123';

function makeMockTable(overrides = {}) {
  return { _id: tableId, cafeId, tableNumber: 1, isActive: true, ...overrides };
}

function makeMockMenuItem(overrides = {}) {
  return { _id: menuItemId, cafeId, name: 'Espresso', price: 120, gstPercentage: 5, isAvailable: true, ...overrides };
}

function makeMockSession(overrides = {}) {
  return {
    _id: sessionId, cafeId, tableId, guestToken, status: 'active',
    participants: [{ participantId: 'p1', name: 'Alice', role: 'owner', status: 'active' }],
    addActivity: jest.fn(), save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeMockOrderData(overrides = {}) {
  return {
    _id: orderId, cafeId, tableId, sessionId,
    orderNumber: 'ORD-20260719-0001',
    items: [{ _id: 'item-001', menuItemId, itemName: 'Espresso', quantity: 2, price: 120, gstPercentage: 5, gstAmount: 12, status: 'pending' }],
    subtotal: 240, totalGST: 12, serviceCharge: 0, totalAmount: 252,
    taxBreakdown: [{ percentage: 5, amount: 12 }],
    status: 'pending', notes: 'Extra hot',
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function createOrderInstance(data) {
  return new Order(data);
}

// ─── createOrder ────────────────────────────────────────────────
describe('Order — createOrder', () => {
  const validBody = { tableId, sessionId, items: [{ menuItemId, quantity: 2 }], notes: 'Extra hot' };

  beforeEach(() => {
    mockResolveGuestToken.mockReturnValue(guestToken);
  });

  it('should create an order successfully', async () => {
    const req = mockReq({ body: validBody, cookies: { guest_token: guestToken } });
    const res = mockRes();
    const next = mockNext();

    mockTableFindById.mockResolvedValue(makeMockTable());
    mockMenuItemFindOne.mockResolvedValue(makeMockMenuItem());
    mockDiningSessionFindById.mockResolvedValue(makeMockSession());
    mockOrderCountDocuments.mockResolvedValue(0);
    mockOrderCreate.mockResolvedValue(createOrderInstance(makeMockOrderData()));
    mockOrderFindById.mockReturnValue({ populate: jest.fn().mockResolvedValue(createOrderInstance(makeMockOrderData())) });

    await createOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Order placed successfully' }));
    expect(mockSocketEmitNewOrder).toHaveBeenCalled();
  });

  it('should return 404 if table not found', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();
    mockTableFindById.mockResolvedValue(null);

    await createOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Table not found', statusCode: 404 }));
  });

  it('should return 400 if table is inactive', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();
    mockTableFindById.mockResolvedValue(makeMockTable({ isActive: false }));

    await createOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Table is currently disabled/inactive', statusCode: 400 }));
  });

  it('should return 404 if menu item not found', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();
    mockTableFindById.mockResolvedValue(makeMockTable());
    mockMenuItemFindOne.mockResolvedValue(null);

    await createOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('should return 400 if menu item is unavailable', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();
    mockTableFindById.mockResolvedValue(makeMockTable());
    mockMenuItemFindOne.mockResolvedValue(makeMockMenuItem({ isAvailable: false }));

    await createOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should return 404 if session not found', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();
    mockTableFindById.mockResolvedValue(makeMockTable());
    mockMenuItemFindOne.mockResolvedValue(makeMockMenuItem());
    mockDiningSessionFindById.mockResolvedValue(null);

    await createOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Dining session not found', statusCode: 404 }));
  });

  it('should return 403 if session is settling bill', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();
    mockTableFindById.mockResolvedValue(makeMockTable());
    mockMenuItemFindOne.mockResolvedValue(makeMockMenuItem());
    mockDiningSessionFindById.mockResolvedValue(makeMockSession({ status: 'bill_requested' }));

    await createOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('should return 403 if guest token is invalid', async () => {
    const req = mockReq({ body: validBody, cookies: {} });
    const res = mockRes();
    const next = mockNext();
    mockResolveGuestToken.mockReturnValue(null);
    mockTableFindById.mockResolvedValue(makeMockTable());
    mockMenuItemFindOne.mockResolvedValue(makeMockMenuItem());
    mockDiningSessionFindById.mockResolvedValue(makeMockSession());

    await createOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('should return existing order for duplicate clientRequestId (idempotency)', async () => {
    const req = mockReq({ body: { ...validBody, clientRequestId: 'req-123' } });
    const res = mockRes();
    const next = mockNext();
    // Controller calls Order.findOne({ clientRequestId }).populate('tableId', 'tableNumber')
    // so mock must return a chainable object
    const existingOrder = createOrderInstance(makeMockOrderData());
    mockOrderFindOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(existingOrder) });

    await createOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Order placed successfully (recovered)' }));
    expect(mockOrderCreate).not.toHaveBeenCalled();
  });

  it('should calculate correct totals with GST', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();
    mockTableFindById.mockResolvedValue(makeMockTable());
    mockMenuItemFindOne.mockResolvedValue(makeMockMenuItem({ price: 100, gstPercentage: 18 }));
    mockDiningSessionFindById.mockResolvedValue(makeMockSession());
    mockOrderCountDocuments.mockResolvedValue(0);

    let capturedData;
    mockOrderCreate.mockImplementation((data) => { capturedData = data; return Promise.resolve(createOrderInstance(data)); });
    mockOrderFindById.mockReturnValue({ populate: jest.fn().mockResolvedValue(createOrderInstance(makeMockOrderData())) });

    await createOrder(req, res, next);

    expect(capturedData.subtotal).toBe(200);
    expect(capturedData.totalGST).toBe(36);
    expect(capturedData.totalAmount).toBe(236);
  });

  it('should return 400 if no session is provided', async () => {
    const req = mockReq({ body: { tableId, items: [{ menuItemId, quantity: 1 }] } });
    const res = mockRes();
    const next = mockNext();
    mockTableFindById.mockResolvedValue(makeMockTable());

    await createOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'A valid dining session is required to place an order', statusCode: 400 }));
  });
});

// ─── updateOrderStatus ──────────────────────────────────────────
describe('Order — updateOrderStatus', () => {
  function setupOrderForUpdate(overrides = {}) {
    const order = createOrderInstance(makeMockOrderData(overrides));
    mockOrderFindOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(order) });
    return order;
  }

  it('should update order status to accepted', async () => {
    const order = setupOrderForUpdate();
    const req = mockReq({ params: { id: orderId }, body: { status: 'accepted' }, cafeId });
    const res = mockRes();
    const next = mockNext();

    await updateOrderStatus(req, res, next);

    expect(order.status).toBe('accepted');
    expect(order.acceptedAt).toBeDefined();
    expect(order.save).toHaveBeenCalled();
    expect(mockSocketEmitStatusUpdate).toHaveBeenCalled();
  });

  it('should update order status to served', async () => {
    const order = setupOrderForUpdate();
    const req = mockReq({ params: { id: orderId }, body: { status: 'served' }, cafeId });
    const res = mockRes();
    const next = mockNext();

    await updateOrderStatus(req, res, next);

    expect(order.status).toBe('served');
    expect(order.servedAt).toBeDefined();
  });

  it('should return 400 for invalid status value', async () => {
    const req = mockReq({ params: { id: orderId }, body: { status: 'invalid_status' }, cafeId });
    const res = mockRes();
    const next = mockNext();

    await updateOrderStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid order status value', statusCode: 400 }));
  });

  it('should return 404 if order not found', async () => {
    const req = mockReq({ params: { id: 'nonexistent' }, body: { status: 'accepted' }, cafeId });
    const res = mockRes();
    const next = mockNext();
    mockOrderFindOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });

    await updateOrderStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Order not found', statusCode: 404 }));
  });

  it('should set cancellation details when cancelling', async () => {
    const order = setupOrderForUpdate();
    const req = mockReq({ params: { id: orderId }, body: { status: 'cancelled', cancellationReason: 'Out of stock', cancelledBy: 'Chef Mike' }, cafeId, user: { name: 'Chef Mike' } });
    const res = mockRes();
    const next = mockNext();

    await updateOrderStatus(req, res, next);

    expect(order.status).toBe('cancelled');
    expect(order.cancellationReason).toBe('Out of stock');
    expect(order.cancelledBy).toBe('Chef Mike');
    expect(order.cancelledAt).toBeDefined();
  });

  it('should sync non-cancelled items status with order status', async () => {
    const order = setupOrderForUpdate();
    order.items[0].status = 'preparing';
    const req = mockReq({ params: { id: orderId }, body: { status: 'ready' }, cafeId });
    const res = mockRes();
    const next = mockNext();

    await updateOrderStatus(req, res, next);

    expect(order.items[0].status).toBe('ready');
  });
});

// ─── cancelOrderItem ────────────────────────────────────────────
describe('Order — cancelOrderItem', () => {
  function setupOrderForCancel(extraItems = []) {
    const items = [
      { _id: 'item-001', menuItemId, itemName: 'Espresso', quantity: 2, price: 120, gstAmount: 12, status: 'pending' },
      ...extraItems,
    ];
    const order = createOrderInstance(makeMockOrderData({ items }));
    mockOrderFindOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(order) });
    return order;
  }

  it('should cancel a specific order item', async () => {
    const order = setupOrderForCancel();
    const req = mockReq({ params: { id: orderId, itemId: 'item-001' }, body: { cancellationReason: 'Sold out' }, cafeId });
    const res = mockRes();
    const next = mockNext();
    mockDiningSessionFindById.mockResolvedValue(null);

    await cancelOrderItem(req, res, next);

    expect(order.items[0].status).toBe('cancelled');
    expect(order.save).toHaveBeenCalled();
  });

  it('should set order to partially_cancelled when one item cancelled', async () => {
    const order = setupOrderForCancel([{ _id: 'item-002', menuItemId: 'menu-002', itemName: 'Latte', quantity: 1, price: 150, gstAmount: 7.5, status: 'pending' }]);
    const req = mockReq({ params: { id: orderId, itemId: 'item-001' }, body: {}, cafeId });
    const res = mockRes();
    const next = mockNext();
    mockDiningSessionFindById.mockResolvedValue(null);

    await cancelOrderItem(req, res, next);

    expect(order.status).toBe('partially_cancelled');
  });

  it('should set order to cancelled when all items are cancelled', async () => {
    const order = setupOrderForCancel();
    const req = mockReq({ params: { id: orderId, itemId: 'item-001' }, body: {}, cafeId });
    const res = mockRes();
    const next = mockNext();
    mockDiningSessionFindById.mockResolvedValue(null);

    await cancelOrderItem(req, res, next);

    expect(order.status).toBe('cancelled');
  });

  it('should return 404 if order not found', async () => {
    const req = mockReq({ params: { id: 'nonexistent', itemId: 'item-001' }, cafeId });
    const res = mockRes();
    const next = mockNext();
    mockOrderFindOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });

    await cancelOrderItem(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Order not found', statusCode: 404 }));
  });

  it('should return 400 if item is already cancelled', async () => {
    const order = createOrderInstance(makeMockOrderData({
      items: [{ _id: 'item-001', menuItemId, itemName: 'Espresso', quantity: 2, price: 120, gstAmount: 12, status: 'cancelled' }],
    }));
    mockOrderFindOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(order) });
    const req = mockReq({ params: { id: orderId, itemId: 'item-001' }, cafeId });
    const res = mockRes();
    const next = mockNext();

    await cancelOrderItem(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Item is already cancelled', statusCode: 400 }));
  });

  it('should recalculate totals after item cancellation', async () => {
    const order = setupOrderForCancel([{ _id: 'item-002', menuItemId: 'menu-002', itemName: 'Latte', quantity: 1, price: 150, gstAmount: 7.5, status: 'pending' }]);
    const req = mockReq({ params: { id: orderId, itemId: 'item-001' }, cafeId });
    const res = mockRes();
    const next = mockNext();
    mockDiningSessionFindById.mockResolvedValue(null);

    await cancelOrderItem(req, res, next);

    expect(order.subtotal).toBe(150);
    expect(order.totalGST).toBe(7.5);
  });
});

// ─── getOrders ──────────────────────────────────────────────────
describe('Order — getOrders', () => {
  it('should return paginated orders for the cafe', async () => {
    const req = mockReq({ cafeId, query: { page: 1, limit: 10 } });
    const res = mockRes();
    const next = mockNext();

    const limitFn = jest.fn().mockResolvedValue([makeMockOrderData()]);
    const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
    const populateFn = jest.fn().mockReturnValue({ skip: skipFn });
    const sortFn = jest.fn().mockReturnValue({ populate: populateFn });
    mockOrderFind.mockReturnValue({ sort: sortFn });
    mockOrderCountDocuments.mockResolvedValue(1);

    await getOrders(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ totalCount: 1, orders: expect.any(Array) }));
  });
});

// ─── getOrder ───────────────────────────────────────────────────
describe('Order — getOrder', () => {
  it('should return a single order by id', async () => {
    const order = createOrderInstance(makeMockOrderData());
    const req = mockReq({ params: { id: orderId }, cafeId });
    const res = mockRes();
    const next = mockNext();
    mockOrderFindOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(order) });

    await getOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ order });
  });

  it('should return 404 if order not found', async () => {
    const req = mockReq({ params: { id: 'nonexistent' }, cafeId });
    const res = mockRes();
    const next = mockNext();
    mockOrderFindOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });

    await getOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Order not found', statusCode: 404 }));
  });
});

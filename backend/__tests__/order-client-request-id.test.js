/**
 * ISSUE-34 — a sparse unique index defeated by an explicit `null`.
 *
 * `Order.clientRequestId` is declared `unique: true, sparse: true`. The intent
 * is clear: orders created without a client request id should not collide with
 * each other. A sparse index only skips documents where the field is *absent*,
 * though — and `createOrder` wrote `clientRequestId: clientRequestId || null`.
 *
 * That made the field present-and-null on every order created without an id, so
 * the second such order hit `E11000 duplicate key error ... clientRequestId_1`
 * and the whole insert failed. Any caller that omits the id — the waiter flow,
 * and the new atomic POS checkout — could only ever place one order per process
 * lifetime before the till started erroring.
 *
 * The fix is to omit the field, not to change the index: changing an index
 * would need a drop-and-rebuild on every deployed database.
 */

// Metered order quota needs a real Mongo reservation; this file asserts the
// shape of the written order with mocked models. See the helper for why.
jest.mock('../src/services/entitlementService', () =>
  require('./helpers/entitlementServicePassthrough')
);

const orderService = require('../src/services/orderService');
const Order = require('../src/models/Order');

const CAFE_ID = '507f1f77bcf86cd799439011';
const MENU_ITEM_ID = '507f1f77bcf86cd799439012';

const lineItem = (overrides = {}) => ({
  menuItemId: MENU_ITEM_ID,
  name: 'Espresso',
  price: 100,
  quantity: 1,
  gstPercentage: 5,
  gstAmount: 5,
  status: 'pending',
  ...overrides,
});

describe('ISSUE-34 — clientRequestId must be omitted, never null', () => {
  let createSpy;
  let findByIdSpy;

  beforeEach(() => {
    createSpy = jest.spyOn(Order, 'create').mockImplementation(async (doc) => ({
      _id: 'new-order-id',
      ...doc,
    }));
    findByIdSpy = jest.spyOn(Order, 'findById').mockReturnValue({
      populate: jest.fn().mockResolvedValue({ _id: 'new-order-id' }),
    });
    // The idempotency probe and the daily order-number sequence both go
    // through the model; neither should touch a real connection here.
    jest.spyOn(Order, 'exists').mockResolvedValue(null);
    jest.spyOn(Order, 'findOne').mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
      select: jest.fn().mockResolvedValue(null),
    });
    jest.spyOn(Order, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(require('../src/models/MenuItem'), 'findOne').mockResolvedValue({
      _id: MENU_ITEM_ID,
      name: 'Espresso',
      price: 100,
      gstPercentage: 5,
      cafeId: CAFE_ID,
      isAvailable: true,
      variants: [],
      modifierGroups: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not write the field when no client request id is supplied', async () => {
    await orderService.createOrder({
      cafeId: CAFE_ID,
      orderType: 'takeaway',
      channel: 'pos',
      items: [lineItem()],
      enforceGeofence: false,
      emit: false,
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const doc = createSpy.mock.calls[0][0];
    // Present-and-null is exactly what broke the sparse index.
    expect('clientRequestId' in doc).toBe(false);
  });

  it('writes the field when one is supplied', async () => {
    await orderService.createOrder({
      cafeId: CAFE_ID,
      orderType: 'takeaway',
      channel: 'pos',
      items: [lineItem()],
      clientRequestId: 'pos-abc123',
      enforceGeofence: false,
      emit: false,
    });

    expect(createSpy.mock.calls[0][0].clientRequestId).toBe('pos-abc123');
  });

  it('creates a POS order settled rather than as a pending kitchen ticket', async () => {
    await orderService.createOrder({
      cafeId: CAFE_ID,
      orderType: 'takeaway',
      channel: 'pos',
      items: [lineItem()],
      initialStatus: 'served',
      enforceGeofence: false,
      emit: false,
    });

    expect(createSpy.mock.calls[0][0].status).toBe('served');
  });

  it('defaults a QR order to pending', async () => {
    await orderService.createOrder({
      cafeId: CAFE_ID,
      orderType: 'dine_in',
      tableId: '507f191e810c19729de860ea',
      channel: 'qr',
      items: [lineItem()],
      enforceGeofence: false,
      emit: false,
    });

    expect(createSpy.mock.calls[0][0].status).toBe('pending');
  });
});

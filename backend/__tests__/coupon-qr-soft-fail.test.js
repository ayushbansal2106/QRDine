/**
 * Guest coupon handling at order creation.
 *
 * A guest typing an expired or mistyped code used to lose the entire order,
 * because `couponService.validate` threw before `Order.create`. QR orders now
 * downgrade that to a notice; the POS keeps failing hard so staff are told.
 */

// Metered order quota needs a real Mongo reservation; this file unit-tests the
// coupon soft-fail path with mocked models. See the helper for why.
jest.mock('../src/services/entitlementService', () =>
  require('./helpers/entitlementServicePassthrough')
);

const mockCouponFindOne = jest.fn();
const mockCouponUpdateOne = jest.fn();
const mockOrderCountDocuments = jest.fn();
const mockMenuItemFindOne = jest.fn();
const mockOrderCreate = jest.fn();
const mockOrderFindOne = jest.fn();
const mockOrderFindById = jest.fn();

jest.mock('../src/models/Coupon', () => ({
  findOne: (...a) => mockCouponFindOne(...a),
  updateOne: (...a) => mockCouponUpdateOne(...a),
}));

jest.mock('../src/models/Order', () => ({
  create: (...a) => mockOrderCreate(...a),
  findOne: (...a) => mockOrderFindOne(...a),
  findById: (...a) => mockOrderFindById(...a),
  countDocuments: (...a) => mockOrderCountDocuments(...a),
}));

jest.mock('../src/models/MenuItem', () => ({
  findOne: (...a) => mockMenuItemFindOne(...a),
}));

jest.mock('../src/services/geofenceService', () => ({
  verifyOrderLocation: jest.fn().mockResolvedValue({ decision: 'allow' }),
}));

jest.mock('../src/services/auditService', () => ({ recordEvent: jest.fn() }));

jest.mock('../src/services/socketService', () => ({
  emitNewOrder: jest.fn(),
  emitOrderCreatedSession: jest.fn(),
  emitGeofenceFlagged: jest.fn(),
  emitMetricsUpdated: jest.fn(),
}));

const orderService = require('../src/services/orderService');

const MENU_ITEM = {
  _id: 'item-1',
  name: 'Flat White',
  price: 200,
  gstPercentage: 5,
  isAvailable: true,
  categoryId: 'category-coffee',
  variants: [],
  modifierGroups: [],
};

const baseArgs = {
  cafeId: 'cafe-1',
  orderType: 'dine_in',
  channel: 'qr',
  tableId: 'table-1',
  items: [{ menuItemId: 'item-1', quantity: 1 }],
  emit: false,
  enforceGeofence: false,
};

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockMenuItemFindOne.mockResolvedValue(MENU_ITEM);
  mockOrderFindOne.mockResolvedValue(null);
  mockOrderCreate.mockImplementation(async (doc) => ({ _id: 'order-1', ...doc }));
  mockOrderFindById.mockReturnValue({
    populate: jest.fn().mockResolvedValue({ _id: 'order-1', items: [], discounts: [] }),
  });
  mockCouponUpdateOne.mockResolvedValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

// The returned order is re-fetched for population, so assert totals against the
// document that was actually persisted.
const persisted = () => mockOrderCreate.mock.calls[0][0];

describe('guest coupon failures never cost the customer their order', () => {
  it('still creates the order at full price when the code is unknown', async () => {
    mockCouponFindOne.mockResolvedValue(null);

    const result = await orderService.createOrder({
      ...baseArgs,
      couponCode: 'TYPO',
      couponStrict: false,
    });

    expect(mockOrderCreate).toHaveBeenCalledTimes(1);
    expect(result.couponNotice).toMatch(/invalid coupon/i);
    expect(result.couponApplied).toBeNull();
    expect(persisted().discountTotal).toBe(0);
    expect(persisted().totalAmount).toBe(210);
    // The counter is never consumed by a code that never applied.
    expect(mockCouponUpdateOne).not.toHaveBeenCalled();
  });

  it('reports an expired code as a notice instead of throwing', async () => {
    mockCouponFindOne.mockResolvedValue({
      code: 'OLD',
      isActive: false,
      type: 'percent',
      value: 10,
      maxDiscount: 0,
      minOrder: 0,
      usageCount: 0,
      usageLimit: 0,
      singleUse: false,
      perCustomerLimit: 0,
      validFrom: null,
      validTo: null,
      happyHour: { enabled: false },
      appliesTo: { scope: 'all' },
    });

    const result = await orderService.createOrder({
      ...baseArgs,
      couponCode: 'OLD',
      couponStrict: false,
    });

    expect(result.order._id).toBe('order-1');
    expect(result.couponNotice).toMatch(/no longer active/i);
  });

  it('applies a valid code and redeems it once', async () => {
    mockCouponFindOne.mockResolvedValue({
      code: 'SAVE10',
      description: '10% off',
      isActive: true,
      type: 'percent',
      value: 10,
      maxDiscount: 0,
      minOrder: 0,
      usageCount: 0,
      usageLimit: 0,
      singleUse: false,
      perCustomerLimit: 0,
      validFrom: null,
      validTo: null,
      happyHour: { enabled: false },
      appliesTo: { scope: 'all', itemIds: [], categoryIds: [] },
    });

    const result = await orderService.createOrder({
      ...baseArgs,
      couponCode: 'save10',
      couponStrict: false,
    });

    expect(result.couponNotice).toBeNull();
    expect(result.couponApplied.discount).toBe(20);
    expect(persisted().discountTotal).toBe(20);
    expect(persisted().discounts[0].couponCode).toBe('SAVE10');
    // 200 subtotal - 20 discount + 10 GST
    expect(persisted().totalAmount).toBe(190);
    expect(mockCouponUpdateOne).toHaveBeenCalledWith(
      { cafeId: 'cafe-1', code: 'SAVE10' },
      { $inc: { usageCount: 1 } }
    );
  });

  it('throws instead of degrading when the caller demands strictness (POS)', async () => {
    mockCouponFindOne.mockResolvedValue(null);

    await expect(
      orderService.createOrder({ ...baseArgs, channel: 'pos', couponCode: 'TYPO', couponStrict: true })
    ).rejects.toThrow(/invalid coupon/i);

    expect(mockOrderCreate).not.toHaveBeenCalled();
  });
});
/**
 * Regression guard — the stamp loop has to end in money the guest can spend.
 *
 * Stamps that crossed the threshold on a settled bill convert automatically;
 * `claimReward` covers the card that reached the threshold any other way (a
 * manager's adjustment, a programme switched on late). Either way the customer
 * ends up holding a code, and the only places that code can be spent are the
 * till and the table's own checkout — so the code has to work there, has to be
 * refused for anyone but its owner, and has to actually come off the bill.
 */
// Metered order quota needs a real Mongo reservation; this file unit-tests
// voucher redemption with mocked models. See the helper for why.
jest.mock('../src/services/entitlementService', () =>
  require('./helpers/entitlementServicePassthrough')
);

const mockProgramFindOne = jest.fn();
const mockCardFindOne = jest.fn();
const mockCardFindOneAndUpdate = jest.fn();
const mockCardCreate = jest.fn();

jest.mock('../src/models/LoyaltyProgram', () => ({
  findOne: (...a) => mockProgramFindOne(...a),
}));
jest.mock('../src/models/LoyaltyCard', () => {
  const LoyaltyCard = function (data) { Object.assign(this, data); };
  LoyaltyCard.findOne = (...a) => mockCardFindOne(...a);
  LoyaltyCard.findOneAndUpdate = (...a) => mockCardFindOneAndUpdate(...a);
  LoyaltyCard.create = (...a) => mockCardCreate(...a);
  return LoyaltyCard;
});
jest.mock('../src/services/auditService', () => ({ recordEvent: jest.fn() }));
jest.mock('../src/services/socketService', () => ({
  emitLoyaltyUpdated: jest.fn(),
  emitNewOrder: jest.fn(),
  emitOrderCreatedSession: jest.fn(),
  emitGeofenceFlagged: jest.fn(),
}));
jest.mock('../src/services/geofenceService', () => ({
  verifyOrderLocation: jest.fn(),
}));
jest.mock('../src/services/couponService', () => ({
  validate: jest.fn(),
  redeem: jest.fn(),
  toDiscount: jest.fn(),
}));

const mockOrderCreate = jest.fn();
const mockOrderFindById = jest.fn();
const mockMenuItemFindOne = jest.fn();

jest.mock('../src/models/Order', () => {
  const M = function (data) { Object.assign(this, data); };
  M.findOne = jest.fn().mockResolvedValue(null);
  M.countDocuments = jest.fn().mockResolvedValue(0);
  M.create = (...a) => mockOrderCreate(...a);
  M.findById = (...a) => mockOrderFindById(...a);
  return M;
});
jest.mock('../src/models/MenuItem', () => ({
  findOne: (...a) => mockMenuItemFindOne(...a),
}));

const LoyaltyProgram = require('../src/models/LoyaltyProgram');
const LoyaltyCard = require('../src/models/LoyaltyCard');
const auditService = require('../src/services/auditService');
const socketService = require('../src/services/socketService');
const geofenceService = require('../src/services/geofenceService');
const loyaltyService = require('../src/services/loyaltyService');
const orderService = require('../src/services/orderService');
const { AppError } = require('../src/utils/AppError');

const cafeId = '507f1f77bcf86cd799439011';
const customerId = '6ac0cabe7eb012096052d970';
const otherCustomerId = '6ac0d41df4b36a73abbabaee';

const program = {
  _id: 'program-1',
  cafeId,
  name: 'Loyalty Card',
  isActive: true,
  stampsRequired: 5,
  stampsPerOrder: 1,
  minSpend: 249,
  qualifyingScope: 'all',
  voucherValidDays: 30,
  reward: { type: 'flat_off', value: 150, label: 'Free dessert', menuItemId: null },
};

const makeCard = (overrides = {}) => ({
  _id: 'card-1',
  cafeId,
  customerId,
  stamps: 0,
  lifetimeStamps: 0,
  vouchers: [],
  history: [],
  save: jest.fn().mockResolvedValue(undefined),
  addHistory(entry) { this.history.push(entry); },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  auditService.recordEvent.mockResolvedValue(undefined);
  geofenceService.verifyOrderLocation.mockResolvedValue({ decision: 'allow' });
  mockMenuItemFindOne.mockResolvedValue({
    _id: 'item-1',
    cafeId,
    name: 'Curd Rice',
    price: 500,
    gstPercentage: 5,
    isAvailable: true,
    prepStation: 'kitchen',
  });
  // The created document is what `findById` hands back, so the assertions read
  // the same numbers the caller would. It is returned directly rather than as a
  // promise: the engine chains `.populate()` on the result, exactly as it does on
  // a mongoose query.
  let created = null;
  mockOrderCreate.mockImplementation(async (data) => {
    created = { _id: 'order-1', ...data };
    return created;
  });
  mockOrderFindById.mockImplementation(() => {
    const doc = { ...created };
    doc.populate = () => doc;
    return doc;
  });
  LoyaltyProgram.findOne = mockProgramFindOne;
  LoyaltyCard.findOne = mockCardFindOne;
  LoyaltyCard.findOneAndUpdate = mockCardFindOneAndUpdate;
  LoyaltyCard.create = mockCardCreate;
  mockProgramFindOne.mockResolvedValue(program);
});

describe('claimReward', () => {
  it('turns a full card into one voucher and spends the stamps', async () => {
    const card = makeCard({ stamps: 5, lifetimeStamps: 9 });
    mockCardFindOne.mockResolvedValue(card);
    mockCardFindOneAndUpdate.mockImplementation(async (_filter, update) =>
      makeCard({ stamps: card.stamps + update.$inc.stamps, lifetimeStamps: 9 })
    );

    const result = await loyaltyService.claimReward({ cafeId, customerId });

    expect(result.voucher.code).toMatch(/^RWD-[0-9A-F]{6}$/);
    expect(result.voucher.status).toBe('active');
    expect(result.card.stamps).toBe(0);
    expect(mockCardFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'card-1', stamps: { $gte: 5 } },
      { $inc: { stamps: -5 }, $set: { programId: program._id } },
      { new: true }
    );
  });

  it('refuses a card that is not full, and names the shortfall', async () => {
    mockCardFindOne.mockResolvedValue(makeCard({ stamps: 3 }));
    mockCardFindOneAndUpdate.mockResolvedValue(null);

    await expect(loyaltyService.claimReward({ cafeId, customerId })).rejects.toThrow(
      'You need 2 more stamps'
    );
    expect(auditService.recordEvent).not.toHaveBeenCalled();
  });

  it('refuses when the programme is switched off', async () => {
    mockProgramFindOne.mockResolvedValue({ ...program, isActive: false });

    await expect(loyaltyService.claimReward({ cafeId, customerId })).rejects.toThrow(
      AppError
    );
    expect(mockCardFindOne).not.toHaveBeenCalled();
  });

  it('claims against a conditional update, so a double tap cannot mint twice', async () => {
    // First tap succeeds, second finds the balance already spent.
    let balance = 5;
    mockCardFindOne.mockImplementation(async () => makeCard({ stamps: balance }));
    mockCardFindOneAndUpdate.mockImplementation(async (filter) => {
      if (balance < filter.stamps.$gte) return null;
      balance -= filter.stamps.$gte;
      return makeCard({ stamps: balance });
    });

    const first = await loyaltyService.claimReward({ cafeId, customerId });
    expect(first.voucher.code).toBeTruthy();

    await expect(loyaltyService.claimReward({ cafeId, customerId })).rejects.toThrow(
      'You need 5 more stamps'
    );
  });
});

/**
 * A voucher factory, not a constant.
 *
 * `redeemVoucher` marks the voucher it consumes as `redeemed` *on the object it
 * was given*. A shared fixture would therefore hand the next test an already
 * spent voucher and fail it for the wrong reason.
 */
const makeVoucher = (overrides = {}) => ({
  code: 'RWD-AAA111',
  label: 'Free dessert',
  type: 'flat_off',
  value: 150,
  status: 'active',
  expiresAt: new Date(Date.now() + 86400000),
  ...overrides,
});

describe('validateVoucherForCustomer', () => {
  const voucher = makeVoucher();

  it('accepts the guest the voucher was issued to', async () => {
    mockCardFindOne.mockResolvedValue(makeCard({ vouchers: [voucher] }));

    const result = await loyaltyService.validateVoucherForCustomer(cafeId, voucher.code, customerId);

    expect(result.code).toBe('RWD-AAA111');
  });

  it('refuses a code that belongs to somebody else', async () => {
    mockCardFindOne.mockResolvedValue(makeCard({ vouchers: [voucher] }));

    await expect(
      loyaltyService.validateVoucherForCustomer(cafeId, voucher.code, otherCustomerId)
    ).rejects.toThrow('belongs to a different customer');
  });

  it('refuses an unsigned-in guest, who cannot prove the card is theirs', async () => {
    mockCardFindOne.mockResolvedValue(makeCard({ vouchers: [voucher] }));

    await expect(
      loyaltyService.validateVoucherForCustomer(cafeId, voucher.code, null)
    ).rejects.toThrow('Sign in with your phone number');
  });

  it('refuses an expired voucher', async () => {
    mockCardFindOne.mockResolvedValue(
      makeCard({ vouchers: [makeVoucher({ expiresAt: new Date(Date.now() - 1000) })] })
    );

    await expect(
      loyaltyService.validateVoucherForCustomer(cafeId, voucher.code, customerId)
    ).rejects.toThrow('expired');
  });
});

describe('orderService — spending a voucher on a table order', () => {
  beforeEach(() => {
    mockCardFindOne.mockResolvedValue(makeCard({ vouchers: [makeVoucher()] }));
  });

  it('takes the reward off the order and spends the voucher against it', async () => {
    const result = await orderService.createOrder({
      cafeId,
      orderType: 'dine_in',
      channel: 'qr',
      tableId: 'table-1',
      customerId,
      items: [{ menuItemId: 'item-1', quantity: 1 }],
      voucherCode: 'rwd-aaa111',
      enforceGeofence: true,
    });

    // 500 less the 150 voucher, plus 5% GST on the pre-discount value.
    expect(result.order.totalAmount).toBeCloseTo(375, 2);
    expect(result.voucherApplied.code).toBe('RWD-AAA111');
    expect(result.order.discountTotal).toBe(150);
    // …and the bill cannot then charge the guest the undiscounted 500.
    expect(orderService.sumBillableItems([result.order]).subtotal).toBe(350);
  });

  it('places the order at full price when the code is not the guest\'s', async () => {
    const result = await orderService.createOrder({
      cafeId,
      orderType: 'dine_in',
      channel: 'qr',
      tableId: 'table-1',
      customerId: otherCustomerId,
      items: [{ menuItemId: 'item-1', quantity: 1 }],
      voucherCode: 'RWD-AAA111',
      enforceGeofence: true,
    });

    expect(result.voucherApplied).toBeNull();
    expect(result.voucherNotice).toMatch(/different customer/);
    expect(result.order.totalAmount).toBeCloseTo(525, 2);
  });

  it('fails loudly for staff, who must hear about a bad code immediately', async () => {
    mockCardFindOne.mockResolvedValue(makeCard({ vouchers: [] }));

    await expect(
      orderService.createOrder({
        cafeId,
        orderType: 'dine_in',
        channel: 'qr',
        tableId: 'table-1',
        customerId,
        items: [{ menuItemId: 'item-1', quantity: 1 }],
        voucherCode: 'RWD-NOPE00',
        couponStrict: true,
        enforceGeofence: true,
      })
    ).rejects.toThrow('Voucher not found');
  });

  it('honours a percentage voucher as a percentage, not as rupees', async () => {
    mockCardFindOne.mockResolvedValue(
      makeCard({ vouchers: [makeVoucher({ type: 'percent_off', value: 10 })] })
    );

    const result = await orderService.createOrder({
      cafeId,
      orderType: 'dine_in',
      channel: 'qr',
      tableId: 'table-1',
      customerId,
      items: [{ menuItemId: 'item-1', quantity: 1 }],
      voucherCode: 'RWD-AAA111',
      enforceGeofence: true,
    });

    expect(result.order.discountTotal).toBe(50); // 10% of 500
  });
});

describe('sumBillableItems — a discount is not charged twice', () => {
  it('subtracts what the order already discounted', () => {
    const { sumBillableItems } = require('../src/services/orderService');
    const orders = [
      {
        status: 'pending',
        discountTotal: 150,
        items: [{ price: 500, quantity: 1, gstAmount: 25, status: 'pending' }],
      },
    ];

    expect(sumBillableItems(orders)).toEqual({ subtotal: 350, gst: 25 });
  });

  it('never returns a negative subtotal for a fully discounted order', () => {
    const { sumBillableItems } = require('../src/services/orderService');
    const orders = [
      {
        status: 'pending',
        discountTotal: 900,
        items: [{ price: 500, quantity: 1, gstAmount: 25, status: 'pending' }],
      },
    ];

    expect(sumBillableItems(orders).subtotal).toBe(0);
  });
});
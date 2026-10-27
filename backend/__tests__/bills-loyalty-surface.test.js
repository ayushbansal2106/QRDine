/**
 * Regression guard — the till can see the guest's loyalty card.
 *
 * A stamp is awarded when a bill settles, and a voucher sitting on the card is
 * a discount the cafe has already promised. The cashier therefore needs both on
 * the bills board and in the session detail — including *only* vouchers that can
 * still be honoured, since an expired one on screen is an offer that cannot be
 * honoured.
 */
jest.mock('../src/models/DiningSession', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock('../src/models/Order', () => ({ find: jest.fn() }));
jest.mock('../src/models/DailySummary', () => ({ find: jest.fn() }));
jest.mock('../src/models/Invoice', () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../src/models/LoyaltyCard', () => ({ find: jest.fn() }));

const program = {
  _id: 'program-1',
  name: 'Loyalty Card',
  stampsRequired: 5,
  stampsPerOrder: 1,
  isActive: true,
};
jest.mock('../src/services/loyaltyService', () => ({
  getProgram: jest.fn(),
}));

const DiningSession = require('../src/models/DiningSession');
const Order = require('../src/models/Order');
const LoyaltyCard = require('../src/models/LoyaltyCard');
const loyaltyService = require('../src/services/loyaltyService');
const { mockReq, mockRes, mockNext } = require('./setup');
const { getBills, getBillDetail } = require('../src/controllers/billingController');

const cafeId = '507f1f77bcf86cd799439011';
const customerId = '6ac0cabe7eb012096052d970';

const card = {
  customerId,
  stamps: 3,
  lifetimeStamps: 8,
  vouchers: [
    { code: 'RWD-AAA111', label: 'Free dessert', type: 'fixed', value: 150, status: 'active' },
    { code: 'RWD-BBB222', label: '10% off', type: 'percent', value: 10, status: 'expired' },
    { code: 'RWD-CCC333', label: 'Used up', type: 'fixed', value: 100, status: 'redeemed' },
  ],
};

const order = {
  _id: 'order-1',
  orderNumber: 'ORD-1',
  status: 'pending',
  totalAmount: 142.76,
  customerId,
  items: [{ itemName: 'Curd Rice', price: 120, quantity: 1, gstAmount: 22.76, status: 'pending' }],
};

const session = {
  _id: 'session-1',
  cafeId,
  tableId: 'table-1',
  status: 'awaiting_payment',
  customerName: 'Ayush',
  startedAt: new Date(),
  adjustments: [],
  paymentMethod: 'pending',
  toObject() {
    return { _id: this._id, status: this.status, customerName: this.customerName };
  },
};

// A chainable query stub — the controller calls `.sort()` and `.populate()`.
const chainable = (result) => {
  const q = {
    sort: jest.fn(() => q),
    populate: jest.fn(() => q),
    select: jest.fn(() => q),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return q;
};

beforeEach(() => {
  jest.clearAllMocks();
  loyaltyService.getProgram.mockResolvedValue(program);
  LoyaltyCard.find.mockReturnValue(chainable([card]));
  Order.find.mockReturnValue(chainable([order]));
  DiningSession.find.mockReturnValue(chainable([session]));
});

describe('getBills — loyalty on the board', () => {
  it('carries the guest\'s stamp progress on the row', async () => {
    const req = mockReq({ cafeId });
    const res = mockRes();

    await getBills(req, res, mockNext());

    const [bill] = res._jsonData.bills;
    expect(bill.loyalty.stamps).toBe(3);
    expect(bill.loyalty.stampsRequired).toBe(5);
    expect(bill.loyalty.stampsToReward).toBe(2);
    expect(bill.loyalty.programName).toBe('Loyalty Card');
  });

  it('lists only vouchers that can still be spent', async () => {
    const req = mockReq({ cafeId });
    const res = mockRes();

    await getBills(req, res, mockNext());

    const [bill] = res._jsonData.bills;
    expect(bill.loyalty.vouchers).toHaveLength(1);
    expect(bill.loyalty.vouchers[0].code).toBe('RWD-AAA111');
  });

  it('says nothing about loyalty on a table with no signed-in guest', async () => {
    Order.find.mockReturnValue(chainable([{ ...order, customerId: null }]));
    const req = mockReq({ cafeId });
    const res = mockRes();

    await getBills(req, res, mockNext());

    const [bill] = res._jsonData.bills;
    expect(bill.loyalty).toBeNull();
    // No signed-in guest means no profile to look up — the board must not
    // query a card that cannot exist.
    expect(LoyaltyCard.find).not.toHaveBeenCalled();
  });

  it('scopes the card lookup to this cafe and the guests on the board', async () => {
    const req = mockReq({ cafeId });
    const res = mockRes();

    await getBills(req, res, mockNext());

    expect(LoyaltyCard.find).toHaveBeenCalledWith({
      cafeId,
      customerId: { $in: [customerId] },
    });
  });
});

describe('getBillDetail — session detail', () => {
  it('returns the orders, the payable total and the loyalty card together', async () => {
    DiningSession.findOne.mockReturnValue(chainable(session));
    const req = mockReq({ cafeId, params: { id: 'session-1' } });
    const res = mockRes();

    await getBillDetail(req, res, mockNext());

    const { bill } = res._jsonData;
    expect(bill.orders).toHaveLength(1);
    expect(bill.subtotal).toBe(120);
    expect(bill.gst).toBe(22.76);
    expect(bill.totalAmount).toBe(142.76);
    expect(bill.loyalty.stamps).toBe(3);
    expect(bill.loyalty.vouchers).toHaveLength(1);
  });

  it('will not show another cafe\'s table', async () => {
    DiningSession.findOne.mockReturnValue(chainable(null));
    const req = mockReq({ cafeId, params: { id: 'session-1' } });
    const res = mockRes();
    const next = mockNext();

    await getBillDetail(req, res, next);

    expect(DiningSession.findOne).toHaveBeenCalledWith({
      _id: 'session-1',
      cafeId,
    });
    expect(res._jsonData).toBeNull();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});
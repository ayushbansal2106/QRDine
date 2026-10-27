/**
 * Coupon applicability (Module #14).
 *
 * Covers the gap where `appliesTo.scope` was stored by the admin API but never
 * read at validation time, so an item/category-scoped coupon discounted the
 * whole bill, and where a bad guest code aborted the entire QR order.
 */

const mockCouponFindOne = jest.fn();
const mockCouponUpdateOne = jest.fn();
const mockOrderCountDocuments = jest.fn();

jest.mock('../src/models/Coupon', () => ({
  findOne: (...a) => mockCouponFindOne(...a),
  updateOne: (...a) => mockCouponUpdateOne(...a),
}));

jest.mock('../src/models/Order', () => ({
  countDocuments: (...a) => mockOrderCountDocuments(...a),
}));

const couponService = require('../src/services/couponService');

const COFFEE = 'category-coffee';
const PASTRY = 'category-pastry';

const line = (overrides) => ({
  menuItemId: 'item-1',
  categoryId: COFFEE,
  price: 200,
  quantity: 1,
  ...overrides,
});

const coupon = (overrides = {}) => ({
  _id: 'coupon-1',
  code: 'COFFEE20',
  description: '20% off coffee',
  isActive: true,
  type: 'percent',
  value: 20,
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
  ...overrides,
});

afterEach(() => jest.clearAllMocks());

describe('appliesTo.scope is honoured', () => {
  it('discounts the whole subtotal when scope is "all"', async () => {
    mockCouponFindOne.mockResolvedValue(coupon({ code: 'ALL10', value: 10 }));

    const result = await couponService.validate({
      cafeId: 'cafe-1',
      code: 'ALL10',
      subtotal: 500,
      items: [line(), line({ menuItemId: 'item-2', categoryId: PASTRY })],
    });

    expect(result.eligibleSubtotal).toBe(500);
    expect(result.discount).toBe(50);
  });

  it('discounts only the eligible lines for a category scope', async () => {
    mockCouponFindOne.mockResolvedValue(
      coupon({ appliesTo: { scope: 'categories', itemIds: [], categoryIds: [COFFEE] } })
    );

    const result = await couponService.validate({
      cafeId: 'cafe-1',
      code: 'COFFEE20',
      subtotal: 500,
      items: [
        line({ price: 200, quantity: 1 }),
        line({ menuItemId: 'item-2', categoryId: PASTRY, price: 300, quantity: 1 }),
      ],
    });

    // 20% of the ₹200 coffee line only — not of the ₹500 basket.
    expect(result.eligibleSubtotal).toBe(200);
    expect(result.discount).toBe(40);
  });

  it('discounts only the matching lines for an item scope', async () => {
    mockCouponFindOne.mockResolvedValue(
      coupon({ appliesTo: { scope: 'items', itemIds: ['item-2'], categoryIds: [] } })
    );

    const result = await couponService.validate({
      cafeId: 'cafe-1',
      code: 'COFFEE20',
      subtotal: 500,
      items: [line({ price: 200 }), line({ menuItemId: 'item-2', categoryId: PASTRY, price: 300 })],
    });

    expect(result.eligibleSubtotal).toBe(300);
    expect(result.discount).toBe(60);
  });

  it('caps a flat coupon at the eligible subtotal, not the basket', async () => {
    mockCouponFindOne.mockResolvedValue(
      coupon({
        type: 'flat',
        value: 150,
        appliesTo: { scope: 'categories', itemIds: [], categoryIds: [COFFEE] },
      })
    );

    const result = await couponService.validate({
      cafeId: 'cafe-1',
      code: 'COFFEE20',
      subtotal: 900,
      items: [line({ price: 100 }), line({ menuItemId: 'item-2', categoryId: PASTRY, price: 800 })],
    });

    expect(result.discount).toBe(100);
  });

  it('respects maxDiscount on the eligible subtotal', async () => {
    mockCouponFindOne.mockResolvedValue(
      coupon({ maxDiscount: 25, appliesTo: { scope: 'categories', itemIds: [], categoryIds: [COFFEE] } })
    );

    const result = await couponService.validate({
      cafeId: 'cafe-1',
      code: 'COFFEE20',
      subtotal: 1000,
      items: [line({ price: 1000 })],
    });

    expect(result.discount).toBe(25);
  });

  it('rejects a scoped coupon when nothing in the order qualifies', async () => {
    mockCouponFindOne.mockResolvedValue(
      coupon({ appliesTo: { scope: 'categories', itemIds: [], categoryIds: [COFFEE] } })
    );

    await expect(
      couponService.validate({
        cafeId: 'cafe-1',
        code: 'COFFEE20',
        subtotal: 300,
        items: [line({ categoryId: PASTRY, price: 300 })],
      })
    ).rejects.toThrow(/does not apply/i);
  });

  it('refuses to guess a scope without the order lines', async () => {
    mockCouponFindOne.mockResolvedValue(
      coupon({ appliesTo: { scope: 'categories', itemIds: [], categoryIds: [COFFEE] } })
    );

    await expect(
      couponService.validate({ cafeId: 'cafe-1', code: 'COFFEE20', subtotal: 300 })
    ).rejects.toThrow(/selected items/i);
  });

  it('checks the minimum order against the basket, not the eligible lines', async () => {
    mockCouponFindOne.mockResolvedValue(
      coupon({ minOrder: 400, appliesTo: { scope: 'categories', itemIds: [], categoryIds: [COFFEE] } })
    );

    await expect(
      couponService.validate({
        cafeId: 'cafe-1',
        code: 'COFFEE20',
        subtotal: 300,
        items: [line({ price: 300 })],
      })
    ).rejects.toThrow(/minimum order/i);
  });
});
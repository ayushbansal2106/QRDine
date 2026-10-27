/**
 * Regression guard — one field, one code, resolved not declared.
 *
 * A guest holding `FIRST50` and a guest holding `RWD-9F2C11` have done the same
 * thing: pasted a code they were given. They cannot tell which shelf it came
 * from, so the app must not make them choose — it resolves the code, names the
 * offer, and quotes what it saves. It must also refuse to let both kinds land
 * on the same bill, since two stacked deductions is not a promotion.
 */
jest.mock('../src/services/couponService', () => ({
  normalizeCode: (code) => String(code || '').trim().toUpperCase(),
  validate: jest.fn(),
  toDiscount: jest.fn(),
  redeem: jest.fn(),
  computeCouponDiscount: jest.fn(),
  eligibleSubtotal: jest.fn(),
}));
jest.mock('../src/services/loyaltyService', () => ({
  validateVoucherForCustomer: jest.fn(),
}));
// Metered order quota needs a real Mongo reservation; this file unit-tests code
// resolution with mocked services. See the helper for why.
jest.mock('../src/services/entitlementService', () =>
  require('./helpers/entitlementServicePassthrough')
);

const couponService = require('../src/services/couponService');
const loyaltyService = require('../src/services/loyaltyService');
const promoService = require('../src/services/promoService');
const AppError = require('../src/utils/AppError');

const cafeId = '507f1f77bcf86cd799439011';
const customerId = '6ac0cabe7eb012096052d970';
const otherCustomerId = '6ac0d41df4b36a73abbabaee';

const notFound = (message = 'Invalid coupon code') => new AppError(message, 404);

beforeEach(() => {
  jest.clearAllMocks();
  // Default: neither shelf knows the code.
  couponService.validate.mockRejectedValue(notFound());
  loyaltyService.validateVoucherForCustomer.mockRejectedValue(notFound('Voucher not found'));
});

describe('resolvePromoCode — a coupon', () => {
  it('names the offer and quotes the exact saving', async () => {
    couponService.validate.mockResolvedValue({
      code: 'FIRST50',
      label: '₹50 off your first order',
      discount: 50,
      coupon: { description: '₹50 off your first order' },
    });

    const promo = await promoService.resolvePromoCode({
      cafeId,
      code: ' first50 ',
      subtotal: 400,
      customerId,
    });

    expect(promo.kind).toBe('coupon');
    expect(promo.code).toBe('FIRST50');
    expect(promo.amount).toBe(50);
    expect(promo.title).toBe('Coupon');
    expect(promo.message).toContain('50.00');
    expect(couponService.validate).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'FIRST50', subtotal: 400, customerId })
    );
  });
});

describe('resolvePromoCode — a reward voucher', () => {
  it('resolves the RWD- code against the guest\'s own card', async () => {
    loyaltyService.validateVoucherForCustomer.mockResolvedValue({
      code: 'RWD-AAA111',
      label: 'Free dessert',
      type: 'flat_off',
      value: 150,
    });

    const promo = await promoService.resolvePromoCode({
      cafeId,
      code: 'rwd-aaa111',
      subtotal: 500,
      customerId,
    });

    expect(promo.kind).toBe('voucher');
    expect(promo.amount).toBe(150);
    expect(promo.title).toBe('Reward voucher');
    // The customer is who the order will belong to, not the code's shape.
    expect(loyaltyService.validateVoucherForCustomer).toHaveBeenCalledWith(
      cafeId,
      'RWD-AAA111',
      customerId
    );
  });

  it('never promises more than the bill is worth', async () => {
    loyaltyService.validateVoucherForCustomer.mockResolvedValue({
      code: 'RWD-AAA111',
      label: 'Free dessert',
      type: 'flat_off',
      value: 900,
    });

    const promo = await promoService.resolvePromoCode({ cafeId, code: 'RWD-AAA111', subtotal: 120 });

    expect(promo.amount).toBe(120);
  });

  it('treats a percentage voucher as a percentage', async () => {
    loyaltyService.validateVoucherForCustomer.mockResolvedValue({
      code: 'RWD-AAA111',
      label: '10% off',
      type: 'percent_off',
      value: 10,
    });

    const promo = await promoService.resolvePromoCode({ cafeId, code: 'RWD-AAA111', subtotal: 500 });

    expect(promo.amount).toBe(50);
  });
});

describe('resolvePromoCode — falling through the wrong shelf', () => {
  it('tries the coupon shelf when an RWD- code is not on any card', async () => {
    couponService.validate.mockResolvedValue({
      code: 'RWD-9F2C11',
      label: 'Autumn offer',
      discount: 75,
    });

    const promo = await promoService.resolvePromoCode({ cafeId, code: 'RWD-9F2C11', subtotal: 500 });

    expect(promo.kind).toBe('coupon');
    expect(promo.amount).toBe(75);
  });

  it('tries the card shelf for a code that does not look like a voucher', async () => {
    loyaltyService.validateVoucherForCustomer.mockResolvedValue({
      code: 'FREEBRUNCH',
      label: 'Free brunch',
      type: 'flat_off',
      value: 200,
    });

    const promo = await promoService.resolvePromoCode({
      cafeId,
      code: 'FREEBRUNCH',
      subtotal: 500,
      customerId,
    });

    expect(promo.kind).toBe('voucher');
  });
});

describe('resolvePromoCode — refusals', () => {
  it('asks for a code rather than guessing', async () => {
    await expect(promoService.resolvePromoCode({ cafeId, code: '  ', subtotal: 500 })).rejects.toThrow(
      'Enter a code to apply'
    );
    expect(couponService.validate).not.toHaveBeenCalled();
  });

  it('reports the real reason, not "not found", when a code exists but is refused', async () => {
    loyaltyService.validateVoucherForCustomer.mockRejectedValue(
      new AppError('This voucher belongs to a different customer', 403)
    );

    await expect(
      promoService.resolvePromoCode({
        cafeId,
        code: 'RWD-AAA111',
        subtotal: 500,
        customerId: otherCustomerId,
      })
    ).rejects.toThrow('belongs to a different customer');
  });

  it('reports an expired reward in its own words', async () => {
    loyaltyService.validateVoucherForCustomer.mockRejectedValue(
      new AppError('This voucher has expired', 400)
    );

    await expect(
      promoService.resolvePromoCode({ cafeId, code: 'RWD-AAA111', subtotal: 500, customerId })
    ).rejects.toThrow('expired');
  });

  it('says the code is unknown when neither shelf knows it', async () => {
    await expect(
      promoService.resolvePromoCode({ cafeId, code: 'NOPE1234', subtotal: 500, customerId })
    ).rejects.toThrow('Invalid coupon code');
  });
});

describe('assertSingleCode — one code per bill', () => {
  it('refuses a coupon and a voucher together', () => {
    expect(() =>
      promoService.assertSingleCode({ couponCode: 'FIRST50', voucherCode: 'RWD-AAA111' })
    ).toThrow('Apply one code at a time');
  });

  it('accepts either one alone, or neither', () => {
    expect(() => promoService.assertSingleCode({ couponCode: 'FIRST50' })).not.toThrow();
    expect(() => promoService.assertSingleCode({ voucherCode: 'RWD-AAA111' })).not.toThrow();
    expect(() => promoService.assertSingleCode({})).not.toThrow();
    expect(() => promoService.assertSingleCode({ couponCode: '  ', voucherCode: '' })).not.toThrow();
  });

  it('is enforced by the order engine, not only by the interface', async () => {
    const orderService = require('../src/services/orderService');

    await expect(
      orderService.createOrder({
        cafeId,
        orderType: 'dine_in',
        channel: 'qr',
        tableId: 'table-1',
        couponCode: 'FIRST50',
        voucherCode: 'RWD-AAA111',
      })
    ).rejects.toThrow('Apply one code at a time');
  });
});
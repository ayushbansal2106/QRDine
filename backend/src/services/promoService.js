const couponService = require('./couponService');
const loyaltyService = require('./loyaltyService');
const AppError = require('../utils/AppError');

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

/** Reward vouchers are minted as `RWD-XXXXXX`. */
const VOUCHER_SHAPE = /^RWD-/i;

/**
 * One field, one code.
 *
 * A guest holding `FIRST50` and a guest holding `RWD-9F2C11` are doing exactly
 * the same thing — pasting a code they were given — and they have no reason to
 * know or care that the two come from different subsystems. Asking them to pick
 * a box first is a question the interface cannot answer for them.
 *
 * So the code is resolved, not declared: the shape hints at where to look first,
 * and a miss on that shelf falls through to the other one rather than telling
 * the guest their own code does not exist.
 */

/** Whether a coupon or a reward voucher is already attached to this order. */
const describeKind = (kind) => (kind === 'voucher' ? 'Reward voucher' : 'Coupon');

/**
 * Resolve a typed code against an order context and price it.
 *
 * The returned `amount` is what will actually come off, computed by the same
 * helpers the order engine uses — so the figure shown on the Apply button is the
 * figure on the bill, not an estimate that gets quietly recomputed later.
 *
 * @returns {Promise<{kind: 'coupon'|'voucher', code: string, label: string,
 *   type: string, value: number, amount: number, title: string, message: string}>}
 */
const resolvePromoCode = async ({ cafeId, code, subtotal = 0, items = null, customerId = null }) => {
  const normalized = couponService.normalizeCode(code);
  if (!normalized) {
    throw new AppError('Enter a code to apply', 400);
  }

  const attempts = VOUCHER_SHAPE.test(normalized) ? ['voucher', 'coupon'] : ['coupon', 'voucher'];
  const errors = [];

  for (const kind of attempts) {
    try {
      if (kind === 'coupon') {
        const validated = await couponService.validate({
          cafeId,
          code: normalized,
          subtotal,
          items,
          customerId,
        });

        return {
          kind: 'coupon',
          code: validated.code,
          label: validated.label,
          type: 'flat',
          value: validated.discount,
          amount: round2(validated.discount),
          title: describeKind('coupon'),
          message:
            validated.discount > 0
              ? `Coupon applied — you save ₹${round2(validated.discount).toFixed(2)} on this order.`
              : 'Coupon applied.',
        };
      }

      const voucher = await loyaltyService.validateVoucherForCustomer(cafeId, normalized, customerId);

      const raw = voucher.type === 'percent_off'
        ? (Number(subtotal) * (Number(voucher.value) || 0)) / 100
        : Number(voucher.value) || 0;
      const amount = round2(Math.min(Math.max(raw, 0), Number(subtotal) || 0));

      return {
        kind: 'voucher',
        code: voucher.code,
        label: voucher.label,
        type: voucher.type,
        value: voucher.value,
        amount,
        title: describeKind('voucher'),
        message:
          amount > 0
            ? `Reward applied — you save ₹${amount.toFixed(2)} on this order.`
            : 'Reward applied.',
      };
    } catch (err) {
      errors.push(err);
    }
  }

  // A miss on both shelves is a real answer; the *specific* refusal is the useful
  // one ("expired", "belongs to another customer", "minimum order"). Only when
  // both were simply "not found" is the generic message honest.
  const specific = errors.find((err) => err.statusCode && err.statusCode !== 404);
  throw specific || errors[0] || new AppError('That code could not be applied', 400);
};

/**
 * Only one code may be attached to an order.
 *
 * A coupon and a reward voucher stacking on one bill is not a promotion, it is
 * two deductions the café never agreed to. The UI offers one field, but the rule
 * belongs here — the UI is not the only caller.
 */
const assertSingleCode = ({ couponCode = null, voucherCode = null } = {}) => {
  const coupon = String(couponCode || '').trim();
  const voucher = String(voucherCode || '').trim();

  if (coupon && voucher) {
    throw new AppError('Apply one code at a time — remove the other first', 400);
  }
};

module.exports = {
  VOUCHER_SHAPE,
  describeKind,
  resolvePromoCode,
  assertSingleCode,
};
const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const Customer = require('../models/Customer');
const segmentService = require('./segmentService');
const couponGrantService = require('./couponGrantService');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Module #14 — Coupon validation engine.
 *
 * The client only supplies a code; every rule (window, caps, limits, happy hour,
 * per-customer usage) is evaluated here against server-side data.
 */

const normalizeCode = (code) => String(code || '').trim().toUpperCase();

const minutesOfDay = (value) => {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
};

const withinHappyHour = (coupon, now) => {
  const hh = coupon.happyHour;
  if (!hh || !hh.enabled) return true;
  if (Array.isArray(hh.days) && hh.days.length > 0 && !hh.days.includes(now.getDay())) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= minutesOfDay(hh.start) && nowMinutes <= minutesOfDay(hh.end);
};

const computeCouponDiscount = (coupon, subtotal) => {
  let amount = coupon.type === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.type === 'percent' && coupon.maxDiscount > 0) {
    amount = Math.min(amount, coupon.maxDiscount);
  }
  return round2(Math.min(Math.max(amount, 0), subtotal));
};

const idList = (value) => (Array.isArray(value) ? value.map(String) : []);

/**
 * How much of the order a coupon is allowed to discount.
 *
 * `appliesTo.scope` was accepted by the admin API and stored on the document but
 * never read at validation time, so a "20% off Coffee" coupon silently
 * discounted the entire bill. Scoped coupons now discount only the eligible
 * lines; `all` keeps the whole subtotal.
 *
 * @param items resolved line items ({ menuItemId, categoryId, price, quantity })
 */
const eligibleSubtotal = (coupon, items, subtotal) => {
  const scope = coupon.appliesTo?.scope || 'all';
  if (scope === 'all') return round2(Number(subtotal) || 0);

  // A scoped coupon cannot be priced from a bare subtotal; the caller must
  // supply the lines so we know which items the scope actually covers.
  if (!Array.isArray(items)) return null;

  const itemIds = idList(coupon.appliesTo?.itemIds);
  const categoryIds = idList(coupon.appliesTo?.categoryIds);

  const eligible = items.reduce((sum, line) => {
    const matches =
      scope === 'items'
        ? itemIds.includes(String(line.menuItemId))
        : categoryIds.includes(String(line.categoryId));
    if (!matches) return sum;
    return sum + (Number(line.price) || 0) * (Number(line.quantity) || 0);
  }, 0);

  return round2(eligible);
};

/**
 * Resolve a typed code to a coupon, following a personal grant when that is
 * what it is.
 *
 * A grant code is delivered to one profile and typed into the same field as
 * every other code, so nothing downstream should have to know which kind it was.
 * The audience is *not* re-checked for a grant: the profile was already selected
 * when it was issued, and a win-back offer that stops working the moment the
 * customer comes back would be the wrong reward for coming back.
 */
const resolveCoupon = async ({ cafeId, code, customerId = null, now = new Date() }) => {
  const normalized = normalizeCode(code);

  const coupon = await Coupon.findOne({ cafeId, code: normalized });
  if (coupon) return { coupon, grant: null };

  // A grant belongs to a real tenant, so there is nothing to look up unless the
  // id can actually be one — and asking anyway would turn "unknown code" into a
  // cast error instead of the answer the guest needs.
  const tenantIsReal = mongoose.Types.ObjectId.isValid(String(cafeId));
  if (!tenantIsReal) return { coupon: null, grant: null };

  const grant = await couponGrantService.findGrant({ cafeId, code: normalized });
  if (!grant) return { coupon: null, grant: null };

  if (String(grant.customerId) !== String(customerId)) {
    throw new AppError('This offer belongs to another customer', 403);
  }
  if (grant.status !== 'issued') {
    throw new AppError('This offer has already been used', 400);
  }
  if (grant.expiresAt && grant.expiresAt < now) {
    grant.status = 'expired';
    await grant.save();
    throw new AppError('This offer has expired', 400);
  }

  const granted = await Coupon.findById(grant.couponId);
  if (!granted) throw new AppError('This offer is no longer available', 400);

  return { coupon: granted, grant };
};

/**
 * Validate a coupon code against an order context.
 * @returns {{ coupon, code, label, discount }}
 */
const validate = async ({ cafeId, code, subtotal, items = null, customerId = null, now = new Date() }) => {
  const normalized = normalizeCode(code);
  if (!normalized) {
    throw new AppError('Coupon code is required', 400);
  }

  const { coupon, grant } = await resolveCoupon({ cafeId, code: normalized, customerId, now });
  if (!coupon) {
    throw new AppError('Invalid coupon code', 404);
  }
  if (!coupon.isActive) {
    throw new AppError('This coupon is no longer active', 400);
  }
  if (coupon.validFrom && now < coupon.validFrom) {
    throw new AppError('This coupon is not active yet', 400);
  }
  if (coupon.validTo && now > coupon.validTo) {
    throw new AppError('This coupon has expired', 400);
  }
  if (coupon.singleUse && coupon.usageCount >= 1) {
    throw new AppError('This coupon has already been used', 400);
  }
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
    throw new AppError('This coupon has reached its usage limit', 400);
  }
  if (coupon.minOrder > 0 && Number(subtotal) < coupon.minOrder) {
    throw new AppError(`A minimum order of ${coupon.minOrder} is required for this coupon`, 400);
  }
  if (!withinHappyHour(coupon, now)) {
    throw new AppError('This coupon is only valid during happy hours', 400);
  }

  // Targeted offers: a coupon aimed at a hand-picked list or at a segment of
  // the customer base is reserved for exactly those profiles. A grant code has
  // already been through this door — it was checked against this profile when it
  // was issued — so it is not checked twice.
  //
  // The hand-picked list is answered from the coupon alone; only a segment needs
  // the customer's live profile, so only a segment costs a read.
  if (!grant && (coupon.appliesTo?.customerIds?.length > 0 || coupon.audience?.mode === 'segment')) {
    const customer =
      coupon.audience?.mode === 'segment' && customerId
        ? await Customer.findById(customerId)
        : null;

    const eligible = segmentService.matchesAudience(coupon, customer, { now, customerId });
    if (!eligible) {
      throw new AppError(
        segmentService.audienceRefusal(coupon, customerId ? customer : null),
        400
      );
    }
  }

  if (customerId && coupon.perCustomerLimit > 0) {
    const used = await Order.countDocuments({
      cafeId,
      customerId,
      'discounts.couponCode': normalized,
      status: { $ne: 'cancelled' },
    });
    if (used >= coupon.perCustomerLimit) {
      throw new AppError('You have already used this coupon the maximum number of times', 400);
    }
  }

  const eligible = eligibleSubtotal(coupon, items, subtotal);
  if (eligible === null) {
    throw new AppError(
      'This coupon only applies to selected items, so it must be checked against the cart',
      400
    );
  }
  if (eligible <= 0) {
    throw new AppError('This coupon does not apply to anything in your order', 400);
  }

  const discount = computeCouponDiscount(coupon, eligible);

  return {
    coupon,
    code: coupon.code,
    // A grant is typed by the customer, so the code they used is the one that
    // must be reported back to them and consumed later.
    grantCode: grant ? grant.code : null,
    label: coupon.description || coupon.code,
    discount,
    eligibleSubtotal: eligible,
  };
};

/**
 * Convert a validated coupon into an order `discounts[]` entry.
 * We emit a flat amount so the persisted discount exactly matches what was
 * validated (caps/max-discount already applied) rather than being recomputed.
 */
const toDiscount = ({ code, label, discount }) => ({
  scope: 'order',
  label,
  type: 'flat',
  value: discount,
  couponCode: code,
});

/** Increment usage after an order with the coupon is persisted. */
/** Increment usage after an order with the coupon is persisted. */
const redeem = async (cafeId, code, { orderId = null } = {}) => {
  const normalized = normalizeCode(code);
  if (!normalized) return;

  await Coupon.updateOne({ cafeId, code: normalized }, { $inc: { usageCount: 1 } });

  // A personal code is also spent — otherwise the same offer could be used at
  // every table the guest visits until the campaign ends.
  await couponGrantService
    .redeemGrant({ cafeId, code: normalized, orderId })
    .catch((err) => console.error('Coupon grant redemption failed (non-blocking):', err.message));
};

module.exports = {
  normalizeCode,
  resolveCoupon,
  validate,
  toDiscount,
  redeem,
  computeCouponDiscount,
  eligibleSubtotal,
};

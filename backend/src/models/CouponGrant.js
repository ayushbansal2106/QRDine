const mongoose = require('mongoose');

/**
 * Module #14 — a coupon issued to one customer as their own code.
 *
 * A targeted offer with a shared code relies on the guest typing it. That is
 * fine at a till and useless on a table: nobody remembers a code from an SMS.
 * A grant is the same offer, delivered — the customer finds it on their profile
 * and taps it into the single code field alongside every other code.
 *
 * Grants exist in addition to, not instead of, audience rules: the rule decides
 * who qualifies, the grant is the individual delivery of it.
 */
const couponGrantSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    /** Unique per café, so it can be typed into the same field as any code. */
    code: {
      type: String,
      required: true,
      uppercase: true,
      maxlength: 32,
    },
    status: {
      type: String,
      enum: ['issued', 'redeemed', 'expired', 'revoked'],
      default: 'issued',
    },
    issuedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    redeemedAt: { type: Date, default: null },
    redeemedOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    /** The audience as it read when this grant was made, for the admin log. */
    audienceAtIssue: { type: String, default: '', maxlength: 200 },
  },
  { timestamps: true }
);

couponGrantSchema.index({ cafeId: 1, code: 1 }, { unique: true });
couponGrantSchema.index({ cafeId: 1, customerId: 1, status: 1 });
couponGrantSchema.index({ couponId: 1, customerId: 1 });
couponGrantSchema.index({ couponId: 1, status: 1 });

module.exports = mongoose.model('CouponGrant', couponGrantSchema);
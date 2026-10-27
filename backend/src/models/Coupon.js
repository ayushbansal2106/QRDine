const mongoose = require('mongoose');

/**
 * Module #14 — Smart coupons & promotional discounts.
 *
 * Validation is always performed server-side (`couponService.validate`) against
 * the live subtotal and order items; the client only ever supplies a code.
 */

const couponSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 32,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 200,
    },
    type: {
      type: String,
      enum: ['percent', 'flat'],
      required: true,
      default: 'percent',
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    minOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Cap for percent coupons (0 = uncapped)
    maxDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Which items the coupon applies to
    appliesTo: {
      scope: { type: String, enum: ['all', 'items', 'categories'], default: 'all' },
      itemIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' }],
      categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
      /**
       * When non-empty the coupon is a targeted offer: only these customer
       * profiles may redeem it. This is independent of `scope`, which governs
       * which *lines* within an order the discount applies to.
       */
      customerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }],
    },
    /**
     * Who this offer is for, as a rule rather than a snapshot of names.
     *
     * `customers` keeps the hand-picked list in `appliesTo.customerIds`; `segment`
     * evaluates `rules` against each customer's live profile at redemption time,
     * so an audience keeps up with the customer base instead of freezing at the
     * moment the coupon was saved.
     */
    audience: {
      mode: { type: String, enum: ['all', 'customers', 'segment'], default: 'all' },
      /** AND-ed. An empty list means everyone. Validated by `segmentService`. */
      rules: [
        {
          field: { type: String, trim: true },
          op: { type: String, trim: true },
          value: { type: mongoose.Schema.Types.Mixed, default: null },
        },
      ],
    },
    /**
     * Personal delivery. When `enabled`, every profile the audience matches is
     * issued its own code (`CouponGrant`), so the offer turns up on that
     * customer's profile instead of waiting to be typed.
     */
    autoIssue: {
      enabled: { type: Boolean, default: false },
      /** Re-issue to someone who already redeemed a grant for this coupon. */
      repeatEveryDays: { type: Number, default: 0, min: 0 },
    },
    validFrom: {
      type: Date,
      default: null,
    },
    validTo: {
      type: Date,
      default: null,
    },
    // Happy-hour window (days are 0=Sun … 6=Sat)
    happyHour: {
      enabled: { type: Boolean, default: false },
      days: { type: [Number], default: [] },
      start: { type: String, default: '00:00' },
      end: { type: String, default: '23:59' },
    },
    singleUse: {
      type: Boolean,
      default: false,
    },
    // 0 = unlimited
    usageLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    perCustomerLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

couponSchema.index({ cafeId: 1 });
couponSchema.index({ cafeId: 1, code: 1 }, { unique: true });
couponSchema.index({ cafeId: 1, isActive: 1 });
// The grant sweep walks "auto-issuing coupons I have not finished issuing to".
couponSchema.index({ cafeId: 1, isActive: 1, 'autoIssue.enabled': 1 });

module.exports = mongoose.model('Coupon', couponSchema);

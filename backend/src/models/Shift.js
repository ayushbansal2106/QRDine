const mongoose = require('mongoose');

/**
 * Module #08 — Cash drawer / shift ledger.
 *
 * A shift is opened by a staff member with a counted opening float and closed
 * with a counted closing float. The closing reconciliation compares the counted
 * cash against the expected cash (opening float + cash sales recorded during the
 * shift window), producing a variance for the manager to review.
 */

const paymentBreakdownSchema = new mongoose.Schema(
  {
    cash: { type: Number, default: 0 },
    upi_manual: { type: Number, default: 0 },
    card_manual: { type: Number, default: 0 },
    wallet: { type: Number, default: 0 },
    online: { type: Number, default: 0 },
  },
  { _id: false }
);

const shiftSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    openedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    openedByName: {
      type: String,
      trim: true,
      default: '',
    },
    openedAt: {
      type: Date,
      default: Date.now,
    },
    openingFloat: {
      type: Number,
      default: 0,
      min: 0,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    closedByName: {
      type: String,
      trim: true,
      default: '',
    },
    closedAt: {
      type: Date,
      default: null,
    },
    closingFloat: {
      type: Number,
      default: null,
    },
    // Snapshot of sales captured at close time (immutable record for the ledger)
    expectedCash: {
      type: Number,
      default: 0,
    },
    cashSales: {
      type: Number,
      default: 0,
    },
    totalSales: {
      type: Number,
      default: 0,
    },
    orderCount: {
      type: Number,
      default: 0,
    },
    difference: {
      type: Number,
      default: 0,
    },
    paymentsBreakdown: {
      type: paymentBreakdownSchema,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

shiftSchema.index({ cafeId: 1 });
shiftSchema.index({ cafeId: 1, status: 1 });
shiftSchema.index({ cafeId: 1, openedAt: -1 });

module.exports = mongoose.model('Shift', shiftSchema);

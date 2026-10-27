const mongoose = require('mongoose');

/**
 * Module #15 — a customer's loyalty card (stamps + issued reward vouchers).
 */

const voucherSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    label: { type: String, trim: true, default: 'Reward' },
    type: { type: String, enum: ['free_item', 'flat_off', 'percent_off'], default: 'flat_off' },
    value: { type: Number, default: 0, min: 0 },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', default: null },
    status: { type: String, enum: ['active', 'redeemed', 'expired'], default: 'active' },
    earnedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    redeemedAt: { type: Date, default: null },
    redeemedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  },
  { _id: true }
);

const loyaltyCardSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    programId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoyaltyProgram',
      default: null,
    },
    stamps: {
      type: Number,
      default: 0,
      min: 0,
    },
    lifetimeStamps: {
      type: Number,
      default: 0,
      min: 0,
    },
    vouchers: {
      type: [voucherSchema],
      default: [],
    },
    lastStampAt: {
      type: Date,
      default: null,
    },
    // Compact audit trail of the last 50 card movements
    history: [
      {
        type: { type: String, enum: ['stamp', 'voucher', 'redeem', 'adjust'] },
        count: { type: Number, default: 0 },
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
        note: { type: String, default: '' },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

loyaltyCardSchema.index({ cafeId: 1 });
loyaltyCardSchema.index({ cafeId: 1, customerId: 1 }, { unique: true });
loyaltyCardSchema.index({ cafeId: 1, lastStampAt: -1 });

loyaltyCardSchema.methods.addHistory = function (entry) {
  this.history.push(entry);
  if (this.history.length > 50) {
    this.history = this.history.slice(-50);
  }
};

module.exports = mongoose.model('LoyaltyCard', loyaltyCardSchema);

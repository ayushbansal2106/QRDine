const mongoose = require('mongoose');

/**
 * Module #16 — an individual scratch card. `issued` cards have not been revealed
 * yet; the prize is only decided at reveal time (server-side weighted draw).
 */

const scratchCardSchema = new mongoose.Schema(
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
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ScratchCampaign',
      default: null,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    prize: {
      label: { type: String, default: '' },
      type: { type: String, enum: ['flat_off', 'percent_off', 'free_item', 'none'], default: 'none' },
      value: { type: Number, default: 0 },
      menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', default: null },
    },
    // Reward voucher issued when a discount/free-item prize is won
    voucherCode: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['issued', 'revealed', 'expired'],
      default: 'issued',
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    revealedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

scratchCardSchema.index({ cafeId: 1 });
scratchCardSchema.index({ cafeId: 1, status: 1 });
scratchCardSchema.index({ cafeId: 1, customerId: 1, createdAt: -1 });
scratchCardSchema.index({ cafeId: 1, orderId: 1 });
scratchCardSchema.index({ cafeId: 1, createdAt: -1 });

module.exports = mongoose.model('ScratchCard', scratchCardSchema);

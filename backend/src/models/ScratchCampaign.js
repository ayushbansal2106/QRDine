const mongoose = require('mongoose');

/**
 * Module #16 — interactive scratch-card campaign.
 *
 * The prize pool (with weights and stock) lives here; the weighted draw happens
 * server-side so odds are never exposed to the client.
 */

const prizeSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 80 },
    type: {
      type: String,
      enum: ['flat_off', 'percent_off', 'free_item', 'none'],
      default: 'none',
    },
    value: { type: Number, default: 0, min: 0 },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', default: null },
    // Relative weight for the weighted draw
    weight: { type: Number, default: 1, min: 0 },
    // 0 = unlimited stock
    stock: { type: Number, default: 0, min: 0 },
    claimed: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

const scratchCampaignSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    name: {
      type: String,
      trim: true,
      default: 'Scratch & Win',
      maxlength: 80,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    prizes: {
      type: [prizeSchema],
      default: [],
    },
    eligibleMinSpend: {
      type: Number,
      default: 0,
      min: 0,
    },
    // 0 = unlimited cards issued per day
    maxCardsPerDay: {
      type: Number,
      default: 0,
      min: 0,
    },
    // 0 = unlimited cards per customer
    maxCardsPerCustomer: {
      type: Number,
      default: 0,
      min: 0,
    },
    voucherValidDays: {
      type: Number,
      default: 15,
      min: 1,
    },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

scratchCampaignSchema.index({ cafeId: 1 }, { unique: true });

module.exports = mongoose.model('ScratchCampaign', scratchCampaignSchema);

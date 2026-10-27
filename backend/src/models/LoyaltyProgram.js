const mongoose = require('mongoose');

/**
 * Module #15 — Digital loyalty stamp program.
 * One program per cafe; earning and redemption rules are server-enforced.
 */

const loyaltyProgramSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    name: {
      type: String,
      trim: true,
      default: 'Loyalty Card',
      maxlength: 80,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    stampsRequired: {
      type: Number,
      default: 5,
      min: 1,
      max: 50,
    },
    // Minimum order value (after discounts) that earns a stamp
    minSpend: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Which items earn stamps
    qualifyingScope: {
      type: String,
      enum: ['all', 'items', 'categories'],
      default: 'all',
    },
    qualifyingItemIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' }],
    qualifyingCategoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    // Stamps awarded per qualifying order (capped)
    stampsPerOrder: {
      type: Number,
      default: 1,
      min: 1,
      max: 10,
    },
    reward: {
      type: {
        type: String,
        enum: ['free_item', 'flat_off', 'percent_off'],
        default: 'flat_off',
      },
      value: { type: Number, default: 0, min: 0 },
      menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', default: null },
      label: { type: String, trim: true, default: 'Reward unlocked', maxlength: 120 },
    },
    voucherValidDays: {
      type: Number,
      default: 30,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

loyaltyProgramSchema.index({ cafeId: 1 }, { unique: true });

module.exports = mongoose.model('LoyaltyProgram', loyaltyProgramSchema);

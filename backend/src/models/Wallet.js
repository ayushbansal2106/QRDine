const mongoose = require('mongoose');

/**
 * Module #17 — Customer prepaid store wallet.
 * Balance is only ever mutated through `walletService` (atomic operations).
 */

const walletSchema = new mongoose.Schema(
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
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      trim: true,
      default: 'INR',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    totalTopups: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastTransactionAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

walletSchema.index({ cafeId: 1 });
walletSchema.index({ cafeId: 1, customerId: 1 }, { unique: true });
walletSchema.index({ cafeId: 1, balance: -1 });

module.exports = mongoose.model('Wallet', walletSchema);

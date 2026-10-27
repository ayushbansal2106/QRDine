const mongoose = require('mongoose');

/**
 * Module #17 — immutable wallet passbook. Every balance change writes one row.
 */

const walletTransactionSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    type: {
      type: String,
      enum: ['topup', 'bonus', 'payment', 'refund', 'adjustment'],
      required: true,
    },
    // Positive for money in, negative for money out
    amount: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    reference: {
      type: String,
      trim: true,
      default: '',
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    staffName: {
      type: String,
      trim: true,
      default: '',
    },
    note: {
      type: String,
      trim: true,
      default: '',
      maxlength: 300,
    },
    clientRequestId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.index({ cafeId: 1 });
walletTransactionSchema.index({ cafeId: 1, customerId: 1, createdAt: -1 });
walletTransactionSchema.index({ cafeId: 1, orderId: 1 });
walletTransactionSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);

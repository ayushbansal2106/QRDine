const mongoose = require('mongoose');

const gatewayTransactionSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
      index: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DiningSession',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['razorpay', 'cashfree', 'phonepe'],
      required: true,
    },
    gatewayOrderId: {
      type: String,
      trim: true,
      default: '',
    },
    gatewayPaymentId: {
      type: String,
      trim: true,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      enum: ['captured', 'failed', 'refunded'],
      default: 'captured',
    },
    rawPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Idempotency index: a payment id can only be recorded once per cafe
gatewayTransactionSchema.index({ cafeId: 1, gatewayPaymentId: 1 }, { unique: true });

module.exports = mongoose.model('GatewayTransaction', gatewayTransactionSchema);

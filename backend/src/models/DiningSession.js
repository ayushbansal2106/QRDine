const mongoose = require('mongoose');

const diningSessionSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
      required: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ['active', 'bill_requested', 'awaiting_payment', 'paid', 'closed'],
      default: 'active',
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    gst: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    invoiceNumber: {
      type: String,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ['pending', 'paid_counter', 'paid_online'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

diningSessionSchema.index({ cafeId: 1, status: 1 });
diningSessionSchema.index({ cafeId: 1, tableId: 1, status: 1 });
diningSessionSchema.index({ cafeId: 1, createdAt: -1 });

module.exports = mongoose.model('DiningSession', diningSessionSchema);

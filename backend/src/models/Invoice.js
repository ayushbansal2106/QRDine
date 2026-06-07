const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DiningSession',
      required: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
    },
    pdfUrl: {
      type: String,
      required: true,
      trim: true,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

invoiceSchema.index({ cafeId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ sessionId: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);

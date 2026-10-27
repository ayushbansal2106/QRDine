const mongoose = require('mongoose');

/**
 * Subscription Tax Invoice Model (Task 5.2 - Stage 5)
 *
 * Implements Rule 46 of CGST Rules, 2017 under SAC 998313 for B2B SaaS platform billing.
 */
const subscriptionInvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    planKey: {
      type: String,
      required: true,
    },
    planName: {
      type: String,
      required: true,
    },
    cycle: {
      type: String,
      enum: ['monthly', 'annual'],
      default: 'monthly',
    },
    sacCode: {
      type: String,
      default: '998313',
    },
    description: {
      type: String,
      default: 'QRDine Cloud SaaS Digital Menu & Order Management Platform',
    },
    outlets: {
      type: Number,
      default: 1,
    },
    basePaise: {
      type: Number,
      required: true,
    },
    subtotalPaise: {
      type: Number,
      required: true,
    },
    taxType: {
      type: String,
      enum: ['intra_state', 'inter_state'],
      required: true,
      default: 'intra_state',
    },
    cgstRate: {
      type: Number,
      default: 0.09,
    },
    cgstPaise: {
      type: Number,
      default: 0,
    },
    sgstRate: {
      type: Number,
      default: 0.09,
    },
    sgstPaise: {
      type: Number,
      default: 0,
    },
    igstRate: {
      type: Number,
      default: 0.18,
    },
    igstPaise: {
      type: Number,
      default: 0,
    },
    totalPaise: {
      type: Number,
      required: true,
    },
    supplier: {
      legalName: { type: String, default: 'QRDine Technologies Private Limited' },
      gstin: { type: String, default: '07AAACQ1234M1Z5' },
      address: { type: String, default: 'Saket District Centre, New Delhi 110017' },
      stateCode: { type: String, default: '07' },
    },
    recipient: {
      legalName: { type: String, default: '' },
      tradeName: { type: String, default: '' },
      gstin: { type: String, default: '' },
      address: { type: String, default: '' },
      stateCode: { type: String, default: '07' },
    },
    pdfUrl: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['draft', 'issued', 'paid', 'cancelled'],
      default: 'paid',
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

subscriptionInvoiceSchema.index({ cafeId: 1, createdAt: -1 });

module.exports = mongoose.model('SubscriptionInvoice', subscriptionInvoiceSchema);

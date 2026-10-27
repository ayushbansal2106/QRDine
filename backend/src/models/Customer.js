const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    name: {
      type: String,
      trim: true,
      default: '',
      maxlength: 120,
    },
    // Phone is the primary identity used by QR / POS / wallet / loyalty.
    phone: {
      type: String,
      trim: true,
      default: '',
      maxlength: 20,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      maxlength: 160,
    },
    /** An email is only stored once the guest proved they own the mailbox. */
    emailVerifiedAt: {
      type: Date,
      default: null,
    },
    /**
     * Module #09 — guest-set preferences. `vegOnly` is honoured by the live
     * menu; the rest are recorded now so the UI does not have to change shape
     * when push delivery and i18n ship.
     */
    preferences: {
      vegOnly: { type: Boolean, default: false },
      notifications: { type: Boolean, default: true },
      // English only for now; the picker reports other languages as coming
      // soon rather than pretending to translate.
      language: { type: String, default: 'en', trim: true, maxlength: 8 },
    },
    /**
     * Staff can block a profile without deleting it, so the order history and
     * ledger stay intact. A blocked customer cannot sign in or order.
     */
    isBlocked: {
      type: Boolean,
      default: false,
    },
    blockedReason: {
      type: String,
      trim: true,
      default: '',
      maxlength: 200,
    },
    /** DPDP Act 2023 Right to Erasure / Anonymization */
    isAnonymized: {
      type: Boolean,
      default: false,
    },
    anonymizedAt: {
      type: Date,
      default: null,
    },
    anonymizationRequestedBy: {
      type: String,
      enum: ['customer', 'admin', 'system', null],
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
    },
    dietary: {
      type: [String],
      default: [],
    },
    tags: {
      type: [String],
      default: [],
    },
    birthday: {
      type: Date,
      default: null,
    },
    firstSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastVisitAt: {
      type: Date,
      default: null,
    },
    visitCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lifetimeSpend: {
      type: Number,
      default: 0,
      min: 0,
    },
    avgSpend: {
      type: Number,
      default: 0,
      min: 0,
    },
    favoriteItemIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MenuItem',
      },
    ],
  },
  {
    timestamps: true,
  }
);

customerSchema.index({ cafeId: 1 });
customerSchema.index({ cafeId: 1, lastVisitAt: -1 });
customerSchema.index(
  { cafeId: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: 'string', $ne: '' } },
  }
);
customerSchema.index({ cafeId: 1, lifetimeSpend: -1 });
// Backs the admin activeness / lapsed-reach filters.
customerSchema.index({ cafeId: 1, isBlocked: 1, lastVisitAt: -1 });

module.exports = mongoose.model('Customer', customerSchema);

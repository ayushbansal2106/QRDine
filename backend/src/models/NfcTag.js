const mongoose = require('mongoose');

/**
 * Module #11 — Social NFC physical tap integration.
 *
 * A tag is a passive sticker; the only thing we control is the URL written into
 * it. That URL is a *resolver* (`/api/nfc/:tagId`) rather than a direct menu
 * link, so a cafe can re-point a sticker from "menu" to "google_review" without
 * touching the physical tag. `tapCount`/`lastTapAt` are the only analytics we
 * keep, which is what makes it possible to tell whether a sticker is still in
 * the field.
 */
const nfcTagSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    // Printed on the sticker and embedded in the tag payload.
    tagId: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      trim: true,
      default: '',
      maxlength: 80,
    },
    destination: {
      type: String,
      enum: ['menu', 'google_review', 'instagram', 'custom'],
      default: 'menu',
    },
    // Only used when destination === 'custom'.
    targetUrl: {
      type: String,
      trim: true,
      default: '',
    },
    // When set and destination === 'menu', the tag resolves to this table.
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Field analytics
    tapCount: {
      type: Number,
      default: 0,
    },
    lastTapAt: {
      type: Date,
      default: null,
    },
    provisionedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    provisionedAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 300,
    },
  },
  {
    timestamps: true,
  }
);

nfcTagSchema.index({ cafeId: 1 });
nfcTagSchema.index({ tagId: 1 }, { unique: true });
nfcTagSchema.index({ cafeId: 1, isActive: 1 });
nfcTagSchema.index({ cafeId: 1, destination: 1 });

module.exports = mongoose.model('NfcTag', nfcTagSchema);

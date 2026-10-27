const mongoose = require('mongoose');

/**
 * Append-only, hash-chained audit ledger (Module #04).
 * Every money-affecting staff action (invoice close, discount, refund, void,
 * drawer open) writes one immutable entry. There are no update/delete routes.
 */
const auditLedgerSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    sequence: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      // e.g. invoice.closed, order.discount, order.refund, order.void, drawer.open
    },
    entityType: {
      type: String,
      trim: true,
      default: '',
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    amount: {
      type: Number,
      default: 0,
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
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    prevHash: {
      type: String,
      default: '',
    },
    entryHash: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

auditLedgerSchema.index({ cafeId: 1, createdAt: -1 });
auditLedgerSchema.index({ cafeId: 1, sequence: 1 }, { unique: true });
auditLedgerSchema.index({ cafeId: 1, type: 1 });

module.exports = mongoose.model('AuditLedger', auditLedgerSchema);

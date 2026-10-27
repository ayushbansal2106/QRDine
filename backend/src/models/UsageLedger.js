const mongoose = require('mongoose');

/**
 * Usage ledger — one row per metered operation.
 *
 * Two jobs, both of which a bare counter cannot do:
 *
 *  1. **Idempotency.** A retried request (double-tapped "Place order", a client
 *     that retried on timeout, a replayed `clientRequestId`) must not consume
 *     two units. The unique partial index on
 *     `(cafeId, metric, periodKey, idempotencyKey)` makes the duplicate insert
 *     fail, and the service treats that as "already claimed" rather than
 *     charging again.
 *
 *  2. **Audit.** A counter says a tenant used 500 orders; it cannot say which
 *     ones, which were released, or who reserved them. When a cafe disputes a
 *     quota block, this is the answer.
 *
 * States:
 *   reserved  → claimed, work in flight
 *   committed → the operation succeeded and the unit is spent
 *   released  → the operation failed/was abandoned and the unit was returned
 *
 * Rows are never deleted: the ledger is the audit trail, and a released row is
 * evidence that a failure did not cost the tenant a unit.
 */
const USAGE_LEDGER_STATUS = {
  RESERVED: 'reserved',
  COMMITTED: 'committed',
  RELEASED: 'released',
};

const usageLedgerSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
      index: true,
    },
    metric: { type: String, required: true, trim: true },
    periodKey: { type: String, required: true, trim: true },

    amount: { type: Number, required: true, min: 1 },

    status: {
      type: String,
      enum: Object.values(USAGE_LEDGER_STATUS),
      default: USAGE_LEDGER_STATUS.RESERVED,
      index: true,
    },

    /**
     * Caller-supplied dedupe key, namespaced by the module that owns the
     * operation (e.g. `order:<clientRequestId>`). Null for operations with no
     * natural key — those are simply never deduped.
     */
    idempotencyKey: { type: String, default: null, trim: true, maxlength: 200 },

    /** What the unit was spent on, for support and dispute resolution. */
    referenceType: { type: String, default: '', trim: true },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },

    /** Why a reservation was released. Empty for committed rows. */
    releaseReason: { type: String, default: '', trim: true, maxlength: 300 },

    committedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// Dedupe index. `partialFilterExpression` rather than `sparse`, because a null
// idempotencyKey is written explicitly for un-keyed operations and a sparse
// unique index treats `null` as a value — two un-keyed rows would collide.
usageLedgerSchema.index(
  { cafeId: 1, metric: 1, periodKey: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);

// "What did this tenant spend this period?" — the dispute/audit query.
usageLedgerSchema.index({ cafeId: 1, metric: 1, createdAt: -1 });

module.exports = mongoose.model('UsageLedger', usageLedgerSchema);
module.exports.USAGE_LEDGER_STATUS = USAGE_LEDGER_STATUS;

const mongoose = require('mongoose');

/**
 * Atomic usage counters.
 *
 * One row per (cafe, metric, period). The row is the *authority* for how much
 * of a metered allowance a tenant has consumed — never a value the client sends,
 * never a cached number, and never recomputed by counting documents (a `count()`
 * is not atomic with the insert that follows it, so N concurrent orders could
 * each read "499 used" and all succeed).
 *
 * ── Why `reserved` exists ───────────────────────────────────────────────
 * A quota has to be claimed *before* the expensive work (pricing a cart,
 * writing an order, calling Gemini) and only counted once that work succeeds.
 * If the counter only had `used`, two concurrent requests would both pass the
 * check and both write. `reserved` is incremented atomically inside the
 * conditional update, so a slot is held from the moment it is claimed and is
 * either committed (moved into `used`) or released (given back).
 *
 * Invariant: `used + reserved` never exceeds the plan limit, provided every
 * mutation goes through `entitlementService`. `used` itself only ever grows
 * within a period; `reserved` can go up and down.
 */
const usageCounterSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
      index: true,
    },
    /** A key from `config/plans.METRICS`. */
    metric: { type: String, required: true, trim: true },
    /**
     * The period this counter belongs to: `YYYY-MM` for monthly metrics, the
     * literal `lifetime` for stock limits such as outlets.
     */
    periodKey: { type: String, required: true, trim: true },

    used: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// The uniqueness here is what makes `$setOnInsert` upserts and the conditional
// `$inc` safe under concurrency: without it, two simultaneous first-uses of a
// metric would create two counters and each would allow the full limit.
usageCounterSchema.index({ cafeId: 1, metric: 1, periodKey: 1 }, { unique: true });

module.exports = mongoose.model('UsageCounter', usageCounterSchema);

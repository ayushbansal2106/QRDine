const mongoose = require('mongoose');

/**
 * The persisted plan → feature/limit configuration.
 *
 * ── Why a document per plan ─────────────────────────────────────────────
 * `config/plans.js` is the *baseline* catalogue: what a plan ships with. The
 * control plane's Plan Configuration page edits what each plan includes at
 * runtime, and that edit has to survive a restart, a deploy and a rollback.
 * One document per plan keeps that state small, makes a single plan's
 * configuration a single atomic write, and gives optimistic concurrency a
 * natural home in `version`.
 *
 * ── What is stored ──────────────────────────────────────────────────────
 *  - `features`: the feature keys this plan grants, as booleans. A key that is
 *    absent falls back to the catalogue default, so a feature added to the
 *    registry after a plan was configured is not silently denied.
 *  - `limits`: the metered allowances for this plan. `null` means *unlimited*,
 *    which is only meaningful for the metrics declared metered in
 *    `METRIC_CONFIG` — a feature with no limit is simply not entitled.
 *  - `includedOutlets`: the outlets bundled in the plan price.
 *
 * ── `version` ───────────────────────────────────────────────────────────
 * Bumped on every write. The control plane sends the version it loaded; a
 * mismatch is a 409 rather than a silent overwrite of another administrator's
 * change.
 *
 * ── `changes` ────────────────────────────────────────────────────────────
 * The audit trail. A plan change is platform-wide — it is not scoped to one
 * café, so it does not belong in the per-tenant `AuditLedger` — but "why does
 * Starter not have loyalty any more" still has to be answerable months later.
 * Each entry records who changed what, when, and the before/after values.
 */
const planFeatureConfigSchema = new mongoose.Schema(
  {
    planKey: {
      type: String,
      required: true,
      trim: true,
      // Unique here and ONLY here. A second index over the same key pattern
      // with different options is an IndexOptionsConflict and Mongo then
      // refuses to build either — the same trap as `Subscription.cafeId`.
      unique: true,
      index: true,
    },

    /**
     * featureKey -> included in this plan?
     *
     * `Schema.Types.Mixed`, not `Map`, and the reason is not cosmetic:
     * Mongoose's `Map` rejects any key containing a dot ("Mongoose maps do not
     * support keys that contain '.'"), and the feature registry has two such
     * keys by design — `reports.export` and `support.priority`. A `Map` here
     * would make every write fail with a cast error, and the failure would
     * look like a server bug rather than a schema mistake.
     *
     * A `Mixed` object stores the dotted key verbatim. It is also what
     * `minimize: false` on this schema exists for: an empty plan must keep
     * `features: {}` rather than having the key dropped.
     */
    features: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /**
     * metric key -> quota for the period, or null for unlimited.
     *
     * Only *metric* rows live here. `includedOutlets` is a plan attribute and
     * has its own field below, so the two can never disagree.
     */
    limits: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /** Outlets bundled in the plan price. Null means "use the catalogue". */
    includedOutlets: {
      type: Number,
      default: null,
      min: 1,
      max: 500,
    },

    version: {
      type: Number,
      default: 1,
      min: 1,
    },

    updatedBy: {
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

    /**
     * The audit trail. Capped: a plan is edited a handful of times, and an
     * unbounded array on a hot document is a slow document.
     */
    changes: {
      type: [
        new mongoose.Schema(
          {
            at: { type: Date, default: Date.now },
            by: { type: String, trim: true, default: '' },
            /** 'feature' or 'limit' */
            kind: { type: String, trim: true, default: 'feature' },
            key: { type: String, trim: true, default: '' },
            before: { type: mongoose.Schema.Types.Mixed, default: null },
            after: { type: mongoose.Schema.Types.Mixed, default: null },
            note: { type: String, trim: true, default: '', maxlength: 300 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

module.exports = mongoose.model('PlanFeatureConfig', planFeatureConfigSchema);

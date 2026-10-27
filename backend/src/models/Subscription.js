const mongoose = require('mongoose');
const { PLANS, PLAN_KEYS, CYCLES, CURRENT_PLAN_VERSION } = require('../config/plans');

/**
 * Persisted lifecycle state.
 *
 * Deliberately coarse: these are the states an operator acts on, not every
 * moment the clock crosses a boundary. The finer distinction ("is this tenant
 * in grace or degraded *right now*") is derived at read time from the dates,
 * see `subscriptionService.computeAccess`.
 */
const SUBSCRIPTION_STATUS = {
  TRIALING: 'trialing',
  ACTIVE: 'active',
  /** Past its paid/trial period but still inside the grace window. */
  GRACE: 'grace',
  /** Grace exhausted. Paid features are locked; the counter still works. */
  DEGRADED: 'degraded',
  /** Customer cancelled and the period ran out. Core features only. */
  CANCELLED: 'cancelled',
  /** Super-admin terminated. Nothing works. */
  TERMINATED: 'terminated',
};

const subscriptionSchema = new mongoose.Schema(
  {
    // One subscription per tenant. The unique index is what makes
    // `ensureSubscription` safe to call concurrently from many requests.
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
      unique: true,
      index: true,
    },

    planKey: {
      type: String,
      enum: PLAN_KEYS,
      default: 'trial',
    },
    /**
     * Which catalogue version this tenant bought under.
     *
     * Entitlements are resolved against the pinned version (see
     * `config/plans.resolvePlan`), so repricing a plan or moving a feature
     * between tiers applies to new sales only. Changing an existing tenant's
     * commercial terms is then a deliberate, auditable act rather than a
     * side-effect of a deploy.
     */
    planVersion: {
      type: String,
      default: CURRENT_PLAN_VERSION,
    },
    cycle: {
      type: String,
      enum: CYCLES,
      default: 'monthly',
    },

    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.TRIALING,
      index: true,
    },

    /**
     * Outlets the tenant has *paid for*. The base price bundles
     * `plan.includedOutlets` (1); each extra is charged per month. This is the
     * authority for how many outlets a tenant may operate — not a cap derived
     * from the plan alone, because a Pro tenant on one outlet is a real case.
     */
    outlets: {
      type: Number,
      default: 1,
      min: 1,
      max: 500,
    },

    /** When the free trial ends. Null once the tenant has paid at least once. */
    trialEndsAt: { type: Date, default: null },

    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },

    /**
     * What the last successful charge was, GST-inclusive, frozen at the
     * moment of payment. Pricing changes must never retroactively alter what
     * an invoice says a tenant already paid.
     */
    lastChargedPaise: { type: Number, default: 0 },
    lastChargedGstPaise: { type: Number, default: 0 },
    lastChargedAt: { type: Date, default: null },

    /** Set when the tenant cancels but keeps service until period end. */
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },

    /** Super-admin override. Nothing reopens a terminated tenant automatically. */
    terminatedAt: { type: Date, default: null },
    terminationReason: { type: String, trim: true, default: '' },

    planChangedAt: { type: Date, default: null },

    /**
     * Who last moved this subscription by hand, and why. Billing state is
     * changed by webhooks as well as by staff, and the two are indistinguishable
     * from the row alone — without this there is no way to answer "why was this
     * cafe downgraded?" months later.
     */
    lastChangedBy: { type: String, trim: true, default: '' },
    lastChangeNote: { type: String, trim: true, default: '' },

    /**
     * Explicit, account-level entitlement exceptions.
     *
     * Only ever written by the super-admin control plane (a comp'd feature for
     * a beta customer, or a single module switched off after an abuse report).
     * There is no tenant-facing write path for this array — a cafe cannot grant
     * itself a feature, and the resolution code treats anything not written here
     * as "no exception".
     *
     * `enabled: false` is a *revocation* and wins over the plan, so support can
     * switch a module off for one tenant without downgrading their whole plan.
     * `expiresAt` bounds a grant in time so a comp cannot become permanent by
     * accident.
     */
    entitlementOverrides: {
      type: [
        new mongoose.Schema(
          {
            featureKey: { type: String, required: true, trim: true },
            enabled: { type: Boolean, required: true },
            note: { type: String, trim: true, default: '', maxlength: 300 },
            grantedBy: { type: String, trim: true, default: '' },
            grantedAt: { type: Date, default: Date.now },
            expiresAt: { type: Date, default: null },
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

// cafeId is indexed by the field-level `unique: true` above. It must NOT also
// be declared here: two indexes over the same key pattern with different
// options (unique vs not) is an IndexOptionsConflict, and Mongo then refuses to
// build either — silently leaving the collection with no uniqueness at all.
// Concurrent signups would each create a billable row.
//
// status leads the second index for the "who has lapsed" operator sweep.
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

subscriptionSchema.virtual('plan').get(function plan() {
  return PLANS[this.planKey] || null;
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
module.exports.SUBSCRIPTION_STATUS = SUBSCRIPTION_STATUS;
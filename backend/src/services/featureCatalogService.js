const FeatureCatalog = require('../models/FeatureCatalog');
const {
  FEATURE_METADATA,
  KNOWN_FEATURES_INCLUDE,
  CORE_FEATURES,
  DEFAULT_TRIAL_PLAN,
  getPlan,
} = require('../config/plans');
const {
  BASE_FEATURES,
  isBaseFeature,
  knownFeatureKeys,
} = require('../models/FeatureCatalog');

/**
 * A base feature is one present in BASE_FEATURES. The catalog overrides a base
 * feature (on/off), but no future code path that grants features from the plan
 * catalogue can add a feature that was never in the base set, so a stray
 * `BASE_FEATURES` key removes the only way to grant a bugged entitlement.
 *
 * If a feature is in `FEATURE_METADATA` but not in `BASE_FEATURES`, it remains
 * plan-gated — the catalog does not touch it.
 */
const BASE_FEATURE_KEYS = new Set(BASE_FEATURES);

const FEATURE_COLLECTION_CACHE = new Map();

/** Feature keys the platform recognises today. */
const KNOWN_FEATURE_KEYS = KNOWN_FEATURES_INCLUDE;

/**
 * The platform's base feature universe.
 *
 * This is the fallback universe when no feature catalog is configured. It is
 * derived from the existing plan catalogue so the new super-admin override is
 * additive, not a second source of truth that can disagree with the plan file.
 */
function baseFeatureUniverse() {
  return KNOWN_FEATURE_KEYS;
}

/**
 * Load the feature catalog row, if one exists.
 *
 * The catalog is intentionally a single document: by default every tenant uses
 * the same override set, and per-tenant customisation is a later product choice.
 *
 * Cached in-process and invalidated by `clearCachedCatalog()` on every write, so
 * a failed query is never cached (a transient Mongo blip must not lock a cafe
 * out of its own features until the next deploy).
 */
async function loadCatalog() {
  if (FEATURE_COLLECTION_CACHE.has('row')) {
    return FEATURE_COLLECTION_CACHE.get('row');
  }

  const row = await FeatureCatalog.findOne().lean();
  const result = row ? { exists: true, row } : { exists: false, row: null };
  FEATURE_COLLECTION_CACHE.set('row', result);
  return result;
}

async function clearCachedCatalog() {
  FEATURE_COLLECTION_CACHE.delete('row');
}

/**
 * The features the platform has blocked for everyone.
 *
 * The catalog carries two independent maps:
 *  - `features` — a platform-wide *grant*: the feature is opened for every
 *    plan, whatever the plan catalogue says.
 *  - `blocked` — a platform-wide *block*: the feature is closed for every
 *    plan, whatever the plan catalogue says.
 *
 * They are separate because they are separate decisions. A block is the
 * emergency control (switch a module off platform-wide during an incident);
 * a grant is the rollout control (open a module to everyone before it is
 * bundled into a plan).
 *
 * A block wins over a plan entitlement: enabling a feature on a plan must
 * never make a globally blocked feature available, or the kill switch would
 * be a suggestion.
 */
function globallyBlockedFeatures(row) {
  if (!row || !row.blocked) return [];

  const entries =
    row.blocked instanceof Map
      ? [...row.blocked.entries()]
      : Object.entries(row.blocked);

  return entries.filter(([, blocked]) => Boolean(blocked)).map(([key]) => key);
}

/**
 * Effective allowed features for a tenant.
 *
 * Order of precedence, from most specific to least:
 *   1. feature catalog overrides (admin-edited)
 *   2. plan catalogue (static)
 *
 * The catalog is an allowlist override only. It cannot grant a feature the
 * platform does not know about, and it is applied *after* the subscription row
 * has already determined the base set the plan would grant.
 *
 * In the active/grace path the catalog is an override allowlist on top of the
 * plan's feature set: toggling loyalty on in the catalog opens loyalty for a
 * Starter tenant even though the Starter plan file does not list it. In the
 * degraded / lapsed / terminated paths the catalog still cannot reopen paid
 * modules.
 *
 * `BASE_FEATURES` in `src/models/FeatureCatalog` is the catalog-editable
 * surface for this release. `scratch` is intentionally not in that surface, so
 * toggling scratch in the catalog row does nothing.
 */
async function effectiveAllowedFeatures({
  subscription,
  subscriptionAllowedFeatures,
  catalogOverrideAllowedFeatures,
  globallyBlockedFeatures: blockedFeatures = [],
  status,
  isTerminated,
  isDegraded,
  isCancelled,
} = {}) {
  // If the caller already resolved the subscription-derived base set, honour it.
  const base =
    subscriptionAllowedFeatures ??
    computeSubscriptionAllowedFeatures({
      subscription,
      status,
      isTerminated,
      isDegraded,
      isCancelled,
    });

  const universe = baseFeatureUniverse();
  // A platform-wide block is applied last and to every path: it is the
  // emergency control, and a plan entitlement must never re-open it.
  const blocked = new Set((blockedFeatures || []).filter((f) => universe.includes(f)));
  const withoutBlocked = (list) => list.filter((f) => !blocked.has(f));

  if (isTerminated) {
    return [];
  }
  if (isDegraded || isCancelled) {
    // A lapsed tenant keeps the core set; the catalog can narrow it but must
    // never widen it back to paid modules.
    return withoutBlocked(base);
  }

  if (!catalogOverrideAllowedFeatures) {
    // No catalog: the plan file decides. Keep only features the platform
    // recognises, so a stale row never leaks a removed key.
    return withoutBlocked(base.filter((f) => universe.includes(f)));
  }

  // The catalog is an allowlist override on top of whatever the plan already
  // grants. Any flag for a feature the platform does not know about is ignored,
  // but every known feature is in scope for the catalog regardless of whether the
  // current plan lists it.
  const overrideSet = new Set(
    catalogOverrideAllowedFeatures.filter((f) => universe.includes(f))
  );

  // Unrecognised flags never leak into the effective set. `scratch` is not in
  // the base feature universe the catalog is allowed to open because it is
  // deliberately excluded from the override surface for this platform release,
  // so it is left out of the effective universe here even though the row may
  // store it.
  const effectiveUniverse = universe.filter((f) => BASE_FEATURE_KEYS.has(f));

  // If the catalog has any enabled flag, it is an override allowlist on top of
  // the plan's feature set, not just a narrows. A tenant whose plan does not
  // include `loyalty` still gets it when the catalog says so, as long as loyalty
  // is in the catalog-editable base feature surface.
  if (overrideSet.size > 0) {
    // A catalog grant can add a base feature the plan did not include, and a
    // catalog revocation can switch a plan-included base feature off. Base
    // features the catalog is allowed to edit survive or disappear according to
    // the catalog; everything else keeps whatever the plan gave it.
    // The catalog is an override on top of the plan, not a replacement for it.
    // Any feature the plan already included is preserved. The catalog can still
    // add a base feature the plan did not include (for example, opening loyalty
    // on a Starter tenant), and it can switch a base feature off. Non-base
    // features that the catalog is not allowed to edit are left untouched.
    const effectiveUniverseSet = new Set(effectiveUniverse);
    const effective = new Set(
      base
        .filter((f) => universe.includes(f))
        .map((f) => {
          if (effectiveUniverseSet.has(f)) {
            // Base-included feature: keep it unless the catalog explicitly
            // turns it off. Returning `f` means "preserve the plan decision".
            return f;
          }
          return f;
        })
    );
    for (const f of effectiveUniverse) {
      if (overrideSet.has(f) && !effective.has(f)) effective.add(f);
    }
    return withoutBlocked([...effective]);
  }

  return withoutBlocked(base.filter((f) => universe.includes(f)));
}

/** The plan-derived base set before any catalog override. */
function computeSubscriptionAllowedFeatures({
  subscription,
  isTerminated,
  isDegraded,
  isCancelled,
} = {}) {
  if (isTerminated) {
    return [];
  }
  if (isDegraded || isCancelled) {
    return [...CORE_FEATURES];
  }

  const plan = getPlan(subscription?.planKey) || getPlan(DEFAULT_TRIAL_PLAN);
  return (plan.features || []).filter((f) => KNOWN_FEATURE_KEYS.includes(f));
}

/**
 * Convenience predicate used by enforcement middleware.
 *
 * Accepts either a bare feature array or a resolved `access` object. The
 * original version only handled the array, while every caller (including
 * `subscriptionMiddleware.requireFeature`) passed the access object — so the
 * "is this plan allowed" check threw a TypeError instead of answering. That is
 * worse than a wrong answer: it surfaced as a 500 and made the gate impossible
 * to trust. Both shapes are supported so a single predicate serves the service,
 * the middleware and the tests.
 */
function hasEffectiveFeature(effectiveAllowed, feature) {
  if (!effectiveAllowed) return false;

  const list = Array.isArray(effectiveAllowed)
    ? effectiveAllowed
    : effectiveAllowed.allowedFeatures;

  return Array.isArray(list) && list.includes(feature);
}

module.exports = {
  FEATURE_COLLECTION_CACHE,
  KNOWN_FEATURE_KEYS,
  baseFeatureUniverse,
  loadCatalog,
  clearCachedCatalog,
  globallyBlockedFeatures,
  effectiveAllowedFeatures,
  hasEffectiveFeature,
  computeSubscriptionAllowedFeatures,
};

const PlanFeatureConfig = require('../models/PlanFeatureConfig');
const AppError = require('../utils/AppError');
const planOverlay = require('../config/planOverlay');
const {
  PAID_PLAN_KEYS,
  getPlan,
  FEATURE_METADATA,
  FEATURE_GROUP_ORDER,
  KNOWN_FEATURES_INCLUDE,
  LIMIT_ROWS,
  LIMIT_ROW_KEYS,
  effectivePlanFeatures,
  effectivePlanLimits,
  effectiveIncludedOutlets,
} = require('../config/plans');
const { loadCatalog } = require('./featureCatalogService');

/**
 * Plan-wise feature configuration.
 *
 * ── The model ───────────────────────────────────────────────────────────
 * A *plan* says what its subscribers get. That is a different thing from the
 * global feature catalog (a platform-wide availability override) and a
 * different thing again from a per-tenant entitlement override (one café, one
 * exception). This service owns the first of the three and nothing else.
 *
 * The three layers, from most specific to least:
 *
 *   1. account-level override — one café, one exception (Subscription row)
 *   2. global availability — platform-wide grant/block (FeatureCatalog row)
 *   3. **plan entitlement — what this plan includes** (this service)
 *
 * A plan change is therefore never the thing that decides a single tenant's
 * access on its own: it decides the baseline the other two layers adjust.
 *
 * ── Persistence ─────────────────────────────────────────────────────────
 * `PlanFeatureConfig` holds one document per plan. The catalogue in
 * `config/plans.js` remains the baseline; this service merges the persisted
 * document over it and publishes the result to `config/planOverlay`, which is
 * what `quote()`, `publicCatalogue()` and `subscriptionService` read. There is
 * exactly one resolution path — the same `entitlementService` that protects
 * the application's APIs.
 *
 * ── Caching ─────────────────────────────────────────────────────────────
 * The overlay is cached in-process for a few seconds and invalidated on every
 * write. The TTL is what makes a change made on one instance visible to the
 * others; the invalidation is what makes it visible immediately on the
 * instance that made it.
 */

// ── Cache ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5000;

/** @type {{rows: Array<object>|null, loadedAt: number}} */
let cache = { rows: null, loadedAt: 0 };

/**
 * Mongoose hands a `Map` back as a `Map` on a hydrated document and as a plain
 * object on a `.lean()` result. Both have to read the same way.
 */
const toPlainObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === 'function') return value.toObject();
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return { ...value };
};

/**
 * The metric rows of a limit map, without the plan-level rows.
 *
 * `includedOutlets` is a *plan* row: it is the number of outlets bundled in
 * the price, not a metered usage quota. It has its own column on the model and
 * its own accessor in the catalogue, so letting it travel inside the metrics
 * map would give the same fact two homes — and they would eventually
 * disagree.
 */
const metricLimitsOnly = (limits) => {
  const out = {};
  for (const key of Object.keys(limits || {})) {
    if (LIMIT_ROWS[key] && LIMIT_ROWS[key].kind === 'metric') out[key] = limits[key];
  }
  return out;
};

/** The persisted rows, plus the overlay they imply. */
const rowsToOverlay = (rows) => {
  const overlay = new Map();
  for (const row of rows || []) {
    overlay.set(row.planKey, {
      features: toPlainObject(row.features),
      limits: metricLimitsOnly(toPlainObject(row.limits)),
      includedOutlets: Number.isInteger(row.includedOutlets) ? row.includedOutlets : null,
    });
  }
  return overlay;
};

/**
 * Load the persisted configuration.
 *
 * @param {{force?: boolean}} options `force` bypasses the TTL — used right
 *   after a write so the next read is authoritative.
 */
const loadPlanFeatureConfigs = async ({ force = false } = {}) => {
  const fresh = cache.rows && Date.now() - cache.loadedAt < CACHE_TTL_MS;
  if (!force && fresh) return cache.rows;

  const rows = await PlanFeatureConfig.find().lean();
  cache = { rows, loadedAt: Date.now() };
  planOverlay.setOverlay(rowsToOverlay(rows));
  return rows;
};

/** Make sure the overlay reflects what is persisted. */
const ensureLoaded = async () => loadPlanFeatureConfigs();

/** Drop the cache and the overlay. Used by tests and after a write. */
const clearCache = () => {
  cache = { rows: null, loadedAt: 0 };
  planOverlay.clearOverlay();
};

// ── Reading ──────────────────────────────────────────────────────────────

/** The feature keys of a plan as a plain object, for the matrix. */
const featureMapFor = (planKey) => {
  const features = effectivePlanFeatures(planKey);
  const out = {};
  for (const key of KNOWN_FEATURES_INCLUDE) out[key] = features.includes(key);
  return out;
};

/** The limit rows of a plan as a plain object, for the matrix. */
const limitMapFor = (planKey) => {
  const effective = effectivePlanLimits(planKey);
  const out = {};
  for (const key of LIMIT_ROW_KEYS) {
    if (LIMIT_ROWS[key].kind === 'metric') {
      out[key] = Object.prototype.hasOwnProperty.call(effective, key) ? effective[key] : null;
    } else {
      out[key] = effectiveIncludedOutlets(planKey);
    }
  }
  return out;
};

/** The limit rows of the *baseline* catalogue, for the matrix. */
const baselineLimitMapFor = (planKey) => {
  const plan = getPlan(planKey);
  const out = {};
  for (const key of LIMIT_ROW_KEYS) {
    if (LIMIT_ROWS[key].kind === 'metric') {
      out[key] =
        plan && plan.limits && Object.prototype.hasOwnProperty.call(plan.limits, key)
          ? plan.limits[key]
          : null;
    } else {
      out[key] = plan ? plan.includedOutlets : 1;
    }
  }
  return out;
};

/** The feature keys the global catalog grants / blocks platform-wide. */
const globalAvailability = async () => {
  const catalog = await loadCatalog();
  if (!catalog.exists || !catalog.row) {
    return { exists: false, granted: {}, blocked: {} };
  }

  const features = toPlainObject(catalog.row.features);
  const blocked = toPlainObject(catalog.row.blocked);

  const granted = {};
  const blockedMap = {};
  for (const key of KNOWN_FEATURES_INCLUDE) {
    granted[key] = Boolean(features[key]);
    blockedMap[key] = Boolean(blocked[key]);
  }

  return { exists: true, granted, blocked: blockedMap };
};

/**
 * The plan-wise feature matrix.
 *
 * This is the payload the Plan Configuration page renders: one column per
 * paid plan, one row per registered feature, and the numeric limit rows
 * underneath. Every value is the *effective* one — the catalogue default with
 * the persisted configuration merged over it — so what the operator sees is
 * what a tenant on that plan actually gets.
 */
const buildPlanFeatureMatrix = async () => {
  const rows = await loadPlanFeatureConfigs();
  const rowByPlan = new Map((rows || []).map((row) => [row.planKey, row]));

  const plans = PAID_PLAN_KEYS.map((planKey) => {
    const plan = getPlan(planKey);
    const row = rowByPlan.get(planKey) || null;
    const features = featureMapFor(planKey);
    const baselineFeatures = {};
    for (const key of KNOWN_FEATURES_INCLUDE) {
      baselineFeatures[key] = plan.features.includes(key);
    }
    const limits = limitMapFor(planKey);
    const baselineLimits = baselineLimitMapFor(planKey);

    return {
      key: planKey,
      name: plan.name,
      blurb: plan.blurb,
      order: plan.order,
      isPaid: plan.isPaid,
      // The price comes from the catalogue, never from the browser.
      pricing: {
        currency: 'INR',
        monthly: { paise: plan.monthlyPaise, rupees: plan.monthlyPaise / 100 },
        annual: { paise: plan.annualPaise, rupees: plan.annualPaise / 100 },
        cycles: ['monthly', 'annual'],
      },
      features,
      baselineFeatures,
      limits,
      baselineLimits,
      // A plan with no persisted document is still "version 1": the baseline
      // is what a fresh operator sees before their first save.
      version: row ? row.version : 1,
      configured: Boolean(row),
      updatedAt: row && row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      updatedBy: row ? row.updatedBy || '' : '',
      note: row ? row.note || '' : '',
    };
  });

  const features = KNOWN_FEATURES_INCLUDE.map((key) => ({
    key,
    label: FEATURE_METADATA[key].label,
    group: FEATURE_METADATA[key].group,
    description: FEATURE_METADATA[key].description || '',
    core: Boolean(FEATURE_METADATA[key].core),
  }));

  const limitRows = LIMIT_ROW_KEYS.map((key) => ({
    key,
    label: LIMIT_ROWS[key].label,
    description: LIMIT_ROWS[key].description || '',
    unit: LIMIT_ROWS[key].unit,
    period: LIMIT_ROWS[key].period,
    kind: LIMIT_ROWS[key].kind,
    min: LIMIT_ROWS[key].min,
    max: LIMIT_ROWS[key].max,
    unlimitedAllowed: Boolean(LIMIT_ROWS[key].unlimitedAllowed),
  }));

  return {
    plans,
    features,
    groups: FEATURE_GROUP_ORDER,
    limitRows,
    globalAvailability: await globalAvailability(),
  };
};

// ── Writing ──────────────────────────────────────────────────────────────

/** Reject anything the platform does not know how to enforce. */
const validateFeaturePayload = (features, current) => {
  if (features === undefined) return { ...current };
  if (!features || typeof features !== 'object' || Array.isArray(features)) {
    throw new AppError('features must be an object', 400);
  }

  const merged = { ...current };
  for (const [key, value] of Object.entries(features)) {
    if (!KNOWN_FEATURES_INCLUDE.includes(key)) {
      throw new AppError(`Unknown feature key: ${key}`, 400);
    }
    if (typeof value !== 'boolean') {
      throw new AppError(`Feature "${key}" must be true or false`, 400);
    }
    merged[key] = value;
  }
  return merged;
};

const validateLimitPayload = (limits, current) => {
  if (limits === undefined) return { ...current };
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new AppError('limits must be an object', 400);
  }

  const merged = { ...current };
  for (const [key, value] of Object.entries(limits)) {
    const row = LIMIT_ROWS[key];
    if (!row) {
      throw new AppError(`Unknown limit key: ${key}`, 400);
    }

    if (value === null) {
      if (!row.unlimitedAllowed) {
        throw new AppError(`Limit "${key}" does not support an unlimited value`, 400);
      }
      merged[key] = null;
      continue;
    }

    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < row.min || numeric > row.max) {
      throw new AppError(
        `Limit "${key}" must be a whole number between ${row.min} and ${row.max}`,
        400
      );
    }
    merged[key] = numeric;
  }
  return merged;
};

/**
 * Save the plan-wise configuration.
 *
 * The whole payload is validated before anything is written: a request that
 * names an unknown feature key must not half-apply. Writes are then applied
 * plan by plan, and a failure part-way through rolls the earlier plans back
 * to the values they had before this call.
 *
 * @param {object} params
 * @param {Array<{planKey: string, features?: object, limits?: object, expectedVersion?: number}>} params.plans
 * @param {string} params.actor  who made the change (an operator's email)
 * @param {string} params.note   why
 */
const savePlanFeatureConfig = async ({ plans, actor = '', note = '' } = {}) => {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new AppError('plans must be a non-empty array', 400);
  }
  if (plans.length > PAID_PLAN_KEYS.length) {
    throw new AppError('too many plans in one request', 400);
  }

  const rows = await loadPlanFeatureConfigs();
  const rowByPlan = new Map((rows || []).map((row) => [row.planKey, row]));

  // ── Validate everything first ──────────────────────────────────────────
  const prepared = [];

  for (const entry of plans) {
    const planKey = String(entry?.planKey || '').trim();
    if (!PAID_PLAN_KEYS.includes(planKey)) {
      throw new AppError(`Unknown or non-configurable plan: ${planKey}`, 400);
    }
    const plan = getPlan(planKey);

    const currentFeatures = featureMapFor(planKey);
    const currentLimits = limitMapFor(planKey);

    const features = validateFeaturePayload(entry.features, currentFeatures);
    const limits = validateLimitPayload(entry.limits, currentLimits);

    const existing = rowByPlan.get(planKey) || null;
    const currentVersion = existing ? existing.version : 1;

    if (entry.expectedVersion !== undefined && entry.expectedVersion !== null) {
      const expected = Number(entry.expectedVersion);
      if (!Number.isInteger(expected)) {
        throw new AppError('expectedVersion must be a whole number', 400);
      }
      if (expected !== currentVersion) {
        const err = new AppError(
          `The ${plan.name} plan was changed by someone else while you were editing. ` +
            'Reload the page and apply your change again.',
          409
        );
        err.code = 'PLAN_CONFIG_CONFLICT';
        err.details = { planKey, expected, current: currentVersion };
        throw err;
      }
    }

    prepared.push({ planKey, plan, features, limits, existing, currentVersion });
  }

  // ── Apply ──────────────────────────────────────────────────────────────
  const written = [];
  const trimNote = String(note || '').slice(0, 300);

  try {
    for (const item of prepared) {
      const before = item.existing
        ? {
            features: toPlainObject(item.existing.features),
            limits: metricLimitsOnly(toPlainObject(item.existing.limits)),
            includedOutlets: item.existing.includedOutlets,
          }
        : null;

      const changes = [];
      const now = new Date();

      for (const key of KNOWN_FEATURES_INCLUDE) {
        const previous = item.existing
          ? Boolean(toPlainObject(item.existing.features)[key])
          : item.plan.features.includes(key);
        if (previous !== item.features[key]) {
          changes.push({
            at: now,
            by: actor,
            kind: 'feature',
            key,
            before: previous,
            after: item.features[key],
            note: trimNote,
          });
        }
      }

      for (const key of LIMIT_ROW_KEYS) {
        const previous = item.existing
          ? limitMapFor(item.planKey)[key]
          : baselineLimitMapFor(item.planKey)[key];
        if (previous !== item.limits[key]) {
          changes.push({
            at: now,
            by: actor,
            kind: 'limit',
            key,
            before: previous,
            after: item.limits[key],
            note: trimNote,
          });
        }
      }

      const update = {
        features: item.features,
        limits: metricLimitsOnly(item.limits),
        includedOutlets: item.limits.includedOutlets ?? null,
        version: item.currentVersion + 1,
        updatedBy: actor,
        note: trimNote,
        changes: changes.length
          ? [...(item.existing?.changes || []), ...changes].slice(-200)
          : item.existing?.changes || [],
      };

      const saved = await PlanFeatureConfig.findOneAndUpdate(
        { planKey: item.planKey },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      written.push({ planKey: item.planKey, before, saved });
    }
  } catch (err) {
    // Put back what was already written — a half-applied plan change is worse
    // than a failed one, because the operator cannot tell what is now true.
    for (const item of written.reverse()) {
      try {
        if (item.before) {
          await PlanFeatureConfig.updateOne(
            { planKey: item.planKey },
            {
              $set: {
                features: item.before.features,
                limits: item.before.limits,
                includedOutlets: item.before.includedOutlets,
              },
            }
          );
        } else {
          await PlanFeatureConfig.deleteOne({ planKey: item.planKey });
        }
      } catch (rollbackError) {
        console.error('Plan configuration rollback failed:', rollbackError.message);
      }
    }
    throw err;
  }

  // Refresh the overlay so the next entitlement read sees the new state.
  await loadPlanFeatureConfigs({ force: true });

  const matrix = await buildPlanFeatureMatrix();
  return {
    ...matrix,
    changedPlans: written.map((item) => item.planKey),
  };
};

module.exports = {
  CACHE_TTL_MS,
  loadPlanFeatureConfigs,
  ensureLoaded,
  clearCache,
  featureMapFor,
  limitMapFor,
  baselineLimitMapFor,
  globalAvailability,
  buildPlanFeatureMatrix,
  savePlanFeatureConfig,
};

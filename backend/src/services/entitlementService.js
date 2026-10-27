const AppError = require('../utils/AppError');
const UsageCounter = require('../models/UsageCounter');
const UsageLedger = require('../models/UsageLedger');
const { USAGE_LEDGER_STATUS } = require('../models/UsageLedger');
const {
  METRICS,
  METRIC_CONFIG,
  KNOWN_FEATURES_INCLUDE,
  isMetric,
  planLimit,
  isKnownFeature,
} = require('../config/plans');
const subscriptionService = require('./subscriptionService');

/**
 * The one place that answers "may this tenant do this, right now?".
 *
 * ── Why a service and not middleware ─────────────────────────────────────
 * Feature access is needed in three different shapes:
 *   - an HTTP gate (`requireFeature` on a route),
 *   - a business-rule gate inside a service (`orderService` must not write an
 *     order past the plan's monthly allowance, whoever called it),
 *   - a read for the UI (`GET /api/subscription/entitlements`).
 * Implementing the policy in each controller would guarantee three versions of
 * it that drift. Every caller resolves through here instead, and the middleware
 * is a thin adapter over `requireFeature`.
 *
 * ── Trust boundary ───────────────────────────────────────────────────────
 * Nothing in this module reads a request body. Entitlements come from the
 * tenant's `Subscription` row (written only by the billing webhook / super-admin
 * control plane) and the static plan catalogue. A client can send whatever plan
 * name it likes; it is never consulted.
 *
 * ── Fail-closed ──────────────────────────────────────────────────────────
 * If the subscription cannot be resolved, or a feature key is unknown, or the
 * plan does not list the entitlement, access is denied. A missing numeric limit
 * is only ever treated as unlimited for metrics that declare `period` in
 * `METRIC_CONFIG` — never for a feature that simply was not configured.
 */

const { RESERVED, COMMITTED, RELEASED } = USAGE_LEDGER_STATUS;

/** `YYYY-MM` in UTC, or `lifetime` for stock limits. */
const periodKeyFor = (metric, now = new Date()) => {
  const config = METRIC_CONFIG[metric];
  if (!config) return 'unknown';
  if (config.period === 'lifetime') return 'lifetime';

  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Start/end of the period a key belongs to, for display and reset explanation. */
const periodBoundsFor = (metric, now = new Date()) => {
  const config = METRIC_CONFIG[metric];
  if (!config || config.period === 'lifetime') return { start: null, end: null };

  const d = new Date(now);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
};

const quotaError = (metric, { limit, used, reserved, requested }) => {
  const config = METRIC_CONFIG[metric] || { label: metric, unit: 'unit' };
  const detail = limit == null ? '' : ` (${used + reserved}/${limit} used)`;
  const err = new AppError(
    `Your plan's ${config.label.toLowerCase()} allowance has been reached${detail}. ` +
      `Upgrade your plan or wait for the next billing period.`,
    402
  );
  err.code = 'QUOTA_EXCEEDED';
  err.details = {
    metric,
    limit,
    used,
    reserved,
    requested,
    period: config.period,
  };
  return err;
};

const featureError = (feature, access) => {
  if (access && access.isTerminated) {
    return new AppError('This account has been suspended. Contact QRDine support.', 410);
  }
  if (access && (access.isDegraded || access.isCancelled)) {
    const err = new AppError(
      'Your subscription has lapsed, so this feature is unavailable until you renew. ' +
        'Ordering and billing at the counter still work.',
      402
    );
    err.code = 'SUBSCRIPTION_LAPSED';
    err.details = { feature };
    return err;
  }
  const err = new AppError(
    'This feature is not included in your current plan. Upgrade to use it.',
    403
  );
  err.code = 'FEATURE_NOT_ENTITLED';
  err.details = { feature };
  return err;
};

/**
 * Apply account-level exceptions to the plan-derived set.
 *
 * Revocations (enabled: false) win over grants and over the plan, so support can
 * switch one module off for one tenant. Grants can add a known feature but never
 * resurrect a terminated tenant, and unknown keys are ignored — an override is
 * an exception on top of the catalogue, not a way to invent one.
 */
const applyOverrides = (features, overrides = [], now = new Date()) => {
  const set = new Set(features);

  for (const override of overrides || []) {
    if (!override || !isKnownFeature(override.featureKey)) continue;
    if (override.expiresAt && new Date(override.expiresAt) <= now) continue;

    if (override.enabled) set.add(override.featureKey);
    else set.delete(override.featureKey);
  }

  return [...set];
};

/** The tenant's subscription row. Never creates one implicitly for reads. */
const getSubscriptionForCafe = async (cafeId) =>
  subscriptionService.ensureSubscription(cafeId);

/**
 * Resolved entitlements for a tenant.
 *
 * `features` is the authoritative allowlist. `limits` carries the numeric
 * allowances. Both are plain values so they can be returned to the admin UI
 * without leaking billing internals.
 */
const getEntitlementsForCafe = async (cafeId, { now = new Date() } = {}) => {
  if (!cafeId) throw new AppError('Tenant context is missing', 401);

  const { subscription, access } = await subscriptionService.getAccessForCafe(cafeId, { now });

  // A terminated tenant holds no entitlements at all — not even overrides.
  const base = access.isTerminated ? [] : access.allowedFeatures || [];
  const features = access.isTerminated ? [] : applyOverrides(base, subscription.entitlementOverrides, now);

  const featureSet = new Set(features);
  // Recompute after overrides: `access.blockedFeatures` reflects the plan before
  // an exception was applied, so a comp'd feature would otherwise be reported as
  // both allowed and blocked. The two lists must partition the catalogue.
  const blockedFeatures = KNOWN_FEATURES_INCLUDE.filter((f) => !featureSet.has(f));

  return {
    cafeId: subscription.cafeId,
    planKey: access.planKey,
    planName: access.planName,
    planVersion: access.planVersion,
    planVersionIsCurrent: access.planVersionIsCurrent,
    status: access.status,
    isTerminated: access.isTerminated,
    isDegraded: access.isDegraded,
    isCancelled: access.isCancelled,
    inGrace: access.inGrace,
    isPayable: access.isPayable,
    paidUntil: access.paidUntil,
    features,
    blockedFeatures,
    limits: { ...(access.limits || {}) },
    // Convenience predicates. The array stays the source of truth so the
    // frontend and the backend can never disagree about what "entitled" means.
    hasFeature: (featureKey) => featureSet.has(featureKey),
    limitFor: (metric) => {
      if (metric === METRICS.OUTLETS) return access.outletLimit ?? null;
      return planLimit({ limits: access.limits }, metric);
    },
  };
};

const hasFeature = (entitlements, featureKey) =>
  Boolean(entitlements && typeof entitlements.hasFeature === 'function'
    ? entitlements.hasFeature(featureKey)
    : Array.isArray(entitlements?.features) && entitlements.features.includes(featureKey));

/**
 * Throw unless the tenant's plan grants `featureKey`.
 *
 * Unknown keys deny. This is deliberate: a typo in a route declaration must fail
 * loudly in tests rather than becoming a permanently free endpoint.
 */
const requireFeature = async (cafeId, featureKey, { now = new Date() } = {}) => {
  if (!isKnownFeature(featureKey)) {
    const err = new AppError('Unknown feature entitlement', 403);
    err.code = 'FEATURE_UNKNOWN';
    err.details = { feature: featureKey };
    throw err;
  }

  const entitlements = await getEntitlementsForCafe(cafeId, { now });

  if (entitlements.isTerminated) throw featureError(featureKey, entitlements);
  if (!hasFeature(entitlements, featureKey)) throw featureError(featureKey, entitlements);
  return entitlements;
};

/**
 * Non-mutating quota check, for endpoints that want to fail early (a dashboard
 * that would otherwise stream a report it cannot afford to generate). The
 * authoritative check is `reserveUsage`; this must never substitute for it on a
 * path that actually consumes the allowance.
 */
const requireQuota = async (cafeId, metric, amount = 1, { now = new Date() } = {}) => {
  if (!isMetric(metric)) {
    const err = new AppError('Unknown usage metric', 500);
    err.code = 'METRIC_UNKNOWN';
    throw err;
  }

  const summary = await getUsageSummary(cafeId, metric, { now });

  if (!summary.unlimited && summary.remaining < amount) {
    throw quotaError(metric, {
      limit: summary.limit,
      used: summary.used,
      reserved: summary.reserved,
      requested: amount,
    });
  }

  return summary;
};

/**
 * Claim `amount` units of `metric`, atomically.
 *
 * Returns a reservation handle that the caller must either `commitUsage` (work
 * succeeded — the unit is spent) or `releaseUsage` (work failed — the unit is
 * returned). A caller that does neither leaks a reservation until the period
 * rolls over, so both paths are exercised in tests.
 *
 * `idempotencyKey` is what makes a retry free. Two requests with the same key
 * and metric never consume two units: the second attaches to the first row.
 *
 * Concurrency: the conditional `findOneAndUpdate` compares
 * `used + reserved + amount <= limit` inside the database, so N simultaneous
 * requests cannot all observe "one slot left". The loser gets `null` back and the
 * caller sees QUOTA_EXCEEDED.
 */
const reserveUsage = async (
  cafeId,
  metric,
  amount = 1,
  { idempotencyKey = null, referenceType = '', referenceId = null, now = new Date() } = {}
) => {
  if (!cafeId) throw new AppError('Tenant context is missing', 401);

  const qty = Number(amount);
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) {
    throw new AppError('Usage amount must be a positive whole number', 400);
  }
  if (!isMetric(metric)) {
    // A programming error, not a user error: it would silently meter nothing.
    const err = new AppError('Unknown usage metric', 500);
    err.code = 'METRIC_UNKNOWN';
    throw err;
  }

  const entitlements = await getEntitlementsForCafe(cafeId, { now });
  if (entitlements.isTerminated) throw featureError(null, entitlements);

  const periodKey = periodKeyFor(metric, now);
  const limit = entitlements.limitFor(metric);
  const unlimited = limit == null;

  // 1. Write the ledger row.
  //
  // This happens even with no idempotency key. The row is the handle a
  // reservation is committed or released through, so skipping it for un-keyed
  // usage left the unit stuck in `reserved` forever — the counter would slowly
  // inflate with work that had already finished and eventually refuse orders
  // the cafe had every right to place.
  let ledger = null;
  let duplicate = false;

  const ledgerKey = {
    cafeId,
    metric,
    periodKey,
    idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
  };

  try {
    ledger = await UsageLedger.create({
      ...ledgerKey,
      amount: qty,
      status: RESERVED,
      referenceType,
      referenceId: referenceId || null,
    });
  } catch (err) {
    // Only a supplied key can collide; a null key is excluded from the partial
    // unique index.
    if (!err || err.code !== 11000) throw err;

    const existing = await UsageLedger.findOne(ledgerKey);
    if (!existing) {
      // Extremely unlikely (deleted between insert and read): treat as a
      // duplicate and let the caller proceed without charging again.
      return { duplicate: true, alreadyCharged: true, unlimited, metric, periodKey, limit };
    }

    if (existing.status === RELEASED) {
      // A retry of an operation that previously failed. Re-open the same row
      // rather than creating a second one, so the ledger stays one row per
      // business operation.
      ledger = await UsageLedger.findOneAndUpdate(
        { _id: existing._id, status: RELEASED },
        { $set: { status: RESERVED, releasedAt: null, releaseReason: '' } },
        { new: true }
      );

      if (!ledger) {
        // Lost the race to another retry: it holds the slot now.
        return { duplicate: true, alreadyCharged: true, unlimited, metric, periodKey, limit };
      }
    } else {
      // Already reserved (in flight) or committed (done). Either way this
      // request must not consume another unit.
      return {
        duplicate: true,
        alreadyCharged: true,
        reservationId: existing._id,
        unlimited,
        metric,
        periodKey,
        limit,
      };
    }
  }

  // 2. Take the unit(s).
  const reservation = {
    reservationId: ledger ? ledger._id : null,
    cafeId,
    metric,
    periodKey,
    amount: qty,
    unlimited,
    limit,
    duplicate,
    idempotencyKey: idempotencyKey || null,
  };

  if (unlimited) {
    // Nothing to enforce, but the usage is still recorded: the owner's usage
    // report and any future metered pricing depend on it. An accounting write
    // failing must not fail the customer's order.
    try {
      await UsageCounter.updateOne(
        { cafeId, metric, periodKey },
        { $inc: { used: qty }, $setOnInsert: { reserved: 0 } },
        { upsert: true }
      );
    } catch (err) {
      console.error(`Usage counter write failed (non-blocking, unlimited ${metric}):`, err.message);
    }
    return reservation;
  }

  // Ensure the row exists before the conditional update. The upsert can lose a
  // race and raise E11000; the winner created exactly the row we need.
  await UsageCounter.updateOne(
    { cafeId, metric, periodKey },
    { $setOnInsert: { used: 0, reserved: 0 } },
    { upsert: true }
  ).catch((err) => {
    if (!err || err.code !== 11000) throw err;
  });

  const claimed = await UsageCounter.findOneAndUpdate(
    {
      cafeId,
      metric,
      periodKey,
      // used + reserved + this request must fit inside the plan's allowance.
      $expr: { $lte: [{ $add: ['$used', '$reserved', qty] }, limit] },
    },
    { $inc: { reserved: qty } },
    { new: true }
  );

  if (!claimed) {
    // Give the idempotency slot back so a later, successful retry is charged.
    if (ledger) {
      await UsageLedger.findOneAndUpdate(
        { _id: ledger._id, status: RESERVED },
        { $set: { status: RELEASED, releasedAt: new Date(), releaseReason: 'quota exceeded' } }
      ).catch(() => {});
    }

    const current = await UsageCounter.findOne({ cafeId, metric, periodKey }).lean();
    throw quotaError(metric, {
      limit,
      used: current ? current.used : 0,
      reserved: current ? current.reserved : 0,
      requested: qty,
    });
  }

  return reservation;
};

/** Mark a reservation as spent. Idempotent: a second commit is a no-op. */
const commitUsage = async (reservation, { referenceId = null } = {}) => {
  if (!reservation || !reservation.reservationId) return false;

  const committed = await UsageLedger.findOneAndUpdate(
    { _id: reservation.reservationId, status: RESERVED },
    {
      $set: {
        status: COMMITTED,
        committedAt: new Date(),
        ...(referenceId ? { referenceId } : {}),
      },
    },
    { new: true }
  );

  // Already committed or released — do not touch the counter twice.
  if (!committed) return false;

  if (!reservation.unlimited) {
    await UsageCounter.updateOne(
      { cafeId: reservation.cafeId, metric: reservation.metric, periodKey: reservation.periodKey },
      { $inc: { reserved: -reservation.amount, used: reservation.amount } }
    );
  }

  return true;
};

/** Return an unspent reservation. Idempotent: a second release is a no-op. */
const releaseUsage = async (reservation, reason = 'operation failed') => {
  if (!reservation || !reservation.reservationId) return false;

  const released = await UsageLedger.findOneAndUpdate(
    { _id: reservation.reservationId, status: RESERVED },
    {
      $set: {
        status: RELEASED,
        releasedAt: new Date(),
        releaseReason: String(reason || 'operation failed').slice(0, 300),
      },
    },
    { new: true }
  );

  if (!released) return false;

  if (!reservation.unlimited) {
    await UsageCounter.updateOne(
      { cafeId: reservation.cafeId, metric: reservation.metric, periodKey: reservation.periodKey },
      { $inc: { reserved: -reservation.amount } }
    );
  }

  return true;
};

/**
 * What a tenant has used this period, and what is left.
 *
 * `remaining` subtracts in-flight reservations too, so two nearly-simultaneous
 * callers are not both told "1 left". For unlimited metrics `limit` is null and
 * `remaining` is null — callers must check `unlimited` rather than treating
 * `remaining: null` as zero.
 */
const getUsageSummary = async (cafeId, metric, { now = new Date() } = {}) => {
  if (!isMetric(metric)) {
    const err = new AppError('Unknown usage metric', 500);
    err.code = 'METRIC_UNKNOWN';
    throw err;
  }

  const entitlements = await getEntitlementsForCafe(cafeId, { now });
  const periodKey = periodKeyFor(metric, now);
  const limit = entitlements.limitFor(metric);
  const config = METRIC_CONFIG[metric];

  const row = await UsageCounter.findOne({ cafeId, metric, periodKey }).lean();
  const used = row ? row.used : 0;
  const reserved = row ? row.reserved : 0;
  const unlimited = limit == null;
  const bounds = periodBoundsFor(metric, now);

  return {
    metric,
    label: config.label,
    unit: config.unit,
    period: config.period,
    periodKey,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    limit,
    unlimited,
    used,
    reserved,
    remaining: unlimited ? null : Math.max(0, limit - used - reserved),
    onExhausted: config.onExhausted,
  };
};

/** Every metered metric for a tenant, for the admin usage panel. */
const getUsageOverview = async (cafeId, { now = new Date(), metrics } = {}) => {
  const list = metrics || Object.keys(METRIC_CONFIG);
  return Promise.all(list.map((metric) => getUsageSummary(cafeId, metric, { now })));
};

/**
 * Convenience wrapper: run `fn` inside a reserved unit.
 *
 * Reserves before the work (the point of a quota), commits on success, and
 * releases on failure — including an exception, so a validation error inside
 * `fn` never costs the tenant an order.
 */
const withUsage = async (
  { cafeId, metric, amount = 1, idempotencyKey = null, referenceType = '', now = new Date() },
  fn
) => {
  const reservation = await reserveUsage(cafeId, metric, amount, {
    idempotencyKey,
    referenceType,
    now,
  });

  if (reservation.duplicate) {
    // The unit belongs to an earlier request with the same idempotency key. It
    // is either already committed (this is a replay — the business operation
    // happened the first time) or still in flight (that request owns the
    // commit/release). Either way this call must not touch it.
    return { result: await fn(reservation), reservation };
  }

  let result;
  try {
    result = await fn(reservation);
  } catch (err) {
    await releaseUsage(reservation, err && err.message ? err.message : 'operation failed').catch(
      () => {}
    );
    throw err;
  }

  await commitUsage(reservation, {
    referenceId: result && result.order && result.order._id ? result.order._id : null,
  }).catch((err) => {
    console.error('Usage commit failed (non-fatal, unit stays reserved):', err.message);
  });

  return { result, reservation };
};

module.exports = {
  METRICS,
  periodKeyFor,
  periodBoundsFor,
  applyOverrides,
  getSubscriptionForCafe,
  getEntitlementsForCafe,
  hasFeature,
  requireFeature,
  requireQuota,
  reserveUsage,
  commitUsage,
  releaseUsage,
  getUsageSummary,
  getUsageOverview,
  withUsage,
};

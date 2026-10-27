const AppError = require('../utils/AppError');
const entitlementService = require('../services/entitlementService');
const { getAccessForCafe, SUBSCRIPTION_STATUS } = require('../services/subscriptionService');

/**
 * Subscription enforcement — admin side only.
 *
 * ── Scope ────────────────────────────────────────────────────────────────
 * These middlewares gate the *tenant's own management surface*: menu editing,
 * analytics, loyalty, coupons. They deliberately do NOT touch the guest-facing
 * customer app (`customerAppRoutes`), which resolves its tenant from a table or
 * session rather than a user token.
 *
 * That omission is the point. A café's guest must always be able to open the
 * menu, place an order and pay at the counter, whether or not that café has
 * paid us. Gating a customer scan behind *our* billing state would mean an
 * expired subscription costs the café its customers — a punishment that hits
 * our customers, not our customer.
 *
 * The one exception is a *terminated* tenant, which must not keep trading: the
 * order engine blocks new orders for a terminated café explicitly. See
 * `entitlementService.requireFeature` for the status ladder.
 *
 * Mount `attachSubscription` after `tenantMiddleware` (it needs `req.cafeId`)
 * and before any `requireFeature`.
 */
const attachSubscription = async (req, res, next) => {
  try {
    // No tenant context means this is not an authenticated tenant route
    // (health, docs, /auth/csrf). Nothing to enforce.
    if (!req.cafeId) return next();

    const { subscription, access } = await getAccessForCafe(req.cafeId);
    req.subscription = subscription;
    req.subscriptionAccess = access;
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Require that the tenant's current plan grants `feature`.
 *
 * All policy lives in `entitlementService.requireFeature` — this is an adapter,
 * so the HTTP status codes and the in-service rules can never diverge.
 *
 *   402 — paid for, or past due: "settle your bill to use this"  (lapsed)
 *   403 — not on a plan that includes this: "upgrade to use this"
 *   410 — account terminated by us
 *
 * Mounting `requireFeature` without a tenant context is a wiring bug. Failing
 * closed with a 500 keeps the bug visible instead of turning the route into a
 * permanently-free endpoint.
 */
const requireFeature = (feature) => async (req, res, next) => {
  try {
    if (!req.cafeId) {
      return next(new AppError('Subscription context is missing', 500));
    }

    const entitlements = await entitlementService.requireFeature(req.cafeId, feature);
    // Downstream handlers may want the resolved set without re-querying.
    req.entitlements = entitlements;
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Gate any write at all. Used for the handful of settings that a lapsed
 * tenant must not be able to change — not to stop the counter working, but so
 * a degraded café cannot quietly reconfigure itself out of a problem.
 */
const requireActiveSubscription = (req, res, next) => {
  const access = req.subscriptionAccess;
  if (!access) return next(new AppError('Subscription context is missing', 500));

  if (access.isTerminated) {
    return next(new AppError('This account has been suspended. Contact QRDine support.', 410));
  }
  return next();
};

/**
 * Reject a request whose metered allowance is exhausted.
 *
 * This is a *pre-check* for endpoints that would do expensive work (generate a
 * report, call an external API). It is not the authority: anything that actually
 * consumes a unit must go through `entitlementService.reserveUsage`, which is
 * atomic. A middleware can only ever race.
 */
const requireQuota = (metric, amount = 1) => async (req, res, next) => {
  try {
    if (!req.cafeId) {
      return next(new AppError('Subscription context is missing', 500));
    }
    await entitlementService.requireQuota(req.cafeId, metric, amount);
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Block a cafe from operating more outlets than it has paid for.
 *
 * Outlets are a *count*, not a feature flag, because they are sold per outlet
 * on every plan. Checked on create and on any write that would start using a
 * new outlet.
 *
 * STATUS: not mounted anywhere today, because the product has no
 * outlet-creation endpoint. A second outlet is a second `Cafe` document sharing
 * an `outletGroup`, `PUT /api/cafe` does not accept `outletGroup`, and nothing
 * else writes a cafe — so there is no request to guard yet. The check is kept
 * and exported (with its index-backed count) so the first endpoint that creates
 * an outlet can mount it instead of re-deriving the rule. It is listed as a
 * known gap in `docs/SUBSCRIPTION_ENTITLEMENTS.md` rather than claimed as
 * enforced.
 */
const assertOutletWithinLimit = async (req, res, next) => {
  try {
    if (!req.cafeId) return next(new AppError('Subscription context is missing', 500));

    const entitlements = await entitlementService.getEntitlementsForCafe(req.cafeId);
    if (entitlements.isTerminated) {
      return next(new AppError('This account has been suspended. Contact QRDine support.', 410));
    }

    const Cafe = require('../models/Cafe');
    const cafe = await Cafe.findById(req.cafeId).select('outletGroup').lean();

    // `outletGroup` defaults to ''. Counting `{ outletGroup: '' }` would match
    // every standalone cafe in the product and wrongly report the tenant as
    // over its limit. An empty group means "this cafe is its own outlet".
    const outletGroup = cafe && cafe.outletGroup ? cafe.outletGroup : null;
    const outletCount = outletGroup ? await Cafe.countDocuments({ outletGroup }) : 1;

    const outletLimit = entitlements.limitFor(entitlementService.METRICS.OUTLETS);

    if (outletLimit != null && outletCount >= outletLimit) {
      const err = new AppError(
        `Your plan includes ${outletLimit} outlet(s). Add outlets to your plan to open more.`,
        402
      );
      err.code = 'OUTLET_LIMIT_REACHED';
      err.details = { outletLimit, outletCount };
      return next(err);
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  attachSubscription,
  requireFeature,
  requireActiveSubscription,
  requireQuota,
  assertOutletWithinLimit,
  attachSubscriptionStatus: SUBSCRIPTION_STATUS,
};

const AppError = require('../utils/AppError');
const { getAccessForCafe } = require('../services/subscriptionService');

/**
 * Resolve the tenant for an authenticated operator and enforce a termination ban.
 *
 * ── Why the subscription check lives here ────────────────────────────────
 * This middleware already runs on *every* tenant route (POS, KDS, orders, menu,
 * tables, analytics, …) right after `protect`, so it is the one place that
 * cannot be forgotten. Before this, `superAdminController.terminate` correctly
 * wrote `Subscription.status = 'terminated'` and `computeAccess` correctly
 * reported `isTerminated: true` — but nothing on the request path ever asked,
 * so a terminated café kept logging in and trading. The guards in
 * `subscriptionMiddleware` (`requireFeature`, `requireActiveSubscription`) were
 * never mounted on any route.
 *
 * ── Immediate session revocation ─────────────────────────────────────────
 * JWTs are stateless, so a terminated operator's token stays cryptographically
 * valid until it expires. Because the ban is evaluated on every request (not
 * just at login), an already-issued token stops working the moment the tenant
 * is terminated — no blocklist, no expiry wait.
 *
 * ── Scope ────────────────────────────────────────────────────────────────
 * Only `isTerminated` blocks. A *degraded* tenant must keep taking orders and
 * printing bills; that separation is deliberate and lives in computeAccess.
 * Guest-facing routes never reach here — they resolve their café from a table
 * or session, never from a user token — so diners can still order and pay.
 */
const tenantMiddleware = async (req, res, next) => {
  try {
    if (!req.user || !req.user.cafeId) {
      return next(new AppError('Tenant context is missing', 401));
    }

    req.cafeId = req.user.cafeId;

    // Also exposes req.subscription / req.subscriptionAccess so downstream
    // `requireFeature` gates can use them without a second lookup.
    const { subscription, access } = await getAccessForCafe(req.cafeId);
    req.subscription = subscription;
    req.subscriptionAccess = access;

    if (access.isTerminated) {
      return next(
        new AppError('This account has been suspended. Contact QRDine support.', 410)
      );
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = tenantMiddleware;

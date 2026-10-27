const express = require('express');

const {
  login,
  me,
  overview,
  listCafes,
  getCafe,
  terminateCafe,
  reinstateCafe,
  setPlan,
  extendTrial,
  setEntitlements,
  expiringSoon,
} = require('../controllers/superAdminController');
const {
  listStaff,
  createStaff,
  updateStaff,
  resetStaffPassword,
  unlockStaff,
} = require('../controllers/superAdminStaffController');
const {
  getCatalog,
  upsertCatalog,
} = require('../controllers/featureCatalogAdminController');
const {
  getPlanConfig,
  savePlanConfig,
} = require('../controllers/planFeatureConfigController');
const { protectSuperAdmin, authorizeSuperAdminRoles, superAdminRoles, TERMINATION_ROLES } =
  require('../middlewares/superAdminMiddleware');
const { authLimiter } = require('../middlewares/rateLimiter');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');

const router = express.Router();

/**
 * Cross-tenant control plane.
 *
 * Mounted at `/api/superadmin`, never under `/api/cafe`, and authenticated by a
 * different middleware against a different collection. There is deliberately no
 * `tenantMiddleware` here: a super admin belongs to no tenant.
 */

// Rate-limited because this is the highest-value credential in the system —
// the one that can terminate every customer.
router.post('/login', authLimiter, login);

router.use(protectSuperAdmin);

router.get('/me', me);
router.get('/overview', overview);
router.get('/cafes', listCafes);
router.get('/cafes/:cafeId', getCafe);
router.get('/expiring', expiringSoon);

// Read-only for anyone; changes need at least `support`.
router.post('/cafes/:cafeId/plan', validateCsrfToken, authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN, superAdminRoles.SUPPORT), setPlan);
// Per-tenant feature grants/revocations. Support may do this (it is a customer
// service action) but it is audited with the operator's identity.
router.put('/cafes/:cafeId/entitlements', validateCsrfToken, authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN, superAdminRoles.SUPPORT), setEntitlements);
router.post('/cafes/:cafeId/extend-trial', validateCsrfToken, authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN, superAdminRoles.SUPPORT), extendTrial);

// Full lock-out and its undo are superadmin-only: support can fix billing, but
// only a superadmin can take a cafe out of its own business.
router.post('/cafes/:cafeId/terminate', validateCsrfToken, authorizeSuperAdminRoles(...TERMINATION_ROLES), terminateCafe);
router.post('/cafes/:cafeId/reinstate', validateCsrfToken, authorizeSuperAdminRoles(...TERMINATION_ROLES), reinstateCafe);

// ── Platform staff ───────────────────────────────────────────────────────
// Managing the operator roster is the highest-privilege action in the control
// plane: whoever holds it can grant themselves anything else. It is therefore
// restricted to `superadmin` — not `support`, and not `readonly`.
//
// These endpoints replace `scripts/create-superadmin.js`, which required shell
// access and was the last thing that could not be done from the panel.
router.get('/staff', authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN), listStaff);
router.post('/staff', validateCsrfToken, authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN), createStaff);
router.patch('/staff/:staffId', validateCsrfToken, authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN), updateStaff);
router.post('/staff/:staffId/password', validateCsrfToken, authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN), resetStaffPassword);
router.post('/staff/:staffId/unlock', validateCsrfToken, authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN), unlockStaff);

// ── Feature catalog (admin-editable feature access) ──────────────────────
// Read-only for support; writes are superadmin-only.
router.get('/feature-catalog', authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN, superAdminRoles.SUPPORT), getCatalog);
router.put('/feature-catalog', validateCsrfToken, authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN), upsertCatalog);

// ── Plan configuration (plan-wise feature entitlements) ──────────────────
// The matrix behind the control plane's "Plan Configuration": one column per
// paid plan, one row per registered feature, each cell an independent
// entitlement for that plan.
//
// This is *not* the feature catalog above. The catalog is a platform-wide
// availability override (grant / block); this is what each plan includes. The
// two are applied in that order, and a global block wins over a plan
// entitlement.
//
// Reads are available to support and readonly operators; changing what a plan
// includes is superadmin-only, because it reprices every subscriber on that
// plan at once.
router.get('/plan-config', authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN, superAdminRoles.SUPPORT), getPlanConfig);
router.put('/plan-config', validateCsrfToken, authorizeSuperAdminRoles(superAdminRoles.SUPERADMIN), savePlanConfig);

module.exports = router;
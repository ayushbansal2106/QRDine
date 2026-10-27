const express = require('express');

const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const {
  getMenu,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getMenuPublic,
  updateMenuItemAvailability,
  searchMenuPublic,
} = require('../controllers/menuController');
const {
  digitize,
  listJobs,
  getJob,
  updateDraft,
  publish,
  listDishLibrary,
} = require('../controllers/menuDigitizationController');
const { requirePermission, requireAnyPermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');

const { publicReadLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Public routes (unauthenticated)
router.get('/public', publicReadLimiter, getMenuPublic);
router.get('/public/search', publicReadLimiter, searchMenuPublic);

router.use(protect, tenantMiddleware, validateCsrfToken);

// ── Module #19 — AI menu digitisation ───────────────────────────
// Registered before the generic `/:id` routes so a job id can never be
// mistaken for a menu item id.
// Digitisation spends real money per call (Gemini vision), so the entitlement is
// checked before the request reaches the controller — and again inside the
// service, which is the only place every caller passes through.
router.get('/digitize/jobs', requireFeature(FEATURES.DIGITIZATION), requirePermission(PERMISSIONS.MENU_MANAGE), listJobs);
router.get('/digitize/jobs/:id', requireFeature(FEATURES.DIGITIZATION), requirePermission(PERMISSIONS.MENU_MANAGE), getJob);
router.put('/digitize/jobs/:id/draft', requireFeature(FEATURES.DIGITIZATION), requirePermission(PERMISSIONS.MENU_MANAGE), updateDraft);
router.post('/digitize/jobs/:id/publish', requireFeature(FEATURES.DIGITIZATION), requirePermission(PERMISSIONS.MENU_MANAGE), publish);
router.post('/digitize', requireFeature(FEATURES.DIGITIZATION), requirePermission(PERMISSIONS.MENU_MANAGE), digitize);
router.get('/dish-library', requireFeature(FEATURES.DIGITIZATION), requirePermission(PERMISSIONS.MENU_MANAGE), listDishLibrary);

router.get('/', authorizeRoles('owner', 'manager', 'cashier', 'waiter', 'barista', 'staff'), getMenu);
router.post('/', requirePermission(PERMISSIONS.MENU_MANAGE), createMenuItem);
router.put('/:id', requirePermission(PERMISSIONS.MENU_MANAGE), updateMenuItem);
router.delete('/:id', requirePermission(PERMISSIONS.MENU_MANAGE), deleteMenuItem);
router.patch(
  '/:id/availability',
  requireAnyPermission(PERMISSIONS.MENU_AVAILABILITY, PERMISSIONS.MENU_MANAGE),
  updateMenuItemAvailability
);

module.exports = router;

const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission, requireAnyPermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const {
  getProgram,
  upsertProgram,
  getCards,
  getCustomerCard,
  adjustCustomerStamps,
  validateVoucher,
  redeemVoucher,
  getMyCard,
} = require('../controllers/loyaltyController');

const router = express.Router();

// Customer-facing (guest-token scoped, no admin auth)
router.get('/me', getMyCard);

// Admin / POS
router.use(protect, tenantMiddleware, validateCsrfToken);

// Loyalty is a paid module. The guest `/me` read above is deliberately left
// open: a guest checking a card that already exists is not the cafe earning new
// loyalty value, and locking it would strand stamps the customer already owns.
router.use(requireFeature(FEATURES.LOYALTY));

router.get('/program', requirePermission(PERMISSIONS.LOYALTY_MANAGE), getProgram);
router.put('/program', requirePermission(PERMISSIONS.LOYALTY_MANAGE), upsertProgram);

router.get('/cards', requirePermission(PERMISSIONS.LOYALTY_MANAGE), getCards);
router.get(
  '/cards/:customerId',
  requireAnyPermission(PERMISSIONS.LOYALTY_MANAGE, PERMISSIONS.CUSTOMER_MANAGE),
  getCustomerCard
);
router.post('/cards/:customerId/stamps', requirePermission(PERMISSIONS.LOYALTY_MANAGE), adjustCustomerStamps);

router.post(
  '/vouchers/validate',
  requireAnyPermission(PERMISSIONS.LOYALTY_MANAGE, PERMISSIONS.POS_USE),
  validateVoucher
);
router.post(
  '/vouchers/redeem',
  requireAnyPermission(PERMISSIONS.LOYALTY_MANAGE, PERMISSIONS.POS_USE),
  redeemVoucher
);

module.exports = router;

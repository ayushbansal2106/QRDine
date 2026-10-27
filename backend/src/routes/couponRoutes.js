const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission, requireAnyPermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const {
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  getAudienceCatalogue,
  previewAudience,
  getCouponGrants,
} = require('../controllers/couponController');

const router = express.Router();

router.use(protect, tenantMiddleware, validateCsrfToken);

// A coupon is a paid marketing module. `validate` is included: honouring a
// coupon the cafe is not entitled to would hand out real discounts from a
// lapsed plan, so the check is on the money path as well as the CRUD path.
router.use(requireFeature(FEATURES.COUPONS));

router.get('/', requirePermission(PERMISSIONS.COUPON_MANAGE), getCoupons);
router.post('/', requirePermission(PERMISSIONS.COUPON_MANAGE), createCoupon);
router.post(
  '/validate',
  requireAnyPermission(PERMISSIONS.COUPON_MANAGE, PERMISSIONS.POS_USE),
  validateCoupon
);
router.get('/audience/catalogue', requirePermission(PERMISSIONS.COUPON_MANAGE), getAudienceCatalogue);
router.post('/audience/preview', requirePermission(PERMISSIONS.COUPON_MANAGE), previewAudience);
router.get('/:id/grants', requirePermission(PERMISSIONS.COUPON_MANAGE), getCouponGrants);
router.patch('/:id', requirePermission(PERMISSIONS.COUPON_MANAGE), updateCoupon);
router.delete('/:id', requirePermission(PERMISSIONS.COUPON_MANAGE), deleteCoupon);

module.exports = router;

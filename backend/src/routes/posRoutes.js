const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const {
  getPosCatalog,
  createPosOrder,
  checkoutPosOrder,
  recordPosPayment,
  applyOrderDiscount,
  applyOrderVoucher,
  getReceipt,
  previewCode,
} = require('../controllers/posController');

const router = express.Router();

// Entire POS surface requires auth + tenant + the pos.use permission.
//
// `pos` is a CORE feature: it survives every subscription state short of
// termination, because a cafe that cannot take money at the counter is a cafe
// that cannot pay us. The gate is mounted anyway so the rule lives in one place
// rather than being "obviously fine" by assumption.
router.use(
  protect,
  tenantMiddleware,
  validateCsrfToken,
  requireFeature(FEATURES.POS),
  requirePermission(PERMISSIONS.POS_USE)
);

router.get('/catalog', getPosCatalog);
// Declared before `/orders/:id/…` patterns: the till's single "apply a code"
// button resolves a coupon or a reward voucher through one call.
router.post('/preview-code', previewCode);
// The POS screen's single write path: validate, create and settle in one call,
// so the till never leaves a half-placed counter order behind.
router.post('/checkout', checkoutPosOrder);
router.post('/orders', createPosOrder);
router.post('/orders/:id/payments', recordPosPayment);
router.post('/orders/:id/discounts', requirePermission(PERMISSIONS.ORDER_DISCOUNT), applyOrderDiscount);
router.post('/orders/:id/voucher', requirePermission(PERMISSIONS.ORDER_DISCOUNT), applyOrderVoucher);
router.get('/orders/:id/receipt', getReceipt);

module.exports = router;

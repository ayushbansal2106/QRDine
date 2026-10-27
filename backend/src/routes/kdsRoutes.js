const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const { getKdsOrders, updateKdsItemStatus, bumpKdsTicket } = require('../controllers/kdsController');

const router = express.Router();

// `kds` is a CORE feature — the kitchen must keep seeing tickets whatever the
// cafe's billing state. Gated for uniformity with the other modules.
router.use(
  protect,
  tenantMiddleware,
  validateCsrfToken,
  requireFeature(FEATURES.KDS),
  requirePermission(PERMISSIONS.KDS_USE)
);

router.get('/orders', getKdsOrders);
router.patch('/orders/:orderId/items/:itemId/status', updateKdsItemStatus);
router.patch('/orders/:orderId/bump', bumpKdsTicket);

module.exports = router;

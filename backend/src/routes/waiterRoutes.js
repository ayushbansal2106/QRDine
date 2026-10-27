const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requireAnyPermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const {
  getWaiterTables,
  createWaiterOrder,
  getWaiterMetrics,
} = require('../controllers/waiterController');

const router = express.Router();

router.use(
  protect,
  tenantMiddleware,
  validateCsrfToken,
  requireAnyPermission(PERMISSIONS.POS_USE, PERMISSIONS.TABLE_MANAGE)
);

router.get('/tables', getWaiterTables);
router.post('/orders', createWaiterOrder);
router.get('/metrics', getWaiterMetrics);

module.exports = router;

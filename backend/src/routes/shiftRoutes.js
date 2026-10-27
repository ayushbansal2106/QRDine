const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission, requireAnyPermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const {
  getCurrentShift,
  openShift,
  closeShift,
  getShiftHistory,
} = require('../controllers/shiftController');

const router = express.Router();

router.use(protect, tenantMiddleware, validateCsrfToken);

router.get('/', requirePermission(PERMISSIONS.REPORT_VIEW), getShiftHistory);
router.get(
  '/current',
  requireAnyPermission(PERMISSIONS.DRAWER_OPEN, PERMISSIONS.REPORT_VIEW),
  getCurrentShift
);
router.post('/open', requirePermission(PERMISSIONS.DRAWER_OPEN), openShift);
router.post('/:id/close', requirePermission(PERMISSIONS.DRAWER_OPEN), closeShift);

module.exports = router;

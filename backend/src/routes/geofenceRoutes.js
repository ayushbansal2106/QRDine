const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const {
  getConfig,
  updateConfig,
  listFlags,
  resolveFlag,
  getStats,
} = require('../controllers/geofenceController');

const router = express.Router();

router.use(
  protect,
  tenantMiddleware,
  requireFeature(FEATURES.GEOFENCE),
  requirePermission(PERMISSIONS.GEOFENCE_MANAGE),
  validateCsrfToken
);

router.get('/config', getConfig);
router.put('/config', updateConfig);
router.get('/flags', listFlags);
router.post('/flags/:id/resolve', resolveFlag);
router.get('/stats', getStats);

module.exports = router;

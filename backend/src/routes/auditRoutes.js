const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { getAuditEvents } = require('../controllers/auditController');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');

const router = express.Router();

// The immutable ledger is a paid reporting surface. Gated to match the sidebar,
// which locks `/cafe/audit` behind `reports.export`.
router.use(
  protect,
  tenantMiddleware,
  validateCsrfToken,
  requireFeature(FEATURES.REPORTS_EXPORT),
  requirePermission(PERMISSIONS.REPORT_VIEW)
);

router.get('/', getAuditEvents);

module.exports = router;

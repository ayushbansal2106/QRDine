const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const {
  getBills,
  getBillDetail,
  getSalesHistory,
  getAnalytics,
  searchBills,
  exportBillsCsv,
  getSettlementReport,
} = require('../controllers/billingController');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');

const router = express.Router();

// All billing endpoints require admin auth.
//
// Was `authorizeRoles('owner', 'manager')` on the whole router, which locked
// the cashier out of /bills entirely — yet taking payment is the core counter
// job. Permissions are per-route instead, so a cashier can open the board and
// settle a table while revenue reporting stays with managers.
router.use(protect, tenantMiddleware, validateCsrfToken);

// The bill board itself is core: it is how the counter settles a table, and a
// lapsed cafe must still be able to take money.
router.get('/bills', requirePermission(PERMISSIONS.BILL_VIEW), getBills);
router.get('/bills/search', requirePermission(PERMISSIONS.BILL_VIEW), searchBills);
// Exporting the ledger is a paid reporting capability, not part of settling.
router.get(
  '/bills/export',
  requireFeature(FEATURES.REPORTS_EXPORT),
  requirePermission(PERMISSIONS.REPORT_EXPORT),
  exportBillsCsv
);
// Declared last: it is a `:id` pattern and must not shadow the literal routes.
router.get('/bills/:id', requirePermission(PERMISSIONS.BILL_VIEW), getBillDetail);
router.get('/settlement', requireFeature(FEATURES.ANALYTICS), requirePermission(PERMISSIONS.REPORT_VIEW), getSettlementReport);
router.get('/sales-history', requireFeature(FEATURES.ANALYTICS), requirePermission(PERMISSIONS.REPORT_VIEW), getSalesHistory);
router.get('/analytics', requireFeature(FEATURES.ANALYTICS), requirePermission(PERMISSIONS.REPORT_VIEW), getAnalytics);

module.exports = router;

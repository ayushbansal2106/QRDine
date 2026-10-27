const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const {
  getOverview,
  getRevenue,
  getGST,
  getItems,
  getTables,
  getSessions,
  getCustomers,
  getPayments,
  getLiveTelemetry,
  getPeakHours,
  getTurnover,
  getOutlets,
} = require('../controllers/analyticsController');

const router = express.Router();

// All analytics endpoints require admin auth
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

// `/live` is the dashboard's operational tile — today's revenue, active tickets,
// tables in service. That is how a café runs the floor, not a reporting product,
// so it stays available on every plan: gating it would leave a Starter café's
// home screen reading "Live metrics unavailable", which looks like an outage
// rather than a paywall. It is the only endpoint on this router that is not
// entitled.
router.get('/live', getLiveTelemetry);

// Everything below is the paid Sales Analytics product. Enforced server-side on
// every route: hiding a sidebar link is a convenience, not a control, and these
// endpoints are reachable directly with a valid owner token.
router.use(requireFeature(FEATURES.ANALYTICS));

router.get('/peak-hours', getPeakHours);
router.get('/turnover', getTurnover);
router.get('/outlets', getOutlets);
router.get('/overview', getOverview);
router.get('/revenue', getRevenue);
router.get('/gst', getGST);
router.get('/items', getItems);
router.get('/tables', getTables);
router.get('/sessions', getSessions);
router.get('/customers', getCustomers);
router.get('/payments', getPayments);

module.exports = router;

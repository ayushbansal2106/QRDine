const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const {
  getOverview,
  getRevenue,
  getGST,
  getItems,
  getTables,
  getSessions,
  getCustomers,
  getPayments,
} = require('../controllers/analyticsController');

const router = express.Router();

// All analytics endpoints require admin auth
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/overview', getOverview);
router.get('/revenue', getRevenue);
router.get('/gst', getGST);
router.get('/items', getItems);
router.get('/tables', getTables);
router.get('/sessions', getSessions);
router.get('/customers', getCustomers);
router.get('/payments', getPayments);

module.exports = router;

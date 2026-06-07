const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { getBills, getSalesHistory, getAnalytics } = require('../controllers/billingController');

const router = express.Router();

// All billing endpoints require admin auth
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'));

router.get('/bills', getBills);
router.get('/sales-history', getSalesHistory);
router.get('/analytics', getAnalytics);

module.exports = router;

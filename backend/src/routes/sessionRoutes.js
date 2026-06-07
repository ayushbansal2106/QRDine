const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const {
  createSession,
  getActiveSessionForTable,
  getBillPreview,
  submitPayment,
  getSessions,
  getSessionDetails,
  markSessionPaid,
} = require('../controllers/sessionController');

const router = express.Router();

// Public endpoints (no authentication required)
router.post('/', createSession);
router.get('/table/:tableId/active', getActiveSessionForTable);
router.get('/:id/bill-preview', getBillPreview);
router.post('/:id/submit-payment', submitPayment);

// Admin-only endpoints
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'));

router.get('/', getSessions);
router.get('/:id', getSessionDetails);
router.put('/:id/mark-paid', markSessionPaid);

module.exports = router;

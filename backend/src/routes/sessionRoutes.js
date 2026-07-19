const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const {
  createSession,
  getActiveSessionForTable,
  getBillPreview,
  submitPayment,
  getSessions,
  getSessionDetails,
  markSessionPaid,
  addBillAdjustment,
  joinSession,
  leaveSession,
  transferOwnership,
  cancelBillRequest,
  getActivityFeed,
} = require('../controllers/sessionController');

const router = express.Router();

// Public endpoints (no authentication required)
router.post('/', createSession);
router.post('/join', joinSession);
router.post('/:id/leave', leaveSession);
router.get('/table/:tableId/active', getActiveSessionForTable);
router.get('/:id/bill-preview', getBillPreview);
router.post('/:id/submit-payment', submitPayment);
router.get('/:id/activity', getActivityFeed);

// Admin-only endpoints
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/', getSessions);
router.get('/:id', getSessionDetails);
router.put('/:id/mark-paid', markSessionPaid);
router.post('/:id/adjustments', addBillAdjustment);
router.post('/:id/transfer-ownership', transferOwnership);
router.post('/:id/cancel-bill-request', cancelBillRequest);

module.exports = router;

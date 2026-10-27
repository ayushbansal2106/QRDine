const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
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
  closeSession,
  addBillAdjustment,
  joinSession,
  leaveSession,
  transferOwnership,
  cancelBillRequest,
  requestBillForTable,
  getActivityFeed,
} = require('../controllers/sessionController');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');

const { publicWriteLimiter, publicReadLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Public endpoints (no authentication required)
router.post('/', publicWriteLimiter, createSession);
router.post('/join', publicWriteLimiter, joinSession);
router.post('/:id/leave', publicWriteLimiter, leaveSession);
router.get('/table/:tableId/active', publicReadLimiter, getActiveSessionForTable);
router.get('/:id/bill-preview', publicReadLimiter, getBillPreview);
router.post('/:id/submit-payment', publicWriteLimiter, submitPayment);
router.get('/:id/activity', publicReadLimiter, getActivityFeed);

// Admin-only endpoints
router.use(protect, tenantMiddleware, validateCsrfToken);

router.get('/', requirePermission(PERMISSIONS.BILL_VIEW), getSessions);
router.get('/:id', requirePermission(PERMISSIONS.BILL_VIEW), getSessionDetails);
router.put('/:id/mark-paid', requirePermission(PERMISSIONS.BILL_PAY), markSessionPaid);
router.post('/:id/close', requirePermission(PERMISSIONS.BILL_PAY), closeSession);
// Raising a bill from the counter: the guest walked up instead of tapping Bill
// in the app, so the session is still `active`. Kept distinct from `mark-paid`
// because it is a visible state change the kitchen and the guest both see.
router.post('/:id/request-bill', requirePermission(PERMISSIONS.BILL_PAY), requestBillForTable);
router.post('/:id/cancel-bill-request', requirePermission(PERMISSIONS.BILL_PAY), cancelBillRequest);
router.post('/:id/adjustments', requirePermission(PERMISSIONS.BILL_ADJUST), addBillAdjustment);
router.post('/:id/transfer-ownership', requirePermission(PERMISSIONS.BILL_ADJUST), transferOwnership);

module.exports = router;

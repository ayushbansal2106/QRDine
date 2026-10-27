const express = require('express');
const {
  initiateSessionPayment,
  handleGatewayWebhook,
  getPGSettings,
  updatePGSettings,
} = require('../controllers/pgBillingController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { webhookLimiter, validateWebhookCafeId } = require('../middlewares/rateLimiter');

const router = express.Router();

// 1. Webhook endpoint called by third-party payment gateways (Razorpay/Cashfree)
// Must stay unauthenticated and above CSRF/auth guards.
// SEC-103: Rate-limited per IP and validates cafeId format before any DB lookup.
router.post('/webhook/:cafeId', webhookLimiter, validateWebhookCafeId, handleGatewayWebhook);

// 2. Customer payment initiation (QR guest with session token)
router.post('/initiate-session-payment', initiateSessionPayment);

// 3. Admin PG settings management (requires owner or manager)
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/settings', getPGSettings);
router.put('/settings', updatePGSettings);

module.exports = router;


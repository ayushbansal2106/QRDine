const express = require('express');

const {
  getPlans,
  getMySubscription,
  getEntitlements,
  getQuote,
  startCheckout,
  cancelSubscription,
  resumeSubscription,
  getMyInvoices,
  getInvoicePdf,
} = require('../controllers/subscriptionController');
const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { attachSubscription } = require('../middlewares/subscriptionMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');

const router = express.Router();

// Public pricing page.
router.get('/plans', getPlans);

// Everything below acts on the caller's own tenant only — there is no
// ":cafeId" in any path here, so a token cannot reach another cafe's billing.
router.use(protect, tenantMiddleware, attachSubscription);

router.get('/', getMySubscription);
// Entitlements + usage for the admin shell. Read-only, so no CSRF token: GET
// requests are not state-changing and the cookie is SameSite-protected.
router.get('/entitlements', getEntitlements);

// Stage 5 / Task 5.2 — B2B GST Subscription Invoices under Rule 46 CGST Rules
router.get('/invoices', getMyInvoices);
router.get('/invoices/:id/pdf', getInvoicePdf);

// `quote` has no side effects, but it is a POST behind auth and every other
// protected write in this codebase carries the guard. Keeping it uniform means
// the rule stays "all protected writes are CSRF-checked" with no exceptions to
// remember.
router.post('/quote', validateCsrfToken, getQuote);
router.post('/checkout', validateCsrfToken, startCheckout);
router.post('/cancel', validateCsrfToken, cancelSubscription);
router.post('/resume', validateCsrfToken, resumeSubscription);

module.exports = router;
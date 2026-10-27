const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { downloadInvoicePDF, resendInvoiceEmail } = require('../controllers/invoiceController');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');

const router = express.Router();

// All invoice endpoints require admin auth + the GST-invoicing entitlement.
// Downloading a previously issued invoice is a read of the cafe's own record, so
// it is blocked only when the plan/module is gone — the PDF already exists and
// withholding it would hide a tax document from the business that owns it.
router.use(
  protect,
  tenantMiddleware,
  authorizeRoles('owner', 'manager'),
  requireFeature(FEATURES.INVOICES),
  validateCsrfToken
);

router.get('/:id/pdf', downloadInvoicePDF);
router.post('/:id/resend-email', resendInvoiceEmail);

module.exports = router;

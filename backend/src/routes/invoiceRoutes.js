const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { downloadInvoicePDF, resendInvoiceEmail } = require('../controllers/invoiceController');

const router = express.Router();

// All invoice endpoints require admin auth
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/:id/pdf', downloadInvoicePDF);
router.post('/:id/resend-email', resendInvoiceEmail);

module.exports = router;

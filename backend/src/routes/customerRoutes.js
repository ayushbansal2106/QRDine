const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const AppError = require('../utils/AppError');
const { getEffectivePermissions } = require('../constants/permissions');
const {
  lookupCustomerByPhone,
  getCustomers,
  getCustomer,
  updateCustomer,
  exportCustomersCsv,
} = require('../controllers/customerController');

const router = express.Router();

router.use(protect, tenantMiddleware, validateCsrfToken);

/**
 * The till lookup is gated on POS_USE *or* CUSTOMER_MANAGE rather than
 * CUSTOMER_MANAGE alone. A `cashier` role holds POS_USE but not CUSTOMER_MANAGE,
 * so requiring the CRM permission would lock out the one person who most needs
 * to check whether a number is a returning customer. It only reads the fields
 * the cashier already sees on screen.
 */
const canLookupAtTill = (req, res, next) => {
  const perms = getEffectivePermissions(req.user);
  if (perms.includes(PERMISSIONS.POS_USE) || perms.includes(PERMISSIONS.CUSTOMER_MANAGE)) {
    return next();
  }
  return next(new AppError('Forbidden: missing permission', 403));
};

router.get('/lookup', canLookupAtTill, lookupCustomerByPhone);

router.use(requirePermission(PERMISSIONS.CUSTOMER_MANAGE));

router.get('/', getCustomers);
// The CRM list is core (a cashier looks customers up all day); exporting the
// customer database is a paid reporting capability.
router.get(
  '/export',
  requireFeature(FEATURES.REPORTS_EXPORT),
  requirePermission(PERMISSIONS.REPORT_EXPORT),
  exportCustomersCsv
);
router.get('/:id', getCustomer);
router.patch('/:id', updateCustomer);

module.exports = router;

const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const {
  listWallets,
  getWalletDetail,
  topUpWallet,
  refundToWallet,
} = require('../controllers/walletController');

const router = express.Router();

// Wallets hold real customer money, so the entitlement gate sits in front of
// every write as well as every read: a lapsed cafe must not be able to top a
// wallet up on a plan that no longer includes the module.
router.use(
  protect,
  tenantMiddleware,
  validateCsrfToken,
  requireFeature(FEATURES.WALLET),
  requirePermission(PERMISSIONS.WALLET_MANAGE)
);

router.get('/', listWallets);
router.get('/:customerId', getWalletDetail);
router.post('/:customerId/topup', topUpWallet);
router.post('/:customerId/refund', refundToWallet);

module.exports = router;

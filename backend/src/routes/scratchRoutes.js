const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const {
  getCampaign,
  upsertCampaign,
  listCards,
  revealCardAdmin,
  getMyCards,
  revealMyCard,
} = require('../controllers/scratchController');

const router = express.Router();

// Customer-facing (guest-token scoped)
router.get('/me', getMyCards);
router.post('/:id/reveal', revealMyCard);

// Admin
router.use(
  protect,
  tenantMiddleware,
  validateCsrfToken,
  requireFeature(FEATURES.SCRATCH),
  requirePermission(PERMISSIONS.SCRATCH_MANAGE)
);

router.get('/campaign', getCampaign);
router.put('/campaign', upsertCampaign);
router.get('/cards', listCards);
router.post('/cards/:id/reveal', revealCardAdmin);

module.exports = router;

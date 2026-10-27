const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const {
  resolveTag,
  previewTag,
  listTags,
  createTag,
  updateTag,
  deleteTag,
  getTagCard,
  getStats,
} = require('../controllers/nfcController');

const router = express.Router();

// Management sub-paths that must never be treated as a physical tag id.
const RESERVED_PATHS = new Set(['manage', 'stats']);

// Public tap resolver, registered first because a phone hitting a sticker has
// no session. Non-tag paths fall through to the authenticated routes below.
router.get('/:tagId', (req, res, next) => {
  if (RESERVED_PATHS.has(req.params.tagId)) return next();
  return resolveTag(req, res, next);
});

// The public tap resolver above stays open: a sticker already printed on a
// table must still work for the diner who scans it. Creating and managing tags
// is the paid module.
router.use(
  protect,
  tenantMiddleware,
  requireFeature(FEATURES.NFC),
  requirePermission(PERMISSIONS.NFC_MANAGE),
  validateCsrfToken
);

router.get('/manage', listTags);
router.post('/manage', createTag);
router.put('/manage/:id', updateTag);
router.delete('/manage/:id', deleteTag);
router.get('/manage/:id/card', getTagCard);
router.get('/manage/:tagId/resolve', previewTag);
router.get('/stats', getStats);

module.exports = router;

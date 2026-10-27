const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const { requireFeature } = require('../middlewares/subscriptionMiddleware');
const { FEATURES } = require('../config/plans');
const env = require('../config/env');
const {
  submitRating,
  listReviews,
  getSummary,
  getReview,
  draftReview,
  draftReply,
  publishReply,
  updateReview,
  getSettings,
  updateSettings,
} = require('../controllers/reviewController');

const router = express.Router();

/**
 * Public rating capture (Module #18). A guest can post one rating per order,
 * so the limit here is generous for a table but stops scripted abuse and keeps
 * the AI draft endpoint from being used as a free text generator.
 */
const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.nodeEnv === 'production' ? 20 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  // Keyed by client IP *and* order id: one rate-limit bucket per table bill.
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.body && req.body.orderId ? req.body.orderId : 'none'}`,
  message: {
    success: false,
    message: 'Too many feedback attempts. Please try again in a few minutes.',
  },
});

router.post('/', reviewLimiter, submitRating);

// Manager surface
router.use(protect, tenantMiddleware, validateCsrfToken);

// The review engine (AI drafting, Google routing, reply publishing) is a paid
// module; the public rating POST above is not, because the guest is mid-meal and
// a billing failure is not their problem. No AI work happens on that path.
router.use(requireFeature(FEATURES.REVIEWS));

router.get('/settings', requirePermission(PERMISSIONS.REVIEW_MANAGE), getSettings);
router.put('/settings', requirePermission(PERMISSIONS.REVIEW_MANAGE), updateSettings);

router.get('/summary', requirePermission(PERMISSIONS.REVIEW_MANAGE), getSummary);
router.get('/all', requirePermission(PERMISSIONS.REVIEW_MANAGE), listReviews);
router.get('/:id', requirePermission(PERMISSIONS.REVIEW_MANAGE), getReview);
router.post('/:id/draft', requirePermission(PERMISSIONS.REVIEW_MANAGE), draftReview);
router.post('/:id/reply-draft', requirePermission(PERMISSIONS.REVIEW_RESPONSE), draftReply);
router.post('/:id/reply', requirePermission(PERMISSIONS.REVIEW_RESPONSE), publishReply);
router.patch('/:id', requirePermission(PERMISSIONS.REVIEW_MANAGE), updateReview);

module.exports = router;
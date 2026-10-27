const express = require('express');

const {
  requestOtp,
  verifyOtp,
  signOut,
  getMe,
  updateProfile,
  updatePreferences,
  getMyOrders,
  requestEmailOtp,
  verifyEmailOtp,
  anonymizeMe,
} = require('../controllers/customerAppController');
const { protectCustomer } = require('../middlewares/customerAuthMiddleware');
const {
  getMyLoyalty,
  claimMyReward,
  getMyWallet,
  getMyWallets,
  getMyScratchCards,
  revealMyScratchCard,
  getMyCoupons,
} = require('../controllers/customerRewardsController');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { authLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// ── Sign-in (unauthenticated) ──────────────────────────
// The guest is not staff: there is no JWT yet, so these sit above the customer
// guard. Each call costs an SMS, so they reuse the strict auth limiter.

router.post('/auth/request-otp', authLimiter, requestOtp);
router.post('/auth/verify-otp', authLimiter, verifyOtp);
router.post('/auth/sign-out', signOut);

// ── Everything below requires a signed-in customer ────
// CSRF is enforced because the token can arrive as a cookie, which a cross-site
// form post would carry automatically. The double-submit check means an
// attacker on another origin cannot forge the state-changing calls below.
router.use(protectCustomer, validateCsrfToken);

router.get('/me', getMe);
router.patch('/me', updateProfile);
router.patch('/me/preferences', updatePreferences);
router.get('/me/orders', getMyOrders);
router.post('/me/email/request-otp', requestEmailOtp);
router.post('/me/email/verify-otp', verifyEmailOtp);
router.post('/me/anonymize', anonymizeMe);

// ── Rewards ──────────────────────────────────────────────
// Loyalty stamps, prepaid wallet, scratch cards and personal coupons. These were
// only reachable through guest-session routes resolved from a table's order, so
// a customer who signed in with their phone number — the profile the app builds
// — had nowhere to see any of it.
router.get('/me/loyalty', getMyLoyalty);
router.post('/me/loyalty/reward', claimMyReward);
router.get('/me/wallet', getMyWallet);
router.get('/me/wallets', getMyWallets);
router.get('/me/scratch', getMyScratchCards);
router.post('/me/scratch/:id/reveal', revealMyScratchCard);
router.get('/me/coupons', getMyCoupons);

module.exports = router;
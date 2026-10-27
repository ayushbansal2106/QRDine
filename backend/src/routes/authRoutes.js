const express = require('express');

const {
  registerOwner,
  login,
  getCurrentUser,
  getOperators,
  pinLogin,
} = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateOwnerRegistration, validateLogin } = require('../middlewares/validateAuth');
const { authLimiter, pinLimiter } = require('../middlewares/rateLimiter');
const { setCsrfToken, validateCsrfToken } = require('../middlewares/csrfMiddleware');

const router = express.Router();

// Rate-limited auth routes (prevents brute force attacks)
router.post('/register-owner', authLimiter, validateOwnerRegistration, setCsrfToken, registerOwner);
router.post('/login', authLimiter, validateLogin, setCsrfToken, login);
// `tenantMiddleware` is mounted so a suspended café gets a clean 410 here too:
// `getCurrentOperator()` treats it as "no session" and bounces the operator to
// the login screen, instead of the dashboard rendering while every other call
// 410s.
router.get('/me', protect, tenantMiddleware, getCurrentUser);

// Module #08 — shared-terminal PIN login / operator switch (device already authenticated)
router.get('/operators', protect, tenantMiddleware, getOperators);
router.post('/pin-login', protect, tenantMiddleware, validateCsrfToken, pinLimiter, pinLogin);

// CSRF token endpoint — setCsrfToken middleware above already sets the cookie
// This just returns the token so the frontend can confirm it exists
router.get('/csrf', setCsrfToken, (req, res) => {
  res.status(200).json({ success: true, csrfToken: res.locals.csrfToken || '' });
});

module.exports = router;

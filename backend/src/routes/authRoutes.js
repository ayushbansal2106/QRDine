const express = require('express');

const { registerOwner, login, getCurrentUser } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');
const { validateOwnerRegistration, validateLogin } = require('../middlewares/validateAuth');
const { authLimiter } = require('../middlewares/rateLimiter');
const { setCsrfToken } = require('../middlewares/csrfMiddleware');

const router = express.Router();

// Rate-limited auth routes (prevents brute force attacks)
router.post('/register-owner', authLimiter, validateOwnerRegistration, setCsrfToken, registerOwner);
router.post('/login', authLimiter, validateLogin, setCsrfToken, login);
router.get('/me', protect, getCurrentUser);

// CSRF token endpoint — setCsrfToken middleware above already sets the cookie
// This just returns the token so the frontend can confirm it exists
router.get('/csrf', setCsrfToken, (req, res) => {
  res.status(200).json({ success: true, csrfToken: res.locals.csrfToken || '' });
});

module.exports = router;

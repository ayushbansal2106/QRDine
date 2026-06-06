const express = require('express');

const { registerOwner, login, getCurrentUser } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');
const { validateOwnerRegistration, validateLogin } = require('../middlewares/validateAuth');

const router = express.Router();

router.post('/register-owner', validateOwnerRegistration, registerOwner);
router.post('/login', validateLogin, login);
router.get('/me', protect, getCurrentUser);

module.exports = router;

const express = require('express');

const { getMyWallet, payWithWallet } = require('../controllers/walletController');

const router = express.Router();

// Customer-facing, guarded by the dining-session guest token
router.get('/me', getMyWallet);
router.post('/pay', payWithWallet);

module.exports = router;

const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { getCafe, getCafePublic, getCafeOperationalStatus, updateCafe } = require('../controllers/cafeController');

const router = express.Router();

// Public, unauthenticated: a guest scanning a table QR has no session.
// MUST stay above the protect middleware below.
router.get('/public/:cafeId/operational-status', getCafeOperationalStatus);
router.get('/public/:cafeId', getCafePublic);

// All cafe endpoints require auth
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/', getCafe);
router.put('/', authorizeRoles('owner', 'manager'), updateCafe);

module.exports = router;

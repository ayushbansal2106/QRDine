const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { getCafe, updateCafe } = require('../controllers/cafeController');

const router = express.Router();

// All cafe endpoints require auth
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/', getCafe);
router.put('/', authorizeRoles('owner'), updateCafe);

module.exports = router;

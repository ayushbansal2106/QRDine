const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const {
  createRequest,
  getRequests,
  resolveRequest,
} = require('../controllers/requestController');

const router = express.Router();

// Public endpoint (no auth)
router.post('/', createRequest);

// Admin-only endpoints
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/', getRequests);
router.put('/:id', resolveRequest);

module.exports = router;

const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { getStaffUsers, createStaffUser, deleteStaffUser } = require('../controllers/userController');

const router = express.Router();

// All staff management endpoints require auth
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/', getStaffUsers);
router.post('/', authorizeRoles('owner'), createStaffUser);
router.delete('/:id', authorizeRoles('owner'), deleteStaffUser);

module.exports = router;

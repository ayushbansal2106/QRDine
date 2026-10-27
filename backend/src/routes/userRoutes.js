const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const {
  getStaffUsers,
  getPermissionCatalog,
  createStaffUser,
  updateStaffUser,
  setStaffPin,
  removeStaffPin,
  deleteStaffUser,
} = require('../controllers/userController');

const router = express.Router();

// All staff management endpoints require auth + cafe context
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/', getStaffUsers);
router.get('/permissions', getPermissionCatalog);

router.post('/', authorizeRoles('owner'), createStaffUser);
router.patch('/:id', updateStaffUser);

// Module #08 — PIN management for the shared terminal
router.post('/:id/pin', setStaffPin);
router.delete('/:id/pin', removeStaffPin);

router.delete('/:id', authorizeRoles('owner'), deleteStaffUser);

module.exports = router;

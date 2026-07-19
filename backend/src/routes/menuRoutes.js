const express = require('express');

const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const {
  getMenu,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getMenuPublic,
} = require('../controllers/menuController');

const router = express.Router();

// Public routes (unauthenticated)
router.get('/public', getMenuPublic);

router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/', getMenu);
router.post('/', createMenuItem);
router.put('/:id', updateMenuItem);
router.delete('/:id', deleteMenuItem);

module.exports = router;

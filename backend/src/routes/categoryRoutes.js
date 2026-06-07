const express = require('express');

const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoriesPublic,
} = require('../controllers/categoryController');

const router = express.Router();

// Public routes (unauthenticated)
router.get('/public', getCategoriesPublic);

router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'));

router.get('/', getCategories);
router.post('/', createCategory);
router.put('/:id', updateCategory);
router.delete('/:id', deleteCategory);

module.exports = router;

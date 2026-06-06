const express = require('express');

const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const {
  getMenu,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} = require('../controllers/menuController');

const router = express.Router();

router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'));

router.get('/', getMenu);
router.post('/', createMenuItem);
router.put('/:id', updateMenuItem);
router.delete('/:id', deleteMenuItem);

module.exports = router;

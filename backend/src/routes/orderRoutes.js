const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateOrderPayload } = require('../middlewares/validateOrder');
const {
  createOrder,
  getOrders,
  getOrder,
  getPublicOrder,
  getPublicOrderStatus,
  updateOrderStatus,
} = require('../controllers/orderController');

const router = express.Router();

// Public endpoints (no authentication required)
router.post('/', validateOrderPayload, createOrder);
router.get('/public/:id', getPublicOrder);
router.get('/public/:id/status', getPublicOrderStatus);

// Admin-only endpoints (requires protection and correct role authorization)
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'));

router.get('/', getOrders);
router.get('/:id', getOrder);
router.put('/:id/status', updateOrderStatus);

module.exports = router;

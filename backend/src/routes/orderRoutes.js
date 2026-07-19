const express = require('express');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { validateOrderPayload } = require('../middlewares/validateOrder');
const {
  createOrder,
  getOrders,
  getOrder,
  getPublicOrder,
  getPublicOrderStatus,
  updateOrderStatus,
  cancelOrderItem,
} = require('../controllers/orderController');

const router = express.Router();

// Public endpoints (no authentication required)
router.post('/', validateOrderPayload, createOrder);
router.get('/public/:id', getPublicOrder);
router.get('/public/:id/status', getPublicOrderStatus);

// Admin-only endpoints (requires protection and correct role authorization)
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/', getOrders);
router.get('/:id', getOrder);
router.put('/:id/status', updateOrderStatus);
router.post('/:id/items/:itemId/cancel', cancelOrderItem);

module.exports = router;

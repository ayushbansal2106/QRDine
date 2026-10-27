const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');
const { validateOrderPayload } = require('../middlewares/validateOrder');
const {
  createOrder,
  previewCode,
  getOrders,
  getOrder,
  getPublicOrder,
  getPublicOrderStatus,
  updateOrderStatus,
  cancelOrderItem,
} = require('../controllers/orderController');
// Optional: links the order to a signed-in customer without ever rejecting an
// anonymous walk-in, which must still be able to order.
const { attachCustomer } = require('../middlewares/customerAuthMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { PERMISSIONS } = require('../constants/permissions');
const {
  addItems,
  reassignTable,
  refundOrder,
} = require('../controllers/orderPipelineController');

const { publicWriteLimiter, publicReadLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Public endpoints (no authentication required)
router.post('/', publicWriteLimiter, attachCustomer, validateOrderPayload, createOrder);
// Price a pasted code without placing anything. Public like `POST /orders`: an
// anonymous guest may still use a coupon, they just cannot spend a reward voucher
// that was issued to somebody else. Declared before `/:id` patterns below.
router.post('/preview-code', publicWriteLimiter, attachCustomer, previewCode);
router.get('/public/:id', publicReadLimiter, attachCustomer, getPublicOrder);
router.get('/public/:id/status', publicReadLimiter, attachCustomer, getPublicOrderStatus);

// Admin endpoints, gated by *permission* rather than by role.
//
// The permission catalogue has always granted `order.view` and `order.status` to
// cashier, waiter, barista and staff — a cashier cannot serve a table without
// seeing its orders. Gating this router on `owner`/`manager` quietly threw all of
// that away: those staff got a bare 403 on a page their own role says they may
// open. Roles set the *default* permission set; the permission decides the
// route, so a manager who revokes `order.cancel` from one person really revokes
// it — and cancelling still belongs to manager and owner alone.
router.use(protect, tenantMiddleware, validateCsrfToken);

router.get('/', requirePermission(PERMISSIONS.ORDER_VIEW), getOrders);
router.get('/:id', requirePermission(PERMISSIONS.ORDER_VIEW), getOrder);
router.put('/:id/status', requirePermission(PERMISSIONS.ORDER_STATUS), updateOrderStatus);
router.post('/:id/items/:itemId/cancel', requirePermission(PERMISSIONS.ORDER_CANCEL), cancelOrderItem);

// Module #03 — omnichannel pipeline actions
router.post('/:id/items', requirePermission(PERMISSIONS.ORDER_STATUS), addItems);
router.patch('/:id/reassign-table', requirePermission(PERMISSIONS.TABLE_MANAGE), reassignTable);
router.post('/:id/refund', requirePermission(PERMISSIONS.ORDER_REFUND), refundOrder);

module.exports = router;

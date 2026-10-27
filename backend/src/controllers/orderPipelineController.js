const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const orderReconciliationService = require('../services/orderReconciliationService');
const { PERMISSIONS } = require('../constants/permissions');
const { hasPermission } = require('../constants/permissions');

/**
 * Module #03 — omnichannel pipeline actions.
 *
 * These are all "the order already exists and now something about it changes"
 * operations, kept out of `orderController` so the QR/public path stays small.
 * Refunds are additionally permission-gated (`order.refund`).
 */

const assertPermission = (user, permission) => {
  if (!hasPermission(user, permission)) {
    throw new AppError('Forbidden: missing required permission', 403);
  }
};

const loadOrder = async (cafeId, id) => {
  const order = await Order.findOne({ _id: id, cafeId });
  if (!order) throw new AppError('Order not found', 404);
  return order;
};

/** POST /api/orders/:id/items — add items to an open tab. */
const addItems = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.cafeId, req.params.id);

  const updated = await orderReconciliationService.addItemsToOrder({
    cafeId: req.cafeId,
    order,
    items: req.body.items,
    staffId: req.user._id,
    staffName: req.user.name || '',
  });

  res.status(200).json({
    success: true,
    message: 'Items added to the open tab',
    order: updated,
  });
});

/** PATCH /api/orders/:id/reassign-table — move an open tab to another table. */
const reassignTable = asyncHandler(async (req, res) => {
  assertPermission(req.user, PERMISSIONS.ORDER_STATUS);

  const order = await loadOrder(req.cafeId, req.params.id);
  const { tableId, tableNumber, reason } = req.body || {};

  let targetTableId = tableId;
  if (!targetTableId && tableNumber) {
    const Table = require('../models/Table');
    const table = await Table.findOne({ cafeId: req.cafeId, tableNumber }).select('_id');
    if (!table) throw new AppError('Target table not found', 404);
    targetTableId = table._id;
  }
  if (!targetTableId) throw new AppError('tableId or tableNumber is required', 400);

  const result = await orderReconciliationService.reassignTable({
    cafeId: req.cafeId,
    order,
    tableId: targetTableId,
    staffId: req.user._id,
    staffName: req.user.name || '',
    reason: reason || '',
  });

  res.status(200).json({
    success: true,
    message: `Order moved to table ${result.table.tableNumber}`,
    order: result.order,
    table: result.table,
    sessionMoved: Boolean(result.session),
  });
});

/** POST /api/orders/:id/refund — coin/credit reconciliation. */
const refundOrder = asyncHandler(async (req, res) => {
  assertPermission(req.user, PERMISSIONS.ORDER_REFUND);

  const order = await loadOrder(req.cafeId, req.params.id);
  const { amount, method = 'cash', reason } = req.body || {};

  if (!reason || String(reason).trim().length < 3) {
    throw new AppError('A refund reason is required', 400);
  }

  const result = await orderReconciliationService.reconcileRefund({
    cafeId: req.cafeId,
    order,
    amount,
    method,
    reason,
    staffId: req.user._id,
    staffName: req.user.name || '',
  });

  res.status(200).json({
    success: true,
    message: 'Refund recorded',
    order: result.order,
    refund: result.refund,
    walletReconciliation: result.walletReconciliation,
  });
});

module.exports = { addItems, reassignTable, refundOrder };
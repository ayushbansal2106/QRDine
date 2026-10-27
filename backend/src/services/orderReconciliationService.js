const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');
const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const orderService = require('./orderService');
const walletService = require('./walletService');
const auditService = require('./auditService');
const socketService = require('./socketService');
const telemetryService = require('./telemetryService');

/**
 * Module #03 — omnichannel pipeline operations.
 *
 * Three things happen after an order exists and are easy to get wrong, so they
 * live together here rather than in the controller:
 *
 *  1. **Add to tab** — a second scan of the same table adds items to the open
 *     ticket. Totals must be recomputed from scratch, never incremented, or
 *     cancellation maths drifts.
 *  2. **Reassign table** — guests move tables mid-visit. The order *and* its
 *     dining session must move together, otherwise the bill stays on the old
 *     table and the QR guest loses their session.
 *  3. **Refund / credit reconciliation** — money has to go back where it came
 *     from. A wallet tender refunds to the wallet (an actual balance change,
 *     not a note); cash/UPI/card refunds are recorded against the order and in
 *     the immutable ledger. Both flip `paymentStatus` correctly.
 */

const OPEN_STATUSES = ['pending', 'accepted', 'preparing'];
const round2 = orderService.round2;

/**
 * Recompute subtotal/GST/total from the order's live (non-cancelled) items.
 * Discounts are re-applied to the new subtotal so a percentage coupon stays
 * proportional instead of keeping its original rupee value.
 */
const recomputeTotals = (order) => {
  const activeItems = (order.items || []).filter((i) => i.status !== 'cancelled');

  let subtotal = 0;
  let totalGST = 0;
  const taxMap = {};

  for (const item of activeItems) {
    subtotal += item.price * item.quantity;
    totalGST += item.gstAmount || 0;
    const pct = item.gstPercentage || 0;
    taxMap[pct] = (taxMap[pct] || 0) + (item.gstAmount || 0);
  }

  let discountTotal = 0;
  for (const discount of order.discounts || []) {
    const value = Number(discount.value) || 0;
    const amount = discount.type === 'percent' ? (subtotal * value) / 100 : value;
    discountTotal += Math.min(Math.max(amount, 0), Math.max(0, subtotal - discountTotal));
  }
  discountTotal = round2(discountTotal);

  order.subtotal = round2(subtotal);
  order.totalGST = round2(totalGST);
  order.discountTotal = discountTotal;
  order.taxBreakdown = Object.keys(taxMap).map((pct) => ({
    percentage: Number(pct),
    amount: round2(taxMap[pct]),
  }));
  order.totalAmount = Math.max(0, round2(order.subtotal - discountTotal + order.totalGST + (order.serviceCharge || 0)));

  return order;
};

/**
 * Module #03 — add items to an open ticket.
 * Prices are resolved server-side by the shared engine, never taken from the body.
 */
const addItemsToOrder = async ({ cafeId, order, items, staffId = null, staffName = '' }) => {
  if (!OPEN_STATUSES.includes(order.status)) {
    throw new AppError('Items can only be added to an order that is still open', 400);
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('At least one item is required', 400);
  }

  const { resolvedItems } = await orderService.resolveLineItems({ cafeId, items });

  // Added items inherit the ticket's current stage so the KDS does not have to
  // guess whether they still need to be fired.
  for (const item of resolvedItems) item.status = order.status;

  order.items.push(...resolvedItems);
  recomputeTotals(order);
  await order.save();

  socketService.emitNewOrder(cafeId, order, {
    sound: false,
    channel: order.channel,
    orderType: order.orderType,
    addedToExisting: true,
  });
  socketService.emitStatusUpdate(order._id, cafeId, order.status);
  telemetryService.emitRefresh(cafeId, 'order.items_added');

  await auditService.recordEvent({
    cafeId,
    type: 'order.items_added',
    entityType: 'Order',
    entityId: order._id,
    amount: order.totalAmount,
    staffId,
    staffName,
    metadata: { orderNumber: order.orderNumber, added: resolvedItems.length },
  });

  return order;
};

/**
 * Module #03 — move an open tab (and its dining session) to another table.
 */
const reassignTable = async ({ cafeId, order, tableId, staffId = null, staffName = '', reason = '' }) => {
  if (!OPEN_STATUSES.includes(order.status)) {
    throw new AppError('Only an open, unserved order can be moved to another table', 400);
  }

  const targetTable = await Table.findOne({ _id: tableId, cafeId });
  if (!targetTable) throw new AppError('Target table not found', 404);
  if (!targetTable.isActive) throw new AppError('Target table is inactive', 400);

  if (order.tableId && String(order.tableId) === String(targetTable._id)) {
    throw new AppError('The order is already on that table', 400);
  }

  const previousTable = order.tableId
    ? await Table.findOne({ _id: order.tableId, cafeId }).select('tableNumber')
    : null;

  // Refuse to drop a customer into a table that is already settling its bill.
  const blockingSession = await DiningSession.findOne({
    cafeId,
    tableId: targetTable._id,
    status: { $in: ['bill_requested', 'awaiting_payment'] },
  });
  if (blockingSession) {
    throw new AppError('That table is currently settling its bill', 409);
  }

  order.tableId = targetTable._id;
  await order.save();

  // The session must follow, otherwise the guests' QR token points at a table
  // their bill is no longer on.
  let movedSession = null;
  if (order.sessionId) {
    const session = await DiningSession.findOne({ _id: order.sessionId, cafeId });
    if (session && ['active', 'bill_requested', 'awaiting_payment'].includes(session.status)) {
      session.tableId = targetTable._id;
      session.addActivity(
        'ownership_transferred',
        `Table moved from ${previousTable ? previousTable.tableNumber : 'unassigned'} to ${targetTable.tableNumber}${reason ? `: ${reason}` : ''}`
      );
      await session.save();
      movedSession = session;
    }
  }

  socketService.emitTableStatusChanged(cafeId, targetTable._id, 'occupied');
  if (previousTable) socketService.emitTableStatusChanged(cafeId, previousTable._id, 'available');
  socketService.emitNewOrder(cafeId, order, { sound: false, channel: order.channel, orderType: order.orderType, reassigned: true });
  telemetryService.emitRefresh(cafeId, 'order.reassigned');

  await auditService.recordEvent({
    cafeId,
    type: 'order.table_reassigned',
    entityType: 'Order',
    entityId: order._id,
    amount: order.totalAmount,
    staffId,
    staffName,
    metadata: {
      orderNumber: order.orderNumber,
      from: previousTable ? previousTable.tableNumber : null,
      to: targetTable.tableNumber,
      reason,
    },
  });

  return { order, session: movedSession, table: targetTable };
};

/**
 * Module #03 — coin/credit reconciliation on cancellation or goodwill refund.
 *
 * A refund is capped at what was actually collected (`payments[]` minus any
 * previous refunds) so a manager cannot refund money that was never taken.
 */
const reconcileRefund = async ({
  cafeId,
  order,
  amount,
  method = 'cash',
  reason = '',
  staffId = null,
  staffName = '',
}) => {
  const collected = (order.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const alreadyRefunded = (order.refunds || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const refundable = round2(collected - alreadyRefunded);

  const value = amount === undefined || amount === null ? refundable : round2(amount);
  if (!(value > 0)) throw new AppError('Refund amount must be positive', 400);
  // Check "nothing was ever collected" before the cap so the manager gets the
  // actionable message rather than a confusing zero-cap error.
  if (refundable <= 0) throw new AppError('This order has no collected payment to refund', 400);
  if (value - refundable > 0.01) {
    throw new AppError(`Refund cannot exceed the collected amount of ${refundable}`, 400);
  }

  const refund = {
    amount: value,
    method,
    reason: String(reason || '').slice(0, 300),
    staffId: staffId || null,
    staffName: staffName || '',
    refundedAt: new Date(),
    destination: method === 'wallet' ? 'wallet_balance' : 'external',
  };
  order.refunds = order.refunds || [];
  order.refunds.push(refund);

  const netPaid = round2(collected - alreadyRefunded - value);
  order.paymentStatus = netPaid <= 0.01 ? 'refunded' : 'partially_refunded';

  await order.save();

  // Wallet tenders go back as real balance — the reconciliation the plan calls
  // for. External tenders are recorded against the order and the ledger only.
  let walletReconciliation = null;
  if (method === 'wallet' && order.customerId) {
    const result = await walletService.credit({
      cafeId,
      customerId: order.customerId,
      amount: value,
      type: 'refund',
      reference: `order:${order.orderNumber}`,
      note: reason || `Refund for ${order.orderNumber}`,
      staffId,
      staffName,
      clientRequestId: `refund:${order._id}:${order.refunds.length}`,
    });
    walletReconciliation = { balance: result.wallet.balance, transactionId: result.transaction._id };
  }

  socketService.emitStatusUpdate(order._id, cafeId, order.status);
  telemetryService.emitRefresh(cafeId, 'order.refunded');

  await auditService.recordEvent({
    cafeId,
    type: 'order.refund',
    entityType: 'Order',
    entityId: order._id,
    amount: value,
    staffId,
    staffName,
    metadata: {
      orderNumber: order.orderNumber,
      method,
      reason: refund.reason,
      netPaid,
      paymentStatus: order.paymentStatus,
      walletBalance: walletReconciliation ? walletReconciliation.balance : undefined,
    },
  });

  return { order, refund, walletReconciliation };
};

module.exports = {
  recomputeTotals,
  addItemsToOrder,
  reassignTable,
  reconcileRefund,
  OPEN_STATUSES,
};
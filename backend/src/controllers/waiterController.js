const crypto = require('crypto');
const mongoose = require('mongoose');

const Table = require('../models/Table');
const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const orderService = require('../services/orderService');
const customerService = require('../services/customerService');
const auditService = require('../services/auditService');
const socketService = require('../services/socketService');

/**
 * Module #13 — waiter handheld ordering.
 *
 * Reuses the shared order engine with `channel: waiter` and staff attribution,
 * so pricing/GST/numbering are identical to POS and QR flows.
 */

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

// 1. Table grid with live session state for the floor
const getWaiterTables = asyncHandler(async (req, res) => {
  const tables = await Table.find({ cafeId: req.cafeId, isActive: true }).sort({ tableNumber: 1 });

  const enriched = await Promise.all(
    tables.map(async (table) => {
      const session = await DiningSession.findOne({
        cafeId: req.cafeId,
        tableId: table._id,
        status: { $in: ['active', 'bill_requested', 'awaiting_payment'] },
      }).sort({ createdAt: -1 });

      let orderCount = 0;
      let runningTotal = 0;
      if (session) {
        const orders = await Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } });
        orderCount = orders.length;
        runningTotal = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      }

      return {
        _id: table._id,
        tableNumber: table.tableNumber,
        status: session ? 'occupied' : 'free',
        sessionId: session ? session._id : null,
        sessionStatus: session ? session.status : null,
        orderCount,
        runningTotal: orderService.round2(runningTotal),
      };
    })
  );

  res.status(200).json({ success: true, tables: enriched });
});

// 2. Fire a waiter order to the kitchen for a table + seat
const createWaiterOrder = asyncHandler(async (req, res) => {
  const {
    tableId,
    sessionId,
    items,
    notes,
    customerPhone,
    customerName,
    clientRequestId,
  } = req.body;

  if (!tableId || !isValidObjectId(tableId)) {
    throw new AppError('A valid tableId is required', 400);
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Order must contain at least one item', 400);
  }

  const table = await Table.findOne({ _id: tableId, cafeId: req.cafeId });
  if (!table) throw new AppError('Table not found for this cafe', 404);
  if (!table.isActive) throw new AppError('Table is currently disabled/inactive', 400);

  // Attach to the table's active session, or open a new one for the bill
  let session = null;
  if (sessionId && isValidObjectId(sessionId)) {
    session = await DiningSession.findOne({ _id: sessionId, cafeId: req.cafeId, tableId: table._id });
  }
  if (!session) {
    session = await DiningSession.findOne({
      cafeId: req.cafeId,
      tableId: table._id,
      status: { $in: ['active', 'bill_requested'] },
    }).sort({ createdAt: -1 });
  }
  if (!session) {
    session = await DiningSession.create({
      cafeId: req.cafeId,
      tableId: table._id,
      guestToken: crypto.randomBytes(16).toString('hex'),
      source: 'new_scan',
      status: 'active',
      customerName: customerName || '',
    });
  }

  let customer = null;
  if (customerPhone) {
    customer = await customerService.upsertByPhone({
      cafeId: req.cafeId,
      phone: customerPhone,
      name: customerName,
      email: session.customerEmail,
    });
  }

  const { order, idempotent } = await orderService.createOrder({
    cafeId: req.cafeId,
    orderType: 'dine_in',
    channel: 'waiter',
    tableId: table._id,
    sessionId: session._id,
    customerId: customer ? customer._id : null,
    createdByStaffId: req.user._id,
    items,
    notes: notes || '',
    clientRequestId: clientRequestId || null,
    // A waiter physically at the table — no geofence enforcement.
    enforceGeofence: false,
  });

  session.addActivity('order_created', `${req.user.name} took an order at table ${table.tableNumber}`);
  session.lastActivityAt = new Date();
  await session.save();

  socketService.emitMetricsUpdated(req.cafeId, { reason: 'waiter-order', orderId: order._id });

  await auditService
    .recordEvent({
      cafeId: req.cafeId,
      type: 'order.waiter',
      entityType: 'Order',
      entityId: order._id,
      amount: order.totalAmount,
      staffId: req.user._id,
      staffName: req.user.name,
      metadata: { tableNumber: table.tableNumber, seat: items[0]?.seat || null },
    })
    .catch((err) => console.error('Waiter order audit failed (non-blocking):', err.message));

  res.status(idempotent ? 200 : 201).json({
    success: true,
    message: idempotent ? 'Order already created (idempotent)' : 'Order fired to kitchen',
    order,
    sessionId: session._id,
  });
});

// 3. Waiter performance metrics (today)
const getWaiterMetrics = asyncHandler(async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const orders = await Order.find({
    cafeId: req.cafeId,
    createdByStaffId: req.user._id,
    createdAt: { $gte: start, $lte: end },
    status: { $ne: 'cancelled' },
  }).select('totalAmount status items');

  const ordersTaken = orders.length;
  const revenue = orderService.round2(orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0));
  const itemsServed = orders.reduce(
    (sum, o) => sum + (o.items || []).reduce((s, i) => s + (i.quantity || 0), 0),
    0
  );

  res.status(200).json({
    success: true,
    metrics: {
      ordersTaken,
      revenue,
      itemsServed,
      avgTicket: ordersTaken > 0 ? orderService.round2(revenue / ordersTaken) : 0,
    },
  });
});

module.exports = { getWaiterTables, createWaiterOrder, getWaiterMetrics };

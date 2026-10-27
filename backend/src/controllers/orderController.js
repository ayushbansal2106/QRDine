const Order = require('../models/Order');
const Table = require('../models/Table');
const DiningSession = require('../models/DiningSession');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const socketService = require('../services/socketService');
const telemetryService = require('../services/telemetryService');
const orderService = require('../services/orderService');
const promoService = require('../services/promoService');
const customerService = require('../services/customerService');
const resolveGuestToken = require('../utils/resolveGuestToken');

// 1. Create Customer Order (QR channel)
const createOrder = asyncHandler(async (req, res, next) => {
  const {
    tableId,
    items,
    notes,
    sessionId,
    participantId,
    clientRequestId,
    customerPhone,
    customerName,
    location,
    couponCode,
    voucherCode,
  } = req.body;

  // 1. Validate Table exists and is active
  const table = await Table.findById(tableId);
  if (!table) {
    return next(new AppError('Table not found', 404));
  }
  if (!table.isActive) {
    return next(new AppError('Table is currently disabled/inactive', 400));
  }

  const cafeId = table.cafeId;

  // 2. Validate session + guest token
  let validSession = null;
  if (!sessionId) {
    return next(new AppError('A valid dining session is required to place an order', 400));
  }

  const session = await DiningSession.findById(sessionId);
  if (!session) {
    return next(new AppError('Dining session not found', 404));
  }
  if (['bill_requested', 'awaiting_payment'].includes(session.status)) {
    return next(new AppError('Cannot add order: table is currently settling the bill', 403));
  }

  // Only `active` accepts orders. `closed`, `paid`, `abandoned` and `processing`
  // used to sail straight through, so a returning guest who still held the last
  // visit's session could add dishes to a bill that had already been settled —
  // food the kitchen would never see and money the till would never collect.
  //
  // The wording is deliberately actionable, because the client's only correct
  // response is to open a fresh session for the table.
  if (session.status !== 'active') {
    return next(
      new AppError('This table’s session has ended — please start a new session', 409)
    );
  }
  if (String(session.tableId) !== String(table._id)) {
    return next(new AppError('Session does not belong to this table', 400));
  }

  const guestToken = resolveGuestToken(req);
  if (!guestToken || session.guestToken !== guestToken) {
    return next(new AppError('Forbidden: Invalid or missing guest session token', 403));
  }

  validSession = session;

  let placedByParticipantId = null;
  let placedByName = null;
  if (participantId) {
    const participant = session.participants.find((p) => p.participantId === participantId);
    if (participant) {
      placedByParticipantId = participant.participantId;
      placedByName = participant.name;
    }
  }

  // 3. Link the order to a customer profile.
  //    A guest who signed in with their phone is linked automatically from the
  //    verified token — that is what makes order history, loyalty and wallet
  //    work without anyone re-entering a phone number. A phone number supplied
  //    on the request remains as a fallback for a walk-in who gave one.
  let customer = null;
  if (req.customer && String(req.customer.cafeId) === String(cafeId)) {
    customer = req.customer;
  } else if (customerPhone) {
    customer = await customerService.upsertByPhone({
      cafeId,
      phone: customerPhone,
      name: customerName || session.customerName,
      email: session.customerEmail,
    });
  }

  // 4. Delegate pricing, numbering and creation to the shared order engine
  const { order, idempotent, couponApplied, couponNotice, voucherApplied, voucherNotice } =
    await orderService.createOrder({
    cafeId,
    orderType: 'dine_in',
    channel: 'qr',
    tableId: table._id,
    sessionId: session._id,
    customerId: customer ? customer._id : null,
    placedByParticipantId,
    placedByName,
    items,
    notes: notes || '',
    clientRequestId: clientRequestId || null,
    voucherCode: voucherCode || null,
    geolocation: location || null,
    couponCode: couponCode || null,
  });

  if (idempotent) {
    return res.status(200).json({
      success: true,
      message: 'Order placed successfully (recovered)',
      orderId: order._id,
      orderNumber: order.orderNumber,
      order,
    });
  }

  // 5. Record session activity atomically (race-condition safe)
  const itemsSummary = (order.items || []).map((i) => `${i.quantity} ${i.itemName}`).join(', ');
  const msg = `${placedByName || session.customerName || 'A customer'} added ${itemsSummary}`;
  if (typeof DiningSession.findByIdAndUpdate === 'function') {
    await DiningSession.findByIdAndUpdate(session._id, {
      $push: {
        activityFeed: {
          $each: [{ type: 'order_created', message: msg, timestamp: new Date() }],
          $slice: -50,
        },
      },
      $set: { lastActivityAt: new Date() },
    });
  }
  socketService.emitSessionActivity(session._id, {
    type: 'order_created',
    message: msg,
    timestamp: new Date(),
  });

  res.status(201).json({
    success: true,
    // When a guest code cannot be honoured the order still succeeds at full
    // price; `couponNotice` explains why so the UI can say so.
    message: voucherNotice
      ? `Order placed successfully, but the voucher was not applied: ${voucherNotice}`
      : couponNotice
        ? `Order placed successfully, but the coupon was not applied: ${couponNotice}`
        : 'Order placed successfully',
    couponApplied: couponApplied || null,
    couponNotice: couponNotice || null,
    voucherApplied: voucherApplied || null,
    voucherNotice: voucherNotice || null,
    orderId: order._id,
    orderNumber: order.orderNumber,
    order,
  });
});

const previewCode = asyncHandler(async (req, res, next) => {
  const { code, subtotal, tableId } = req.body;

  // The tenant comes from the table, exactly as it does when the order is
  // actually placed — a public endpoint must never be told which café to look a
  // code up in.
  const table = await Table.findById(tableId);
  if (!table) {
    return next(new AppError('Table not found', 404));
  }

  try {
    const promo = await promoService.resolvePromoCode({
      cafeId: table.cafeId,
      code,
      subtotal: Number(subtotal) || 0,
      customerId: req.customer ? req.customer._id : null,
    });
    return res.status(200).json({ success: true, promo });
  } catch (err) {
    return next(err);
  }
});

const getOrders = asyncHandler(async (req, res, next) => {
  const { status, page = 1, limit = 20, search, tableNumber, orderType, channel, paymentStatus } = req.query;
  const filter = { cafeId: req.cafeId };

  const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);

  if (status) {
    filter.status = status.toLowerCase();
  }

  if (orderType) {
    filter.orderType = orderType;
  }

  if (channel) {
    filter.channel = channel;
  }

  if (paymentStatus) {
    filter.paymentStatus = paymentStatus;
  }

  // Filter by search query (orderNumber) - escape special regex chars to prevent ReDoS
  if (search && typeof search === 'string') {
    filter.orderNumber = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }

  // Filter by tableNumber (find matching table first)
  if (tableNumber) {
    const table = await Table.findOne({ cafeId: req.cafeId, tableNumber });
    if (table) {
      filter.tableId = table._id;
    } else {
      return res.status(200).json({
        page: parsedPage,
        limit: parsedLimit,
        totalCount: 0,
        totalPages: 0,
        orders: [],
      });
    }
  }

  const skip = (parsedPage - 1) * parsedLimit;

  const [orders, totalCount] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .populate('tableId', 'tableNumber')
      .skip(skip)
      .limit(parsedLimit),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    page: parsedPage,
    limit: parsedLimit,
    totalCount,
    totalPages: Math.ceil(totalCount / parsedLimit),
    orders,
  });
});

// 3. Get Single Admin Order Details
const getOrder = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findOne({ _id: id, cafeId: req.cafeId }).populate(
    'tableId',
    'tableNumber'
  );

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  res.status(200).json({
    order,
  });
});

/**
 * Assert that the caller has legitimate authority to inspect this order (SEC-003, CUS-005).
 * Authority can be established via:
 * 1. Authenticated staff/admin matching order.cafeId.
 * 2. Authenticated customer matching order.customerId.
 * 3. Valid guest session token matching order.sessionId.
 */
const assertCanAccessPublicOrder = async (req, order) => {
  // 1. Staff / Admin authorization (Bearer token for cafe)
  if (req.user && req.user.cafeId && String(req.user.cafeId) === String(order.cafeId)) {
    return true;
  }

  // 2. Customer token authorization (Signed-in profile)
  if (req.customer && order.customerId && String(req.customer._id) === String(order.customerId)) {
    return true;
  }

  // 3. Guest token authorization (Dining session cookie or x-guest-token header)
  if (order.sessionId) {
    const guestToken = resolveGuestToken(req);
    if (guestToken) {
      const session = await DiningSession.findById(order.sessionId);
      if (session && session.guestToken === guestToken) {
        return true;
      }
    }
  }

  return false;
};

// 4. Get Public Order Details (Guest tracking, verified by session or customer token)
const getPublicOrder = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id).populate('tableId', 'tableNumber');
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  const isAuthorized = await assertCanAccessPublicOrder(req, order);
  if (!isAuthorized) {
    return next(new AppError('Order not found', 404));
  }

  // Filter returning only public fields
  res.status(200).json({
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      status: (order.status || 'unknown').toUpperCase(),
      subtotal: order.subtotal,
      totalGST: order.totalGST,
      serviceCharge: order.serviceCharge,
      totalAmount: order.totalAmount,
      taxBreakdown: order.taxBreakdown || [],
      // The confirmation screen renders a "Discount (CODE)" line and the guest
      // expects to see what they saved. Without these the guest pays the
      // discounted `totalAmount` but the breakdown never adds up, which reads
      // as a billing error. Only non-sensitive fields are exposed — who applied
      // it and for how much, never the appliedBy staff id.
      discountTotal: order.discountTotal || 0,
      discounts: (order.discounts || [])
        .filter((d) => d.amount > 0)
        .map((d) => ({
          label: d.label,
          type: d.type,
          amount: d.amount,
          couponCode: d.couponCode,
        })),
      notes: order.notes,
      createdAt: order.createdAt,
      acceptedAt: order.acceptedAt,
      preparingAt: order.preparingAt,
      readyAt: order.readyAt,
      servedAt: order.servedAt,
      cancelledAt: order.cancelledAt,
      cancellationReason: order.cancellationReason,
      cancelledBy: order.cancelledBy,
      table: {
        tableNumber: order.tableId ? order.tableId.tableNumber : 'N/A',
      },
      items: order.items.map((i) => ({
        menuItemId: i.menuItemId,
        name: i.itemName,
        quantity: i.quantity,
        price: i.price,
        gstPercentage: i.gstPercentage,
        gstAmount: i.gstAmount,
      })),
    },
  });
});

// 5. Get Public Order Status Only (Lightweight polling, verified by session or customer token)
const getPublicOrderStatus = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id);
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  const isAuthorized = await assertCanAccessPublicOrder(req, order);
  if (!isAuthorized) {
    return next(new AppError('Order not found', 404));
  }

  res.status(200).json({
    status: (order.status || 'unknown').toUpperCase(),
  });
});

// 6. Update Order Status (Admin)
const updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || typeof status !== 'string') {
    return next(new AppError('status is required and must be a string', 400));
  }

  const normalizedStatus = status.toLowerCase();
  const validStatuses = ['pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled'];

  if (!validStatuses.includes(normalizedStatus)) {
    return next(new AppError('Invalid order status value', 400));
  }

  const order = await Order.findOne({ _id: id, cafeId: req.cafeId }).populate(
    'tableId',
    'tableNumber'
  );

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Update status and timestamp
  order.status = normalizedStatus;
  const timestampField = `${normalizedStatus}At`;
  order[timestampField] = new Date();

  // Sync non-cancelled items with the order's overall status
  order.items.forEach((item) => {
    if (item.status !== 'cancelled') {
      item.status = normalizedStatus;
    }
  });

  if (normalizedStatus === 'cancelled') {
    const { cancellationReason, cancelledBy } = req.body;
    order.cancellationReason = cancellationReason || 'Cancelled by staff';
    order.cancelledBy = cancelledBy || (req.user ? req.user.name : 'System');
  }

  await order.save();

  // Emit status change socket events
  socketService.emitStatusUpdate(order._id, order.cafeId, normalizedStatus);
  // Module #01 — let the live dashboard graph redraw on every transition.
  telemetryService.emitRefresh(order.cafeId, 'order.status');

  res.status(200).json({
    success: true,
    message: `Order status updated to ${normalizedStatus}`,
    order,
  });
});

// 7. Cancel Order Item (Admin/Kitchen)
const cancelOrderItem = asyncHandler(async (req, res, next) => {
  const { id, itemId } = req.params;
  const { cancellationReason, cancelledBy } = req.body;

  const order = await Order.findOne({ _id: id, cafeId: req.cafeId }).populate('tableId', 'tableNumber');
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  let item = null;
  try {
    item = order.items.id(itemId);
  } catch (e) {
    // older orders may lack _id on items; fall through to the manual search
  }

  if (!item) {
    item = order.items.find(
      (i) =>
        String(i.menuItemId) === String(itemId) ||
        String(i._id) === String(itemId) ||
        String(i.itemName) === String(itemId)
    );
  }

  if (!item) {
    return next(new AppError('Order item not found', 404));
  }

  if (item.status === 'cancelled') {
    return next(new AppError('Item is already cancelled', 400));
  }

  item.status = 'cancelled';
  item.cancelledAt = new Date();
  item.cancellationReason = cancellationReason || 'Unavailable';

  let newSubtotal = 0;
  let newTotalGST = 0;
  order.items.forEach((i) => {
    if (i.status !== 'cancelled') {
      newSubtotal += i.price * i.quantity;
      newTotalGST += i.gstAmount;
    }
  });
  order.subtotal = newSubtotal;
  order.totalGST = newTotalGST;
  order.totalAmount = newSubtotal + newTotalGST + order.serviceCharge;

  const allCancelled = order.items.every((i) => i.status === 'cancelled');
  if (allCancelled) {
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = 'All items cancelled';
  } else if (!['ready', 'served', 'partially_served'].includes(order.status)) {
    order.status = 'partially_cancelled';
  }

  await order.save();

  if (order.sessionId) {
    const session = await DiningSession.findById(order.sessionId);
    if (session && ['bill_requested', 'bill_updated', 'active'].includes(session.status)) {
      if (['bill_requested', 'bill_updated'].includes(session.status)) {
        session.status = 'bill_updated';
      }
      session.addActivity('item_cancelled', `Kitchen cancelled: ${item.itemName} (${item.cancellationReason})`);
      await session.save();
      socketService.emitSessionActivity(session._id, {
        type: 'item_cancelled',
        message: `Kitchen cancelled: ${item.itemName} (${item.cancellationReason})`,
        timestamp: new Date(),
      });

      if (session.status === 'bill_updated') {
        socketService.emitBillUpdated(req.cafeId, {
          sessionId: session._id,
          message: 'Bill has been updated due to item availability',
        });
      }
    }
  }

  socketService.emitItemCancelled(req.cafeId, {
    orderId: order._id,
    itemId,
    itemName: item.itemName,
    reason: item.cancellationReason,
  });
  socketService.emitStatusUpdate(order._id, order.cafeId, order.status);
  telemetryService.emitRefresh(order.cafeId, 'order.item_cancelled');

  res.status(200).json({
    success: true,
    message: 'Item cancelled successfully',
    order,
  });
});

module.exports = {
  createOrder,
  previewCode,
  getOrders,
  getOrder,
  getPublicOrder,
  getPublicOrderStatus,
  updateOrderStatus,
  cancelOrderItem,
};

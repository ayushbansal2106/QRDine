const Order = require('../models/Order');
const Table = require('../models/Table');
const MenuItem = require('../models/MenuItem');
const DiningSession = require('../models/DiningSession');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const socketService = require('../services/socketService');
const resolveGuestToken = require('../utils/resolveGuestToken');

// 1. Create Customer Order
const createOrder = asyncHandler(async (req, res, next) => {
  const { tableId, items, notes, sessionId, participantId, clientRequestId } = req.body;

  // 0. Idempotency Check
  if (clientRequestId) {
    const existingOrder = await Order.findOne({ clientRequestId }).populate('tableId', 'tableNumber');
    if (existingOrder) {
      return res.status(200).json({
        success: true,
        message: 'Order placed successfully (recovered)',
        orderId: existingOrder._id,
        orderNumber: existingOrder.orderNumber,
        order: existingOrder,
      });
    }
  }

  // 1. Validate Table exists and is active
  const table = await Table.findById(tableId);
  if (!table) {
    return next(new AppError('Table not found', 404));
  }
  if (!table.isActive) {
    return next(new AppError('Table is currently disabled/inactive', 400));
  }

  const cafeId = table.cafeId;

  // 2. Validate and Load Menu Items (Security: Never trust frontend names/prices/taxes)
  const resolvedItems = [];
  let calculatedSubtotal = 0;
  let totalGST = 0;
  const taxBreakdownMap = {};

  for (const item of items) {
    const menuItem = await MenuItem.findOne({ _id: item.menuItemId, cafeId });
    
    if (!menuItem) {
      return next(
        new AppError(`Menu item ${item.menuItemId} not found or does not belong to this cafe`, 404)
      );
    }
    if (!menuItem.isAvailable) {
      return next(new AppError(`Menu item "${menuItem.name}" is currently unavailable`, 400));
    }

    const price = Number(menuItem.price);
    const quantity = Number(item.quantity);
    const gstPercentage = Number(menuItem.gstPercentage || 0);

    const lineSubtotal = price * quantity;
    const lineGST = (lineSubtotal * gstPercentage) / 100;

    calculatedSubtotal += lineSubtotal;
    totalGST += lineGST;

    if (taxBreakdownMap[gstPercentage] === undefined) {
      taxBreakdownMap[gstPercentage] = 0;
    }
    taxBreakdownMap[gstPercentage] += lineGST;

    resolvedItems.push({
      menuItemId: menuItem._id,
      itemName: menuItem.name,
      quantity,
      price,
      gstPercentage,
      gstAmount: Number(lineGST.toFixed(2)),
    });
  }

  // Convert taxBreakdownMap to array format
  const taxBreakdown = Object.keys(taxBreakdownMap).map((pct) => ({
    percentage: Number(pct),
    amount: Number(taxBreakdownMap[pct].toFixed(2)),
  }));

  // 3. Calculate Totals server-side (including service charge placeholder)
  const serviceCharge = 0;
  const totalAmount = calculatedSubtotal + totalGST + serviceCharge;

  // 4. Generate Sequential Order Number (ORD-YYYYMMDD-XXXX)
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const orderCountToday = await Order.countDocuments({
    cafeId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });

  const sequenceStr = String(orderCountToday + 1).padStart(4, '0');
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;
  const orderNumber = `ORD-${dateStr}-${sequenceStr}`;

  let placedByParticipantId = null;
  let placedByName = null;

  // 4b. Validate session
  let validSessionId = null;
  if (sessionId) {
    const session = await DiningSession.findById(sessionId);
    if (!session) {
      return next(new AppError('Dining session not found', 404));
    }
    if (['bill_requested', 'awaiting_payment'].includes(session.status)) {
      return next(new AppError(`Cannot add order: table is currently settling the bill`, 403));
    }
    if (String(session.tableId) !== String(table._id)) {
      return next(new AppError('Session does not belong to this table', 400));
    }

    // Guest Token Validation (resolves from cookie or header)
    const guestToken = resolveGuestToken(req);
    if (!guestToken || session.guestToken !== guestToken) {
      return next(new AppError('Forbidden: Invalid or missing guest session token', 403));
    }

    validSessionId = session._id;
    
    if (participantId) {
      const participant = session.participants.find(p => p.participantId === participantId);
      if (participant) {
        placedByParticipantId = participant.participantId;
        placedByName = participant.name;
      }
    }
    
    // Add activity
    const itemsSummary = resolvedItems.map(i => `${i.quantity} ${i.itemName}`).join(', ');
    const msg = `${placedByName || session.customerName || 'A customer'} added ${itemsSummary}`;
    session.addActivity('order_created', msg);

    // Update last activity
    session.lastActivityAt = new Date();
    await session.save();

    // Emit activity
    socketService.emitSessionActivity(session._id, { type: 'order_created', message: msg, timestamp: new Date() });
  } else {
    return next(new AppError('A valid dining session is required to place an order', 400));
  }

  // 5. Save Order with pending default
  const order = await Order.create({
    cafeId,
    tableId: table._id,
    sessionId: validSessionId,
    placedByParticipantId: placedByParticipantId || null,
    placedByName: placedByName || null,
    orderNumber,
    clientRequestId: clientRequestId || null,
    items: resolvedItems,
    subtotal: calculatedSubtotal,
    totalGST: Number(totalGST.toFixed(2)),
    serviceCharge,
    totalAmount: Number(totalAmount.toFixed(2)),
    taxBreakdown,
    notes: notes || '',
    status: 'pending',
  });

  // Populate tableId and items before emitting to ensure the dashboard receives the complete payload
  const populatedOrder = await Order.findById(order._id).populate('tableId', 'tableNumber');
  socketService.emitNewOrder(cafeId, populatedOrder);
  
  if (validSessionId) {
    socketService.emitOrderCreatedSession(validSessionId, populatedOrder);
  }

  res.status(201).json({
    success: true,
    message: 'Order placed successfully',
    orderId: order._id,
    orderNumber: order.orderNumber,
    order: populatedOrder,
  });
});

// 2. Get Admin Orders (Dashboard)
const getOrders = asyncHandler(async (req, res, next) => {
  const { status, page = 1, limit = 20, search, tableNumber } = req.query;
  const filter = { cafeId: req.cafeId };

  // Filter by status
  if (status) {
    filter.status = status.toLowerCase();
  }

  // Filter by search query (orderNumber)
  if (search) {
    filter.orderNumber = { $regex: search, $options: 'i' };
  }

  // Filter by tableNumber (find matching table first)
  if (tableNumber) {
    const table = await Table.findOne({ cafeId: req.cafeId, tableNumber });
    if (table) {
      filter.tableId = table._id;
    } else {
      // If table number doesn't exist, return empty results
      return res.status(200).json({
        page: Number(page),
        limit: Number(limit),
        totalCount: 0,
        totalPages: 0,
        orders: [],
      });
    }
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [orders, totalCount] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .populate('tableId', 'tableNumber')
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    page: Number(page),
    limit: Number(limit),
    totalCount,
    totalPages: Math.ceil(totalCount / Number(limit)),
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

// 4. Get Public Order Details (No Auth for guest tracking)
const getPublicOrder = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id).populate('tableId', 'tableNumber');
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Filter returning only public fields
  res.status(200).json({
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      status: order.status.toUpperCase(), // Convert to frontend uppercase format
      subtotal: order.subtotal,
      totalGST: order.totalGST,
      serviceCharge: order.serviceCharge,
      totalAmount: order.totalAmount,
      taxBreakdown: order.taxBreakdown || [],
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

// 5. Get Public Order Status Only (Lightweight polling)
const getPublicOrderStatus = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id, 'status');
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  res.status(200).json({
    status: order.status.toUpperCase(),
  });
});

// 6. Update Order Status (Admin)
const updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

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
  order.items.forEach(item => {
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

  console.log(`cancelOrderItem called with orderId: ${id}, itemId: ${itemId}`);

  const order = await Order.findOne({ _id: id, cafeId: req.cafeId }).populate('tableId', 'tableNumber');
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  let item = null;
  try {
    item = order.items.id(itemId);
  } catch(e) {
    console.log(`Mongoose items.id() threw an error: ${e.message}`);
  }
  
  if (!item) {
    // Fallback for older orders without _id on items
    console.log(`Fallback search for menuItemId matching ${itemId}`);
    item = order.items.find(i => String(i.menuItemId) === String(itemId) || String(i._id) === String(itemId) || String(i.itemName) === String(itemId));
  }

  if (!item) {
    console.log(`Item not found! Order has ${order.items.length} items.`);
    order.items.forEach(i => console.log(`- item: _id=${i._id}, menuItemId=${i.menuItemId}, name=${i.itemName}`));
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
  order.items.forEach(i => {
    if (i.status !== 'cancelled') {
      newSubtotal += i.price * i.quantity;
      newTotalGST += i.gstAmount;
    }
  });
  order.subtotal = newSubtotal;
  order.totalGST = newTotalGST;
  order.totalAmount = newSubtotal + newTotalGST + order.serviceCharge;

  const allCancelled = order.items.every(i => i.status === 'cancelled');
  if (allCancelled) {
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = 'All items cancelled';
  } else {
    if (!['ready', 'served', 'partially_served'].includes(order.status)) {
       order.status = 'partially_cancelled';
    }
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
       socketService.emitSessionActivity(session._id, { type: 'item_cancelled', message: `Kitchen cancelled: ${item.itemName} (${item.cancellationReason})`, timestamp: new Date() });
       
       if (session.status === 'bill_updated') {
           socketService.emitBillUpdated(req.cafeId, { sessionId: session._id, message: 'Bill has been updated due to item availability' });
       }
    }
  }

  socketService.emitItemCancelled(req.cafeId, { orderId: order._id, itemId, itemName: item.itemName, reason: item.cancellationReason });
  socketService.emitStatusUpdate(order._id, order.cafeId, order.status);

  res.status(200).json({
    success: true,
    message: 'Item cancelled successfully',
    order,
  });
});

module.exports = {
  createOrder,
  getOrders,
  getOrder,
  getPublicOrder,
  getPublicOrderStatus,
  updateOrderStatus,
  cancelOrderItem,
};

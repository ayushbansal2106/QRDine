const Order = require('../models/Order');
const Table = require('../models/Table');
const MenuItem = require('../models/MenuItem');
const DiningSession = require('../models/DiningSession');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const socketService = require('../services/socketService');

// 1. Create Customer Order
const createOrder = asyncHandler(async (req, res, next) => {
  const { tableId, items, notes, sessionId } = req.body;

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

  // 4b. Validate session if provided
  let validSessionId = null;
  if (sessionId) {
    const session = await DiningSession.findById(sessionId);
    if (!session) {
      return next(new AppError('Dining session not found', 404));
    }
    if (session.status !== 'active') {
      return next(new AppError(`Cannot add order: session status is "${session.status}"`, 400));
    }
    if (String(session.tableId) !== String(table._id)) {
      return next(new AppError('Session does not belong to this table', 400));
    }
    validSessionId = session._id;
  }

  // 5. Save Order with pending default
  const order = await Order.create({
    cafeId,
    tableId: table._id,
    sessionId: validSessionId,
    orderNumber,
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

  await order.save();

  // Emit status change socket events
  socketService.emitStatusUpdate(order._id, order.cafeId, normalizedStatus);

  res.status(200).json({
    success: true,
    message: `Order status updated to ${normalizedStatus}`,
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
};

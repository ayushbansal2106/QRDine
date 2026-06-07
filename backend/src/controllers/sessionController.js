const DiningSession = require('../models/DiningSession');
const Order = require('../models/Order');
const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const socketService = require('../services/socketService');
const { executePaymentPipeline } = require('../services/paymentPipeline');

// ─── Public Endpoints (No Auth) ────────────────────────

// 1. Create a new dining session
const createSession = asyncHandler(async (req, res, next) => {
  const { tableId, customerName, customerEmail } = req.body;

  if (!tableId || !customerName || !customerEmail) {
    return next(new AppError('tableId, customerName, and customerEmail are required', 400));
  }

  // Validate table
  const table = await Table.findById(tableId);
  if (!table) {
    return next(new AppError('Table not found', 404));
  }
  if (!table.isActive) {
    return next(new AppError('Table is currently inactive', 400));
  }

  // Check for existing active/bill_requested session on this table
  const existingSession = await DiningSession.findOne({
    tableId: table._id,
    status: { $in: ['active', 'bill_requested'] },
  });

  if (existingSession) {
    return next(
      new AppError('An active session already exists on this table. Please continue with the existing session.', 409)
    );
  }

  const session = await DiningSession.create({
    cafeId: table.cafeId,
    tableId: table._id,
    customerName: customerName.trim(),
    customerEmail: customerEmail.trim().toLowerCase(),
    status: 'active',
    startedAt: new Date(),
  });

  res.status(201).json({
    success: true,
    message: 'Dining session started',
    session: {
      id: session._id,
      cafeId: session.cafeId,
      tableId: session.tableId,
      customerName: session.customerName,
      customerEmail: session.customerEmail,
      status: session.status,
      startedAt: session.startedAt,
    },
  });
});

// 2. Get active session for a table (public)
const getActiveSessionForTable = asyncHandler(async (req, res, next) => {
  const { tableId } = req.params;

  const session = await DiningSession.findOne({
    tableId,
    status: { $in: ['active', 'bill_requested'] },
  });

  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'No active session found for this table',
    });
  }

  // Get order count for this session
  const orderCount = await Order.countDocuments({ sessionId: session._id });

  res.status(200).json({
    success: true,
    session: {
      id: session._id,
      cafeId: session.cafeId,
      tableId: session.tableId,
      customerName: session.customerName,
      customerEmail: session.customerEmail,
      status: session.status,
      startedAt: session.startedAt,
      orderCount,
    },
  });
});

// 3. Get bill preview (customer action)
const getBillPreview = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const session = await DiningSession.findById(id).populate('tableId', 'tableNumber');
  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  const orders = await Order.find({ sessionId: session._id });
  let subtotal = 0;
  let totalGST = 0;

  for (const order of orders) {
    subtotal += order.subtotal || 0;
    totalGST += order.totalGST || 0;
  }

  const totalAmount = subtotal + totalGST;

  res.status(200).json({
    success: true,
    bill: {
      subtotal: Number(subtotal.toFixed(2)),
      gst: Number(totalGST.toFixed(2)),
      totalAmount: Number(totalAmount.toFixed(2)),
      orderCount: orders.length,
    },
  });
});

// 4. Submit payment preference (customer action)
const submitPayment = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { paymentMethod } = req.body;

  if (!paymentMethod || !['paid_counter', 'paid_online'].includes(paymentMethod)) {
    return next(new AppError('paymentMethod must be "paid_counter" or "paid_online"', 400));
  }

  const session = await DiningSession.findById(id).populate('tableId', 'tableNumber');
  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  if (session.status !== 'active') {
    return next(new AppError(`Cannot submit payment: session status is "${session.status}"`, 400));
  }

  session.status = 'awaiting_payment';
  session.paymentMethod = paymentMethod;
  await session.save();

  // Get running total for the notification
  const orders = await Order.find({ sessionId: session._id });
  let runningTotal = 0;
  for (const order of orders) {
    runningTotal += (order.subtotal || 0) + (order.totalGST || 0);
  }

  const sessionData = {
    sessionId: session._id,
    tableId: session.tableId._id || session.tableId,
    tableNumber: session.tableId.tableNumber || 'N/A',
    customerName: session.customerName,
    paymentMethod: session.paymentMethod,
    orderCount: orders.length,
    runningTotal: Number(runningTotal.toFixed(2)),
  };

  socketService.emitPaymentAwaiting(session.cafeId, sessionData);

  res.status(200).json({
    success: true,
    message: 'Payment preference submitted. Please proceed to the counter or await staff confirmation.',
    session: {
      id: session._id,
      status: session.status,
      paymentMethod: session.paymentMethod,
    },
  });
});

// ─── Admin Endpoints (Auth Required) ───────────────────

// 5. List sessions (admin)
const getSessions = asyncHandler(async (req, res, next) => {
  const { status, page = 1, limit = 20, tableNumber, dateFrom, dateTo } = req.query;
  const filter = { cafeId: req.cafeId };

  if (status) {
    filter.status = status.toLowerCase();
  }

  if (tableNumber) {
    const table = await Table.findOne({ cafeId: req.cafeId, tableNumber });
    if (table) {
      filter.tableId = table._id;
    } else {
      return res.status(200).json({ page: 1, limit: Number(limit), totalCount: 0, totalPages: 0, sessions: [] });
    }
  }

  if (dateFrom || dateTo) {
    filter.startedAt = {};
    if (dateFrom) filter.startedAt.$gte = new Date(dateFrom);
    if (dateTo) filter.startedAt.$lte = new Date(dateTo);
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [sessions, totalCount] = await Promise.all([
    DiningSession.find(filter)
      .sort({ createdAt: -1 })
      .populate('tableId', 'tableNumber')
      .skip(skip)
      .limit(Number(limit)),
    DiningSession.countDocuments(filter),
  ]);

  // For each session, get order count and running total
  const enriched = await Promise.all(
    sessions.map(async (s) => {
      const orders = await Order.find({ sessionId: s._id });
      let runningTotal = 0;
      for (const o of orders) {
        runningTotal += (o.subtotal || 0) + (o.totalGST || 0);
      }
      return {
        ...s.toObject(),
        id: s._id,
        orderCount: orders.length,
        runningTotal: Number(runningTotal.toFixed(2)),
      };
    })
  );

  res.status(200).json({
    page: Number(page),
    limit: Number(limit),
    totalCount,
    totalPages: Math.ceil(totalCount / Number(limit)),
    sessions: enriched,
  });
});

// 6. Get session details with orders (admin)
const getSessionDetails = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const session = await DiningSession.findOne({ _id: id, cafeId: req.cafeId }).populate(
    'tableId',
    'tableNumber'
  );

  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  const orders = await Order.find({ sessionId: session._id })
    .sort({ createdAt: 1 })
    .populate('tableId', 'tableNumber');

  res.status(200).json({
    success: true,
    session: {
      ...session.toObject(),
      id: session._id,
      orders,
    },
  });
});

// 7. Mark session as paid (triggers full pipeline)
const markSessionPaid = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { paymentMethod } = req.body;

  if (!paymentMethod || !['paid_counter', 'paid_online'].includes(paymentMethod)) {
    return next(new AppError('paymentMethod must be "paid_counter" or "paid_online"', 400));
  }

  try {
    const result = await executePaymentPipeline(id, paymentMethod, req.cafeId);

    res.status(200).json({
      success: true,
      message: 'Payment processed. Invoice generated and session closed.',
      session: result.session,
      invoice: result.invoice,
    });
  } catch (err) {
    return next(new AppError(err.message, 400));
  }
});

module.exports = {
  createSession,
  getActiveSessionForTable,
  getBillPreview,
  submitPayment,
  getSessions,
  getSessionDetails,
  markSessionPaid,
};

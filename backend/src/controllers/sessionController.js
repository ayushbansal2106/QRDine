const DiningSession = require('../models/DiningSession');
const Order = require('../models/Order');
const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const socketService = require('../services/socketService');
const { executePaymentPipeline } = require('../services/paymentPipeline');
const resolveGuestToken = require('../utils/resolveGuestToken');

// ─── Public Endpoints (No Auth) ────────────────────────

// 1. Create a new dining session
const createSession = asyncHandler(async (req, res, next) => {
  const { tableId, customerName, customerEmail, deviceId, forceNew } = req.body;

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
    status: { $in: ['active', 'bill_requested', 'awaiting_payment'] },
  });

  if (existingSession) {
    if (['bill_requested', 'awaiting_payment'].includes(existingSession.status)) {
      return res.status(403).json({
        success: false,
        message: 'This table is currently settling a bill. Please contact staff.',
        sessionLocked: true
      });
    }

    // Get order count for this session
    const orderCount = await Order.countDocuments({ sessionId: existingSession._id, status: { $ne: 'cancelled' } });

    // Lazy Abandonment Check
    if (existingSession.status === 'active' && orderCount === 0) {
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (existingSession.lastActivityAt < fifteenMinsAgo) {
        existingSession.status = 'abandoned';
        existingSession.abandonedAt = new Date();
        await existingSession.save();
        // Proceed to create new session below
      } else {
        return res.status(409).json({
          success: false,
          message: 'An active session already exists for this table.',
          sessionExists: true,
        });
      }
    } else {
      return res.status(409).json({
        success: false,
        message: 'An active session already exists for this table.',
        sessionExists: true,
      });
    }
  }

  const crypto = require('crypto');
  const participantId = crypto.randomBytes(8).toString('hex');
  const guestToken = crypto.randomBytes(16).toString('hex');

  const session = await DiningSession.create({
    cafeId: table.cafeId,
    tableId: table._id,
    customerName: customerName.trim(),
    customerEmail: customerEmail.trim().toLowerCase(),
    guestToken,
    participants: [{
      participantId,
      name: customerName.trim(),
      email: customerEmail.trim().toLowerCase(),
      role: 'owner',
      deviceId: deviceId || null,
      status: 'active'
    }],
    deviceId: deviceId || null,
    source: forceNew ? 'replaced_previous' : 'new_scan',
    status: 'active',
    startedAt: new Date(),
    lastActivityAt: new Date(),
  });

  // Set guest token as an httpOnly cookie (prevents XSS exfiltration)
  const guestCookieMaxAge = 24 * 60 * 60 * 1000; // 24 hours
  res.cookie('guest_token', guestToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: guestCookieMaxAge,
    path: '/',
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
      guestToken: session.guestToken,
      participantId,
      role: 'owner',
      status: session.status,
      startedAt: session.startedAt,
    },
  });
});

// 2. Get active session for a table (public)
const getActiveSessionForTable = asyncHandler(async (req, res, next) => {
  const { tableId } = req.params;
  const { deviceId } = req.query;

  const session = await DiningSession.findOne({
    tableId,
    status: { $in: ['active', 'bill_requested', 'awaiting_payment'] },
  });

  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'No active session found for this table',
    });
  }

  // Get order count for this session
  const orderCount = await Order.countDocuments({ sessionId: session._id, status: { $ne: 'cancelled' } });

  // Lazy Abandonment Check
  if (session.status === 'active' && orderCount === 0) {
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    if (session.lastActivityAt < fifteenMinsAgo) {
      session.status = 'abandoned';
      session.abandonedAt = new Date();
      await session.save();

      return res.status(404).json({
        success: false,
        message: 'No active session found for this table',
      });
    }
  }

  if (['bill_requested', 'awaiting_payment'].includes(session.status)) {
    return res.status(200).json({
      success: true,
      sessionLocked: true,
    });
  }

  // Device Ownership Check
  let isDifferentDevice = false;
  if (deviceId && session.deviceId && session.deviceId !== deviceId) {
    isDifferentDevice = true;
  }

  // Set guest token cookie so returning users have it for subsequent API calls
  // Only set for the same device to prevent information leakage to different devices
  if (!isDifferentDevice) {
    const guestCookieMaxAge = 24 * 60 * 60 * 1000; // 24 hours
    res.cookie('guest_token', session.guestToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: guestCookieMaxAge,
      path: '/',
    });
  }

  res.status(200).json({
    success: true,
    activeSession: true,
    sameDevice: !isDifferentDevice,
    session: {
      id: session._id,
      cafeId: session.cafeId,
      tableId: session.tableId,
      status: session.status,
      startedAt: session.startedAt,
      orderCount,
      participants: session.participants,
      guestToken: isDifferentDevice ? undefined : session.guestToken,
      customerName: isDifferentDevice ? undefined : session.customerName,
      customerEmail: isDifferentDevice ? undefined : session.customerEmail,
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

  // Security: Guest Token Validation (resolves from cookie or header)
  const guestToken = resolveGuestToken(req);
  if (!guestToken || session.guestToken !== guestToken) {
    return next(new AppError('Forbidden: Invalid or missing guest session token', 403));
  }

  const orders = await Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } });
  let subtotal = 0;
  let totalGST = 0;

  const itemsMap = {};

  for (const order of orders) {
    for (const item of order.items) {
      if (item.status === 'served' || order.status === 'served') {
        if (item.status !== 'cancelled') {
          subtotal += item.price * item.quantity;
          totalGST += item.gstAmount;
          
          if (itemsMap[item.menuItemId]) {
            itemsMap[item.menuItemId].quantity += item.quantity;
          } else {
            itemsMap[item.menuItemId] = {
              name: item.itemName,
              quantity: item.quantity,
              price: item.price,
            };
          }
        }
      }
    }
  }

  const consolidatedItems = Object.values(itemsMap);

  let totalAdditions = 0;
  let totalDiscounts = 0;

  if (session.adjustments) {
    for (const adj of session.adjustments) {
      if (adj.type === 'addition') totalAdditions += adj.amount;
      if (adj.type === 'discount') totalDiscounts += adj.amount;
    }
  }

  const totalAmount = Math.max(0, subtotal + totalAdditions - totalDiscounts + totalGST);

  res.status(200).json({
    success: true,
    bill: {
      subtotal: Number(subtotal.toFixed(2)),
      additions: Number(totalAdditions.toFixed(2)),
      discounts: Number(totalDiscounts.toFixed(2)),
      gst: Number(totalGST.toFixed(2)),
      totalAmount: Number(totalAmount.toFixed(2)),
      orderCount: orders.length,
      adjustments: session.adjustments || [],
      items: consolidatedItems,
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

  // Security: Guest Token Validation (resolves from cookie or header)
  const guestToken = resolveGuestToken(req);
  if (!guestToken || session.guestToken !== guestToken) {
    return next(new AppError('Forbidden: Invalid or missing guest session token', 403));
  }

  if (session.status !== 'active') {
    return next(new AppError(`Cannot submit payment: session status is "${session.status}"`, 400));
  }

  // Validate that the requestor is the owner
  const { participantId } = req.body;
  const participant = session.participants?.find(p => p.participantId === participantId);
  if (!participant || participant.role !== 'owner') {
    return next(new AppError('Only the session owner can request the bill and choose a payment method', 403));
  }

  session.status = 'awaiting_payment';
  session.paymentMethod = paymentMethod;
  session.addActivity('bill_requested', `Bill requested by ${participant.name}`);
  await session.save();

  socketService.emitSessionActivity(session._id, { type: 'bill_requested', message: `Bill requested by ${participant.name}`, timestamp: new Date() });
  socketService.emitSessionBillRequested(session._id);

  // Get running total for the notification
  const orders = await Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } });
  let runningTotal = 0;
  for (const order of orders) {
    for (const item of order.items) {
      if (item.status === 'served' || order.status === 'served') {
        if (item.status !== 'cancelled') {
          runningTotal += item.price * item.quantity;
          runningTotal += item.gstAmount;
        }
      }
    }
  }

  let totalAdditions = 0;
  let totalDiscounts = 0;

  if (session.adjustments) {
    for (const adj of session.adjustments) {
      if (adj.type === 'addition') totalAdditions += adj.amount;
      if (adj.type === 'discount') totalDiscounts += adj.amount;
    }
  }

  runningTotal = Math.max(0, runningTotal + totalAdditions - totalDiscounts);

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
      const orders = await Order.find({ sessionId: s._id, status: 'served' });
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

  const session = await DiningSession.findOne({ _id: id, cafeId: req.cafeId }).populate('tableId', 'tableNumber');
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

    // Fetch the updated session to add the activity log
    const updatedSession = await DiningSession.findById(id);
    if (updatedSession) {
      updatedSession.addActivity('session_paid', 'Payment completed');
      await updatedSession.save();
      socketService.emitSessionActivity(updatedSession._id, { type: 'session_paid', message: 'Payment completed', timestamp: new Date() });
    }

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

// 8. Add Bill Adjustment (Admin)
const addBillAdjustment = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { type, description, amount, approvalReason } = req.body;

  if (!['addition', 'discount'].includes(type)) {
    return next(new AppError('Invalid adjustment type', 400));
  }
  if (!description || !amount || amount <= 0) {
    return next(new AppError('Description and a positive amount are required', 400));
  }

  const session = await DiningSession.findOne({ _id: id, cafeId: req.cafeId });
  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  if (['paid', 'closed'].includes(session.status)) {
    return next(new AppError('Cannot adjust a paid or closed session', 400));
  }

  // Calculate current payable amount to prevent negative bills
  const Order = require('../models/Order');
  const orders = await Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } });
  
  let currentSubtotal = 0;
  let currentGST = 0;
  for (const order of orders) {
    for (const item of order.items) {
      if (item.status === 'served' || order.status === 'served') {
        if (item.status !== 'cancelled') {
          currentSubtotal += item.price * item.quantity;
          currentGST += item.gstAmount;
        }
      }
    }
  }

  let currentAdditions = 0;
  let currentDiscounts = 0;
  if (session.adjustments) {
    for (const adj of session.adjustments) {
      if (adj.type === 'addition') currentAdditions += adj.amount;
      if (adj.type === 'discount') currentDiscounts += adj.amount;
    }
  }

  const currentPayable = currentSubtotal + currentGST + currentAdditions - currentDiscounts;

  if (type === 'discount' && amount > currentPayable) {
    return next(new AppError(`Discount (₹${amount}) cannot exceed the current payable amount (₹${currentPayable})`, 400));
  }

  session.adjustments.push({
    type,
    description,
    amount,
    addedBy: req.user ? req.user._id : null,
    approvedBy: req.user ? req.user._id : null, // Default auto-approve
    approvalReason: approvalReason || 'Admin adjustment',
  });

  session.billVersion = (session.billVersion || 1) + 1;
  session.addActivity('bill_adjusted', `Manager added ${type === 'addition' ? 'charge' : 'discount'}: ${description} (₹${amount})`);

  await session.save();

  socketService.emitSessionActivity(session._id, { type: 'bill_adjusted', message: `Manager added ${type === 'addition' ? 'charge' : 'discount'}: ${description} (₹${amount})`, timestamp: new Date() });
  socketService.emitBillUpdated(req.cafeId, { sessionId: session._id, message: `Bill adjusted: ${description}` });

  res.status(200).json({
    success: true,
    message: 'Bill adjustment added',
    session,
  });
});

// 9. Join existing session (customer action)
const joinSession = asyncHandler(async (req, res, next) => {
  const { tableId, name, deviceId } = req.body;

  if (!tableId || !name) {
    return next(new AppError('tableId and name are required', 400));
  }

  const session = await DiningSession.findOne({
    tableId,
    status: { $in: ['active', 'bill_requested', 'awaiting_payment'] },
  });

  if (!session) {
    return next(new AppError('No active session found for this table', 404));
  }

  if (['bill_requested', 'awaiting_payment'].includes(session.status)) {
    return res.status(403).json({
      success: false,
      message: 'This table is currently settling a bill. Please contact staff.',
      sessionLocked: true
    });
  }

  // Check if device is already a participant or name matches an active participant
  let participant = session.participants.find(p => 
    (p.deviceId && p.deviceId === deviceId && p.status === 'active') || 
    (p.name.toLowerCase() === name.trim().toLowerCase() && p.status === 'active')
  );
  
  if (!participant) {
    const crypto = require('crypto');
    const participantId = crypto.randomBytes(8).toString('hex');
    
    participant = {
      participantId,
      name: name.trim(),
      email: null,
      role: 'member',
      deviceId: deviceId || null,
      status: 'active'
    };
    
    session.participants.push(participant);
    session.addActivity('participant_joined', `${participant.name} joined the table`);
    session.lastActivityAt = new Date();
    await session.save();

    socketService.emitParticipantJoined(session._id, participant);
    socketService.emitSessionActivity(session._id, { type: 'participant_joined', message: `${participant.name} joined the table`, timestamp: new Date() });
  } else {
    // If reusing participant but device is new/updated, we could update deviceId here
    if (deviceId && participant.deviceId !== deviceId) {
      participant.deviceId = deviceId;
      await session.save();
    }
  }

  // Set guest token as an httpOnly cookie for the joining participant
  const guestCookieMaxAge = 24 * 60 * 60 * 1000; // 24 hours
  res.cookie('guest_token', session.guestToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: guestCookieMaxAge,
    path: '/',
  });

  res.status(200).json({
    success: true,
    message: 'Joined dining session',
    session: {
      id: session._id,
      cafeId: session.cafeId,
      tableId: session.tableId,
      guestToken: session.guestToken,
      status: session.status,
      participantId: participant.participantId,
      role: participant.role
    },
  });
});

// 10. Leave session (customer action)
const leaveSession = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { participantId } = req.body;

  const session = await DiningSession.findById(id);
  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  const guestToken = resolveGuestToken(req);
  if (!guestToken || session.guestToken !== guestToken) {
    return next(new AppError('Forbidden: Invalid or missing guest session token', 403));
  }

  const participant = session.participants.find(p => p.participantId === participantId);
  if (participant) {
    participant.status = 'left';
    session.addActivity('participant_left', `${participant.name} left the table`);
    await session.save();
    socketService.emitParticipantLeft(session._id, participantId);
    socketService.emitSessionActivity(session._id, { type: 'participant_left', message: `${participant.name} left the table`, timestamp: new Date() });
  }

  res.status(200).json({ success: true, message: 'Left session' });
});

// 11. Transfer ownership (admin action)
const transferOwnership = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { newOwnerParticipantId, email } = req.body;

  const session = await DiningSession.findOne({ _id: id, cafeId: req.cafeId });
  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  if (!['active', 'bill_requested'].includes(session.status)) {
    return next(new AppError('Ownership can only be transferred during active or bill requested status', 400));
  }

  const oldOwner = session.participants.find(p => p.role === 'owner');
  const newOwner = session.participants.find(p => p.participantId === newOwnerParticipantId);

  if (!newOwner) {
    return next(new AppError('Participant not found in this session', 404));
  }

  if (oldOwner) {
    oldOwner.role = 'member';
  }

  newOwner.role = 'owner';
  if (email) {
    newOwner.email = email.trim().toLowerCase();
  } else if (!newOwner.email && oldOwner && oldOwner.email) {
    newOwner.email = oldOwner.email; // Fallback to old owner's email to ensure invoice delivery
  }

  if (!newOwner.email) {
    return next(new AppError('An email address is required for the new owner to receive the invoice.', 400));
  }

  session.customerName = newOwner.name;
  if (newOwner.email) {
    session.customerEmail = newOwner.email;
  }

  session.addActivity('ownership_transferred', `Ownership transferred to ${newOwner.name}`);
  await session.save();

  socketService.emitSessionActivity(session._id, { type: 'ownership_transferred', message: `Ownership transferred to ${newOwner.name}`, timestamp: new Date() });

  socketService.emitOwnershipTransferred(session._id, {
    sessionId: session._id,
    oldOwnerId: oldOwner ? oldOwner.participantId : null,
    newOwnerId: newOwner.participantId
  });

  res.status(200).json({
    success: true,
    message: 'Ownership transferred successfully',
    session
  });
});

// 12. Cancel bill request (admin action)
const cancelBillRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const session = await DiningSession.findOne({ _id: id, cafeId: req.cafeId });
  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  if (session.status !== 'awaiting_payment') {
    return next(new AppError('Can only cancel bill request when awaiting payment', 400));
  }

  session.status = 'active';
  session.paymentMethod = 'pending';
  session.addActivity('bill_cancelled', 'Manager unlocked the session');
  await session.save();

  socketService.emitSessionActivity(session._id, { type: 'bill_cancelled', message: 'Manager unlocked the session', timestamp: new Date() });
  socketService.emitSessionBillCancelled(session._id);
  socketService.emitBillUpdated(req.cafeId, { sessionId: session._id, message: 'Bill request cancelled' });

  res.status(200).json({
    success: true,
    message: 'Bill request cancelled',
    session
  });
});

// 13. Get activity feed (customer action)
const getActivityFeed = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const session = await DiningSession.findById(id);
  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  const guestToken = resolveGuestToken(req);
  if (!guestToken || session.guestToken !== guestToken) {
    return next(new AppError('Forbidden: Invalid or missing guest session token', 403));
  }

  res.status(200).json({
    success: true,
    activityFeed: session.activityFeed || [],
  });
});

module.exports = {
  createSession,
  getActiveSessionForTable,
  getBillPreview,
  submitPayment,
  getSessions,
  getSessionDetails,
  markSessionPaid,
  addBillAdjustment,
  joinSession,
  leaveSession,
  transferOwnership,
  cancelBillRequest,
  getActivityFeed,
};

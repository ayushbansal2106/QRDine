const crypto = require('crypto');
const DiningSession = require('../models/DiningSession');
const Order = require('../models/Order');
const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const socketService = require('../services/socketService');
const { executePaymentPipeline } = require('../services/paymentPipeline');
const { closeSessionManually } = require('../services/sessionLifecycleService');
const orderService = require('../services/orderService');
const resolveGuestToken = require('../utils/resolveGuestToken');

// ─── Public Endpoints (No Auth) ────────────────────────

// 1. Create a new dining session
const createSession = asyncHandler(async (req, res, next) => {
  const { tableId, customerName, customerEmail, deviceId, forceNew } = req.body;

  // Email is optional since Module #09: a guest signs in with a phone OTP and
  // can attach a verified email later from their profile. Only the table and a
  // display name are needed to open a table.
  if (!tableId || !customerName) {
    return next(new AppError('tableId and customerName are required', 400));
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

  const participantId = crypto.randomBytes(8).toString('hex');
  const guestToken = crypto.randomBytes(16).toString('hex');

  const session = await DiningSession.create({
    cafeId: table.cafeId,
    tableId: table._id,
    customerName: customerName.trim(),
    customerEmail: (customerEmail || '').trim().toLowerCase(),
    guestToken,
    participants: [{
      participantId,
      name: customerName.trim(),
      email: (customerEmail || '').trim().toLowerCase(),
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
      if (orderService.isBillableItem(item)) {
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
  if (!participant) {
    return next(new AppError('You are not a participant in this dining session', 403));
  }

  if (participant.status !== 'active') {
    return next(new AppError('This participant has left the table', 403));
  }

  // An unhosted session has nobody who can legitimately pay, which would strand
  // the table forever. Rather than dead-end, promote the requesting member to
  // host — the same rule `joinSession` applies when a table is first claimed.
  const hasActiveOwner = session.participants.some(
    (p) => p.role === 'owner' && p.status === 'active' && p.participantId !== participantId
  );

  if (!hasActiveOwner) {
    participant.role = 'owner';
    session.customerName = participant.name;
    session.addActivity('ownership_transferred', `${participant.name} became the table host`);
    socketService.emitOwnershipTransferred(session._id, {
      sessionId: session._id,
      oldOwnerId: null,
      newOwnerId: participant.participantId
    });
  } else if (participant.role !== 'owner') {
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
  const billable = orderService.sumBillableItems(orders);
  let runningTotal = billable.subtotal + billable.gst;

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

  const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);

  if (tableNumber) {
    const table = await Table.findOne({ cafeId: req.cafeId, tableNumber });
    if (table) {
      filter.tableId = table._id;
    } else {
      return res.status(200).json({ page: 1, limit: parsedLimit, totalCount: 0, totalPages: 0, sessions: [] });
    }
  }

  if (dateFrom || dateTo) {
    filter.startedAt = {};
    if (dateFrom) filter.startedAt.$gte = new Date(dateFrom);
    if (dateTo) filter.startedAt.$lte = new Date(dateTo);
  }

  const skip = (parsedPage - 1) * parsedLimit;

  const [sessions, totalCount] = await Promise.all([
    DiningSession.find(filter)
      .sort({ createdAt: -1 })
      .populate('tableId', 'tableNumber')
      .skip(skip)
      .limit(parsedLimit),
    DiningSession.countDocuments(filter),
  ]);

  const sessionIds = sessions.map((s) => s._id);
  const servedOrders = sessionIds.length > 0
    ? await Order.find(
        { sessionId: { $in: sessionIds }, status: 'served' },
        'sessionId subtotal totalGST'
      )
    : [];

  const statsMap = {};
  for (const o of servedOrders) {
    const sid = o.sessionId ? o.sessionId.toString() : null;
    if (!sid) continue;
    if (!statsMap[sid]) {
      statsMap[sid] = { count: 0, total: 0 };
    }
    statsMap[sid].count += 1;
    statsMap[sid].total += (o.subtotal || 0) + (o.totalGST || 0);
  }

  const enriched = sessions.map((s) => {
    const stats = statsMap[s._id.toString()] || { count: 0, total: 0 };
    return {
      ...s.toObject(),
      id: s._id,
      orderCount: stats.count,
      runningTotal: Number(stats.total.toFixed(2)),
    };
  });

  res.status(200).json({
    page: parsedPage,
    limit: parsedLimit,
    totalCount,
    totalPages: Math.ceil(totalCount / parsedLimit),
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

// 7b. Manual close (owner/manager) — a table cleared without settling the bill
//
// Paying a bill already closes the session, so this is the escape hatch for the
// cases that payment cannot express: a walkout, a comped table, or a session
// stranded by a crashed till. Unpaid orders block it unless the caller
// explicitly writes them off.
const closeSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason, writeOff } = req.body;

  if (reason !== undefined && typeof reason !== 'string') {
    throw new AppError('reason must be a string', 400);
  }

  const { session, writtenOffAmount } = await closeSessionManually({
    sessionId: id,
    cafeId: req.cafeId,
    user: req.user,
    reason: (reason || '').trim(),
    writeOff: writeOff === true,
  });

  res.status(200).json({
    success: true,
    message: 'Session closed',
    session,
    writtenOffAmount,
  });
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
  const orders = await Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } });

  const billable = orderService.sumBillableItems(orders);
  const currentSubtotal = billable.subtotal;
  const currentGST = billable.gst;

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
    const participantId = crypto.randomBytes(8).toString('hex');

    // Host resolution: whoever first claims an unhosted table becomes its host.
    //
    // `createSession` (customer scanned first) always seeds an owner, but
    // `createWaiterOrder` opens a session with NO participants at all. Without
    // this promotion such a session can never gain an owner, so `submitPayment`
    // rejects every caller with "Only the session owner can request the bill"
    // and the table is permanently unable to settle. Promoting the first joiner
    // also covers the case where the original host has left the table.
    const hasActiveOwner = session.participants.some(
      (p) => p.role === 'owner' && p.status === 'active'
    );
    const becomingOwner = !hasActiveOwner;

    participant = {
      participantId,
      name: name.trim(),
      email: null,
      role: becomingOwner ? 'owner' : 'member',
      deviceId: deviceId || null,
      status: 'active'
    };
    
    session.participants.push(participant);

    if (becomingOwner) {
      // Keep the session header in step with its new host so the bill and
      // invoice are not attributed to a waiter-entered placeholder name.
      session.customerName = participant.name;
      session.addActivity('ownership_transferred', `${participant.name} became the table host`);
      socketService.emitOwnershipTransferred(session._id, {
        sessionId: session._id,
        oldOwnerId: null,
        newOwnerId: participant.participantId
      });
    }
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

// 12b. Raise a table's bill from the counter (staff action)
//
// The guest walked up to the till and asked for the bill instead of tapping Bill
// in the app, so their session is still `active` and the kitchen may still be
// working. This moves it to the same `awaiting_payment` state the guest's own
// button produces, so from that point the counter flow is identical — the board,
// `mark-paid` and the pipeline all behave as they already do.
//
// Deliberately *not* gated on the food being served: a guest is entitled to pay
// and leave, and refusing would only trap them at the table. Staff see the
// unserved items on the bill detail before charging.
const requestBillForTable = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const session = await DiningSession.findOne({ _id: id, cafeId: req.cafeId })
    .populate('tableId', 'tableNumber');
  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  // Idempotent rather than an error: the cashier may double-tap, and a table
  // already waiting on payment is already in the state they asked for.
  if (session.status === 'awaiting_payment') {
    return res.status(200).json({
      success: true,
      alreadyRequested: true,
      message: 'Bill was already raised for this table',
      session,
    });
  }

  // Anything else is genuinely wrong to bill. `closed`/`paid` is money already
  // taken; `abandoned` is a table the cafe wrote off.
  if (session.status !== 'active') {
    return next(
      new AppError(`Cannot raise a bill for a session with status "${session.status}"`, 400)
    );
  }

  // Refuse a bill with nothing on it — that is a ₹0 "sale", which is exactly the
  // kind of row that quietly corrupts revenue reporting.
  const orders = await Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } });
  const { subtotal, gst } = orderService.sumBillableItems(orders);
  let totalAdditions = 0;
  let totalDiscounts = 0;
  if (session.adjustments) {
    for (const adj of session.adjustments) {
      if (adj.type === 'addition') totalAdditions += adj.amount;
      if (adj.type === 'discount') totalDiscounts += adj.amount;
    }
  }
  const runningTotal = Math.max(0, subtotal + gst + totalAdditions - totalDiscounts);

  if (runningTotal <= 0) {
    return next(new AppError('This table has no billable orders yet', 400));
  }

  session.status = 'awaiting_payment';
  // No payment method yet: the cashier has not taken money, and this field says
  // *how* the guest intends to settle. `mark-paid` sets the real value.
  session.paymentMethod = 'pending';
  session.addActivity('bill_requested', `Bill raised at the counter${req.user ? ` by ${req.user.name}` : ''}`);
  await session.save();

  socketService.emitSessionActivity(session._id, {
    type: 'bill_requested',
    message: 'Bill raised at the counter — please proceed to the till',
    timestamp: new Date(),
  });
  socketService.emitSessionBillRequested(session._id);
  socketService.emitPaymentAwaiting(req.cafeId, {
    sessionId: session._id,
    tableId: session.tableId._id || session.tableId,
    tableNumber: session.tableId?.tableNumber || 'N/A',
    customerName: session.customerName,
    orderCount: orders.length,
    runningTotal: Number(runningTotal.toFixed(2)),
  });

  res.status(200).json({
    success: true,
    message: 'Bill raised. The guest has been asked to pay at the counter.',
    session,
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
  closeSession,
  addBillAdjustment,
  joinSession,
  leaveSession,
  transferOwnership,
  cancelBillRequest,
  requestBillForTable,
  getActivityFeed,
};

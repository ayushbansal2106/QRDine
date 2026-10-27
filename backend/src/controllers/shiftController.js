const Shift = require('../models/Shift');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const shiftService = require('../services/shiftService');
const auditService = require('../services/auditService');
const socketService = require('../services/socketService');

/**
 * Module #08 — Shift / cash-drawer lifecycle.
 * Open/close are gated by the `drawer.open` permission at the route level.
 */

const serializeShift = (shift, summary) => ({
  id: shift._id,
  cafeId: shift.cafeId,
  openedBy: shift.openedBy,
  openedByName: shift.openedByName,
  openedAt: shift.openedAt,
  openingFloat: shift.openingFloat,
  closedBy: shift.closedBy,
  closedByName: shift.closedByName,
  closedAt: shift.closedAt,
  closingFloat: shift.closingFloat,
  status: shift.status,
  notes: shift.notes,
  ...summary,
});

// 1. Current open shift for this cafe (with live reconciliation)
const getCurrentShift = asyncHandler(async (req, res) => {
  const shift = await Shift.findOne({ cafeId: req.cafeId, status: 'open' }).sort({ openedAt: -1 });

  if (!shift) {
    return res.status(200).json({ success: true, shift: null });
  }

  const summary = await shiftService.summarizeShift(shift);

  res.status(200).json({ success: true, shift: serializeShift(shift, summary) });
});

// 2. Open a new shift (fails if one is already open)
const openShift = asyncHandler(async (req, res) => {
  const { openingFloat = 0, notes = '' } = req.body;

  if (Number(openingFloat) < 0 || Number.isNaN(Number(openingFloat))) {
    throw new AppError('openingFloat must be a non-negative number', 400);
  }

  const existing = await Shift.findOne({ cafeId: req.cafeId, status: 'open' });
  if (existing) {
    throw new AppError('A shift is already open. Close it before opening a new one.', 409);
  }

  const shift = await Shift.create({
    cafeId: req.cafeId,
    openedBy: req.user._id,
    openedByName: req.user.name,
    openedAt: new Date(),
    openingFloat: shiftService.round2(openingFloat),
    notes: notes || '',
    status: 'open',
  });

  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'shift.opened',
    entityType: 'Shift',
    entityId: shift._id,
    amount: shift.openingFloat,
    staffId: req.user._id,
    staffName: req.user.name,
    metadata: { openingFloat: shift.openingFloat },
  });

  socketService.emitShiftUpdated(req.cafeId, { shiftId: shift._id, status: 'open' });

  const summary = await shiftService.summarizeShift(shift);

  res.status(201).json({
    success: true,
    message: 'Shift opened',
    shift: serializeShift(shift, summary),
  });
});

// 3. Close the shift (accepts the shift id or falls back to the open shift)
const closeShift = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { closingFloat = 0, notes } = req.body;

  if (Number(closingFloat) < 0 || Number.isNaN(Number(closingFloat))) {
    throw new AppError('closingFloat must be a non-negative number', 400);
  }

  const filter = id
    ? { _id: id, cafeId: req.cafeId, status: 'open' }
    : { cafeId: req.cafeId, status: 'open' };
  const shift = await Shift.findOne(filter).sort({ openedAt: -1 });

  if (!shift) {
    throw new AppError('No open shift found to close', 404);
  }

  // Freeze the sales snapshot before marking closed so the summary window ends now.
  const summary = await shiftService.summarizeShift(shift);
  const closedAt = new Date();
  const difference = shiftService.round2(shiftService.round2(closingFloat) - summary.expectedCash);

  shift.status = 'closed';
  shift.closedBy = req.user._id;
  shift.closedByName = req.user.name;
  shift.closedAt = closedAt;
  shift.closingFloat = shiftService.round2(closingFloat);
  shift.expectedCash = summary.expectedCash;
  shift.cashSales = summary.cashSales;
  shift.totalSales = summary.totalSales;
  shift.orderCount = summary.orderCount;
  shift.difference = difference;
  shift.paymentsBreakdown = summary.breakdown;
  if (notes !== undefined) shift.notes = notes;
  await shift.save();

  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'shift.closed',
    entityType: 'Shift',
    entityId: shift._id,
    amount: shift.closingFloat,
    staffId: req.user._id,
    staffName: req.user.name,
    metadata: {
      openingFloat: shift.openingFloat,
      closingFloat: shift.closingFloat,
      expectedCash: shift.expectedCash,
      difference,
      breakdown: summary.breakdown,
    },
  });

  socketService.emitShiftUpdated(req.cafeId, {
    shiftId: shift._id,
    status: 'closed',
    difference,
  });

  res.status(200).json({
    success: true,
    message: 'Shift closed',
    shift: serializeShift(shift, summary),
  });
});

// 4. Shift history (closed shifts, newest first)
const getShiftHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [shifts, totalCount] = await Promise.all([
    Shift.find({ cafeId: req.cafeId, status: 'closed' })
      .sort({ closedAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Shift.countDocuments({ cafeId: req.cafeId, status: 'closed' }),
  ]);

  res.status(200).json({
    success: true,
    page: Number(page),
    limit: Number(limit),
    totalCount,
    totalPages: Math.ceil(totalCount / Number(limit)),
    shifts: shifts.map((s) =>
      serializeShift(s, {
        breakdown: s.paymentsBreakdown,
        cashSales: s.cashSales,
        totalSales: s.totalSales,
        orderCount: s.orderCount,
        expectedCash: s.expectedCash,
        difference: s.difference,
      })
    ),
  });
});

module.exports = { getCurrentShift, openShift, closeShift, getShiftHistory };

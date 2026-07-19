const DiningSession = require('../models/DiningSession');
const Order = require('../models/Order');
const DailySummary = require('../models/DailySummary');
const Invoice = require('../models/Invoice');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// 1. Bills Dashboard — active + bill_requested sessions
const getBills = asyncHandler(async (req, res, next) => {
  const { status } = req.query;
  const filter = { cafeId: req.cafeId };

  if (status) {
    filter.status = status.toLowerCase();
  } else {
    // Default: show active (with orders) + awaiting_payment
    filter.status = { $in: ['active', 'awaiting_payment'] };
  }

  const sessions = await DiningSession.find(filter)
    .sort({ createdAt: -1 })
    .populate('tableId', 'tableNumber');

  // Enrich each session with order count and running total
  const enriched = await Promise.all(
    sessions.map(async (s) => {
      const orders = await Order.find({ sessionId: s._id, status: { $ne: 'cancelled' } });
      let runningTotal = 0;
      let orderCount = 0;
      for (const order of orders) {
        orderCount++;
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
      if (s.adjustments) {
        for (const adj of s.adjustments) {
          if (adj.type === 'addition') totalAdditions += adj.amount;
          if (adj.type === 'discount') totalDiscounts += adj.amount;
        }
      }

      runningTotal = Math.max(0, runningTotal + totalAdditions - totalDiscounts);

      return {
        ...s.toObject(),
        id: s._id,
        orderCount,
        runningTotal: Number(runningTotal.toFixed(2)),
      };
    })
  );

  // Filter out "active" sessions with zero orders (no point showing them in bills)
  const filtered = enriched.filter((s) => {
    if (s.status === 'active' && s.orderCount === 0) return false;
    return true;
  });

  res.status(200).json({
    success: true,
    bills: filtered,
  });
});

// 2. Sales History — closed sessions
const getSalesHistory = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, dateFrom, dateTo } = req.query;
  const filter = { cafeId: req.cafeId, status: 'closed' };

  if (dateFrom || dateTo) {
    filter.endedAt = {};
    if (dateFrom) filter.endedAt.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.endedAt.$lte = end;
    }
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [sessions, totalCount] = await Promise.all([
    DiningSession.find(filter)
      .sort({ endedAt: -1 })
      .populate('tableId', 'tableNumber')
      .skip(skip)
      .limit(Number(limit)),
    DiningSession.countDocuments(filter),
  ]);

  // Get invoice for each session
  const enriched = await Promise.all(
    sessions.map(async (s) => {
      const orderCount = await Order.countDocuments({ sessionId: s._id, status: 'served' });
      const invoice = await Invoice.findOne({ sessionId: s._id });
      return {
        ...s.toObject(),
        id: s._id,
        orderCount,
        invoice: invoice
          ? { id: invoice._id, invoiceNumber: invoice.invoiceNumber, pdfUrl: invoice.pdfUrl }
          : null,
      };
    })
  );

  // Compute summary totals for the filtered range
  const allClosedInRange = await DiningSession.find(filter);
  const summaryTotals = allClosedInRange.reduce(
    (acc, s) => {
      acc.totalRevenue += s.totalAmount || 0;
      acc.totalGST += s.gst || 0;
      acc.sessionCount += 1;
      return acc;
    },
    { totalRevenue: 0, totalGST: 0, sessionCount: 0 }
  );

  res.status(200).json({
    page: Number(page),
    limit: Number(limit),
    totalCount,
    totalPages: Math.ceil(totalCount / Number(limit)),
    sessions: enriched,
    summary: {
      totalRevenue: Number(summaryTotals.totalRevenue.toFixed(2)),
      totalGST: Number(summaryTotals.totalGST.toFixed(2)),
      sessionCount: summaryTotals.sessionCount,
      averageOrderValue:
        summaryTotals.sessionCount > 0
          ? Number((summaryTotals.totalRevenue / summaryTotals.sessionCount).toFixed(2))
          : 0,
    },
  });
});

// 3. Analytics — daily summaries
const getAnalytics = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo } = req.query;
  const filter = { cafeId: req.cafeId };

  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.date.$lte = end;
    }
  }

  const summaries = await DailySummary.find(filter).sort({ date: -1 });

  // Aggregate across the date range
  const totals = summaries.reduce(
    (acc, s) => {
      acc.totalRevenue += s.totalRevenue;
      acc.gstCollected += s.gstCollected;
      acc.orderCount += s.orderCount;
      acc.sessionCount += s.sessionCount;
      acc.customerCount += s.customerCount;
      return acc;
    },
    { totalRevenue: 0, gstCollected: 0, orderCount: 0, sessionCount: 0, customerCount: 0 }
  );

  res.status(200).json({
    success: true,
    totals: {
      ...totals,
      averageOrderValue: totals.orderCount > 0 ? Number((totals.totalRevenue / totals.orderCount).toFixed(2)) : 0,
    },
    dailySummaries: summaries,
  });
});

module.exports = {
  getBills,
  getSalesHistory,
  getAnalytics,
};

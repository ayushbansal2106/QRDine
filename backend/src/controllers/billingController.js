const DiningSession = require('../models/DiningSession');
const Order = require('../models/Order');
const orderService = require('../services/orderService');
const DailySummary = require('../models/DailySummary');
const Invoice = require('../models/Invoice');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const loyaltyService = require('../services/loyaltyService');
const LoyaltyCard = require('../models/LoyaltyCard');

/**
 * Cast a tenant id for use inside an aggregation pipeline.
 *
 * `Model.find()` casts its filter through the schema, so `{ cafeId: '<hex>' }`
 * matches fine. `Model.aggregate()` does not — it hands the raw pipeline to the
 * server. `tenantMiddleware` supplies `req.cafeId` as a string, so an uncast id
 * silently matches nothing: the rows come back empty and the summary reads ₹0
 * with no error anywhere.
 */
const cafeObjectId = (cafeId) =>
  cafeId instanceof mongoose.Types.ObjectId
    ? cafeId
    : new mongoose.Types.ObjectId(String(cafeId));

/**
 * Compact loyalty card for a bills row: how far along the guest is, and what
 * they can actually spend right now.
 *
 * The cashier needs this at the moment of payment — "you are two stamps from a
 * free dessert" is a reason to settle this bill here, and a voucher on the card
 * is money the cafe has already promised. Only `active` vouchers are listed:
 * an expired one on screen would be an offer that cannot be honoured.
 */
const buildLoyaltySnapshot = (card, program) => {
  if (!card) return null;

  return {
    programName: program ? program.name : 'Loyalty Card',
    stamps: card.stamps || 0,
    lifetimeStamps: card.lifetimeStamps || 0,
    stampsRequired: program ? program.stampsRequired : 0,
    stampsToReward: program ? Math.max(0, program.stampsRequired - (card.stamps || 0)) : 0,
    vouchers: (card.vouchers || [])
      .filter((v) => v.status === 'active')
      .map((v) => ({
        code: v.code,
        label: v.label,
        type: v.type,
        value: v.value,
        expiresAt: v.expiresAt,
      })),
  };
};

/** Batch loyalty lookup — one query for the whole board, not one per table. */
const attachLoyalty = async (rows, cafeId) => {
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean).map(String))];

  // No signed-in guest anywhere on the board: every row reports "no card"
  // explicitly, so the shape of the response never depends on the data.
  if (customerIds.length === 0) {
    for (const row of rows) row.loyalty = null;
    return;
  }

  const [program, cards] = await Promise.all([
    loyaltyService.getProgram(cafeId),
    LoyaltyCard.find({ cafeId, customerId: { $in: customerIds } }),
  ]);

  const byCustomer = new Map(cards.map((c) => [String(c.customerId), c]));
  for (const row of rows) {
    row.loyalty = row.customerId
      ? buildLoyaltySnapshot(byCustomer.get(String(row.customerId)) || null, program)
      : null;
  }
};

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
      const orderCount = orders.length;
      const { subtotal, gst } = orderService.sumBillableItems(orders);
      let runningTotal = subtotal + gst;

      let totalAdditions = 0;
      let totalDiscounts = 0;
      if (s.adjustments) {
        for (const adj of s.adjustments) {
          if (adj.type === 'addition') totalAdditions += adj.amount;
          if (adj.type === 'discount') totalDiscounts += adj.amount;
        }
      }

      runningTotal = Math.max(0, runningTotal + totalAdditions - totalDiscounts);

      // The guest whose card the cashier is about to talk about: the profile
      // linked to any order on this table. A table with no signed-in guest has
      // none, and the card simply stays empty.
      const linkedCustomer = orders.find((o) => o.customerId);

      return {
        ...s.toObject(),
        id: s._id,
        orderCount,
        runningTotal: Number(runningTotal.toFixed(2)),
        customerId: linkedCustomer ? linkedCustomer.customerId : null,
      };
    })
  );

  await attachLoyalty(enriched, req.cafeId);

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

// 1b. One table, in full — what the bills card opens into.
//
// The board deliberately stays a summary, but "adjust bill" and "take payment"
// are decisions about a specific visit, and settling it moves the guest's
// loyalty card. This is the staff-side counterpart to the guest's bill preview:
// same arithmetic (the shared billable sum), plus the CRM context needed to
// decide how to charge and whether to mention a reward.
const getBillDetail = asyncHandler(async (req, res, next) => {
  const session = await DiningSession.findOne({ _id: req.params.id, cafeId: req.cafeId })
    .populate('tableId', 'tableNumber');

  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  const orders = await Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } })
    .sort({ createdAt: 1 })
    .populate('customerId', 'name phone email')
    .populate('items.menuItemId', 'name image price');

  const { subtotal, gst } = orderService.sumBillableItems(orders);

  let additions = 0;
  let discounts = 0;
  for (const adj of session.adjustments || []) {
    if (adj.type === 'addition') additions += adj.amount || 0;
    if (adj.type === 'discount') discounts += adj.amount || 0;
  }

  const linkedCustomer = orders.find((o) => o.customerId);
  const rows = [{ customerId: linkedCustomer ? linkedCustomer.customerId : null }];
  await attachLoyalty(rows, req.cafeId);

  res.status(200).json({
    success: true,
    bill: {
      ...session.toObject(),
      id: session._id,
      orders,
      orderCount: orders.length,
      subtotal,
      gst,
      adjustmentsTotal: additions - discounts,
      totalAmount: Number(Math.max(0, subtotal + additions - discounts + gst).toFixed(2)),
      customer: linkedCustomer ? linkedCustomer.customerId : null,
      loyalty: rows[0].loyalty,
    },
  });
});

// 2. Sales History — closed sessions + settled counter sales
//
// Two kinds of money reach a cafe and they are shaped differently:
//
//   • **QR table sessions** — a `DiningSession` that reached `closed` after the
//     bill was paid. Revenue lives on the session row.
//   • **Counter sales** — a POS order. There is no session: a takeaway has no
//     table to open, and a counter till should not leave a table session sitting
//     open for the length of a visit. Revenue lives on the order row.
//
// Reading only `DiningSession` therefore reported a cafe that rang up real money
// as having made none — every counter sale was invisible. Both sources are read
// here and merged into one chronological list so the owner sees total takings.
//
// The two are paginated together by over-fetching a `skip + limit` window from
// each source, sorting by date and slicing. That keeps the page correct without
// loading an unbounded history into memory the way the old summary did.
const getSalesHistory = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, dateFrom, dateTo } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Number(limit) || 20);

  const window = {};
  if (dateFrom || dateTo) {
    if (dateFrom) window.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      window.$lte = end;
    }
  }

  const sessionFilter = { cafeId: req.cafeId, status: 'closed' };
  if (Object.keys(window).length > 0) sessionFilter.endedAt = window;

  // A cancelled POS order is money that was never kept, so it stays out.
  const posFilter = {
    cafeId: req.cafeId,
    channel: 'pos',
    sessionId: null,
    paymentStatus: 'paid',
    status: { $ne: 'cancelled' },
  };
  if (Object.keys(window).length > 0) posFilter.createdAt = window;

  const skip = (pageNum - 1) * limitNum;
  const fetchWindow = skip + limitNum;

  const [sessions, posOrders, sessionCount, posCount, sessionTotals, posTotals] = await Promise.all([
    DiningSession.find(sessionFilter)
      .sort({ endedAt: -1 })
      .populate('tableId', 'tableNumber')
      .limit(fetchWindow)
      .lean(),
    Order.find(posFilter)
      .sort({ createdAt: -1 })
      .populate('tableId', 'tableNumber')
      .populate('customerId', 'name email')
      .limit(fetchWindow)
      .lean(),
    DiningSession.countDocuments(sessionFilter),
    Order.countDocuments(posFilter),
    DiningSession.aggregate([
      { $match: { ...sessionFilter, cafeId: cafeObjectId(req.cafeId) } },
      { $group: { _id: null, revenue: { $sum: '$totalAmount' }, gst: { $sum: '$gst' } } },
    ]),
    Order.aggregate([
      { $match: { ...posFilter, cafeId: cafeObjectId(req.cafeId) } },
      { $group: { _id: null, revenue: { $sum: '$totalAmount' }, gst: { $sum: '$totalGST' } } },
    ]),
  ]);

  const invoiceRows = await Invoice.find({
    cafeId: req.cafeId,
    sessionId: { $in: sessions.map((s) => s._id) },
  });
  const invoiceBySession = new Map(invoiceRows.map((i) => [String(i.sessionId), i]));

  // One grouped aggregation rather than a `countDocuments` per row.
  const orderCountRows = await Order.aggregate([
    { $match: { sessionId: { $in: sessions.map((s) => s._id) }, status: 'served' } },
    { $group: { _id: '$sessionId', count: { $sum: 1 } } },
  ]);
  const orderCountBySession = new Map(orderCountRows.map((r) => [String(r._id), r.count]));

  const sessionEntries = sessions.map((s) => {
    const invoice = invoiceBySession.get(String(s._id));
    return {
      kind: 'session',
      id: String(s._id),
      date: s.endedAt || s.startedAt,
      orderNumber: null,
      customerName: s.customerName || 'Walk-in',
      customerEmail: s.customerEmail || '',
      tableNumber: s.tableId?.tableNumber ?? null,
      orderCount: orderCountBySession.get(String(s._id)) || 0,
      subtotal: s.subtotal || 0,
      gst: s.gst || 0,
      totalAmount: s.totalAmount || 0,
      paymentMethod: s.paymentMethod,
      invoice: invoice
        ? { id: String(invoice._id), invoiceNumber: invoice.invoiceNumber, pdfUrl: invoice.pdfUrl }
        : null,
    };
  });

  const posEntries = posOrders.map((o) => ({
    kind: 'pos_order',
    id: String(o._id),
    date: o.createdAt,
    orderNumber: o.orderNumber,
    customerName: o.customerId?.name || o.placedByName || 'Counter',
    customerEmail: o.customerId?.email || '',
    tableNumber: o.tableId?.tableNumber ?? null,
    orderCount: 1,
    subtotal: o.subtotal || 0,
    gst: o.totalGST || 0,
    totalAmount: o.totalAmount || 0,
    // A split till records several tenders; the first is the headline label.
    paymentMethod: o.payments?.[0]?.method || 'paid_counter',
    invoice: null,
  }));

  const merged = [...sessionEntries, ...posEntries]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(skip, skip + limitNum);

  const totalCount = sessionCount + posCount;
  const totalRevenue =
    (sessionTotals[0]?.revenue || 0) + (posTotals[0]?.revenue || 0);
  const totalGST = (sessionTotals[0]?.gst || 0) + (posTotals[0]?.gst || 0);

  res.status(200).json({
    page: pageNum,
    limit: limitNum,
    totalCount,
    totalPages: Math.ceil(totalCount / limitNum),
    // `entries` is the merged list the UI renders. `sessions` is kept for
    // anything still reading the old array shape.
    entries: merged,
    sessions: sessionEntries.slice(skip, skip + limitNum),
    summary: {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalGST: Number(totalGST.toFixed(2)),
      sessionCount: totalCount,
      averageOrderValue:
        totalCount > 0 ? Number((totalRevenue / totalCount).toFixed(2)) : 0,
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

// ─── Shared helpers ─────────────────────────────────────

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const csvCell = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
};

const buildBillFilter = (query) => {
  const { q, method, from, to } = query;
  const filter = { cafeId: query.cafeId, status: 'closed' };

  if (method && method !== 'all') {
    filter.paymentMethod = method;
  }

  if (from || to) {
    filter.endedAt = {};
    if (from) filter.endedAt.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      filter.endedAt.$lte = end;
    }
  }

  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ invoiceNumber: regex }, { customerName: regex }, { customerEmail: regex }];
  }

  return filter;
};

// 4. Bills history search (Module #04) — by invoice no / customer / date / payment mode
const searchBills = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const filter = buildBillFilter({ ...req.query, cafeId: req.cafeId });

  const skip = (Number(page) - 1) * Number(limit);
  const [sessions, totalCount] = await Promise.all([
    DiningSession.find(filter)
      .sort({ endedAt: -1 })
      .populate('tableId', 'tableNumber')
      .skip(skip)
      .limit(Number(limit)),
    DiningSession.countDocuments(filter),
  ]);

  const enriched = await Promise.all(
    sessions.map(async (s) => {
      const invoice = await Invoice.findOne({ sessionId: s._id });
      return {
        ...s.toObject(),
        id: s._id,
        invoice: invoice
          ? { id: invoice._id, invoiceNumber: invoice.invoiceNumber, pdfUrl: invoice.pdfUrl }
          : null,
      };
    })
  );

  const allInRange = await DiningSession.find(filter);
  const summary = allInRange.reduce(
    (acc, s) => {
      acc.totalRevenue += s.totalAmount || 0;
      acc.totalGST += s.gst || 0;
      acc.count += 1;
      return acc;
    },
    { totalRevenue: 0, totalGST: 0, count: 0 }
  );

  res.status(200).json({
    success: true,
    page: Number(page),
    limit: Number(limit),
    totalCount,
    totalPages: Math.ceil(totalCount / Number(limit)),
    bills: enriched,
    summary: {
      totalRevenue: Number(summary.totalRevenue.toFixed(2)),
      totalGST: Number(summary.totalGST.toFixed(2)),
      count: summary.count,
    },
  });
});

// 5. Export bills as CSV with tax breakdown (Module #04)
const exportBillsCsv = asyncHandler(async (req, res) => {
  const filter = buildBillFilter({ ...req.query, cafeId: req.cafeId });
  const sessions = await DiningSession.find(filter).sort({ endedAt: -1 });

  const header = [
    'Invoice No',
    'Date',
    'Customer',
    'Email',
    'Payment Mode',
    'Subtotal',
    'GST',
    'Total',
  ].join(',');

  const rows = sessions.map((s) =>
    [
      csvCell(s.invoiceNumber),
      csvCell(s.endedAt ? new Date(s.endedAt).toISOString() : ''),
      csvCell(s.customerName),
      csvCell(s.customerEmail),
      csvCell(s.paymentMethod),
      s.subtotal || 0,
      s.gst || 0,
      s.totalAmount || 0,
    ].join(',')
  );

  const csv = [header, ...rows].join('\n');
  const filename = `bills-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
});

// 6. Daily settlement reconciliation for shift handover (Module #04)
const getSettlementReport = asyncHandler(async (req, res) => {
  const { date } = req.query;
  const target = date ? new Date(date) : new Date();
  const start = new Date(target);
  start.setHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setHours(23, 59, 59, 999);

  const sessions = await DiningSession.find({
    cafeId: req.cafeId,
    status: 'closed',
    endedAt: { $gte: start, $lte: end },
  });

  const byMethod = {};
  let totalRevenue = 0;
  let totalGST = 0;

  for (const s of sessions) {
    const method = s.paymentMethod || 'pending';
    if (!byMethod[method]) byMethod[method] = { count: 0, revenue: 0 };
    byMethod[method].count += 1;
    byMethod[method].revenue += s.totalAmount || 0;
    totalRevenue += s.totalAmount || 0;
    totalGST += s.gst || 0;
  }

  res.status(200).json({
    success: true,
    date: start.toISOString().slice(0, 10),
    totalBills: sessions.length,
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalGST: Number(totalGST.toFixed(2)),
    byMethod: Object.entries(byMethod).map(([method, data]) => ({
      method,
      count: data.count,
      revenue: Number(data.revenue.toFixed(2)),
    })),
  });
});

module.exports = {
  getBills,
  getBillDetail,
  getSalesHistory,
  getAnalytics,
  searchBills,
  exportBillsCsv,
  getSettlementReport,
};

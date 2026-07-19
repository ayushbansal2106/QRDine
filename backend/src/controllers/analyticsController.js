const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');
const Table = require('../models/Table');
const asyncHandler = require('../utils/asyncHandler');

// ─── Shared IST Timezone Helpers ────────────────────────

const getIstBoundaries = (year, month, date) => {
  const yStr = String(year);
  const mStr = String(month + 1).padStart(2, '0');
  const dStr = String(date).padStart(2, '0');
  return {
    start: new Date(`${yStr}-${mStr}-${dStr}T00:00:00+05:30`),
    end: new Date(`${yStr}-${mStr}-${dStr}T23:59:59.999+05:30`),
  };
};

const getPeriodRange = (period) => {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);
  
  const y = istDate.getFullYear();
  const m = istDate.getMonth();
  const d = istDate.getDate();

  let start, end;
  switch (period) {
    case 'week': {
      const past = new Date(istDate);
      past.setDate(past.getDate() - 6);
      start = getIstBoundaries(past.getFullYear(), past.getMonth(), past.getDate()).start;
      end = getIstBoundaries(y, m, d).end;
      break;
    }
    case 'month': {
      const past = new Date(istDate);
      past.setDate(past.getDate() - 29);
      start = getIstBoundaries(past.getFullYear(), past.getMonth(), past.getDate()).start;
      end = getIstBoundaries(y, m, d).end;
      break;
    }
    case '90days': {
      const past = new Date(istDate);
      past.setDate(past.getDate() - 89);
      start = getIstBoundaries(past.getFullYear(), past.getMonth(), past.getDate()).start;
      end = getIstBoundaries(y, m, d).end;
      break;
    }
    case 'today':
    default: {
      const bounds = getIstBoundaries(y, m, d);
      start = bounds.start;
      end = bounds.end;
      break;
    }
  }
  return { start, end };
};

const getPreviousPeriodRange = (period) => {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);
  const y = istDate.getFullYear();
  const m = istDate.getMonth();
  const d = istDate.getDate();

  let start, end;
  switch (period) {
    case 'week': {
      const endPast = new Date(istDate);
      endPast.setDate(endPast.getDate() - 7);
      const startPast = new Date(endPast);
      startPast.setDate(startPast.getDate() - 6);
      start = getIstBoundaries(startPast.getFullYear(), startPast.getMonth(), startPast.getDate()).start;
      end = getIstBoundaries(endPast.getFullYear(), endPast.getMonth(), endPast.getDate()).end;
      break;
    }
    case 'month': {
      const endPast = new Date(istDate);
      endPast.setDate(endPast.getDate() - 30);
      const startPast = new Date(endPast);
      startPast.setDate(startPast.getDate() - 29);
      start = getIstBoundaries(startPast.getFullYear(), startPast.getMonth(), startPast.getDate()).start;
      end = getIstBoundaries(endPast.getFullYear(), endPast.getMonth(), endPast.getDate()).end;
      break;
    }
    case '90days': {
      const endPast = new Date(istDate);
      endPast.setDate(endPast.getDate() - 90);
      const startPast = new Date(endPast);
      startPast.setDate(startPast.getDate() - 89);
      start = getIstBoundaries(startPast.getFullYear(), startPast.getMonth(), startPast.getDate()).start;
      end = getIstBoundaries(endPast.getFullYear(), endPast.getMonth(), endPast.getDate()).end;
      break;
    }
    case 'today':
    default: {
      const past = new Date(istDate);
      past.setDate(past.getDate() - 1);
      const bounds = getIstBoundaries(past.getFullYear(), past.getMonth(), past.getDate());
      start = bounds.start;
      end = bounds.end;
      break;
    }
  }
  return { start, end };
};

const getIstDateStr = (date) => {
  const istString = new Date(date).toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const d = new Date(istString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── 1. Overview (LIVE) ─────────────────────────────────

const getOverview = asyncHandler(async (req, res) => {
  const { cafeId } = req;
  const { start: todayStart, end: todayEnd } = getPeriodRange('today');
  const { start: yesterdayStart, end: yesterdayEnd } = getPreviousPeriodRange('today');

  // Today's orders
  const todayOrders = await Order.find({
    cafeId,
    createdAt: { $gte: todayStart, $lte: todayEnd },
    status: 'served',
  });

  const todayRevenue = todayOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const todayOrderCount = todayOrders.length;
  const avgOrderValue = todayOrderCount > 0 ? todayRevenue / todayOrderCount : 0;

  // Yesterday's orders for comparison
  const yesterdayOrders = await Order.find({
    cafeId,
    createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
    status: 'served',
  });

  const yesterdayRevenue = yesterdayOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const yesterdayOrderCount = yesterdayOrders.length;

  // Active tables (live)
  const totalTables = await Table.countDocuments({ cafeId, isActive: true });
  const activeSessions = await DiningSession.find({
    cafeId,
    status: { $in: ['active', 'bill_requested', 'awaiting_payment'] },
  }).distinct('tableId');
  const occupiedTables = activeSessions.length;

  // Today's sessions
  const todaySessions = await DiningSession.countDocuments({
    cafeId,
    startedAt: { $gte: todayStart, $lte: todayEnd },
  });

  // Table turnover
  const closedToday = await DiningSession.countDocuments({
    cafeId,
    status: 'closed',
    endedAt: { $gte: todayStart, $lte: todayEnd },
  });
  const tableTurnover = totalTables > 0 ? Number((closedToday / totalTables).toFixed(1)) : 0;

  // Percentage changes
  const revenueChange = yesterdayRevenue > 0
    ? Number((((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(1))
    : todayRevenue > 0 ? 100 : 0;

  const orderChange = yesterdayOrderCount > 0
    ? Number((((todayOrderCount - yesterdayOrderCount) / yesterdayOrderCount) * 100).toFixed(1))
    : todayOrderCount > 0 ? 100 : 0;

  res.status(200).json({
    success: true,
    overview: {
      revenueToday: Number(todayRevenue.toFixed(2)),
      revenueChange,
      ordersToday: todayOrderCount,
      orderChange,
      avgOrderValue: Number(avgOrderValue.toFixed(2)),
      activeTables: occupiedTables,
      totalTables,
      sessionsToday: todaySessions,
      tableTurnover,
    },
  });
});

// ─── 2. Revenue Analytics (LIVE) ────────────────────────

const getRevenue = asyncHandler(async (req, res) => {
  const { cafeId } = req;
  const period = req.query.period || 'week';
  const { start, end } = getPeriodRange(period);
  const prev = getPreviousPeriodRange(period);

  // Current period revenue (closed sessions)
  const currentSessions = await DiningSession.find({
    cafeId,
    status: 'closed',
    endedAt: { $gte: start, $lte: end },
  });

  // Previous period revenue
  const prevSessions = await DiningSession.find({
    cafeId,
    status: 'closed',
    endedAt: { $gte: prev.start, $lte: prev.end },
  });

  const currentRevenue = currentSessions.reduce((s, d) => s + (d.totalAmount || 0), 0);
  const previousRevenue = prevSessions.reduce((s, d) => s + (d.totalAmount || 0), 0);
  const growthPercent = previousRevenue > 0
    ? Number((((currentRevenue - previousRevenue) / previousRevenue) * 100).toFixed(1))
    : currentRevenue > 0 ? 100 : 0;

  // Daily breakdown
  const dailyMap = {};
  for (const s of currentSessions) {
    const dateStr = getIstDateStr(s.endedAt);
    if (!dailyMap[dateStr]) {
      dailyMap[dateStr] = { date: new Date(`${dateStr}T00:00:00Z`).toISOString(), revenue: 0, orders: 0 };
    }
    dailyMap[dateStr].revenue += (s.totalAmount || 0);
  }

  // Count orders per day for the chart tooltips
  const orders = await Order.find({ cafeId, createdAt: { $gte: start, $lte: end }, status: 'served' });
  for (const o of orders) {
    const dateStr = getIstDateStr(o.createdAt);
    if (!dailyMap[dateStr]) {
      dailyMap[dateStr] = { date: new Date(`${dateStr}T00:00:00Z`).toISOString(), revenue: 0, orders: 0 };
    }
    dailyMap[dateStr].orders += 1;
  }

  const dailyData = Object.values(dailyMap)
    .map(d => ({ ...d, revenue: Number(d.revenue.toFixed(2)) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Peak days computation
  const dayTotals = {};
  const dayCounts = {};
  for (const s of currentSessions) {
    const dayName = new Date(getIstDateStr(s.endedAt)).toLocaleDateString('en-US', { weekday: 'long' });
    dayTotals[dayName] = (dayTotals[dayName] || 0) + (s.totalAmount || 0);
  }
  for (const d of dailyData) {
    const dayName = new Date(d.date).toLocaleDateString('en-US', { weekday: 'long' });
    dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
  }

  const peakDays = Object.entries(dayTotals)
    .map(([day, total]) => ({
      day,
      totalRevenue: Number(total.toFixed(2)),
      avgRevenue: dayCounts[day] ? Number((total / dayCounts[day]).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  res.status(200).json({
    success: true,
    period,
    currentRevenue: Number(currentRevenue.toFixed(2)),
    previousRevenue: Number(previousRevenue.toFixed(2)),
    growthPercent,
    dailyData,
    peakDays,
  });
});

// ─── 3. GST Analytics (LIVE) ────────────────────────────

const getGST = asyncHandler(async (req, res) => {
  const { cafeId } = req;
  const period = req.query.period || 'today';
  const { start, end } = getPeriodRange(period);

  const orders = await Order.find({
    cafeId,
    createdAt: { $gte: start, $lte: end },
    status: 'served',
  });

  const gstMap = {};
  let totalGST = 0;
  for (const order of orders) {
    for (const tax of order.taxBreakdown || []) {
      if (tax.percentage > 0) {
        gstMap[tax.percentage] = (gstMap[tax.percentage] || 0) + tax.amount;
        totalGST += tax.amount;
      }
    }
  }

  const slabs = Object.entries(gstMap)
    .map(([pct, amt]) => ({ percentage: Number(pct), amount: Number(amt.toFixed(2)) }))
    .sort((a, b) => a.percentage - b.percentage);

  res.status(200).json({
    success: true,
    period,
    totalGST: Number(totalGST.toFixed(2)),
    slabs,
  });
});

// ─── 4. Items Analytics (LIVE) ──────────────────────────

const getItems = asyncHandler(async (req, res) => {
  const { cafeId } = req;
  const period = req.query.period || 'month';
  const { start, end } = getPeriodRange(period);

  const orders = await Order.find({
    cafeId,
    createdAt: { $gte: start, $lte: end },
  });

  const itemMap = {};
  for (const order of orders) {
    for (const item of order.items || []) {
      const key = String(item.menuItemId);
      if (!itemMap[key]) {
        itemMap[key] = {
          menuItemId: item.menuItemId,
          itemName: item.itemName,
          quantity: 0,
          revenue: 0,
          cancelledQuantity: 0,
          cancellationReasons: {},
        };
      }

      if (item.status === 'cancelled') {
        itemMap[key].cancelledQuantity += item.quantity;
        const reason = item.cancellationReason || 'Unknown';
        itemMap[key].cancellationReasons[reason] = (itemMap[key].cancellationReasons[reason] || 0) + item.quantity;
      } else if (order.status === 'served' || item.status === 'served') {
        itemMap[key].quantity += item.quantity;
        itemMap[key].revenue += item.price * item.quantity;
      }
    }
  }

  const allItems = Object.values(itemMap).map((item) => ({
    ...item,
    revenue: Number(item.revenue.toFixed(2)),
  }));

  const bestByQuantity = [...allItems].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
  const bestByRevenue = [...allItems].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const worstPerformers = [...allItems]
    .filter((item) => item.quantity > 0)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 5);

  res.status(200).json({
    success: true,
    period,
    bestByQuantity,
    bestByRevenue,
    worstPerformers,
    totalItems: allItems.length,
  });
});

// ─── 5. Table Analytics (LIVE) ──────────────────────────

const getTables = asyncHandler(async (req, res) => {
  const { cafeId } = req;
  const period = req.query.period || 'month';
  const { start, end } = getPeriodRange(period);

  const tables = await Table.find({ cafeId, isActive: true });

  const tableStats = await Promise.all(
    tables.map(async (table) => {
      const orders = await Order.find({
        cafeId,
        tableId: table._id,
        createdAt: { $gte: start, $lte: end },
        status: 'served',
      });
      const revenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

      const sessions = await DiningSession.find({
        cafeId,
        tableId: table._id,
        startedAt: { $gte: start, $lte: end },
      });

      const closedSessions = sessions.filter((s) => s.endedAt);
      let avgDuration = 0;
      if (closedSessions.length > 0) {
        const totalMinutes = closedSessions.reduce((sum, s) => {
          return sum + (new Date(s.endedAt) - new Date(s.startedAt)) / 60000;
        }, 0);
        avgDuration = Math.round(totalMinutes / closedSessions.length);
      }

      const activeSession = await DiningSession.findOne({
        tableId: table._id,
        status: { $in: ['active', 'bill_requested', 'awaiting_payment'] },
      });

      return {
        tableId: table._id,
        tableNumber: table.tableNumber,
        revenue: Number(revenue.toFixed(2)),
        orderCount: orders.length,
        sessionCount: sessions.length,
        avgSessionDuration: avgDuration,
        turnoverRate: sessions.length,
        isOccupied: !!activeSession,
      };
    })
  );

  tableStats.sort((a, b) => b.revenue - a.revenue);

  res.status(200).json({
    success: true,
    period,
    tables: tableStats,
  });
});

// ─── 6. Session Analytics (LIVE) ────────────────────────

const getSessions = asyncHandler(async (req, res) => {
  const { cafeId } = req;
  const period = req.query.period || 'today';
  const { start, end } = getPeriodRange(period);

  const sessions = await DiningSession.find({
    cafeId,
    startedAt: { $gte: start, $lte: end },
  });

  const totalSessions = sessions.length;

  const closedSessions = sessions.filter((s) => s.endedAt);
  const durations = closedSessions.map((s) =>
    (new Date(s.endedAt) - new Date(s.startedAt)) / 60000
  );

  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const longestSession = durations.length > 0 ? Math.round(Math.max(...durations)) : 0;
  const shortestSession = durations.length > 0 ? Math.round(Math.min(...durations)) : 0;

  const sessionsStarted = totalSessions;
  const sessionIds = sessions.map((s) => s._id);
  const ordersPerSession = await Order.aggregate([
    { $match: { sessionId: { $in: sessionIds }, status: { $ne: 'cancelled' } } },
    { $group: { _id: '$sessionId' } },
  ]);
  const sessionsWithOrders = ordersPerSession.length;

  const billRequested = sessions.filter((s) =>
    ['bill_requested', 'bill_updated', 'awaiting_payment', 'paid', 'closed'].includes(s.status)
  ).length;

  const paymentsCompleted = sessions.filter((s) =>
    ['paid', 'closed'].includes(s.status)
  ).length;

  const abandonedSessions = sessions.filter(s => s.status === 'abandoned').length;

  res.status(200).json({
    success: true,
    period,
    totalSessions,
    avgDuration,
    longestSession,
    shortestSession,
    closedCount: closedSessions.length,
    abandonedCount: abandonedSessions,
    funnel: {
      sessionsStarted,
      ordersPlaced: sessionsWithOrders,
      billsRequested: billRequested,
      paymentsCompleted,
      abandonedSessions,
    },
  });
});

// ─── 7. Customer Analytics (LIVE) ───────────────────────

const getCustomers = asyncHandler(async (req, res) => {
  const { cafeId } = req;
  const period = req.query.period || 'month';
  const { start, end } = getPeriodRange(period);

  const sessions = await DiningSession.find({
    cafeId,
    startedAt: { $gte: start, $lte: end },
    status: 'closed',
  });

  const customerMap = {};
  for (const s of sessions) {
    const email = s.customerEmail;
    if (!customerMap[email]) {
      customerMap[email] = { email, name: s.customerName, visits: 0, totalRevenue: 0 };
    }
    customerMap[email].visits += 1;
    customerMap[email].totalRevenue += s.totalAmount || 0;
  }

  const customers = Object.values(customerMap);

  const returningEmails = new Set();
  for (const email of Object.keys(customerMap)) {
    const priorSession = await DiningSession.findOne({
      cafeId,
      customerEmail: email,
      startedAt: { $lt: start },
      status: 'closed',
    });
    if (priorSession) returningEmails.add(email);
  }

  const totalCustomers = customers.length;
  const returningCount = returningEmails.size;
  const newCount = totalCustomers - returningCount;

  const topCustomers = [...customers]
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 10)
    .map((c) => ({
      ...c,
      totalRevenue: Number(c.totalRevenue.toFixed(2)),
      isReturning: returningEmails.has(c.email),
    }));

  res.status(200).json({
    success: true,
    period,
    totalCustomers,
    newCustomers: newCount,
    returningCustomers: returningCount,
    newPercent: totalCustomers > 0 ? Number(((newCount / totalCustomers) * 100).toFixed(1)) : 0,
    returningPercent: totalCustomers > 0 ? Number(((returningCount / totalCustomers) * 100).toFixed(1)) : 0,
    topCustomers,
  });
});

// ─── 8. Payment Method Analytics (LIVE) ─────────────────

const getPayments = asyncHandler(async (req, res) => {
  const { cafeId } = req;
  const period = req.query.period || 'today';
  const { start, end } = getPeriodRange(period);

  const sessions = await DiningSession.find({
    cafeId,
    status: 'closed',
    endedAt: { $gte: start, $lte: end },
  });

  let onlineCount = 0;
  let counterCount = 0;
  let onlineRevenue = 0;
  let counterRevenue = 0;

  for (const s of sessions) {
    if (s.paymentMethod === 'paid_online') {
      onlineCount++;
      onlineRevenue += s.totalAmount || 0;
    } else {
      counterCount++;
      counterRevenue += s.totalAmount || 0;
    }
  }

  const total = onlineCount + counterCount;
  const avgOnlineTicket = onlineCount > 0 ? onlineRevenue / onlineCount : 0;
  const avgCounterTicket = counterCount > 0 ? counterRevenue / counterCount : 0;

  res.status(200).json({
    success: true,
    period,
    onlineCount,
    counterCount,
    onlinePercent: total > 0 ? Number(((onlineCount / total) * 100).toFixed(1)) : 0,
    counterPercent: total > 0 ? Number(((counterCount / total) * 100).toFixed(1)) : 0,
    onlineRevenue: Number(onlineRevenue.toFixed(2)),
    counterRevenue: Number(counterRevenue.toFixed(2)),
    avgOnlineTicket: Number(avgOnlineTicket.toFixed(2)),
    avgCounterTicket: Number(avgCounterTicket.toFixed(2)),
  });
});

module.exports = {
  getOverview,
  getRevenue,
  getGST,
  getItems,
  getTables,
  getSessions,
  getCustomers,
  getPayments,
};

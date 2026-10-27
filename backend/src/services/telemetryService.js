const mongoose = require('mongoose');
const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');
const Table = require('../models/Table');
const Cafe = require('../models/Cafe');
const User = require('../models/User');
const socketService = require('./socketService');

/**
 * Module #01 — real-time operations telemetry.
 *
 * All per-cafe numbers here are tenant-scoped. The single exception is
 * `getOutletConsolidation`, which spans cafes — and it re-verifies ownership of
 * every outlet it touches before returning a single rupee of it, so a manager
 * can only ever see their own brand's outlets.
 */

const ACTIVE_ORDER_STATUSES = ['pending', 'accepted', 'preparing', 'ready'];
const ACTIVE_SESSION_STATUSES = ['active', 'bill_requested', 'awaiting_payment'];

const round2 = (value) => Number(Number(value).toFixed(2));
const round1 = (value) => Number(Number(value).toFixed(1));

/** Throttle socket refresh pings to at most one per second per cafe. */
const REFRESH_THROTTLE_MS = 1000;
const lastRefreshAt = new Map();

const emitRefresh = (cafeId, reason) => {
  const key = String(cafeId);
  const now = Date.now();
  const previous = lastRefreshAt.get(key) || 0;
  if (now - previous < REFRESH_THROTTLE_MS) return false;
  lastRefreshAt.set(key, now);
  socketService.emitMetricsUpdated(cafeId, { reason, at: new Date().toISOString() });
  return true;
};

const startOfLocalDay = (reference = new Date()) => {
  const d = new Date(reference);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
};

/**
 * Live board payload: revenue, open work, throughput and the order feed.
 * Kept deliberately cheap — this is polled or socket-triggered.
 */
const getLiveSnapshot = async (cafeId) => {
  const todayStart = startOfLocalDay();
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  const [todaysOrders, activeTickets, openSessions, recentOrders] = await Promise.all([
    Order.find({
      cafeId,
      createdAt: { $gte: todayStart, $lte: todayEnd },
    }),
    Order.countDocuments({ cafeId, status: { $in: ACTIVE_ORDER_STATUSES } }),
    DiningSession.countDocuments({ cafeId, status: { $in: ACTIVE_SESSION_STATUSES } }),
    Order.find({ cafeId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('tableId', 'tableNumber'),
  ]);

  const paidOrders = todaysOrders.filter((o) => o.paymentStatus === 'paid');
  const grossRevenue = paidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const breakdown = { dine_in: {}, takeaway: {}, delivery: {} };
  const statusCounts = { pending: 0, accepted: 0, preparing: 0, ready: 0, served: 0, cancelled: 0 };
  const channelCounts = { qr: 0, pos: 0, waiter: 0, online: 0 };
  let fulfillmentTotal = 0;
  let fulfillmentCount = 0;

  for (const order of todaysOrders) {
    statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
    const type = order.orderType || 'dine_in';
    breakdown[type] = breakdown[type] || {};
    breakdown[type][order.status] = (breakdown[type][order.status] || 0) + 1;
    channelCounts[order.channel] = (channelCounts[order.channel] || 0) + 1;

    if (order.servedAt && order.createdAt) {
      fulfillmentTotal += (new Date(order.servedAt) - new Date(order.createdAt)) / 60000;
      fulfillmentCount += 1;
    }
  }

  return {
    grossRevenue: round2(grossRevenue),
    paidOrderCount: paidOrders.length,
    activeTickets,
    customerInflux: openSessions,
    avgFulfillmentMinutes: fulfillmentCount > 0 ? round1(fulfillmentTotal / fulfillmentCount) : 0,
    statusCounts,
    channelCounts,
    orderTypeBreakdown: breakdown,
    recentOrders: recentOrders.map((o) => ({
      id: o._id,
      orderNumber: o.orderNumber,
      orderType: o.orderType,
      channel: o.channel,
      status: o.status,
      totalAmount: o.totalAmount,
      tableNumber: o.tableId ? o.tableId.tableNumber : null,
      createdAt: o.createdAt,
    })),
  };
};

/**
 * Peak-hours analytics over a rolling window.
 * Returns per-hour order/revenue/ticket aggregates plus a day-of-week heatmap
 * so a manager can see "Saturday 8pm" rather than just "hour 20".
 */
const getPeakHours = async ({ cafeId, days = 7 }) => {
  const windowDays = Math.min(90, Math.max(1, Number(days) || 7));
  const start = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const orders = await Order.find({ cafeId, createdAt: { $gte: start } }).select(
    'createdAt totalAmount paymentStatus status'
  );

  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orderCount: 0,
    paidRevenue: 0,
    cancelled: 0,
  }));
  const daysOfWeek = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const order of orders) {
    const hour = new Date(order.createdAt).getHours();
    const bucket = hours[hour];
    if (order.status === 'cancelled') bucket.cancelled += 1;
    else bucket.orderCount += 1;
    if (order.paymentStatus === 'paid') bucket.paidRevenue += order.totalAmount || 0;

    daysOfWeek[new Date(order.createdAt).getDay()][hour] += 1;
  }

  const hourly = hours.map((bucket) => ({
    ...bucket,
    paidRevenue: round2(bucket.paidRevenue),
    avgTicket: bucket.orderCount > 0 ? round2(bucket.paidRevenue / bucket.orderCount) : 0,
  }));

  const peak = hourly.reduce(
    (best, bucket) => (bucket.orderCount > (best ? best.orderCount : -1) ? bucket : best),
    null
  );

  return {
    windowDays,
    totalOrders: orders.length,
    hourly,
    heatmap: daysOfWeek,
    peakHour: peak && peak.orderCount > 0 ? peak.hour : null,
    peakOrderCount: peak ? peak.orderCount : 0,
  };
};

/**
 * Table turnover: how hard the floor is being worked.
 * Turnover rate = closed sessions / active tables, per hour bucket.
 */
const getTurnover = async ({ cafeId, days = 1 }) => {
  const windowDays = Math.min(30, Math.max(1, Number(days) || 1));
  const start = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [sessions, tables] = await Promise.all([
    DiningSession.find({ cafeId, createdAt: { $gte: start } }).select(
      'tableId status startedAt endedAt totalAmount'
    ),
    Table.find({ cafeId, isActive: true }).select('_id tableNumber'),
  ]);

  const activeTables = tables.length;
  const closed = sessions.filter((s) => ['paid', 'closed'].includes(s.status) && s.endedAt);

  const perHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    sessionsStarted: 0,
    sessionsClosed: 0,
    revenue: 0,
  }));

  let totalDurationMinutes = 0;
  let durationCount = 0;

  for (const session of sessions) {
    perHour[new Date(session.startedAt || session.createdAt).getHours()].sessionsStarted += 1;
    if (closed.includes(session)) {
      const hour = new Date(session.endedAt).getHours();
      perHour[hour].sessionsClosed += 1;
      perHour[hour].revenue += session.totalAmount || 0;
      const minutes = (new Date(session.endedAt) - new Date(session.startedAt)) / 60000;
      if (minutes > 0 && minutes < 12 * 60) {
        totalDurationMinutes += minutes;
        durationCount += 1;
      }
    }
  }

  const byTable = new Map();
  for (const session of sessions) {
    const key = String(session.tableId);
    const entry = byTable.get(key) || { tableId: key, sessions: 0, revenue: 0 };
    entry.sessions += 1;
    entry.revenue += session.totalAmount || 0;
    byTable.set(key, entry);
  }

  const avgSessionMinutes = durationCount > 0 ? round1(totalDurationMinutes / durationCount) : 0;
  const avgSessionsPerTable =
    activeTables > 0 ? round2(sessions.length / activeTables) : 0;

  return {
    windowDays,
    activeTables,
    totalSessions: sessions.length,
    closedSessions: closed.length,
    turnoverRate: activeTables > 0 ? round2(closed.length / activeTables) : 0,
    avgSessionsPerTable,
    avgSessionMinutes,
    occupancyPct: sessions.length > 0 && activeTables > 0
      ? Math.min(100, Math.round((sessions.length / (activeTables * windowDays)) * 100))
      : 0,
    hourly: perHour.map((bucket) => ({ ...bucket, revenue: round2(bucket.revenue) })),
    byTable: Array.from(byTable.values())
      .map((entry) => ({ ...entry, revenue: round2(entry.revenue) }))
      .sort((a, b) => b.sessions - a.sessions),
  };
};

/**
 * Outlet consolidation (Module #01).
 *
 * A brand owner registers one `User` per outlet. We therefore only include an
 * outlet when there is a user with the SAME email holding owner/manager on it —
 * identity is proven by the auth token, not by a client-supplied cafe list.
 */
const getOutletConsolidation = async ({ user, cafeId, days = 7 }) => {
  const homeCafe = await Cafe.findById(cafeId).select('name outletGroup outletLabel').lean();
  if (!homeCafe) {
    return { scope: 'single', outlets: [], totals: null };
  }

  const outletGroup = homeCafe.outletGroup || '';
  if (!outletGroup) {
    return {
      scope: 'single',
      reason: 'no_outlet_group_configured',
      outlets: [],
      totals: await aggregateOutlets({ cafeIds: [cafeId], days }),
    };
  }

  const groupCafes = await Cafe.find({ outletGroup }).select('name outletGroup outletLabel');
  const groupIds = groupCafes.map((c) => c._id);

  const myAccounts = await User.find({
    cafeId: { $in: groupIds },
    email: user.email,
    role: { $in: ['owner', 'manager'] },
    isActive: true,
  }).select('cafeId role');

  const permittedIds = new Set(myAccounts.map((a) => String(a.cafeId)));
  permittedIds.add(String(cafeId)); // the caller's own tenant is always included

  const accessible = groupCafes.filter((c) => permittedIds.has(String(c._id)));

  return {
    scope: accessible.length > 1 ? 'group' : 'single',
    outletGroup,
    // Cafes in the group the caller is NOT entitled to are simply not listed.
    excludedCount: groupCafes.length - accessible.length,
    outlets: accessible.map((c) => c._id),
    totals: await aggregateOutlets({ cafeIds: accessible.map((c) => c._id), days }),
  };
};

const aggregateOutlets = async ({ cafeIds, days }) => {
  const windowDays = Math.min(90, Math.max(1, Number(days) || 7));
  const start = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const ids = cafeIds.map((id) => new mongoose.Types.ObjectId(String(id)));

  const [orders, cafes] = await Promise.all([
    Order.find({ cafeId: { $in: ids }, createdAt: { $gte: start } }).select(
      'cafeId totalAmount paymentStatus status createdAt'
    ),
    Cafe.find({ _id: { $in: ids } }).select('name outletLabel'),
  ]);

  const perOutlet = new Map();
  for (const cafe of cafes) {
    perOutlet.set(String(cafe._id), {
      cafeId: cafe._id,
      name: cafe.name,
      outletLabel: cafe.outletLabel || cafe.name,
      orderCount: 0,
      paidOrders: 0,
      revenue: 0,
      cancellations: 0,
    });
  }

  for (const order of orders) {
    const entry = perOutlet.get(String(order.cafeId));
    if (!entry) continue;
    entry.orderCount += 1;
    if (order.status === 'cancelled') entry.cancellations += 1;
    if (order.paymentStatus === 'paid') {
      entry.paidOrders += 1;
      entry.revenue += order.totalAmount || 0;
    }
  }

  const outlets = Array.from(perOutlet.values()).map((entry) => ({
    ...entry,
    revenue: round2(entry.revenue),
    avgTicket: entry.paidOrders > 0 ? round2(entry.revenue / entry.paidOrders) : 0,
  }));

  const revenue = outlets.reduce((sum, o) => sum + o.revenue, 0);
  const paidOrders = outlets.reduce((sum, o) => sum + o.paidOrders, 0);

  return {
    windowDays,
    outletCount: outlets.length,
    totals: {
      revenue: round2(revenue),
      orderCount: outlets.reduce((sum, o) => sum + o.orderCount, 0),
      paidOrders,
      cancellations: outlets.reduce((sum, o) => sum + o.cancellations, 0),
      avgTicket: paidOrders > 0 ? round2(revenue / paidOrders) : 0,
      bestOutlet: outlets.length ? outlets.reduce((a, b) => (b.revenue > a.revenue ? b : a)).outletLabel : null,
    },
    outlets,
  };
};

module.exports = {
  emitRefresh,
  getLiveSnapshot,
  getPeakHours,
  getTurnover,
  getOutletConsolidation,
  aggregateOutlets,
  ACTIVE_ORDER_STATUSES,
  ACTIVE_SESSION_STATUSES,
};
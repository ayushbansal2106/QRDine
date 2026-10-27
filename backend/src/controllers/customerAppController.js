const Customer = require('../models/Customer');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const customerAuthService = require('../services/customerAuthService');
const customerService = require('../services/customerService');
const emailService = require('../services/emailService');
const env = require('../config/env');
const { CUSTOMER_COOKIE } = require('../middlewares/customerAuthMiddleware');

/**
 * Guest-facing customer app (Module #09).
 *
 * Every read here is scoped to `req.customer.cafeId`, which comes from the
 * verified token rather than from the request, so a customer can only ever see
 * their own history at one café.
 */

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.nodeEnv === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Orders a guest sees are settled ones; drafts and cancellations are noise.
 *
 * These have to be the *real* `Order.status` enum. The list used to read
 * `['confirmed', ..., 'completed']`, but the model only ever sets
 * `pending | accepted | preparing | ready | served | cancelled` — so two of the
 * five entries could never match anything.
 *
 * Payment is the stronger signal, so it wins: a counter sale is written only
 * once the tender is confirmed, and a QR order can be paid while the kitchen is
 * still on it. Either way the customer handed over money and expects to see it.
 * Cancellations stay excluded so a voided order is never counted as spend.
 */
const SETTLED_STATUSES = ['accepted', 'preparing', 'ready', 'served'];

/** Shared match clause for "this customer actually bought something". */
const settledOrderMatch = (cafeId, customerId) => ({
  cafeId,
  customerId,
  status: { $ne: 'cancelled' },
  $or: [{ paymentStatus: 'paid' }, { status: { $in: SETTLED_STATUSES } }],
});

/**
 * Orders still in front of the guest: placed, not yet paid, not cancelled.
 *
 * Settled-only history is the right record of *spend*, but it is the wrong list
 * for "where is my order". A guest who has just scanned the QR and ordered sees
 * an empty history while they are still sitting at the table eating it — which
 * reads as their order having been lost.
 *
 * Kept as a separate list rather than merged, so the spend figures (lifetime
 * value, the counter on the profile) keep counting settled orders only.
 */
const liveOrderMatch = (cafeId, customerId) => ({
  cafeId,
  customerId,
  status: { $nin: [...SETTLED_STATUSES, 'cancelled'] },
  paymentStatus: { $ne: 'paid' },
});

/**
 * Order-history windows. Defaulting to three months keeps the common case to a
 * single indexed range scan, while `all` stays available for the rare customer
 * who wants the full record.
 */
const RANGE_MONTHS = { '3m': 3, '6m': 6, '1y': 12 };

const rangeStart = (range) => {
  if (range === 'all') return null;
  const months = RANGE_MONTHS[range] ?? RANGE_MONTHS['3m'];
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  return start;
};

const publicProfile = (customer) => ({
  id: String(customer._id),
  name: customer.name || '',
  phone: customer.phone || '',
  email: customer.email || '',
  emailVerified: Boolean(customer.emailVerifiedAt),
  preferences: {
    vegOnly: Boolean(customer.preferences?.vegOnly),
    notifications: customer.preferences?.notifications !== false,
    language: customer.preferences?.language || 'en',
  },
});

// ── Sign-in ────────────────────────────────────────────

const requestOtp = asyncHandler(async (req, res) => {
  const { phone, cafeId } = req.body;
  const result = await customerAuthService.requestLoginOtp({ phone, cafeId });

  res.status(200).json({
    success: true,
    message: 'We sent you a 6-digit code',
    provider: result.provider,
    // Present only outside production so the flow is testable before the
    // operator's DLT sender ID is approved.
    devCode: result.devCode || undefined,
  });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, code, cafeId } = req.body;
  const { customer, token } = await customerAuthService.verifyLoginOtp({ phone, code, cafeId });

  res.cookie(CUSTOMER_COOKIE, token, COOKIE_OPTIONS);
  // The frontend and backend run on different origins, so this cookie is set
  // on the API origin and the browser never presents it to Next. The token is
  // returned as well so the Next origin can mirror it into its own httpOnly
  // cookie — the same thing `createSession` does for the guest token.
  res.status(200).json({ success: true, customer: publicProfile(customer), token });
});

const signOut = asyncHandler(async (req, res) => {
  res.clearCookie(CUSTOMER_COOKIE, { ...COOKIE_OPTIONS, maxAge: undefined });
  res.status(200).json({ success: true, message: 'Signed out' });
});

/**
 * `customer_token` mirror — see the sign-in note above.

// ── Profile ────────────────────────────────────────────

/**
 * Profile plus the three counters on the profile screen.
 * `saved` is the money actually kept in the guest's pocket across their orders.
 */
const getMe = asyncHandler(async (req, res) => {
  const customer = req.customer;

  const match = settledOrderMatch(customer.cafeId, customer._id);

  const [orderCount, spend, saved] = await Promise.all([
    Order.countDocuments(match),
    Order.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Order.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$discountTotal' } } }]),
  ]);

  res.status(200).json({
    success: true,
    customer: publicProfile(customer),
    stats: {
      orders: orderCount,
      spent: Number((spend[0]?.total || 0).toFixed(2)),
      saved: Number((saved[0]?.total || 0).toFixed(2)),
      visits: customer.visitCount || 0,
      averageSpend: Number(customer.avgSpend || 0),
      memberSince: customer.firstSeenAt,
      lastVisitAt: customer.lastVisitAt,
    },
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (name !== undefined) {
    req.customer.name = String(name).trim().slice(0, 120);
  }
  await req.customer.save();
  res.status(200).json({ success: true, customer: publicProfile(req.customer) });
});

const updatePreferences = asyncHandler(async (req, res) => {
  const { vegOnly, notifications, language } = req.body;

  // Profiles created before this field existed hydrate without it, so the
  // nested object cannot be assumed present.
  if (!req.customer.preferences) req.customer.preferences = {};

  if (vegOnly !== undefined) req.customer.preferences.vegOnly = Boolean(vegOnly);
  if (notifications !== undefined) {
    req.customer.preferences.notifications = Boolean(notifications);
  }
  if (language !== undefined) {
    const requested = String(language).trim().toLowerCase();
    // English is the only shipped locale. Storing an untranslated value would
    // render a half-localised UI, so anything else is refused explicitly.
    if (requested && requested !== 'en') {
      throw new AppError('More languages are coming soon', 400);
    }
    req.customer.preferences.language = 'en';
  }

  await req.customer.save();
  res.status(200).json({ success: true, customer: publicProfile(req.customer) });
});

// ── Order history ──────────────────────────────────────

/**
 * Paginated by time window rather than by page number alone: a customer with
 * years of history would otherwise deep-page through a large collection.
 */
const getMyOrders = asyncHandler(async (req, res) => {
  const customer = req.customer;
  const range = String(req.query.range || '3m').toLowerCase();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

  const filter = settledOrderMatch(customer.cafeId, customer._id);
  const liveFilter = liveOrderMatch(customer.cafeId, customer._id);

  const from = rangeStart(range);
  if (from) {
    filter.createdAt = { $gte: from };
    liveFilter.createdAt = { $gte: from };
  }

  const [orders, total, active] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('tableId', 'tableNumber')
      .lean(),
    Order.countDocuments(filter),
    // Only the first page carries the live list — they are few by nature (an
    // open table, not an archive) and paged history must not refetch them.
    page === 1
      ? Order.find(liveFilter)
          .sort({ createdAt: -1 })
          .limit(20)
          .populate('tableId', 'tableNumber')
          .lean()
      : Promise.resolve([]),
  ]);

  const present = (o) => ({
    id: String(o._id),
    orderNumber: o.orderNumber,
    status: o.status,
    orderType: o.orderType,
    // The channel is what tells a guest their table order is here at all: the
    // POS and the table look identical otherwise.
    channel: o.channel,
    placedAt: o.createdAt,
    itemCount: (o.items || []).reduce((sum, i) => sum + (i.quantity || 0), 0),
    items: (o.items || []).map((i) => ({
      name: i.itemName,
      quantity: i.quantity,
      amount: Number(((Number(i.price) || 0) * (i.quantity || 0)).toFixed(2)),
    })),
    totalAmount: o.totalAmount,
    discountTotal: o.discountTotal || 0,
    tableNumber: o.tableId?.tableNumber ?? null,
  });

  res.status(200).json({
    success: true,
    range,
    page,
    limit,
    total,
    hasMore: page * limit < total,
    orders: orders.map(present),
    // In progress: placed and unpaid, or already settled while the guest is
    // still at the table. Separate so the spend count above stays truthful.
    active: active.map((o) => ({ ...present(o), isLive: true })),
  });
});

// ── Email verification ─────────────────────────────────

const requestEmailOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const { code, address } = await customerAuthService.requestEmailOtp({
    customer: req.customer,
    email,
  });

  const sent = await emailService.sendVerificationCode({
    to: address,
    code,
    customerName: req.customer.name || 'there',
    cafeId: req.customer.cafeId,
  });

  if (!sent.sent) {
    throw new AppError(sent.reason || 'Could not send verification email. Please check the address or try again.', 500);
  }

  res.status(200).json({
    success: true,
    message: 'We sent a 6-digit code to your email',
    // Same testing affordance as SMS: only ever populated outside production.
    devCode: sent.devCode,
  });
});

const verifyEmailOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  const customer = await customerAuthService.verifyEmailOtp({
    customer: req.customer,
    email,
    code,
  });

  res.status(200).json({ success: true, customer: publicProfile(customer) });
});

/**
 * DPDP Act 2023 Right to Erasure / Anonymization (Section 12).
 * Irreversibly scrubs personal identity while maintaining 8-year statutory tax compliance.
 */
const anonymizeMe = asyncHandler(async (req, res) => {
  await customerService.anonymizeCustomer({
    cafeId: req.customer.cafeId,
    customerId: req.customer._id,
    requestedBy: 'customer',
  });

  res.clearCookie(CUSTOMER_COOKIE, { ...COOKIE_OPTIONS, maxAge: undefined });
  res.status(200).json({
    success: true,
    message:
      'Your account has been permanently anonymized in accordance with DPDP Act, 2023. Historical tax invoices remain retained for statutory CGST accounting compliance.',
  });
});

module.exports = {
  requestOtp,
  verifyOtp,
  signOut,
  getMe,
  updateProfile,
  updatePreferences,
  getMyOrders,
  SETTLED_STATUSES,
  liveOrderMatch,
  requestEmailOtp,
  verifyEmailOtp,
  RANGE_MONTHS,
  anonymizeMe,
};
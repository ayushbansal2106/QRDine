const jwt = require('jsonwebtoken');

const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const SuperAdmin = require('../models/SuperAdmin');
const Cafe = require('../models/Cafe');
const User = require('../models/User');
const Order = require('../models/Order');
const Subscription = require('../models/Subscription');
const {
  computeAccess,
  quote,
  publicSubscription,
  terminate,
  reinstate,
  activatePaidPlan,
  ensureSubscription,
  setEntitlementOverrides,
  findExpiring,
} = require('../services/subscriptionService');
const entitlementService = require('../services/entitlementService');
const auditService = require('../services/auditService');
const planFeatureConfigService = require('../services/planFeatureConfigService');
const { PLANS, isPlanKey, isCycle, addDays } = require('../config/plans');

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;

const signSuperAdminToken = (admin) =>
  jwt.sign({ id: String(admin._id), role: admin.role, typ: 'superadmin' }, env.jwtSecret, {
    expiresIn: '8h',
  });

/**
 * Sign a QRDine operator in.
 *
 * Lockout mirrors the cafe PIN policy: a slow 15-minute lock after 5 consecutive
 * failures, and the counter resets on success. A generous 8-hour token is
 * acceptable here because this surface can terminate a paying customer's
 * business — a short session would make routine console work painful, and the
 * session is only as good as the lockout.
 *
 * The error message is deliberately identical for "no such account" and "wrong
 * password": distinguishing them would let anyone enumerate which email
 * addresses are QRDine staff.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const admin = await SuperAdmin.findOne({ email: normalizedEmail }).select('+password');

  if (!admin) {
    throw new AppError('Invalid credentials', 401);
  }

  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    const mins = Math.ceil((admin.lockedUntil - Date.now()) / 60000);
    throw new AppError(`Too many failed attempts. Try again in ${mins} minute(s).`, 423);
  }

  if (!admin.isActive) {
    throw new AppError('This account has been deactivated', 403);
  }

  const ok = await admin.verifyPassword(password);

  if (!ok) {
    admin.failedAttempts = (admin.failedAttempts || 0) + 1;
    if (admin.failedAttempts >= LOGIN_MAX_ATTEMPTS) {
      admin.failedAttempts = 0;
      admin.lockedUntil = new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000);
      await admin.save();
      throw new AppError(
        `Too many failed attempts. Try again in ${LOGIN_LOCK_MINUTES} minutes.`,
        423
      );
    }
    await admin.save();
    throw new AppError('Invalid credentials', 401);
  }

  admin.failedAttempts = 0;
  admin.lockedUntil = null;
  admin.lastLoginAt = new Date();
  await admin.save();

  res.status(200).json({
    success: true,
    token: signSuperAdminToken(admin),
    admin: { id: admin._id, email: admin.email, name: admin.name, role: admin.role },
  });
});

const me = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    admin: {
      id: req.superAdmin._id,
      email: req.superAdmin.email,
      name: req.superAdmin.name,
      role: req.superAdmin.role,
    },
  });
});

/**
 * Counts and money across the whole product.
 *
 * MRR is deliberately computed from *active and grace* subscriptions only.
 * Counting trials or degraded tenants as revenue would flatter the number, and
 * this is the figure the founder makes decisions on — it should be the
 * pessimistic one.
 */
const overview = asyncHandler(async (req, res) => {
  const subscriptions = await Subscription.find({}).lean();

  const buckets = {
    trialing: 0,
    active: 0,
    grace: 0,
    degraded: 0,
    cancelled: 0,
    terminated: 0,
  };

  let mrrPaise = 0;
  let payingTenants = 0;

  for (const sub of subscriptions) {
    const access = computeAccess(sub);
    if (access.status in buckets) buckets[access.status] += 1;

    if (access.status === 'active' || access.status === 'grace') {
      // Normalise to a monthly figure: an annual payer is worth its monthly
      // equivalent every month, not its whole year up front.
      const monthly = quote({ planKey: sub.planKey, cycle: 'monthly', outlets: sub.outlets });
      mrrPaise += monthly.subtotalPaise;
      payingTenants += 1;
    }
  }

  const cafeCount = await Cafe.countDocuments({});

  res.status(200).json({
    success: true,
    totals: {
      cafes: cafeCount,
      subscriptions: subscriptions.length,
      ...buckets,
    },
    revenue: {
      mrrPaise,
      mrrRupees: mrrPaise / 100,
      payingTenants,
      arpuPaise: payingTenants ? Math.round(mrrPaise / payingTenants) : 0,
      currency: 'INR',
      // GST-exclusive, because GST is collected from the cafe, not earned.
      note: 'MRR excludes GST and counts only active/grace tenants.',
    },
  });
});

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Search every tenant, with its live subscription state. */
const listCafes = asyncHandler(async (req, res) => {
  const { q, status, page = 1, limit = 25 } = req.query || {};

  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegExp(String(q).trim()), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { outletGroup: rx }];
  }

  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const safePage = Math.max(1, Number(page) || 1);

  const cafes = await Cafe.find(filter)
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();

  const subs = await Subscription.find({
    cafeId: { $in: cafes.map((c) => c._id) },
  }).lean();
  const subByCafe = new Map(subs.map((s) => [String(s.cafeId), s]));

  let rows = cafes.map((cafe) => {
    const sub = subByCafe.get(String(cafe._id)) || null;
    const access = computeAccess(sub);
    return {
      cafeId: cafe._id,
      name: cafe.name,
      email: cafe.email,
      phone: cafe.phone,
      city: cafe.address,
      outletGroup: cafe.outletGroup,
      outlets: sub ? sub.outlets : 0,
      planKey: sub ? sub.planKey : null,
      status: access.status,
      paidUntil: access.paidUntil,
      createdAt: cafe.createdAt,
    };
  });

  if (status) {
    rows = rows.filter((r) => r.status === status);
  }

  res.status(200).json({
    success: true,
    page: safePage,
    limit: safeLimit,
    count: rows.length,
    cafes: rows,
  });
});

/** One tenant in full: subscription, staff, order volume. */
const getCafe = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;

  // The plan matrix is persisted: refresh it so the entitlements shown here
  // are the ones the tenant actually has right now.
  await planFeatureConfigService.ensureLoaded();

  const cafe = await Cafe.findById(cafeId).lean();
  if (!cafe) throw new AppError('Cafe not found', 404);

  const subscription = await Subscription.findOne({ cafeId }).lean();
  const access = computeAccess(subscription);

  const [staff, orderCount, lastOrder] = await Promise.all([
    User.find({ cafeId }).select('name email role isActive lastLoginAt').lean(),
    Order.countDocuments({ cafeId }),
    Order.findOne({ cafeId }).sort({ createdAt: -1 }).select('createdAt totalAmount status').lean(),
  ]);

  res.status(200).json({
    success: true,
    cafe: {
      id: cafe._id,
      name: cafe.name,
      email: cafe.email,
      phone: cafe.phone,
      address: cafe.address,
      outletGroup: cafe.outletGroup,
      createdAt: cafe.createdAt,
    },
    subscription: subscription
      ? publicSubscription(subscription, access)
      : { status: 'none', planKey: null, note: 'No subscription row; tenant has never been through billing.' },
    rawSubscription: subscription
      ? {
          status: subscription.status,
          planKey: subscription.planKey,
          cycle: subscription.cycle,
          outlets: subscription.outlets,
          lastChargedPaise: subscription.lastChargedPaise,
          lastChargedAt: subscription.lastChargedAt,
          terminatedAt: subscription.terminatedAt,
          terminationReason: subscription.terminationReason,
          lastChangedBy: subscription.lastChangedBy,
          lastChangeNote: subscription.lastChangeNote,
        }
      : null,
    staff,
    activity: { orderCount, lastOrder: lastOrder || null },
    // Live usage against the plan's allowances, so a support conversation about
    // a quota block can see the actual numbers instead of guessing.
    usage: await entitlementService.getUsageOverview(cafeId).catch(() => []),
  });
});

const loadSubscriptionOr404 = async (cafeId) => {
  const exists = await Cafe.exists({ _id: cafeId });
  if (!exists) throw new AppError('Cafe not found', 404);
};

/**
 * Full lock-out. Restricted to `superadmin` — not `support` — because this
 * takes a paying customer out of their own business, and we would rather make
 * that require two minds than one.
 *
 * A reason is mandatory: a termination with no stated cause cannot be explained
 * to the cafe, audited later, or reviewed.
 */
const terminateCafe = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;
  const { reason } = req.body || {};

  if (!reason || String(reason).trim().length < 5) {
    throw new AppError('A reason of at least 5 characters is required', 400);
  }

  await loadSubscriptionOr404(cafeId);

  const subscription = await terminate(cafeId, {
    reason: String(reason).trim(),
    actor: req.superAdmin.email,
  });

  res.status(200).json({
    success: true,
    message: 'Tenant terminated. Full access is blocked until reinstated.',
    subscription: publicSubscription(subscription, computeAccess(subscription)),
  });
});

const reinstateCafe = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;
  await loadSubscriptionOr404(cafeId);

  const subscription = await reinstate(cafeId, {
    note: req.superAdmin.email,
  });

  res.status(200).json({
    success: true,
    message: 'Tenant reinstated.',
    subscription: publicSubscription(subscription, computeAccess(subscription)),
  });
});

/**
 * Move a tenant onto a plan by hand — a comp, a refund, or onboarding a café
 * that pays by bank transfer. Prices are recomputed from the catalogue so the
 * figure can never be hand-typed into an inconsistent state.
 */
const setPlan = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;
  const { planKey, cycle = 'monthly', outlets = 1 } = req.body || {};

  await planFeatureConfigService.ensureLoaded();

  if (!isPlanKey(planKey)) throw new AppError('Unknown plan', 400);
  if (!isCycle(cycle)) throw new AppError('Billing cycle must be monthly or annual', 400);

  const requested = Number(outlets);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new AppError('outlets must be a positive whole number', 400);
  }

  await loadSubscriptionOr404(cafeId);

  const subscription = await activatePaidPlan(cafeId, {
    planKey,
    cycle,
    outlets: requested,
    from: new Date(),
  });

  res.status(200).json({
    success: true,
    message: `Plan set to ${PLANS[planKey].name} (${cycle}).`,
    quote: quote({ planKey, cycle, outlets: requested }),
    subscription: publicSubscription(subscription, computeAccess(subscription)),
  });
});

/**
 * Grant or revoke individual features for one tenant.
 *
 * This is the only write path for `Subscription.entitlementOverrides`: no cafe
 * endpoint accepts it, and `requireFeature` reads it from the stored row. Support
 * can comp a feature for a beta customer or switch one module off after an abuse
 * report without repricing or downgrading their whole plan.
 *
 * Tenant-level exceptions are a privileged operation, so every change is written
 * to the hash-chained audit ledger with the operator's identity. "Why does this
 * cafe have loyalty on Starter?" must be answerable six months later.
 */
const setEntitlements = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;
  const { overrides, note = '' } = req.body || {};

  if (!Array.isArray(overrides)) {
    throw new AppError('overrides must be an array', 400);
  }
  if (overrides.length > 50) {
    throw new AppError('at most 50 overrides may be set at once', 400);
  }

  await loadSubscriptionOr404(cafeId);

  let subscription;
  try {
    subscription = await setEntitlementOverrides(cafeId, overrides, {
      actor: req.superAdmin.email,
      note: String(note || '').slice(0, 300),
    });
  } catch (err) {
    // Validation failures in the service are user errors, not 500s.
    throw new AppError(err.message, 400);
  }

  await auditService
    .recordEvent({
      cafeId,
      type: 'subscription.entitlement_override',
      entityType: 'Subscription',
      entityId: subscription._id,
      staffName: req.superAdmin.email,
      metadata: {
        note: String(note || '').slice(0, 300),
        overrides: subscription.entitlementOverrides.map((o) => ({
          featureKey: o.featureKey,
          enabled: o.enabled,
          expiresAt: o.expiresAt || null,
        })),
      },
    })
    .catch((err) => console.error('Entitlement override audit write failed:', err.message));

  const entitlements = await entitlementService.getEntitlementsForCafe(cafeId);

  res.status(200).json({
    success: true,
    message: 'Entitlement overrides updated.',
    entitlements: {
      planKey: entitlements.planKey,
      status: entitlements.status,
      features: entitlements.features,
      blockedFeatures: entitlements.blockedFeatures,
    },
    overrides: subscription.entitlementOverrides.map((o) => ({
      featureKey: o.featureKey,
      enabled: o.enabled,
      note: o.note,
      grantedBy: o.grantedBy,
      grantedAt: o.grantedAt,
      expiresAt: o.expiresAt,
    })),
  });
});

/** Push a tenant's trial out — support asking for more time before it lapses. */
const extendTrial = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;
  const { days } = req.body || {};

  const extra = Number(days);
  if (!Number.isInteger(extra) || extra < 1 || extra > 365) {
    throw new AppError('days must be a whole number between 1 and 365', 400);
  }

  await loadSubscriptionOr404(cafeId);

  const subscription = await ensureSubscription(cafeId);

  const base = subscription.trialEndsAt && subscription.trialEndsAt > new Date()
    ? subscription.trialEndsAt
    : new Date();

  subscription.trialEndsAt = addDays(base, extra);
  subscription.status = 'trialing';
  subscription.currentPeriodEnd = subscription.trialEndsAt;
  subscription.lastChangedBy = req.superAdmin.email;
  subscription.lastChangeNote = `Trial extended by ${extra} day(s)`;
  await subscription.save();

  res.status(200).json({
    success: true,
    message: `Trial extended by ${extra} day(s).`,
    trialEndsAt: subscription.trialEndsAt,
    subscription: publicSubscription(subscription, computeAccess(subscription)),
  });
});

/** Tenants about to lapse, for the renewal-chase list. */
const expiringSoon = asyncHandler(async (req, res) => {
  const { days = 7 } = req.query || {};
  const within = Math.min(90, Math.max(1, Number(days) || 7));

  const subs = await findExpiring({ withinDays: within });
  const cafes = await Cafe.find({
    _id: { $in: subs.map((s) => s.cafeId) },
  })
    .select('name email phone')
    .lean();
  const cafeById = new Map(cafes.map((c) => [String(c._id), c]));

  res.status(200).json({
    success: true,
    withinDays: within,
    count: subs.length,
    tenants: subs
      .map((sub) => {
        const cafe = cafeById.get(String(sub.cafeId));
        const access = computeAccess(sub);
        return {
          cafeId: sub.cafeId,
          name: cafe ? cafe.name : '(unknown)',
          email: cafe ? cafe.email : '',
          phone: cafe ? cafe.phone : '',
          planKey: sub.planKey,
          status: access.status,
          paidUntil: access.paidUntil,
          daysRemaining: access.daysUntilPaidUntil,
        };
      })
      .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0)),
  });
});

module.exports = {
  login,
  me,
  overview,
  listCafes,
  getCafe,
  terminateCafe,
  reinstateCafe,
  setPlan,
  extendTrial,
  setEntitlements,
  expiringSoon,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_LOCK_MINUTES,
};
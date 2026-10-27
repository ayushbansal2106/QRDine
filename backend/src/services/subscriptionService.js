const Subscription = require('../models/Subscription');
const {
  PLANS,
  FEATURES,
  CORE_FEATURES,
  getPlan,
  isPlanKey,
  isCycle,
  quote,
  addDays,
  addMonths,
  FREE_TRIAL_DAYS,
  GRACE_DAYS,
  DEFAULT_TRIAL_PLAN,
  KNOWN_FEATURES_INCLUDE,
  CURRENT_PLAN_VERSION,
  METRICS,
  resolvePlan,
  effectivePlanFeatures,
  effectivePlanLimits,
  effectiveIncludedOutlets,
} = require('../config/plans');
const {
  loadCatalog,
  effectiveAllowedFeatures,
  hasEffectiveFeature,
  globallyBlockedFeatures,
} = require('./featureCatalogService');
const planFeatureConfigService = require('./planFeatureConfigService');

const { SUBSCRIPTION_STATUS } = Subscription;
const {
  TRIALING,
  ACTIVE,
  GRACE,
  DEGRADED,
  CANCELLED,
  TERMINATED,
} = SUBSCRIPTION_STATUS;

const KNOWN_FEATURES = Object.values(FEATURES);
const daysBetween = (from, to) => Math.ceil((new Date(to) - new Date(from)) / 86400000);

/**
 * The date the tenant has paid (or trialed) up to.
 *
 * While trialing the trial clock is authoritative; afterwards it is the paid
 * period. Never both, or a tenant who trialled and then paid would get the
 * longer of the two for free.
 */
const paidUntilFor = (subscription) => {
  if (!subscription) return null;
  if (subscription.status === TRIALING && subscription.trialEndsAt) {
    return new Date(subscription.trialEndsAt);
  }
  if (subscription.currentPeriodEnd) return new Date(subscription.currentPeriodEnd);
  if (subscription.trialEndsAt) return new Date(subscription.trialEndsAt);
  return null;
};

const emptyAccess = (status) => ({
  status,
  planKey: null,
  planName: null,
  cycle: null,
  outlets: 0,
  includedOutlets: 0,
  outletLimit: 0,
  maxOrdersPerMonth: null,
  allowedFeatures: [],
  blockedFeatures: [...KNOWN_FEATURES_INCLUDE],
  isTrialing: false,
  isActive: false,
  inGrace: false,
  isDegraded: true,
  isCancelled: status === CANCELLED,
  isTerminated: status === TERMINATED,
  paidUntil: null,
  graceEndsAt: null,
  daysUntilPaidUntil: null,
  graceDaysRemaining: 0,
  planVersion: null,
  planVersionIsCurrent: false,
  limits: {},
});

/**
 * What a tenant may do *right now*, derived from its dates.
 *
 * This is a pure function of (subscription, now) on purpose. Status is not a
 * field that gets "written" when a subscription expires — nothing runs at
 * 00:01 on the expiry date, so a stored `status` would be stale and wrong for
 * every tenant that crossed the boundary while the process was down. Deriving
 * it means the answer is correct at any instant, with no sweeper, no cron and
 * no repair job.
 *
 * The ladder, in the user's words — still active, then degrade, then the super
 * admin may terminate:
 *
 *   trialing ──trial ends──> grace (7d, everything still works)
 *                          └─grace ends──> degraded (paid modules locked)
 *   active   ──period ends─> grace (7d)
 *                          └─grace ends──> degraded
 *   degraded ──super admin──> terminated (everything locked)
 *
 * Degrading locks *modules*, never the counter. A café that cannot take an
 * order or print a bill because a card failed is worse for the café and for
 * its customers than a café running on a free tier, so CORE_FEATURES survive
 * every state short of termination.
 */
const computeAccess = (subscription, now = new Date()) => {
  if (!subscription) {
    // Fail closed. Every tenant gets a subscription created at signup, so this
    // only happens for legacy rows written before billing existed — and those
    // must be migrated deliberately, not silently handed full access.
    return emptyAccess(DEGRADED);
  }

  const stored = subscription.status;
  const paidUntil = paidUntilFor(subscription);

  let status;
  if (stored === TERMINATED) {
    // Terminal. Nothing below can reopen it; only an explicit reinstate.
    status = TERMINATED;
  } else if (stored === CANCELLED) {
    status = CANCELLED;
  } else if (!paidUntil) {
    // If the subscription has a paid plan key (not trial), it likely had billing
    // active at some point but dates are missing (e.g. setPlan was called but
    // webhook failed, or a legacy row). Grant core features (POS + KDS) only,
    // and surface the plan name correctly rather than showing "Free Plan".
    const isPaidPlan = subscription.planKey &&
      !['trial', DEFAULT_TRIAL_PLAN].includes(subscription.planKey);
    if (isPaidPlan) {
      // Paid plan with no dates – keep status as DEGRADED (core features only)
      // but the plan name from the catalogue will display correctly.
      status = DEGRADED;
    } else {
      status = DEGRADED; // trial or no‑plan row with no dates
    }
  } else if (now <= paidUntil) {
    status = stored === TRIALING ? TRIALING : ACTIVE;
  } else {
    const graceEndsAt = addDays(paidUntil, GRACE_DAYS);
    status = now <= graceEndsAt ? GRACE : DEGRADED;
  }

  // Resolve against the catalogue *version the tenant bought*, not blindly
  // against today's file. With no archived versions this is the current plan,
  // but the indirection is what lets a repricing ship without repricing every
  // existing customer at the same moment.
  const resolved = resolvePlan(subscription.planKey, subscription.planVersion);
  const plan = resolved.plan;

  // A tenant on a *pinned* catalogue version keeps the entitlements they
  // bought; the control plane's persisted configuration only applies to the
  // current version. Otherwise a deploy that moved a feature between tiers
  // would silently reprice every existing subscriber.
  const planKey = resolved.plan.key || subscription.planKey;
  const planFeatures = resolved.isCurrent
    ? effectivePlanFeatures(planKey)
    : plan.features;
  const planLimits = resolved.isCurrent
    ? effectivePlanLimits(planKey)
    : { ...(plan.limits || {}) };
  const includedOutlets = resolved.isCurrent
    ? effectiveIncludedOutlets(planKey)
    : plan.includedOutlets;

  let allowedFeatures;
  if (status === TERMINATED) {
    allowedFeatures = [];
  } else if (status === DEGRADED || status === CANCELLED) {
    allowedFeatures = [...CORE_FEATURES];
  } else {
    // trialing / active / grace — the plan's own entitlements. Grace is
    // deliberately identical to active: the tenant paid for this period and a
    // retry may still succeed, so taking their modules away the moment a
    // webhook is late would be punishing them for our latency.
    allowedFeatures = planFeatures.filter((f) => KNOWN_FEATURES_INCLUDE.includes(f));
  }

  const isTerminated = status === TERMINATED;
  const graceEndsAt = paidUntil && !isTerminated ? addDays(paidUntil, GRACE_DAYS) : null;
  const inGrace = status === GRACE;

  return {
    status,
    planKey: subscription.planKey,
    planName: plan.name,
    cycle: subscription.cycle,
    outlets: subscription.outlets,
    includedOutlets,
    outletLimit: subscription.outlets,
    maxOrdersPerMonth:
      planLimits && Object.prototype.hasOwnProperty.call(planLimits, METRICS.ORDERS_PER_MONTH)
        ? planLimits[METRICS.ORDERS_PER_MONTH]
        : null,
    allowedFeatures,
    blockedFeatures: KNOWN_FEATURES_INCLUDE.filter((f) => !allowedFeatures.includes(f)),
    isTrialing: status === TRIALING,
    isActive: status === ACTIVE,
    inGrace,
    isDegraded: status === DEGRADED,
    isCancelled: status === CANCELLED,
    isTerminated,
    isPayable: status === TRIALING || status === ACTIVE || status === GRACE,
    paidUntil,
    graceEndsAt,
    trialEndsAt: subscription.trialEndsAt || null,
    currentPeriodEnd: subscription.currentPeriodEnd || null,
    daysUntilPaidUntil: paidUntil ? daysBetween(now, paidUntil) : null,
    graceDaysRemaining:
      inGrace && graceEndsAt ? Math.max(0, daysBetween(now, graceEndsAt)) : 0,
    planVersion: resolved.version,
    planVersionIsCurrent: resolved.isCurrent,
    limits: { ...planLimits },
  };
};

const withSession = (options, session) => (session ? { ...options, session } : options);

const findForCafe = async (cafeId, session) =>
  Subscription.findOne({ cafeId }, null, withSession({}, session));

/**
 * Fetch the tenant's subscription, creating a trial if it has none.
 *
 * Idempotent and race-safe: the unique index on `cafeId` means two concurrent
 * signups for the same cafe cannot both create one, and the loser of that race
 * re-reads instead of throwing. This is also what migrates legacy cafes
 * created before billing existed.
 */
const ensureSubscription = async (cafeId, { session } = {}) => {
  if (!cafeId) return null;

  const existing = await findForCafe(cafeId, session);
  if (existing) return existing;

  const now = new Date();
  const trialEndsAt = addDays(now, FREE_TRIAL_DAYS);

  try {
    const created = await Subscription.create(
      [
        {
          cafeId,
          planKey: DEFAULT_TRIAL_PLAN,
          cycle: 'monthly',
          status: TRIALING,
          outlets: 1,
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
          planChangedAt: now,
        },
      ],
      { session }
    );
    return created[0];
  } catch (err) {
    // 11000 = unique index violation: someone else won the race.
    if (err && err.code === 11000) return findForCafe(cafeId, session);
    throw err;
  }
};

/**
 * Load a tenant's subscription and its live access in one call.
 *
 * Access is now computed against the feature catalog override when one exists,
 * so the super-admin feature catalog is enforced everywhere access is read.
 */
const getAccessForCafe = async (cafeId, { session, now } = {}) => {
  const subscription = await ensureSubscription(cafeId, { session });

  // The plan configuration is persisted, not in memory: refresh the overlay
  // before resolving access so a change an operator just saved is what the
  // tenant is judged against.
  await planFeatureConfigService.ensureLoaded();

  const base = computeAccess(subscription, now);
  const catalog = await loadCatalog();
  const catalogFlags = catalog.exists && catalog.row?.features ? catalog.row.features : null;
  const catalogAllowed = catalogFlags ? Object.keys(catalogFlags).filter((f) => Boolean(catalogFlags[f])) : null;
  const effective = await effectiveAllowedFeatures({
    subscription,
    subscriptionAllowedFeatures: base.allowedFeatures,
    catalogOverrideAllowedFeatures: catalogAllowed,
    globallyBlockedFeatures: globallyBlockedFeatures(catalog.row),
    status: base.status,
    isTerminated: base.isTerminated,
    isDegraded: base.isDegraded,
    isCancelled: base.isCancelled,
  });
  const blockedFeatures = KNOWN_FEATURES_INCLUDE.filter((f) => !effective.includes(f));
  return {
    subscription,
    access: {
      ...base,
      allowedFeatures: effective,
      blockedFeatures,
      featureCatalogUsed: catalog.exists,
    },
  };
};

/**
 * Start a paid period. Called by the payment webhook once money is actually
 * confirmed — never by a client request — and by a super-admin grant.
 *
 * `currentPeriodEnd` is anchored to `from` (payment time), not to the previous
 * period, so a late webhook grants exactly the period that was paid for and
 * does not silently extend a subscription.
 */
const activatePaidPlan = async (cafeId, { planKey, cycle = 'monthly', outlets = 1, from = new Date(), chargedPaise = null, chargedGstPaise = null, session } = {}) => {
  if (!isPlanKey(planKey)) throw new Error(`Unknown plan: ${planKey}`);
  if (!isCycle(cycle)) throw new Error(`Unknown billing cycle: ${cycle}`);

  const plan = getPlan(planKey);
  const start = new Date(from);
  const end = cycle === 'annual' ? addMonths(start, 12) : addMonths(start, 1);
  const priced = quote({ planKey, cycle, outlets });

  const subscription = await ensureSubscription(cafeId, { session });

  subscription.planKey = planKey;
  subscription.cycle = cycle;
  subscription.outlets = priced.outlets;
  // ACTIVE, not TRIALING: money has been taken. Storing TRIALING here made
  // `computeAccess` report a paying tenant as "trialing" forever, because the
  // derived status copies the stored one while the period is still running.
  //
  // Except when the tenant is terminated — a payment must never be able to lift
  // a ban on its own. The period is still recorded below so the money is
  // accounted for, but the lock stands until a human reinstates them.
  if (subscription.status !== TERMINATED) {
    subscription.status = ACTIVE;
  }
  // Money paid means the trial clock is over, whatever the row said before.
  subscription.trialEndsAt = null;
  subscription.currentPeriodStart = start;
  subscription.currentPeriodEnd = end;
  subscription.lastChargedPaise = chargedPaise == null ? priced.subtotalPaise : chargedPaise;
  subscription.lastChargedGstPaise = chargedGstPaise == null ? priced.gstPaise : chargedGstPaise;
  subscription.lastChargedAt = start;
  subscription.cancelAtPeriodEnd = false;
  subscription.cancelledAt = null;
  subscription.planChangedAt = start;
  // Stamp the catalogue version the tenant just bought. Existing tenants keep
  // whatever they were stamped with until someone deliberately migrates them.
  subscription.planVersion = CURRENT_PLAN_VERSION;
  await subscription.save(withSession({}, session));

  return subscription;
};

/** Stop service at the end of the period already paid for. Never mid-period. */
const scheduleCancellation = async (cafeId, { atPeriodEnd = true, session } = {}) => {
  const subscription = await ensureSubscription(cafeId, { session });
  subscription.cancelAtPeriodEnd = atPeriodEnd;
  subscription.cancelledAt = atPeriodEnd ? new Date() : null;
  if (!atPeriodEnd) {
    subscription.status = CANCELLED;
    subscription.currentPeriodEnd = new Date();
  }
  await subscription.save(withSession({}, session));
  return subscription;
};

/** Undo a scheduled cancellation before the period runs out. */
const resumeSubscription = async (cafeId, { session } = {}) => {
  const subscription = await ensureSubscription(cafeId, { session });
  subscription.cancelAtPeriodEnd = false;
  subscription.cancelledAt = null;
  // A tenant that cancelled mid-period and then paid again is active again.
  if (subscription.status === CANCELLED) {
    subscription.status = subscription.trialEndsAt ? TRIALING : ACTIVE;
  }
  await subscription.save(withSession({}, session));
  return subscription;
};

/**
 * Super-admin termination: full lock-out, and it sticks.
 *
 * Deliberately does not consult the dates. A terminated tenant stays
 * terminated through any number of renewal webhooks until a human reinstates
 * it, because "the gateway says they paid" is exactly the signal that should
 * not be able to un-ban an account on its own.
 */
const terminate = async (cafeId, { reason = '', actor = '', session } = {}) => {
  const subscription = await ensureSubscription(cafeId, { session });
  subscription.status = TERMINATED;
  subscription.terminatedAt = new Date();
  subscription.terminationReason = String(reason || '').slice(0, 500);
  // Recorded so a support ticket months from now can be answered.
  subscription.lastChangedBy = actor || 'system';
  subscription.lastChangeNote = String(reason || '').slice(0, 500);
  await subscription.save(withSession({}, session));
  return subscription;
};

const reinstate = async (cafeId, { note = '', session } = {}) => {
  const subscription = await ensureSubscription(cafeId, { session });
  subscription.status = subscription.trialEndsAt ? TRIALING : ACTIVE;
  subscription.terminatedAt = null;
  subscription.terminationReason = '';
  subscription.lastChangedBy = note || 'system';
  await subscription.save(withSession({}, session));
  return subscription;
};

/**
 * Replace a tenant's account-level entitlement exceptions.
 *
 * Only reachable from the super-admin control plane. `overrides` is validated
 * here rather than at the controller so there is exactly one write path that
 * can produce an override — an operator console, a script and a future
 * integration cannot disagree about what is stored.
 *
 * Unknown feature keys are rejected outright instead of being stored and
 * ignored: a silently-dropped grant is a support ticket that says "we granted
 * it" while the tenant still sees the paywall.
 */
const setEntitlementOverrides = async (
  cafeId,
  overrides = [],
  { actor = '', note = '', session } = {}
) => {
  const list = Array.isArray(overrides) ? overrides : [];
  const cleaned = [];

  for (const entry of list) {
    const featureKey = String(entry?.featureKey || '').trim();
    if (!KNOWN_FEATURES_INCLUDE.includes(featureKey)) {
      throw new Error(`Unknown feature key: ${featureKey}`);
    }

    const expiresAt = entry?.expiresAt ? new Date(entry.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new Error(`Invalid expiry for ${featureKey}`);
    }

    cleaned.push({
      featureKey,
      enabled: Boolean(entry.enabled),
      note: String(entry.note || note || '').slice(0, 300),
      grantedBy: actor || 'system',
      grantedAt: new Date(),
      expiresAt,
    });
  }

  const subscription = await ensureSubscription(cafeId, { session });
  subscription.entitlementOverrides = cleaned;
  subscription.lastChangedBy = actor || 'system';
  subscription.lastChangeNote = `Entitlement overrides: ${cleaned.length} entry(ies)`;
  await subscription.save(withSession({}, session));
  return subscription;
};

/**
 * Tenants whose paid period ends within `withinDays`, for the "your plan
 * renews in N days" notice. Uses the stored date rather than the derived
 * status, because a notice about an already-expired tenant is a different
 * email than one about an upcoming renewal.
 */
const findExpiring = async ({ withinDays = GRACE_DAYS, limit = 500 } = {}) => {
  const now = new Date();
  const horizon = addDays(now, Math.max(0, withinDays));
  return Subscription.find({
    status: { $in: [TRIALING, ACTIVE] },
    $or: [{ currentPeriodEnd: { $lte: horizon } }, { trialEndsAt: { $lte: horizon } }],
  })
    .sort({ currentPeriodEnd: 1 })
    .limit(limit);
};

const publicSubscription = (subscription, access) => ({
  planKey: subscription.planKey,
  planName: getPlan(subscription.planKey)?.name || subscription.planKey,
  planVersion: access.planVersion,
  planVersionIsCurrent: access.planVersionIsCurrent,
  cycle: subscription.cycle,
  outlets: subscription.outlets,
  status: access.status,
  allowedFeatures: access.allowedFeatures,
  blockedFeatures: access.blockedFeatures,
  maxOrdersPerMonth: access.maxOrdersPerMonth,
  isTrialing: access.isTrialing,
  inGrace: access.inGrace,
  isDegraded: access.isDegraded,
  isCancelled: access.isCancelled,
  isTerminated: access.isTerminated,
  isPayable: access.isPayable,
  trialEndsAt: access.trialEndsAt,
  currentPeriodStart: subscription.currentPeriodStart || null,
  currentPeriodEnd: access.currentPeriodEnd,
  paidUntil: access.paidUntil,
  lastChargedAt: subscription.lastChargedAt || null,
  lastChargedPaise: subscription.lastChargedPaise || null,
  lastChargedGstPaise: subscription.lastChargedGstPaise || null,
  graceEndsAt: access.graceEndsAt,
  daysUntilPaidUntil: access.daysUntilPaidUntil,
  graceDaysRemaining: access.graceDaysRemaining,
  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  cancelledAt: subscription.cancelledAt || null,
  terminatedAt: subscription.terminatedAt || null,
  planChangedAt: subscription.planChangedAt || null,
});

module.exports = {
  SUBSCRIPTION_STATUS,
  computeAccess,
  hasFeature: hasEffectiveFeature,
  paidUntilFor,
  ensureSubscription,
  findForCafe,
  getAccessForCafe,
  activatePaidPlan,
  scheduleCancellation,
  resumeSubscription,
  terminate,
  reinstate,
  setEntitlementOverrides,
  findExpiring,
  publicSubscription,
  quote,
  FREE_TRIAL_DAYS,
  GRACE_DAYS,
  KNOWN_FEATURES_INCLUDE,
};

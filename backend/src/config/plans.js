/**
 * Plan catalogue — the single source of truth for pricing and entitlements.
 *
 * Everything money-shaped lives here: no price, feature list or limit is
 * duplicated in a controller, a test fixture or the frontend. Changing what a
 * tier costs is a one-line edit to this file.
 *
 * ── Money representation ────────────────────────────────────────────────
 * Prices are stored as integer PAISE, never rupees-as-float. `349` rupees is
 * `34900` paise. The rest of the codebase already settles money this way
 * (orderService's `round2`), and binary floats cannot represent 0.1 exactly —
 * a cafe billed 0.1 too much, forever, is a support ticket. The API returns
 * rupees *and* paise so neither side has to do the division.
 *
 * ── GST ────────────────────────────────────────────────────────────────
 * Listed prices are pre-GST (standard for Indian SaaS pricing pages; GST is
 * added at checkout against the cafe's place of supply). `GST_RATE` is the
 * single knob.
 *
 * ── Entitlements ────────────────────────────────────────────────────────
 * `features` gates *capabilities*. `CORE_FEATURES` are deliberately NOT
 * gated: a café whose card failed at 2am must still be able to take orders,
 * print a bill and settle a table. Degrading a tenant must never stop service
 * to its customers — see subscriptionService for how that plays out.
 */

const planOverlay = require('./planOverlay');

const GST_RATE = 0.18;

/** Number of paid months an annual plan is billed for (i.e. 2 months free). */
const ANNUAL_MONTHS = 10;

const FREE_TRIAL_DAYS = 14;

/** Days a lapsed tenant keeps full access before being degraded. */
const GRACE_DAYS = 7;

/**
 * Capabilities. Values are feature keys used by
 * `middlewares/subscriptionMiddleware.requireFeature`.
 */
const FEATURES = {
  POS: 'pos',
  KDS: 'kds',
  ANALYTICS: 'analytics',
  REPORTS_EXPORT: 'reports.export',
  LOYALTY: 'loyalty',
  COUPONS: 'coupons',
  WALLET: 'wallet',
  INVOICES: 'invoices',
  REVIEWS: 'reviews',
  NFC: 'nfc',
  GEOFENCE: 'geofence',
  DIGITIZATION: 'digitization',
  SCRATCH: 'scratch',
  PRIORITY_SUPPORT: 'support.priority',
  CUSTOM_PAYMENT_GATEWAY: 'payment.gateway.custom',
  // NOTE: there is deliberately no `multi.outlet` feature. Outlets are sold on
  // every paid plan (see `extraOutletMonthlyPaise`), so gating them behind a
  // higher tier would mean charging a Growth cafe for a second outlet and then
  // refusing to let it open one. The `outlets` field on the subscription is
  // the single authority for how many outlets a tenant may operate.
};

/**
 * Never gated, at any price, in any state short of full termination.
 * Taking money at the table is the whole reason the café is a customer.
 */
const CORE_FEATURES = [FEATURES.POS, FEATURES.KDS];

/**
 * Usage metrics the platform meters.
 *
 * A metric key is what `entitlementService.reserveUsage` is called with, and it
 * is the same string used as the `limits` key on a plan. Keeping one vocabulary
 * means "is this plan allowed 500 orders" is a single lookup rather than a
 * chain of conditionals per module.
 *
 * `null`/absent in a plan's `limits` means **unlimited** — but only for metrics
 * explicitly listed in `METERED_METRICS`, and never for entitlements reached
 * through the feature path, where a missing key denies access.
 */
const METRICS = {
  ORDERS_PER_MONTH: 'orders.month',
  OUTLETS: 'outlets',
};

/**
 * How a metric is counted, reset, and what happens at the limit.
 *
 *  - `period: 'month'`  → the counter resets on the first instant of each UTC
 *    calendar month. UTC, not the cafe's local timezone: a period boundary that
 *    moves with a tenant-configurable field is a support ticket at 00:00 on the
 *    1st, and the quota is a commercial boundary rather than a service one.
 *  - `period: 'lifetime'` → a stock limit (outlets), never resets.
 *  - `onExhausted: 'block'` → the operation fails with 402 QUOTA_EXCEEDED.
 */
const METRIC_CONFIG = {
  [METRICS.ORDERS_PER_MONTH]: {
    label: 'Orders',
    unit: 'order',
    period: 'month',
    onExhausted: 'block',
  },
  [METRICS.OUTLETS]: {
    label: 'Outlets',
    unit: 'outlet',
    period: 'lifetime',
    onExhausted: 'block',
  },
};

const METERED_METRICS = Object.keys(METRIC_CONFIG);

const isMetric = (metric) => Object.prototype.hasOwnProperty.call(METRIC_CONFIG, metric);

const RUPEES = (rupees) => Math.round(rupees * 100);

const PLANS = {
  trial: {
    key: 'trial',
    name: 'Free Trial',
    blurb: 'Everything in Pro, free, for 14 days. One outlet.',
    order: 0,
    monthlyPaise: 0,
    annualPaise: 0,
    extraOutletMonthlyPaise: 0,
    // The trial exists to demonstrate the product, so it carries every feature.
    // It is bounded by TRIAL_DAYS and a single outlet, not by capability.
    features: Object.values(FEATURES),
    includedOutlets: 1,
    limits: { [METRICS.ORDERS_PER_MONTH]: 500 },
    isPaid: false,
  },
  starter: {
    key: 'starter',
    name: 'Starter',
    blurb: 'QR ordering, kitchen display and billing for a single counter.',
    order: 1,
    monthlyPaise: RUPEES(349),
    annualPaise: RUPEES(3490),
    extraOutletMonthlyPaise: RUPEES(149),
    features: [FEATURES.POS, FEATURES.KDS],
    includedOutlets: 1,
    limits: { [METRICS.ORDERS_PER_MONTH]: 500 },
    isPaid: true,
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    blurb: 'Loyalty, coupons, wallets, GST invoices and sales analytics.',
    order: 2,
    monthlyPaise: RUPEES(499),
    annualPaise: RUPEES(4990),
    extraOutletMonthlyPaise: RUPEES(199),
    features: [
      FEATURES.POS,
      FEATURES.KDS,
      FEATURES.ANALYTICS,
      FEATURES.REPORTS_EXPORT,
      FEATURES.LOYALTY,
      FEATURES.COUPONS,
      FEATURES.WALLET,
      FEATURES.INVOICES,
      FEATURES.SCRATCH,
      FEATURES.CUSTOM_PAYMENT_GATEWAY,
    ],
    includedOutlets: 1,
    limits: { [METRICS.ORDERS_PER_MONTH]: null }, // unlimited
    isPaid: true,
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    blurb: 'AI menu digitisation, review engine and priority support.',
    order: 3,
    monthlyPaise: RUPEES(649),
    annualPaise: RUPEES(6490),
    extraOutletMonthlyPaise: RUPEES(249),
    features: Object.values(FEATURES),
    includedOutlets: 1,
    limits: { [METRICS.ORDERS_PER_MONTH]: null },
    isPaid: true,
  },
};

/**
 * The plan catalogue is the current *version*.
 *
 * A version stamp on the subscription (see Subscription.planVersion) records
 * which catalogue a tenant bought under. When a plan's price or feature list
 * changes, the previous snapshot is archived in `PLAN_VERSION_HISTORY` and new
 * signups are stamped with `CURRENT_PLAN_VERSION`; existing subscriptions keep
 * resolving against the snapshot they bought. That is what stops a deploy that
 * repriced Pro from silently repricing every existing Pro customer.
 *
 * The history is intentionally empty today — nothing has been re-versioned yet
 * — but the resolution path exists and is exercised, so the first repricing does
 * not require a schema migration under time pressure.
 */
const CURRENT_PLAN_VERSION = '2026-10';

/** { [planKey]: { [version]: <frozen plan snapshot> } } */
const PLAN_VERSION_HISTORY = {};

// `maxOrdersPerMonth` was the original spelling of the same limit. Derive it
// from `limits` rather than keeping two fields that can drift apart, while still
// exposing it because the admin API and the pricing page already return it.
for (const plan of Object.values(PLANS)) {
  plan.maxOrdersPerMonth =
    plan.limits && Object.prototype.hasOwnProperty.call(plan.limits, METRICS.ORDERS_PER_MONTH)
      ? plan.limits[METRICS.ORDERS_PER_MONTH]
      : null;
}

const PAID_PLAN_KEYS = Object.values(PLANS)
  .filter((p) => p.isPaid)
  .sort((a, b) => a.order - b.order)
  .map((p) => p.key);

const PLAN_KEYS = Object.keys(PLANS);

const DEFAULT_TRIAL_PLAN = 'trial';

/** The plan a tenant starts on and the one a lapsed tenant falls back to. */
const DEFAULT_PAID_PLAN = 'growth';

const CYCLES = ['monthly', 'annual'];

const getPlan = (planKey) => PLANS[planKey] || null;

const isPlanKey = (planKey) => Object.prototype.hasOwnProperty.call(PLANS, planKey);

const isCycle = (cycle) => CYCLES.includes(cycle);

/** Normalise anything a caller might send into a valid plan key. */
const resolvePlanKey = (planKey) => (isPlanKey(planKey) ? planKey : DEFAULT_TRIAL_PLAN);

const addDays = (date, days) => new Date(new Date(date).getTime() + days * 86400000);

const addMonths = (date, months) => {
  const base = new Date(date);
  // Derive the target year/month *first*, then clamp the day into it. Using
  // setUTCMonth() instead would silently overflow: 31 Jan + 1 month lands on
  // 2/3 March, so a period billed on the 31st would roll a whole month and,
  // worse, the clamp below would then inspect March instead of February.
  const targetFirst = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const year = targetFirst.getUTCFullYear();
  const month = targetFirst.getUTCMonth();
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(base.getUTCDate(), daysInTargetMonth),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds()
    )
  );
};

/**
 * Price a plan for N outlets on a cycle.
 *
 * `includedOutlets` is bundled into the base price; every outlet beyond it is
 * charged at the plan's add-on rate. Total is GST-exclusive — the caller adds
 * `gstPaise` on top.
 */
const quote = ({ planKey, cycle = 'monthly', outlets = 1 } = {}) => {
  const plan = getPlan(resolvePlanKey(planKey));
  if (!plan) throw new Error(`Unknown plan: ${planKey}`);

  const requestedOutlets = Number(outlets);
  const safeOutlets =
    Number.isFinite(requestedOutlets) && requestedOutlets >= 1 ? Math.floor(requestedOutlets) : 1;

  const isAnnual = cycle === 'annual';
  const basePaise = isAnnual ? plan.annualPaise : plan.monthlyPaise;

  const includedOutlets = effectiveIncludedOutlets(plan.key);
  const extraOutlets = Math.max(0, safeOutlets - includedOutlets);
  // An annual plan pays for its extra outlets up front, at 10x the monthly
  // add-on rate — the same 2-months-free discount as the base.
  const extraOutletUnitPaise = plan.extraOutletMonthlyPaise * (isAnnual ? ANNUAL_MONTHS : 1);
  const extrasPaise = extraOutlets * extraOutletUnitPaise;

  const subtotalPaise = basePaise + extrasPaise;
  const gstPaise = Math.round(subtotalPaise * GST_RATE);

  return {
    planKey: plan.key,
    planName: plan.name,
    cycle: isAnnual ? 'annual' : 'monthly',
    outlets: safeOutlets,
    includedOutlets,
    extraOutlets,
    basePaise,
    extraOutletsPaise: extrasPaise,
    subtotalPaise,
    gstRate: GST_RATE,
    gstPaise,
    totalPaise: subtotalPaise + gstPaise,
    currency: 'INR',
    // Convenience mirrors for the frontend; paise stays authoritative.
    subtotalRupees: subtotalPaise / 100,
    totalRupees: (subtotalPaise + gstPaise) / 100,
    periodMonths: isAnnual ? 12 : 1,
    maxOrdersPerMonth: planLimit({ limits: effectivePlanLimits(plan.key) }, METRICS.ORDERS_PER_MONTH),
  };
};

/**
 * Serialisable catalogue for the public pricing page — no secrets, no
 * internal flags, and deliberately includes GST so the page can show the
 * all-in figure an Indian café actually pays.
 */
const publicCatalogue = () =>
  Object.values(PLANS)
    .sort((a, b) => a.order - b.order)
    .map((plan) => ({
      key: plan.key,
      name: plan.name,
      blurb: plan.blurb,
      isPaid: plan.isPaid,
      features: effectivePlanFeatures(plan.key),
      includedOutlets: effectiveIncludedOutlets(plan.key),
      maxOrdersPerMonth: planLimit(
        { limits: effectivePlanLimits(plan.key) },
        METRICS.ORDERS_PER_MONTH
      ),
      trialDays: plan.isPaid ? 0 : FREE_TRIAL_DAYS,
      monthly: {
        paise: plan.monthlyPaise,
        rupees: plan.monthlyPaise / 100,
        withGstRupees: Math.round(plan.monthlyPaise * (1 + GST_RATE)) / 100,
        extraOutletRupees: plan.extraOutletMonthlyPaise / 100,
      },
      annual: {
        paise: plan.annualPaise,
        rupees: plan.annualPaise / 100,
        withGstRupees: Math.round(plan.annualPaise * (1 + GST_RATE)) / 100,
        extraOutletRupees: (plan.extraOutletMonthlyPaise * ANNUAL_MONTHS) / 100,
        months: 12,
      },
      annualSavingsRupees: (plan.monthlyPaise * 12 - plan.annualPaise) / 100,
    }));

/**
 * The feature registry.
 *
 * `label` and `group` are what the control plane's plan matrix groups rows by;
 * `description` is the one-line explanation shown next to each toggle.
 * `core: true` marks the two capabilities the counter cannot work without —
 * the plan matrix flags them so an operator can see that switching one off
 * locks that plan's tenants out of ordering.
 */
const FEATURE_METADATA = {
  pos: {
    label: 'POS / QR ordering',
    group: 'counter',
    core: true,
    description: 'Scan-to-order QR menu, POS terminal and the counter workflow.',
  },
  kds: {
    label: 'Kitchen display',
    group: 'counter',
    core: true,
    description: 'Live kitchen display with order tickets, timers and bump actions.',
  },
  analytics: {
    label: 'Sales analytics',
    group: 'reporting',
    description: 'Revenue, order-volume and product-mix reporting for the period.',
  },
  'reports.export': {
    label: 'Report export',
    group: 'reporting',
    description: 'Download sales, tax and product reports as CSV or PDF.',
  },
  loyalty: {
    label: 'Loyalty',
    group: 'marketing',
    description: 'Points programmes, loyalty cards and member rewards.',
  },
  coupons: {
    label: 'Coupons',
    group: 'marketing',
    description: 'Promo codes, manual discounts and automatic coupon grants.',
  },
  wallet: {
    label: 'Customer wallets',
    group: 'marketing',
    description: 'Stored customer balance, top-ups and wallet payments.',
  },
  invoices: {
    label: 'GST invoices',
    group: 'billing',
    description: 'GST-compliant invoices with printable and PDF output.',
  },
  reviews: {
    label: 'Reviews & AI',
    group: 'marketing',
    description: 'Customer reviews, ratings and AI-assisted review replies.',
  },
  nfc: {
    label: 'NFC tags',
    group: 'marketing',
    description: 'NFC tag ordering and tag provisioning for tables.',
  },
  geofence: {
    label: 'Fraud watch',
    group: 'risk',
    description: 'Geofenced ordering checks that flag out-of-area orders.',
  },
  digitization: {
    label: 'Menu digitisation',
    group: 'operations',
    description: 'AI menu digitisation that turns a photographed menu into items.',
  },
  scratch: {
    label: 'Scratch cards',
    group: 'marketing',
    description: 'Scratch-and-win campaigns and prize redemption.',
  },
  'support.priority': {
    label: 'Priority support',
    group: 'support',
    description: 'Priority response from QRDine support.',
  },
  'payment.gateway.custom': {
    label: 'Direct Payment Gateway (BYO-PG)',
    group: 'billing',
    description: 'Connect direct merchant credentials for Razorpay, Cashfree, Paytm.',
  },
};

/** Feature keys the platform recognises today. */
const KNOWN_FEATURES_INCLUDE = Object.keys(FEATURE_METADATA);

/**
 * The groups the matrix rows are organised by. Purely visual: a group heading
 * never grants or revokes anything, and it never behaves as a global switch.
 */
const FEATURE_GROUP_ORDER = [
  'counter',
  'operations',
  'billing',
  'reporting',
  'marketing',
  'risk',
  'support',
];

/**
 * The limit rows of the plan matrix — the numeric side of a plan.
 *
 * A limit row is *not* a feature: it is a metered allowance attached to a
 * plan. Two kinds exist today:
 *
 *  - `kind: 'metric'` — a usage metric declared in `METRIC_CONFIG`. The value
 *    is a quota for the metric's period, or `null` for unlimited. `null` is
 *    only meaningful here because these metrics are explicitly declared as
 *    metered; a *feature* with no limit is simply not entitled.
 *  - `kind: 'plan'` — a plan attribute that behaves like a cap
 *    (`includedOutlets`, the outlets bundled in the price).
 *
 * The registry is the single place that decides what a limit row means, so
 * the control plane can render it and the backend can validate it without the
 * two drifting apart.
 */
const LIMIT_ROWS = {
  [METRICS.ORDERS_PER_MONTH]: {
    key: METRICS.ORDERS_PER_MONTH,
    label: 'Orders per month',
    description:
      'Orders a tenant may place before the platform blocks new orders until the next billing period.',
    unit: 'orders',
    period: 'month',
    kind: 'metric',
    min: 1,
    max: 1000000,
    unlimitedAllowed: true,
  },
  includedOutlets: {
    key: 'includedOutlets',
    label: 'Maximum outlets',
    description:
      'Outlets bundled in the plan price. Additional outlets are billed per outlet on every plan.',
    unit: 'outlets',
    period: 'lifetime',
    kind: 'plan',
    min: 1,
    max: 500,
    unlimitedAllowed: false,
  },
};

/** Limit row keys the control plane may read and write. */
const LIMIT_ROW_KEYS = Object.keys(LIMIT_ROWS);

/** Is this a limit row the platform knows how to enforce? */
const isLimitRow = (key) => Object.prototype.hasOwnProperty.call(LIMIT_ROWS, key);

/**
 * A feature is a boolean entitlement: the plan grants it or it does not.
 * Feature types are declared centrally so a future numeric feature (\"seats\")
 * cannot be added to the UI without deciding how it is enforced.
 */
const FEATURE_TYPES = Object.fromEntries(
  KNOWN_FEATURES_INCLUDE.map((key) => [key, 'boolean'])
);

const isKnownFeature = (key) => Object.prototype.hasOwnProperty.call(FEATURE_TYPES, key);

/**
 * Resolve the plan a subscription is entitled to.
 *
 * Returns the pinned historical snapshot when the tenant's `planVersion` still
 * exists in history, otherwise the current catalogue. The caller can tell the
 * two apart via `isCurrent`, which the admin UI shows when a tenant is on an
 * older commercial version.
 */
const resolvePlan = (planKey, planVersion) => {
  const current = getPlan(planKey) || getPlan(DEFAULT_TRIAL_PLAN);
  const archived = PLAN_VERSION_HISTORY[current.key];
  const snapshot = planVersion && archived ? archived[planVersion] : null;

  if (snapshot) {
    return {
      plan: snapshot,
      version: planVersion,
      isCurrent: planVersion === CURRENT_PLAN_VERSION,
    };
  }

  return { plan: current, version: CURRENT_PLAN_VERSION, isCurrent: true };
};

/** The limit a plan allows for a metric. `null` means unlimited. */
const planLimit = (plan, metric) => {
  if (!plan || !plan.limits) return null;
  return Object.prototype.hasOwnProperty.call(plan.limits, metric)
    ? plan.limits[metric]
    : null;
};

// ── Effective (persisted) plan values ───────────────────────────────────
//
// The catalogue above is the *baseline*. The control plane's plan matrix can
// change what a plan includes at runtime, and that change is persisted in
// `PlanFeatureConfig`. These three accessors are the one place the baseline
// and the persisted configuration are merged, so pricing, the public pricing
// page and the entitlement gate can never disagree about a plan.
//
// The merge is per key rather than a wholesale replacement: a feature that is
// added to the registry after a plan was configured keeps the catalogue
// default until an operator saves that plan again.

/** The features a plan grants, with the persisted configuration applied. */
const effectivePlanFeatures = (planKey) => {
  const plan = getPlan(planKey);
  const base = plan ? plan.features : [];
  const overlay = planOverlay.getOverlay(planKey);
  if (!overlay || !overlay.features) return [...base];

  const merged = new Set(base);
  for (const [key, enabled] of Object.entries(overlay.features)) {
    if (enabled) merged.add(key);
    else merged.delete(key);
  }
  return [...merged];
};

/** The limits a plan allows, with the persisted configuration applied. */
const effectivePlanLimits = (planKey) => {
  const plan = getPlan(planKey);
  const base = plan ? { ...(plan.limits || {}) } : {};
  const overlay = planOverlay.getOverlay(planKey);
  if (!overlay || !overlay.limits) return base;
  return { ...base, ...overlay.limits };
};

/** The outlets bundled in the plan price, with the persisted value applied. */
const effectiveIncludedOutlets = (planKey) => {
  const overlay = planOverlay.getOverlay(planKey);
  if (overlay && Number.isInteger(overlay.includedOutlets)) return overlay.includedOutlets;
  const plan = getPlan(planKey);
  return plan ? plan.includedOutlets : 1;
};

module.exports = {
  GST_RATE,
  ANNUAL_MONTHS,
  FREE_TRIAL_DAYS,
  GRACE_DAYS,
  FEATURES,
  CORE_FEATURES,
  PLANS,
  PLAN_KEYS,
  PAID_PLAN_KEYS,
  DEFAULT_TRIAL_PLAN,
  DEFAULT_PAID_PLAN,
  CYCLES,
  METRICS,
  METRIC_CONFIG,
  METERED_METRICS,
  isMetric,
  CURRENT_PLAN_VERSION,
  PLAN_VERSION_HISTORY,
  FEATURE_TYPES,
  isKnownFeature,
  resolvePlan,
  planLimit,
  getPlan,
  isPlanKey,
  isCycle,
  resolvePlanKey,
  quote,
  publicCatalogue,
  addDays,
  addMonths,
  RUPEES,
  FEATURE_METADATA,
  KNOWN_FEATURES_INCLUDE,
  FEATURE_GROUP_ORDER,
  LIMIT_ROWS,
  LIMIT_ROW_KEYS,
  isLimitRow,
  effectivePlanFeatures,
  effectivePlanLimits,
  effectiveIncludedOutlets,
};
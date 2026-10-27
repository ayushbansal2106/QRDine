const Customer = require('../models/Customer');

/**
 * Module #14 — audience rules for targeted offers.
 *
 * A coupon can name the customers it is for, but a *list* freezes the audience
 * at the moment it is saved: someone who goes inactive tomorrow is not on it,
 * and someone who came back today still is. A win-back offer aimed at a snapshot
 * of "the inactive" is wrong within a day of writing it.
 *
 * So the audience is a **rule**, evaluated against the customer's live document
 * every time the code is used. The customer base moves; the rule keeps up.
 */

/**
 * The only fields a rule may read, and the operations each supports.
 *
 * A whitelist, not free text. An offer that could read `blockedReason` or any
 * future field would turn the coupon editor into a way to query the customer
 * table, so the surface is declared here and the admin UI is built from this
 * same catalogue — the picker cannot offer a rule the engine would refuse.
 */
const RULE_FIELDS = {
  visitCount: {
    label: 'Number of visits',
    type: 'number',
    ops: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  },
  lifetimeSpend: {
    label: 'Lifetime spend (₹)',
    type: 'number',
    ops: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  },
  avgSpend: {
    label: 'Average bill (₹)',
    type: 'number',
    ops: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  },
  lastVisitAt: {
    label: 'Last visit',
    type: 'date',
    ops: ['within_days', 'not_within_days', 'before', 'after', 'is_set', 'is_not_set'],
  },
  firstSeenAt: {
    label: 'First seen',
    type: 'date',
    ops: ['within_days', 'not_within_days', 'before', 'after'],
  },
  birthday: {
    label: 'Birthday',
    type: 'date',
    ops: ['month_is', 'is_set', 'is_not_set'],
  },
  tags: {
    label: 'Tags',
    type: 'array',
    ops: ['contains', 'not_contains'],
  },
  emailVerifiedAt: {
    label: 'Email verified',
    type: 'date',
    ops: ['is_set', 'is_not_set'],
  },
};

const OPERATOR_LABELS = {
  eq: 'is',
  neq: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  within_days: 'within the last (days)',
  not_within_days: 'has not visited for (days)',
  before: 'is before',
  after: 'is after',
  month_is: 'is in month (1–12)',
  contains: 'includes',
  not_contains: 'does not include',
  is_set: 'is known',
  is_not_set: 'is not known',
};

/** The catalogue the admin rule builder renders from. */
const ruleCatalogue = () =>
  Object.entries(RULE_FIELDS).map(([field, meta]) => ({
    field,
    label: meta.label,
    type: meta.type,
    ops: meta.ops.map((op) => ({ op, label: OPERATOR_LABELS[op] || op })),
  }));

/**
 * Presets: the four audiences a café actually asks for, expanded into the same
 * rules the builder produces. A preset is a starting point, not a separate
 * mechanism — what is stored is always rules, so a preset can be tweaked after
 * it is applied.
 */
const AUDIENCE_PRESETS = [
  {
    key: 'new_user',
    label: 'New customers',
    hint: 'First visit — up to the given number of visits',
    build: (value = 1) => [{ field: 'visitCount', op: 'lte', value: Number(value) || 1 }],
  },
  {
    key: 'inactive',
    label: 'Inactive (win-back)',
    hint: 'No visit for the given number of days',
    build: (value = 30) => [
      { field: 'lastVisitAt', op: 'is_set', value: true },
      { field: 'lastVisitAt', op: 'not_within_days', value: Number(value) || 30 },
    ],
  },
  {
    key: 'loyal',
    label: 'Loyal / high spenders',
    hint: 'Lifetime spend of at least ₹',
    build: (value = 1000) => [
      { field: 'lifetimeSpend', op: 'gte', value: Number(value) || 1000 },
    ],
  },
  {
    key: 'birthday_month',
    label: 'Birthday this month',
    hint: 'Profile birthday falls in the current month',
    build: () => [{ field: 'birthday', op: 'month_is', value: 'current' }],
  },
  {
    key: 'tagged',
    label: 'Tagged customers',
    hint: 'Profiles carrying a tag, e.g. "student"',
    build: (value = '') => [{ field: 'tags', op: 'contains', value: String(value || '').toLowerCase() }],
  },
];

/** Which preset, if any, a stored rule set is recognisably the same as. */
const matchPreset = (rules = []) => {
  for (const preset of AUDIENCE_PRESETS) {
    const built = preset.build(preset.key === 'birthday_month' ? undefined : undefined);
    // Compared on shape rather than value: a preset stays recognisable when the
    // café has tuned its threshold.
    if (built.length !== rules.length) continue;
    const same = built.every((rule, i) => rule.field === rules[i].field && rule.op === rules[i].op);
    if (same) return preset.key;
  }
  return null;
};

const asDate = (value) => (value instanceof Date ? value : value ? new Date(value) : null);

const daysSince = (date, now) => {
  const d = asDate(date);
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
};

/**
 * Validate an audience before it is stored.
 *
 * An audience the engine would quietly refuse is worse than no audience: the
 * coupon looks targeted in the list, and is not. So the mode is checked against
 * the enum and every rule against the whitelist, and anything unrecognised is
 * dropped here rather than silently never matching at redemption time.
 */
const normalizeAudience = (audience) => {
  const requested = audience?.mode || 'all';
  const mode = ['all', 'customers', 'segment'].includes(requested) ? requested : 'all';

  if (mode !== 'segment') return { mode, rules: [] };

  const rules = (Array.isArray(audience?.rules) ? audience.rules : [])
    .filter((rule) => rule && RULE_FIELDS[rule.field])
    .filter((rule) => RULE_FIELDS[rule.field].ops.includes(rule.op))
    .map((rule) => ({
      field: rule.field,
      op: rule.op,
      value:
        rule.op === 'month_is' && rule.value === 'current'
          ? 'current'
          : RULE_FIELDS[rule.field].type === 'number'
            ? Number(rule.value)
            : rule.value,
    }));

  // A segment with nothing left to match would have been everyone.
  return rules.length > 0 ? { mode, rules } : { mode: 'all', rules: [] };
};

/** Evaluate one rule against a customer document. Unknown rules never match. */
const evaluateRule = (rule, customer, { now = new Date() } = {}) => {
  const meta = RULE_FIELDS[rule?.field];
  if (!meta || !meta.ops.includes(rule.op)) return false;

  const actual = customer[rule.field];

  switch (rule.op) {
    case 'eq':
    case 'neq': {
      const equals =
        meta.type === 'number'
          ? Number(actual) === Number(rule.value)
          : String(actual ?? '') === String(rule.value ?? '');
      return rule.op === 'eq' ? equals : !equals;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = Number(actual);
      const b = Number(rule.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (rule.op === 'gt') return a > b;
      if (rule.op === 'gte') return a >= b;
      if (rule.op === 'lt') return a < b;
      return a <= b;
    }
    case 'within_days': {
      const days = daysSince(actual, now);
      return days !== null && days <= Number(rule.value);
    }
    case 'not_within_days': {
      const days = daysSince(actual, now);
      // Never visited at all is the definition of inactive, not an exception.
      if (days === null) return true;
      return days > Number(rule.value);
    }
    case 'before':
      return !!asDate(actual) && asDate(actual) < asDate(rule.value);
    case 'after':
      return !!asDate(actual) && asDate(actual) > asDate(rule.value);
    case 'month_is': {
      const d = asDate(actual);
      if (!d) return false;
      const wanted =
        rule.value === 'current' ? now.getMonth() + 1 : Number(rule.value);
      return d.getMonth() + 1 === Number(wanted);
    }
    case 'contains':
      return (customer.tags || []).map((t) => String(t).toLowerCase()).includes(String(rule.value || '').toLowerCase());
    case 'not_contains':
      return !(customer.tags || []).map((t) => String(t).toLowerCase()).includes(String(rule.value || '').toLowerCase());
    case 'is_set':
      return actual !== null && actual !== undefined && actual !== '';
    case 'is_not_set':
      return actual === null || actual === undefined || actual === '';
    default:
      return false;
  }
};

/**
 * Does this customer match the coupon's audience?
 *
 * `customers` mode is the hand-picked list and is answered from ids alone — it
 * does not need the profile document, so redemption of a targeted coupon costs
 * no extra read. `segment` mode needs the live document and runs the rules.
 * `all` — and any segment with no rules — is everyone.
 */
const matchesAudience = (coupon, customer, ctx = {}) => {
  const audience = coupon.audience || {};
  const mode = audience.mode || (coupon.appliesTo?.customerIds?.length ? 'customers' : 'all');
  const id = customer?._id ?? ctx.customerId ?? null;

  if (mode === 'customers') {
    const list = (coupon.appliesTo?.customerIds || []).map(String);
    return list.length > 0 && id !== null && list.includes(String(id));
  }

  if (!customer) {
    // An anonymous order can still use a café-wide coupon, but never a targeted
    // one: an audience is a property of a profile.
    return mode === 'all';
  }

  if (mode !== 'segment') return true;

  const rules = Array.isArray(audience.rules) ? audience.rules.filter(Boolean) : [];
  if (rules.length === 0) return true;

  return rules.every((rule) => evaluateRule(rule, customer, ctx));
};

/** Plain-English summary of who an offer is for, for the admin list. */
const describeAudience = (coupon) => {
  const audience = coupon.audience || {};
  const mode = audience.mode || (coupon.appliesTo?.customerIds?.length ? 'customers' : 'all');

  if (mode === 'customers') {
    const count = (coupon.appliesTo?.customerIds || []).length;
    return `${count} selected customer${count === 1 ? '' : 's'}`;
  }
  if (mode !== 'segment') return 'Everyone';

  const rules = Array.isArray(audience.rules) ? audience.rules.filter(Boolean) : [];
  if (rules.length === 0) return 'Everyone';

  const preset = matchPreset(rules);
  if (preset) {
    const found = AUDIENCE_PRESETS.find((p) => p.key === preset);
    if (found) return found.label;
  }

  return rules
    .map((rule) => {
      const meta = RULE_FIELDS[rule.field];
      if (!meta) return '';
      const opLabel = OPERATOR_LABELS[rule.op] || rule.op;
      const needsValue = !['is_set', 'is_not_set'].includes(rule.op);
      if (rule.op === 'month_is' && rule.value === 'current') {
        return `${meta.label} is this month`;
      }
      return needsValue
        ? `${meta.label} ${opLabel} ${rule.value}`
        : `${meta.label} ${opLabel}`;
    })
    .filter(Boolean)
    .join(' and ');
};

/** Why a customer did not match — the sentence the redemption path shows. */
const audienceRefusal = (coupon, customer) => {
  const mode = coupon.audience?.mode || (coupon.appliesTo?.customerIds?.length ? 'customers' : 'all');
  if (!customer && mode !== 'all') {
    // An anonymous order cannot match any audience, because the audience is a
    // property of a profile. Say both halves: why, and what to do about it.
    return 'This offer is not available for your account — sign in with your phone number to use it';
  }
  return 'This offer is not available for your account';
};

/**
 * Who would this reach right now?
 *
 * Shown next to the audience picker, because "inactive for 30 days" is not a
 * number anyone can picture until the screen says how many people that is.
 */
const previewAudience = async ({ coupon, cafeId, limit = 5 }) => {
  const audience = coupon.audience || {};
  const mode = audience.mode || (coupon.appliesTo?.customerIds?.length ? 'customers' : 'all');

  if (mode === 'all') {
    const totalCount = await Customer.countDocuments({ cafeId });
    return { mode, totalCount, sample: [], description: describeAudience(coupon) };
  }

  if (mode === 'customers') {
    const ids = coupon.appliesTo?.customerIds || [];
    const sample = await Customer.find({ cafeId, _id: { $in: ids } })
      .limit(limit)
      .select('name phone');
    const totalCount = await Customer.countDocuments({ cafeId, _id: { $in: ids } });
    return { mode, totalCount, sample, description: describeAudience(coupon) };
  }

  // A segment is evaluated in the application, not in the database: the rules
  // are not expressible as a single portable query, and silently drifting from
  // the definition the café was shown would be worse than a slower count.
  const customers = await Customer.find({ cafeId }).select(
    'name phone visitCount lifetimeSpend avgSpend lastVisitAt firstSeenAt birthday tags emailVerifiedAt'
  );
  const matching = customers.filter((c) => matchesAudience(coupon, c));

  return {
    mode,
    totalCount: matching.length,
    sample: matching.slice(0, limit).map((c) => ({ name: c.name, phone: c.phone })),
    description: describeAudience(coupon),
  };
};

module.exports = {
  RULE_FIELDS,
  OPERATOR_LABELS,
  AUDIENCE_PRESETS,
  ruleCatalogue,
  normalizeAudience,
  matchPreset,
  evaluateRule,
  matchesAudience,
  describeAudience,
  audienceRefusal,
  previewAudience,
};
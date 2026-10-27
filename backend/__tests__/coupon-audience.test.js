/**
 * Regression guard — an offer can name a *rule*, not just a list of people.
 *
 * A hand-picked audience is a photograph: everyone who was inactive when the
 * coupon was saved, and nobody who drifts into that state afterwards. These tests
 * pin the rule engine against exactly that failure — the audience moving on
 * after the coupon was written — and the personal delivery that tells the people
 * it now covers.
 */
jest.mock('../src/models/Coupon', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../src/models/CouponGrant', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock('../src/models/Customer', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
}));
jest.mock('../src/services/auditService', () => ({ recordEvent: jest.fn() }));
jest.mock('../src/services/socketService', () => ({ emitMetricsUpdated: jest.fn() }));

const Coupon = require('../src/models/Coupon');
const CouponGrant = require('../src/models/CouponGrant');
const Customer = require('../src/models/Customer');
const auditService = require('../src/services/auditService');
const segmentService = require('../src/services/segmentService');
const couponGrantService = require('../src/services/couponGrantService');
const couponService = require('../src/services/couponService');

const cafeId = '6ac08f59dc276e3c59831d60';
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const regular = { _id: 'c1', visitCount: 12, lifetimeSpend: 8400, avgSpend: 700, lastVisitAt: daysAgo(2), firstSeenAt: daysAgo(300), birthday: null, tags: [], emailVerifiedAt: null };
const newcomer = { _id: 'c2', visitCount: 0, lifetimeSpend: 0, avgSpend: 0, lastVisitAt: null, firstSeenAt: daysAgo(2), birthday: null, tags: [], emailVerifiedAt: null };
const lapsed = { _id: 'c3', visitCount: 4, lifetimeSpend: 900, avgSpend: 225, lastVisitAt: daysAgo(95), firstSeenAt: daysAgo(400), birthday: null, tags: [], emailVerifiedAt: null };

beforeEach(() => {
  jest.clearAllMocks();
  auditService.recordEvent.mockResolvedValue(undefined);
  CouponGrant.updateMany.mockResolvedValue({ modifiedCount: 0 });
});

describe('normalizeAudience', () => {
  it('keeps a well-formed segment', () => {
    const audience = segmentService.normalizeAudience({
      mode: 'segment',
      rules: [{ field: 'visitCount', op: 'lte', value: '1' }],
    });

    expect(audience.mode).toBe('segment');
    expect(audience.rules[0].value).toBe(1);
  });

  it('drops a rule the engine would refuse, rather than storing a lie', () => {
    const audience = segmentService.normalizeAudience({
      mode: 'segment',
      rules: [
        { field: 'blockedReason', op: 'contains', value: 'chargeback' }, // not whitelisted
        { field: 'visitCount', op: 'like', value: '1' }, // not an operator
        { field: 'visitCount', op: 'lte', value: 1 },
      ],
    });

    expect(audience.rules).toHaveLength(1);
    expect(audience.rules[0].field).toBe('visitCount');
  });

  it('falls back to everyone rather than to a segment with no rules', () => {
    expect(segmentService.normalizeAudience({ mode: 'segment', rules: [] }).mode).toBe('all');
    expect(segmentService.normalizeAudience({ mode: 'nonsense' }).mode).toBe('all');
  });
});

describe('the four audiences a café asks for', () => {
  const couponFor = (rules) => ({ audience: { mode: 'segment', rules } });

  it('new customers — nobody who has already been in a few times', () => {
    const preset = segmentService.AUDIENCE_PRESETS.find((p) => p.key === 'new_user');
    const offer = couponFor(preset.build(1));

    expect(segmentService.matchesAudience(offer, newcomer)).toBe(true);
    expect(segmentService.matchesAudience(offer, regular)).toBe(false);
    expect(segmentService.describeAudience(offer)).toBe(preset.label);
  });

  it('inactive — a win-back offer that ignores the people who came back', () => {
    const preset = segmentService.AUDIENCE_PRESETS.find((p) => p.key === 'inactive');
    const offer = couponFor(preset.build(30));

    expect(segmentService.matchesAudience(offer, lapsed)).toBe(true);
    // The whole point: the audience is re-read, so yesterday's regular is not
    // quietly still on the list.
    expect(segmentService.matchesAudience(offer, regular)).toBe(false);
  });

  it('treats a profile that has never visited as inactive', () => {
    const preset = segmentService.AUDIENCE_PRESETS.find((p) => p.key === 'inactive');
    const offer = couponFor(preset.build(30));
    // The `is_set` half of the preset is what excludes a profile with no visit
    // recorded yet — a first-timer is "new", not "lapsed".
    const withoutThePresenceCheck = couponFor([
      { field: 'lastVisitAt', op: 'not_within_days', value: 30 },
    ]);

    expect(segmentService.matchesAudience(offer, newcomer)).toBe(false);
    expect(segmentService.matchesAudience(withoutThePresenceCheck, newcomer)).toBe(true);
  });

  it('loyal — big spenders only', () => {
    const preset = segmentService.AUDIENCE_PRESETS.find((p) => p.key === 'loyal');
    const offer = couponFor(preset.build(1000));

    expect(segmentService.matchesAudience(offer, regular)).toBe(true);
    expect(segmentService.matchesAudience(offer, lapsed)).toBe(false);
  });

  it('birthday — the current month, and nobody without a birthday', () => {
    const preset = segmentService.AUDIENCE_PRESETS.find((p) => p.key === 'birthday_month');
    const offer = couponFor(preset.build());
    const thisMonth = { ...regular, birthday: new Date(1990, new Date().getMonth(), 12) };
    const notThisMonth = { ...regular, birthday: new Date(1990, (new Date().getMonth() + 3) % 12, 12) };

    expect(segmentService.matchesAudience(offer, thisMonth)).toBe(true);
    expect(segmentService.matchesAudience(offer, notThisMonth)).toBe(false);
    expect(segmentService.matchesAudience(offer, regular)).toBe(false);
  });

  it('tags — the hand-applied label, case-insensitively', () => {
    const preset = segmentService.AUDIENCE_PRESETS.find((p) => p.key === 'tagged');
    const offer = couponFor(preset.build('Student'));

    expect(segmentService.matchesAudience(offer, { ...regular, tags: ['student'] })).toBe(true);
    expect(segmentService.matchesAudience(offer, regular)).toBe(false);
  });

  it('describes an arbitrary rule in words the café can read', () => {
    const offer = couponFor([
      { field: 'visitCount', op: 'gte', value: 5 },
      { field: 'lastVisitAt', op: 'within_days', value: 7 },
    ]);

    expect(segmentService.describeAudience(offer)).toBe(
      'Number of visits is at least 5 and Last visit within the last (days) 7'
    );
  });
});

describe('matchesAudience — who gets refused, and why', () => {
  it('answers a hand-picked list from ids alone, with no profile read', () => {
    const coupon = { appliesTo: { customerIds: ['c1'] } };

    expect(segmentService.matchesAudience(coupon, null, { customerId: 'c1' })).toBe(true);
    expect(segmentService.matchesAudience(coupon, null, { customerId: 'c9' })).toBe(false);
  });

  it('lets an anonymous order use a café-wide offer but not a targeted one', () => {
    expect(segmentService.matchesAudience({ audience: { mode: 'all' } }, null)).toBe(true);
    expect(segmentService.matchesAudience({ audience: { mode: 'segment', rules: [] } }, null)).toBe(false);
  });

  it('tells an anonymous guest why, not just that it failed', () => {
    const message = segmentService.audienceRefusal({ audience: { mode: 'segment', rules: [] } }, null);

    expect(message).toMatch(/not available for your account/i);
    expect(message).toMatch(/sign in/i);
  });
});

describe('personal delivery — a grant per matching profile', () => {
  const coupon = {
    _id: 'coupon-1',
    cafeId,
    code: 'WINBACK',
    isActive: true,
    audience: { mode: 'segment', rules: [{ field: 'visitCount', op: 'lte', value: 1 }] },
    autoIssue: { enabled: true, repeatEveryDays: 0 },
    validTo: null,
  };

  beforeEach(() => {
    Coupon.find.mockResolvedValue([coupon]);
    Customer.find.mockResolvedValue([regular, newcomer, lapsed]);
    CouponGrant.findOne.mockResolvedValue(null);
  });

  it('issues to the audience and to nobody else', async () => {
    CouponGrant.create.mockImplementation(async (data) => ({ _id: `grant-${data.customerId}`, ...data }));

    const result = await couponGrantService.sweepAutoIssue();

    expect(result.issued).toBe(1); // only `newcomer` matches
    expect(CouponGrant.create).toHaveBeenCalledTimes(1);
    expect(CouponGrant.create.mock.calls[0][0].customerId).toBe('c2');
  });

  it('never sends a personal code for a café-wide offer', async () => {
    Coupon.find.mockResolvedValue([{ ...coupon, audience: { mode: 'all', rules: [] } }]);

    const result = await couponGrantService.sweepAutoIssue();

    expect(result.issued).toBe(0);
    expect(CouponGrant.create).not.toHaveBeenCalled();
  });

  it('does not re-issue to somebody who already holds a live code', async () => {
    CouponGrant.findOne.mockResolvedValue({
      _id: 'existing',
      status: 'issued',
      expiresAt: null,
    });
    CouponGrant.create.mockResolvedValue({ _id: 'new' });

    const result = await couponGrantService.sweepAutoIssue();

    expect(result.issued).toBe(0);
    expect(CouponGrant.create).not.toHaveBeenCalled();
  });

  it('gives each grant a code that fits the field it is typed into', () => {
    const code = couponGrantService.buildGrantCode('A-VERY-LONG-CAMPAIGN-CODE-NAME');

    expect(code.length).toBeLessThanOrEqual(32);
    expect(code.startsWith('A-VERY-LONG-CAMPAIGN')).toBe(true);
  });

  it('expires lapsed grants so a finished campaign stops working', async () => {
    CouponGrant.updateMany.mockResolvedValue({ modifiedCount: 4 });

    expect(await couponGrantService.expireStaleGrants()).toEqual({ expired: 4 });
    expect(CouponGrant.updateMany.mock.calls[0][0].status).toBe('issued');
  });
});

describe('a grant is spendable like any other code', () => {
  const coupon = {
    _id: 'coupon-1',
    cafeId,
    code: 'WINBACK',
    isActive: true,
    type: 'flat',
    value: 100,
    minOrder: 0,
    appliesTo: { scope: 'all' },
    validFrom: null,
    validTo: null,
    usageCount: 0,
    usageLimit: 0,
    singleUse: false,
  };

  it('resolves to its coupon and reports the code the guest typed', async () => {
    Coupon.findOne.mockResolvedValue(null);
    CouponGrant.findOne.mockResolvedValue({
      _id: 'g1',
      customerId: 'c2',
      status: 'issued',
      expiresAt: null,
      couponId: 'coupon-1',
      code: 'WINBACK-AB12CD',
    });
    Coupon.findById.mockResolvedValue(coupon);

    const result = await couponService.validate({
      cafeId,
      code: 'winback-ab12cd',
      subtotal: 500,
      customerId: 'c2',
    });

    expect(result.grantCode).toBe('WINBACK-AB12CD');
    expect(result.discount).toBe(100);
  });

  it('refuses a personal code presented by somebody else', async () => {
    Coupon.findOne.mockResolvedValue(null);
    CouponGrant.findOne.mockResolvedValue({
      _id: 'g1',
      customerId: 'c2',
      status: 'issued',
      expiresAt: null,
      couponId: 'coupon-1',
    });

    await expect(
      couponService.validate({ cafeId, code: 'WINBACK-AB12CD', subtotal: 500, customerId: 'c9' })
    ).rejects.toThrow('belongs to another customer');
  });

  it('refuses a personal code that has already been spent', async () => {
    Coupon.findOne.mockResolvedValue(null);
    CouponGrant.findOne.mockResolvedValue({
      _id: 'g1',
      customerId: 'c2',
      status: 'redeemed',
      couponId: 'coupon-1',
    });

    await expect(
      couponService.validate({ cafeId, code: 'WINBACK-AB12CD', subtotal: 500, customerId: 'c2' })
    ).rejects.toThrow('already been used');
  });
});
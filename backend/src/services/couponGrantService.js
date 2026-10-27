const crypto = require('crypto');

const Coupon = require('../models/Coupon');
const CouponGrant = require('../models/CouponGrant');
const Customer = require('../models/Customer');
const segmentService = require('./segmentService');
const AppError = require('../utils/AppError');
const auditService = require('./auditService');
const socketService = require('./socketService');

/**
 * Module #14 — personal delivery of targeted offers.
 *
 * The audience rule decides *who qualifies*; this decides *who has been told*.
 * A grant is one profile's own code for a coupon that already exists, so the
 * pricing, caps and limits are still the coupon's — nothing is duplicated, and
 * turning the offer off turns the grants off with it.
 */

const GRANT_SUFFIX = () => crypto.randomBytes(3).toString('hex').toUpperCase();

/** Keep the grant code inside the field's 32-character limit. */
const buildGrantCode = (couponCode) =>
  `${String(couponCode).slice(0, 24)}-${GRANT_SUFFIX()}`.toUpperCase();

const isLive = (grant, now = new Date()) =>
  grant.status === 'issued' && (!grant.expiresAt || grant.expiresAt >= now);

/**
 * Issue one grant, skipping if this customer already holds a live one.
 *
 * The check-and-insert is not transactional, and that is deliberate: the sweep
 * that calls this runs on a timer and may overlap itself. A duplicate code is a
 * nuisance; a duplicate *grant* for the same coupon is worse. The unique index
 * on `(cafeId, customerId, couponId)` for live grants is what actually prevents
 * it, so the race is settled by the database rather than by hope.
 */
const issueToCustomer = async ({ coupon, customer, expiresAt = null, now = new Date() }) => {
  const existing = await CouponGrant.findOne({
    cafeId: coupon.cafeId,
    couponId: coupon._id,
    customerId: customer._id,
    status: 'issued',
  });

  const expiry = expiresAt || coupon.validTo || null;
  if (existing && isLive(existing, now)) return { grant: existing, created: false };
  if (existing && !isLive(existing, now)) {
    existing.status = 'expired';
    await existing.save();
  }

  // A grant that outlives its offer would honour a campaign the café has ended.
  const effectiveExpiry = expiry && expiry >= now ? expiry : null;

  try {
    const grant = await CouponGrant.create({
      cafeId: coupon.cafeId,
      couponId: coupon._id,
      customerId: customer._id,
      code: buildGrantCode(coupon.code),
      status: 'issued',
      issuedAt: now,
      expiresAt: effectiveExpiry,
      audienceAtIssue: segmentService.describeAudience(coupon),
    });
    return { grant, created: true };
  } catch (err) {
    // Someone else issued to this customer between the check and the insert.
    if (err && err.code === 11000) return { grant: existing, created: false };
    throw err;
  }
};

/** Every live grant for one customer, with the offer behind each. */
const listForCustomer = async ({ cafeId, customerId, now = new Date() }) => {
  const grants = await CouponGrant.find({ cafeId, customerId, status: 'issued' })
    .sort({ issuedAt: -1 })
    .lean();

  const live = grants.filter((g) => isLive(g, now));
  if (live.length === 0) return [];

  const coupons = await Coupon.find({
    cafeId,
    _id: { $in: live.map((g) => g.couponId) },
    isActive: true,
  });
  const byId = new Map(coupons.map((c) => [String(c._id), c]));

  return live
    .filter((g) => byId.has(String(g.couponId)))
    .map((g) => {
      const coupon = byId.get(String(g.couponId));
      return {
        code: g.code,
        couponCode: coupon.code,
        label: coupon.description || coupon.code,
        type: coupon.type,
        value: coupon.value,
        minOrder: coupon.minOrder || 0,
        expiresAt: g.expiresAt,
        audienceAtIssue: g.audienceAtIssue || '',
      };
    });
};

/**
 * Issue to everyone the audience matches and nobody already holds.
 *
 * Runs on a timer rather than on signup, because the audiences are a state, not
 * an event: "inactive for 30 days" becomes true while nobody is looking.
 *
 * @returns {Promise<{issued: number, coupons: number}>}
 */
const sweepAutoIssue = async ({ limitPerCoupon = 500, now = new Date() } = {}) => {
  const coupons = await Coupon.find({ isActive: true, 'autoIssue.enabled': true });
  if (coupons.length === 0) return { issued: 0, coupons: 0 };

  let issued = 0;

  for (const coupon of coupons) {
    if (coupon.validFrom && coupon.validFrom > now) continue;
    if (coupon.validTo && coupon.validTo < now) continue;

    let matching;
    if (coupon.audience?.mode === 'customers') {
      matching = await Customer.find({ cafeId: coupon.cafeId, _id: { $in: coupon.appliesTo?.customerIds || [] } });
    } else {
      // A café-wide auto-issue would send a personal code to every profile on
      // every sweep. That is a newsletter, not a targeted offer.
      if (!coupon.audience?.mode || coupon.audience.mode === 'all') continue;
      const all = await Customer.find({ cafeId: coupon.cafeId });
      matching = all.filter((c) => segmentService.matchesAudience(coupon, c, { now }));
    }

    for (const customer of matching.slice(0, limitPerCoupon)) {
      // Somebody who has already used this offer is not sent it again unless the
      // café asked for a repeat cadence.
      if (coupon.autoIssue.repeatEveryDays > 0) {
        const previous = await CouponGrant.findOne({
          couponId: coupon._id,
          customerId: customer._id,
          status: 'redeemed',
        }).sort({ redeemedAt: -1 });

        if (previous?.redeemedAt) {
          const daysSince = (now.getTime() - previous.redeemedAt.getTime()) / 86400000;
          if (daysSince < coupon.autoIssue.repeatEveryDays) continue;
        }
      }

      try {
        const { created } = await issueToCustomer({ coupon, customer, now });
        if (created) issued += 1;
      } catch (err) {
        console.error(`Coupon grant failed for ${coupon.code}:`, err.message);
      }
    }
  }

  if (issued > 0) {
    auditService
      .recordEvent({
        cafeId: coupons[0].cafeId,
        type: 'coupon.grants_issued',
        entityType: 'Coupon',
        entityId: coupons[0]._id,
        staffName: 'system',
        metadata: { issued },
      })
      .catch((err) => console.error('Coupon grant audit failed (non-blocking):', err.message));

    socketService.emitMetricsUpdated(coupons[0].cafeId, { reason: 'coupon-grants' });
  }

  return { issued, coupons: coupons.length };
};

/** Expire grants whose campaign has ended, so a stale code stops working. */
const expireStaleGrants = async ({ now = new Date() } = {}) => {
  const result = await CouponGrant.updateMany(
    { status: 'issued', expiresAt: { $ne: null, $lt: now } },
    { $set: { status: 'expired' } }
  );
  return { expired: result.modifiedCount || 0 };
};

/** Consume a grant when the order it discounted is written. */
const redeemGrant = async ({ cafeId, code, orderId = null, now = new Date() }) => {
  const grant = await CouponGrant.findOne({ cafeId, code: String(code || '').trim().toUpperCase() });
  if (!grant) return null;

  if (!isLive(grant, now)) {
    if (grant.status === 'issued') {
      grant.status = 'expired';
      await grant.save();
    }
    throw new AppError('This offer is no longer available', 400);
  }

  grant.status = 'redeemed';
  grant.redeemedAt = now;
  grant.redeemedOrderId = orderId || null;
  await grant.save();

  return grant;
};

/** Look up a grant for validation; returns null when the code is not one. */
const findGrant = async ({ cafeId, code }) =>
  CouponGrant.findOne({
    cafeId,
    code: String(code || '').trim().toUpperCase(),
  });

/**
 * Run both halves on an interval.
 *
 * `unref()` keeps the timer from holding the process open, and both are skipped
 * under Jest so suites never race a background write against fixtures.
 */
const startCouponGrantSweeper = ({ intervalMs = 15 * 60 * 1000 } = {}) => {
  if (process.env.NODE_ENV === 'test') return null;

  const run = () =>
    Promise.all([sweepAutoIssue(), expireStaleGrants()])
      .then(([{ issued }, { expired }]) => {
        if (issued > 0) console.log(`Issued ${issued} personal offer code(s)`);
        if (expired > 0) console.log(`Expired ${expired} lapsed offer code(s)`);
      })
      .catch((err) => console.error('Coupon grant sweep failed:', err.message));

  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
};

module.exports = {
  buildGrantCode,
  isLive,
  issueToCustomer,
  listForCustomer,
  sweepAutoIssue,
  expireStaleGrants,
  redeemGrant,
  findGrant,
  startCouponGrantSweeper,
};
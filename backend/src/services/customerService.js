const crypto = require('crypto');
const Customer = require('../models/Customer');
const Wallet = require('../models/Wallet');
const LoyaltyCard = require('../models/LoyaltyCard');
const CouponGrant = require('../models/CouponGrant');
const ScratchCard = require('../models/ScratchCard');
const AppError = require('../utils/AppError');
const smsService = require('./smsService');

/**
 * Customer CRM service (Module #09).
 *
 * Profiles are keyed by { cafeId, phone } and are auto-created on any order that
 * carries a phone number (QR, POS, or waiter). Lifetime metrics are recomputed on
 * bill settlement.
 */

/**
 * The single canonical form of a customer's phone number.
 *
 * This has to be one function, not three call sites each doing their own thing.
 * OTP sign-in normalised through `smsService.normalizePhone` (adding the `91`
 * country code), while the POS stored whatever the cashier typed. The result was
 * two profiles for one person: the counter sale linked to `9996696235`, and
 * signing in with the same number resolved `919996696235`, found a different,
 * empty profile, and showed an order history with nothing in it.
 *
 * Anything that reads or writes a customer profile by phone goes through here.
 */
const canonicalPhone = (input) => {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  return smsService.normalizePhone(trimmed) || trimmed;
};

/**
 * The bare 10-digit national form of a canonical number.
 *
 * Used only to *find* profiles stored before normalisation existed. It never
 * gets written back — see `findByPhone`.
 */
const legacyPhoneVariants = (input) => {
  const trimmed = String(input || '').trim();
  if (!trimmed) return [];
  const canonical = canonicalPhone(trimmed);
  const variants = new Set();
  if (trimmed !== canonical) variants.add(trimmed);
  if (canonical.length === 12 && canonical.startsWith('91')) {
    variants.add(canonical.slice(2));
  }
  return [...variants];
};

/**
 * Resolve a phone number to a profile, whichever form it was stored in.
 *
 * The canonical row wins. When only a legacy-form row matches, its phone is
 * healed to the canonical form in place so the split cannot recur. When *both*
 * forms exist they are genuinely two profiles and the canonical one is
 * authoritative — merging them is a deliberate repair, not something to do
 * silently on a read path.
 */
const findByPhone = async (cafeId, phone) => {
  const canonical = canonicalPhone(phone);
  if (!canonical) return null;

  const customer = await Customer.findOne({ cafeId, phone: canonical });
  if (customer) return customer;

  for (const variant of legacyPhoneVariants(phone)) {
    const legacy = await Customer.findOne({ cafeId, phone: variant });
    if (!legacy) continue;
    legacy.phone = canonical;
    await legacy.save();
    return legacy;
  }

  return null;
};

/** Find an existing customer by phone, or create a new profile. */
const upsertByPhone = async ({ cafeId, phone, name, email }) => {
  const normalizedPhone = canonicalPhone(phone);
  if (!normalizedPhone) return null;

  let customer = await findByPhone(cafeId, phone);

  if (!customer) {
    customer = await Customer.create({
      cafeId,
      phone: normalizedPhone,
      name: (name || '').trim(),
      email: (email || '').trim().toLowerCase(),
      firstSeenAt: new Date(),
    });
    return customer;
  }

  // Backfill details that arrived later without overwriting good data with blanks.
  let changed = false;
  if (!customer.name && name) {
    customer.name = name.trim();
    changed = true;
  }
  if (!customer.email && email) {
    customer.email = email.trim().toLowerCase();
    changed = true;
  }
  if (changed) await customer.save();

  return customer;
};

/** Record a settled visit and refresh aggregate metrics. */
const recordVisit = async ({ cafeId, customerId, amount, itemIds = [] }) => {
  if (!customerId) return null;

  const customer = await Customer.findOne({ _id: customerId, cafeId });
  if (!customer) return null;

  customer.visitCount += 1;
  customer.lifetimeSpend = Number((customer.lifetimeSpend + (Number(amount) || 0)).toFixed(2));
  customer.avgSpend = Number((customer.lifetimeSpend / customer.visitCount).toFixed(2));
  customer.lastVisitAt = new Date();

  // Track the 5 most frequently ordered items.
  for (const itemId of itemIds) {
    const idStr = String(itemId);
    if (!customer.favoriteItemIds.some((id) => String(id) === idStr)) {
      customer.favoriteItemIds.push(itemId);
    }
  }
  if (customer.favoriteItemIds.length > 5) {
    customer.favoriteItemIds = customer.favoriteItemIds.slice(-5);
  }

  await customer.save();
  return customer;
};

/** Whether the customer has not visited in `days` (repeat-visit trigger). */
const isReturningAfterGap = (customer, days = 14) => {
  if (!customer || !customer.lastVisitAt) return false;
  const gapMs = Date.now() - new Date(customer.lastVisitAt).getTime();
  return gapMs >= days * 24 * 60 * 60 * 1000;
};

/**
 * Anonymize customer profile under DPDP Act 2023 Right to Erasure (Section 12).
 *
 * Statutory Compliance:
 * - Order and Invoice records are retained for 8 years (Section 36 of CGST Act 2017).
 * - Personal identifiers (name, phone, email, notes, preferences, dietary) are permanently scrubbed.
 * - Phone is replaced with irreversible SHA256-derived 'ANON-XXXXXXXXXX' preserving index uniqueness.
 * - Associated active wallet balance, coupons, and loyalty vouchers are deactivated.
 */
const anonymizeCustomer = async ({ cafeId, customerId, requestedBy = 'customer' }) => {
  const customer = await Customer.findOne({ _id: customerId, cafeId });
  if (!customer) {
    throw new AppError('Customer profile not found', 404);
  }

  if (customer.isAnonymized) {
    return customer;
  }

  const hashSuffix = crypto
    .createHash('sha256')
    .update(String(customer._id) + (customer.phone || ''))
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();

  const anonPhone = `ANON-${hashSuffix}`;

  customer.name = 'Redacted';
  customer.phone = anonPhone;
  customer.email = '';
  customer.emailVerifiedAt = null;
  customer.dietary = [];
  customer.tags = [];
  customer.birthday = null;
  customer.notes = '';
  customer.favoriteItemIds = [];
  customer.preferences = { vegOnly: false, notifications: false, language: 'en' };
  customer.isBlocked = true;
  customer.blockedReason = 'Account anonymized under DPDP Act 2023 Right to Erasure';
  customer.isAnonymized = true;
  customer.anonymizedAt = new Date();
  customer.anonymizationRequestedBy = requestedBy;

  await customer.save();

  // Deactivate store balance and promotional assets
  await Promise.allSettled([
    Wallet.updateMany({ cafeId, customerId: customer._id }, { $set: { isActive: false, balance: 0 } }),
    LoyaltyCard.updateMany(
      { cafeId, customerId: customer._id },
      { $set: { stamps: 0, 'vouchers.$[].status': 'expired' } }
    ),
    CouponGrant.updateMany(
      { cafeId, customerId: customer._id, status: 'issued' },
      { $set: { status: 'revoked' } }
    ),
    ScratchCard.updateMany(
      { cafeId, customerId: customer._id, status: 'issued' },
      { $set: { status: 'expired' } }
    ),
  ]);

  return customer;
};

module.exports = {
  canonicalPhone,
  legacyPhoneVariants,
  findByPhone,
  upsertByPhone,
  recordVisit,
  isReturningAfterGap,
  anonymizeCustomer,
};

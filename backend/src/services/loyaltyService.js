const crypto = require('crypto');

const LoyaltyProgram = require('../models/LoyaltyProgram');
const LoyaltyCard = require('../models/LoyaltyCard');
const AppError = require('../utils/AppError');
const auditService = require('./auditService');
const socketService = require('./socketService');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Module #15 — loyalty stamp program.
 * Stamps are earned on settlement and converted into reward vouchers.
 */

const getProgram = (cafeId) => LoyaltyProgram.findOne({ cafeId });

const getActiveProgram = async (cafeId) => {
  const program = await getProgram(cafeId);
  return program && program.isActive ? program : null;
};

const getOrCreateCard = async ({ cafeId, customerId, programId = null }) => {
  let card = await LoyaltyCard.findOne({ cafeId, customerId });
  if (!card) {
    card = await LoyaltyCard.create({ cafeId, customerId, programId });
  }
  return card;
};

const generateVoucherCode = () => `RWD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Mint one reward voucher from the programme's reward block.
 *
 * Shared by the automatic issue on settlement and the customer's explicit claim,
 * so a voucher can never look different depending on which door it came through.
 */
const buildVoucher = (program) => ({
  code: generateVoucherCode(),
  label: program.reward.label || 'Reward unlocked',
  type: program.reward.type,
  value: program.reward.value,
  menuItemId: program.reward.menuItemId || null,
  status: 'active',
  earnedAt: new Date(),
  expiresAt: new Date(Date.now() + program.voucherValidDays * 24 * 60 * 60 * 1000),
});

const itemsQualify = (program, itemIds) => {
  if (program.qualifyingScope !== 'items') return true;
  return (itemIds || []).some((id) =>
    (program.qualifyingItemIds || []).some((q) => String(q) === String(id))
  );
};

/**
 * Award stamps for a settled order; issue vouchers when the threshold is crossed.
 * Non-throwing by design where possible — callers treat failures as non-blocking.
 */
const earnStamps = async ({
  cafeId,
  customerId,
  orderId = null,
  amount = 0,
  itemIds = [],
  staffName = 'system',
}) => {
  if (!customerId) return null;

  const program = await getActiveProgram(cafeId);
  if (!program) return null;
  if (program.minSpend > 0 && Number(amount) < program.minSpend) return null;
  if (!itemsQualify(program, itemIds)) return null;

  const card = await getOrCreateCard({ cafeId, customerId, programId: program._id });
  if (!card.programId) card.programId = program._id;

  const earned = program.stampsPerOrder;
  card.stamps += earned;
  card.lifetimeStamps += earned;
  card.lastStampAt = new Date();
  card.addHistory({ type: 'stamp', count: earned, orderId, note: 'Order settled' });

  const issued = [];
  while (card.stamps >= program.stampsRequired) {
    card.stamps -= program.stampsRequired;
    const voucher = buildVoucher(program);
    card.vouchers.push(voucher);
    card.addHistory({ type: 'voucher', count: 1, note: voucher.code });
    issued.push(voucher);
  }

  await card.save();

  auditService
    .recordEvent({
      cafeId,
      type: 'loyalty.stamp',
      entityType: 'LoyaltyCard',
      entityId: card._id,
      staffName,
      metadata: { stampsEarned: earned, vouchers: issued.map((v) => v.code) },
    })
    .catch((err) => console.error('Loyalty audit write failed (non-blocking):', err.message));

  socketService.emitLoyaltyUpdated(cafeId, { customerId, stamps: card.stamps });

  return { card, stampsEarned: earned, vouchersIssued: issued };
};

/** Card + program summary for a customer (used by admin and customer views). */
const getCardSummary = async (cafeId, customerId) => {
  const [program, card] = await Promise.all([
    getProgram(cafeId),
    LoyaltyCard.findOne({ cafeId, customerId }),
  ]);

  if (!program && !card) return null;

  const vouchers = card ? card.vouchers : [];
  return {
    program,
    stamps: card ? card.stamps : 0,
    lifetimeStamps: card ? card.lifetimeStamps : 0,
    stampsRequired: program ? program.stampsRequired : 0,
    lastStampAt: card ? card.lastStampAt : null,
    vouchers,
    activeVouchers: vouchers.filter((v) => v.status === 'active'),
  };
};

/** Issue a standalone reward voucher onto a customer's card (used by scratch cards). */
const issueVoucher = async ({
  cafeId,
  customerId,
  label = 'Reward',
  type = 'flat_off',
  value = 0,
  menuItemId = null,
  validDays = 30,
}) => {
  const card = await getOrCreateCard({ cafeId, customerId });

  const voucher = {
    code: generateVoucherCode(),
    label,
    type,
    value,
    menuItemId,
    status: 'active',
    earnedAt: new Date(),
    expiresAt: new Date(Date.now() + validDays * 24 * 60 * 60 * 1000),
  };

  card.vouchers.push(voucher);
  card.addHistory({ type: 'voucher', count: 1, note: voucher.code });
  await card.save();

  socketService.emitLoyaltyUpdated(cafeId, { customerId, stamps: card.stamps });

  return voucher;
};

const findVoucher = async (cafeId, code) => {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;

  const card = await LoyaltyCard.findOne({
    cafeId,
    'vouchers.code': normalized,
  });
  if (!card) return null;
  const voucher = card.vouchers.find((v) => v.code === normalized);
  // The query above already matched the code, so this is belt-and-braces — but
  // returning `null` rather than a half-built result is what turns a mistyped
  // code into "Voucher not found" instead of a crash on `voucher.status`.
  if (!voucher) return null;
  return { card, voucher };
};

/** Validate a voucher without consuming it (used at checkout preview). */
const validateVoucher = async (cafeId, code) => {
  const found = await findVoucher(cafeId, code);
  if (!found) throw new AppError('Voucher not found', 404);

  const { voucher } = found;
  if (voucher.status !== 'active') throw new AppError('This voucher is not active', 400);
  if (voucher.expiresAt && voucher.expiresAt < new Date()) {
    throw new AppError('This voucher has expired', 400);
  }

  return {
    code: voucher.code,
    label: voucher.label,
    type: voucher.type,
    value: voucher.value,
    menuItemId: voucher.menuItemId,
    expiresAt: voucher.expiresAt,
  };
};

/**
 * Claim a completed stamp set for its voucher.
 *
 * Stamps that crossed the threshold on a settled bill are converted
 * automatically, so this is for the other case: a full card whose stamps were
 * put there by a manager adjustment, or a programme switched on after the
 * stamps were already earned. The customer presses one button and gets a code.
 *
 * The balance is decremented with a conditional update rather than read-modify-
 * write, so two taps on the button cannot both succeed and mint two vouchers
 * from the same five stamps.
 */
const claimReward = async ({ cafeId, customerId }) => {
  const program = await getActiveProgram(cafeId);
  if (!program) {
    throw new AppError('This café has no active loyalty programme', 400);
  }

  const card = await getOrCreateCard({ cafeId, customerId, programId: program._id });

  const claimed = await LoyaltyCard.findOneAndUpdate(
    { _id: card._id, stamps: { $gte: program.stampsRequired } },
    { $inc: { stamps: -program.stampsRequired }, $set: { programId: program._id } },
    { new: true }
  );

  if (!claimed) {
    const short = Math.max(0, program.stampsRequired - (card.stamps || 0));
    throw new AppError(
      `You need ${short} more stamp${short === 1 ? '' : 's'} to claim this reward`,
      400
    );
  }

  const voucher = buildVoucher(program);
  claimed.vouchers.push(voucher);
  claimed.addHistory({ type: 'voucher', count: 1, note: `Reward claimed: ${voucher.code}` });
  await claimed.save();

  auditService
    .recordEvent({
      cafeId,
      type: 'loyalty.reward_claimed',
      entityType: 'LoyaltyCard',
      entityId: claimed._id,
      staffName: 'customer',
      metadata: { voucherCode: voucher.code, stampsSpent: program.stampsRequired },
    })
    .catch((err) => console.error('Loyalty audit write failed (non-blocking):', err.message));

  socketService.emitLoyaltyUpdated(cafeId, { customerId, stamps: claimed.stamps });

  return { voucher, card: claimed };
};

/**
 * Validate a voucher for a specific customer.
 *
 * `validateVoucher` alone would let anyone who guessed or was handed a code
 * spend another guest's reward, so the owner of the card is checked here. This
 * is the only place a voucher can leave a customer's hand.
 */
const validateVoucherForCustomer = async (cafeId, code, customerId) => {
  if (!customerId) {
    throw new AppError('Sign in with your phone number to use a reward voucher', 403);
  }

  const found = await findVoucher(cafeId, code);
  if (!found) throw new AppError('Voucher not found', 404);

  if (String(found.card.customerId) !== String(customerId)) {
    throw new AppError('This voucher belongs to a different customer', 403);
  }

  return validateVoucher(cafeId, code);
};

/** Redeem (consume) a voucher atomically against a specific voucher element. */
const redeemVoucher = async ({ cafeId, code, orderId = null, staffId = null, staffName = '' }) => {
  const normalized = String(code || '').trim().toUpperCase();
  const card = await LoyaltyCard.findOne({ cafeId, 'vouchers.code': normalized });
  if (!card) throw new AppError('Voucher not found', 404);

  const voucher = card.vouchers.find((v) => v.code === normalized);
  if (!voucher || voucher.status !== 'active') {
    throw new AppError('This voucher is not active', 400);
  }
  if (voucher.expiresAt && voucher.expiresAt < new Date()) {
    voucher.status = 'expired';
    await card.save();
    throw new AppError('This voucher has expired', 400);
  }

  voucher.status = 'redeemed';
  voucher.redeemedAt = new Date();
  voucher.redeemedOrderId = orderId || null;
  card.addHistory({ type: 'redeem', count: 1, orderId, note: voucher.code });
  await card.save();

  auditService
    .recordEvent({
      cafeId,
      type: 'loyalty.redeem',
      entityType: 'LoyaltyCard',
      entityId: card._id,
      staffId,
      staffName,
      metadata: { voucherCode: voucher.code, orderId: orderId ? String(orderId) : null },
    })
    .catch((err) => console.error('Loyalty audit write failed (non-blocking):', err.message));

  socketService.emitLoyaltyUpdated(cafeId, { customerId: card.customerId, stamps: card.stamps });

  return voucher;
};

/** Manager adjustment of a customer's stamp balance. */
const adjustStamps = async ({ cafeId, customerId, delta, note = '', staffName = '' }) => {
  const value = Number(delta);
  if (!Number.isInteger(value) || value === 0) {
    throw new AppError('delta must be a non-zero integer', 400);
  }

  const card = await getOrCreateCard({ cafeId, customerId });
  if (card.stamps + value < 0) {
    throw new AppError('Adjustment would make the stamp balance negative', 400);
  }

  card.stamps += value;
  if (value > 0) card.lifetimeStamps += value;
  card.addHistory({ type: 'adjust', count: value, note });
  await card.save();

  auditService
    .recordEvent({
      cafeId,
      type: 'loyalty.adjust',
      entityType: 'LoyaltyCard',
      entityId: card._id,
      staffName,
      metadata: { delta: value, note },
    })
    .catch((err) => console.error('Loyalty audit write failed (non-blocking):', err.message));

  return card;
};

module.exports = {
  getProgram,
  getActiveProgram,
  getOrCreateCard,
  issueVoucher,
  earnStamps,
  claimReward,
  validateVoucherForCustomer,
  getCardSummary,
  validateVoucher,
  redeemVoucher,
  adjustStamps,
  round2,
};

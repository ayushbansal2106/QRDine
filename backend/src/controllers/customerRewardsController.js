const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const loyaltyService = require('../services/loyaltyService');
const segmentService = require('../services/segmentService');
const couponGrantService = require('../services/couponGrantService');
const walletService = require('../services/walletService');
const scratchService = require('../services/scratchService');
const couponService = require('../services/couponService');
const Coupon = require('../models/Coupon');
const ScratchCard = require('../models/ScratchCard');
const Customer = require('../models/Customer');
const Wallet = require('../models/Wallet');
const Cafe = require('../models/Cafe');

/**
 * Module #09 — the customer's own view of their rewards.
 *
 * Everything here already existed, but only behind admin auth: `/api/loyalty/me`
 * and `/api/wallet/me` were guest-session routes, and the guest-session route
 * resolved the customer through a table's order. A guest who signed in with
 * their phone number — the profile the app actually builds — had nowhere to see
 * their stamps, balance, scratch cards or offers.
 *
 * These endpoints are all `protectCustomer`, so the identity comes from the
 * signed-in profile and the tenant comes from that document rather than from
 * anything the caller supplies.
 */

/**
 * Loyalty card: stamps earned, progress to the next reward, and any vouchers
 * the customer can type at checkout.
 *
 * A café with no program *and* no card yet returns `null` — an absent reward is
 * different from a customer with zero stamps, and the UI needs to tell those
 * apart rather than showing an empty card that implies they are being
 * short-changed.
 */
const getMyLoyalty = asyncHandler(async (req, res) => {
  const summary = await loyaltyService.getCardSummary(req.customer.cafeId, req.customer._id);

  if (!summary) {
    return res.status(200).json({ success: true, loyalty: null });
  }

  const program = summary.program;
  const stampsRequired = program?.stampsRequired || 0;

  res.status(200).json({
    success: true,
    loyalty: {
      programName: program?.name || 'Loyalty Card',
      // An inactive program earns nothing, so say so rather than showing a
      // progress bar that will never move.
      isActive: Boolean(program?.isActive),
      stamps: summary.stamps,
      lifetimeStamps: summary.lifetimeStamps,
      stampsRequired,
      stampsToNextReward: stampsRequired > 0 ? Math.max(0, stampsRequired - summary.stamps) : 0,
      stampsPerOrder: program?.stampsPerOrder || 0,
      lastStampAt: summary.lastStampAt,
      vouchers: (summary.activeVouchers || []).map((v) => ({
        code: v.code,
        label: v.label,
        type: v.type,
        value: v.value,
        expiresAt: v.expiresAt,
      })),
    },
  });
});

/**
 * Prepaid wallet balance and recent ledger entries.
 *
 * A customer who has never topped up gets a zero balance, not `null` — the
 * wallet screen should read "₹0" rather than an empty state, because the
 * difference between "no wallet" and "an empty wallet" is invisible to the
 * customer and irrelevant to them.
 */
const getMyWallet = asyncHandler(async (req, res) => {
  const [wallet, ledger] = await Promise.all([
    walletService.getWallet(req.customer.cafeId, req.customer._id),
    walletService.listTransactions(req.customer.cafeId, req.customer._id, { page: 1, limit: 10 }),
  ]);

  res.status(200).json({
    success: true,
    wallet: {
      balance: wallet ? Number((wallet.balance || 0).toFixed(2)) : 0,
      currency: wallet?.currency || 'INR',
      hasWallet: Boolean(wallet),
    },
    transactions: (ledger?.transactions || []).map((t) => ({
      id: String(t._id),
      type: t.type,
      amount: Number((t.amount || 0).toFixed(2)),
      balanceAfter: Number((t.balanceAfter || 0).toFixed(2)),
      note: t.note || '',
      createdAt: t.createdAt,
    })),
  });
});

/**
 * Task 2.5: Multi-Wallet Discovery Tab.
 * Lists all cafe-isolated prepaid store wallets linked to the customer's verified phone number.
 */
const getMyWallets = asyncHandler(async (req, res) => {
  const phone = req.customer.phone;
  let customerIds = [req.customer._id];

  if (phone) {
    const matchingCustomers = await Customer.find({ phone }).select('_id cafeId');
    customerIds = matchingCustomers.map((c) => c._id);
  }

  const wallets = await Wallet.find({ customerId: { $in: customerIds } })
    .populate('cafeId', 'name logo address')
    .lean();

  const formattedWallets = wallets
    .filter((w) => w.cafeId)
    .map((w) => ({
      walletId: String(w._id),
      cafeId: String(w.cafeId._id),
      cafeName: w.cafeId.name || 'Unnamed Cafe',
      cafeLogo: w.cafeId.logo || '',
      cafeAddress: w.cafeId.address || '',
      balance: Number((w.balance || 0).toFixed(2)),
      currency: w.currency || 'INR',
      isActiveHere: String(w.cafeId._id) === String(req.customer.cafeId),
      lastTransactionAt: w.lastTransactionAt,
    }));

  const hasCurrentCafe = formattedWallets.some((w) => w.isActiveHere);
  if (!hasCurrentCafe) {
    const currentCafe = await Cafe.findById(req.customer.cafeId).select('name logo address').lean();
    if (currentCafe) {
      formattedWallets.unshift({
        walletId: null,
        cafeId: String(currentCafe._id),
        cafeName: currentCafe.name || 'Current Cafe',
        cafeLogo: currentCafe.logo || '',
        cafeAddress: currentCafe.address || '',
        balance: 0,
        currency: 'INR',
        isActiveHere: true,
        lastTransactionAt: null,
      });
    }
  }

  res.status(200).json({
    success: true,
    currentCafeId: String(req.customer.cafeId),
    wallets: formattedWallets,
  });
});

/** Scratch cards issued to this customer, plus whether the campaign is live. */
const getMyScratchCards = asyncHandler(async (req, res) => {
  const [campaign, cards] = await Promise.all([
    scratchService.getCampaign(req.customer.cafeId),
    ScratchCard.find({
      cafeId: req.customer.cafeId,
      customerId: req.customer._id,
    })
      .sort({ createdAt: -1 })
      .limit(20),
  ]);

  res.status(200).json({
    success: true,
    campaignLive: Boolean(campaign && campaign.isActive),
    cards: cards.map((c) => ({
      id: String(c._id),
      status: c.status,
      createdAt: c.createdAt,
      revealedAt: c.revealedAt,
      // The prize is withheld until revealed — sending it in the list would
      // hand every customer the answer in the network tab.
      prize: c.status === 'revealed' ? c.prize : null,
    })),
  });
});

/**
 * Reveal one of the customer's own scratch cards.
 *
 * `revealCard` re-checks ownership from the signed-in customer id, so a card id
 * belonging to someone else cannot be revealed by guessing it.
 */
const revealMyScratchCard = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { card, voucher } = await scratchService.revealCard({
    cafeId: req.customer.cafeId,
    cardId: id,
    customerId: req.customer._id,
    staffName: req.customer.name || 'customer',
  });

  res.status(200).json({
    success: true,
    message: 'Card revealed',
    prize: card.prize,
    voucher: voucher
      ? { code: voucher.code, label: voucher.label, type: voucher.type, value: voucher.value }
      : null,
  });
});

/**
 * Offers addressed to this customer — both the personal codes they were sent and
 * the shared ones their profile qualifies for.
 *
 * This list was reading fields the model does not have (`label`, `discountType`,
 * `minOrderValue`) and filtering on an `appliesTo.scope` value outside the enum,
 * so it could never return a targeted offer: a coupon aimed at "inactive for 30
 * days" was accepted at checkout and invisible to the very customer it was for.
 *
 * A café-wide coupon is still not listed — it is found by typing its code, which
 * is how coupons are meant to work. Validity is applied here rather than in the
 * UI, so the list cannot drift from what the server will actually accept.
 */
const getMyCoupons = asyncHandler(async (req, res) => {
  const now = new Date();
  const cafeId = req.customer.cafeId;
  const me = req.customer;

  const [targeted, grants] = await Promise.all([
    Coupon.find({
      cafeId,
      isActive: true,
      $or: [
        { 'appliesTo.customerIds': me._id },
        { 'audience.mode': 'segment' },
      ],
    }).sort({ createdAt: -1 }),
    couponGrantService.listForCustomer({ cafeId, customerId: me._id, now }),
  ]);

  const live = (c) => (!c.validFrom || c.validFrom <= now) && (!c.validTo || c.validTo >= now);

  const offers = targeted
    .filter(live)
    // The audience is re-evaluated here for the same reason it is at redemption:
    // a win-back offer must not appear to somebody who has already come back.
    .filter((c) => segmentService.matchesAudience(c, me, { now }))
    .filter((c) => !(c.singleUse && c.usageCount >= 1))
    .filter((c) => !(c.usageLimit > 0 && c.usageCount >= c.usageLimit))
    .map((c) => ({
      code: c.code,
      label: c.description || c.code,
      description: c.description || '',
      type: c.type,
      value: c.value,
      minOrderValue: c.minOrder || 0,
      validUntil: c.validTo,
      used: c.usageCount || 0,
      usageLimit: c.usageLimit || null,
      personal: false,
      audience: segmentService.describeAudience(c),
    }));

  // A personal grant carries its own code, so it is listed separately and first —
  // it is the one the customer can actually type without remembering anything.
  const personal = grants.map((g) => ({
    code: g.code,
    label: g.label,
    description: g.label,
    type: g.type,
    value: g.value,
    minOrderValue: g.minOrder || 0,
    validUntil: g.expiresAt,
    used: 0,
    usageLimit: 1,
    personal: true,
    audience: g.audienceAtIssue || '',
  }));

  res.status(200).json({
    success: true,
    coupons: [...personal, ...offers],
  });
});

/**
 * Claim a completed stamp set for its voucher code.
 *
 * The customer-facing half of the stamp loop. Stamps that crossed the threshold
 * while a bill was settling are converted automatically, so this is for the
 * card that reached the threshold any other way — a manager's goodwill
 * adjustment, or a programme switched on after the stamps were already earned.
 * The response carries the voucher so the app can show the code straight away;
 * from there it is spent at the till or typed in at the table.
 */
const claimMyReward = asyncHandler(async (req, res) => {
  const { voucher, card } = await loyaltyService.claimReward({
    cafeId: req.customer.cafeId,
    customerId: req.customer._id,
  });

  res.status(200).json({
    success: true,
    voucher: {
      code: voucher.code,
      label: voucher.label,
      type: voucher.type,
      value: voucher.value,
      expiresAt: voucher.expiresAt,
    },
    stamps: card.stamps,
    lifetimeStamps: card.lifetimeStamps,
  });
});

module.exports = {
  getMyLoyalty,
  claimMyReward,
  getMyWallet,
  getMyWallets,
  getMyScratchCards,
  revealMyScratchCard,
  getMyCoupons,
};

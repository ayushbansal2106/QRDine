const LoyaltyProgram = require('../models/LoyaltyProgram');
const LoyaltyCard = require('../models/LoyaltyCard');
const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const loyaltyService = require('../services/loyaltyService');
const resolveGuestToken = require('../utils/resolveGuestToken');

// 1. Get the cafe's loyalty program
const getProgram = asyncHandler(async (req, res) => {
  const program = await loyaltyService.getProgram(req.cafeId);
  res.status(200).json({ success: true, program: program || null });
});

// 2. Create / update the loyalty program (one per cafe)
const upsertProgram = asyncHandler(async (req, res) => {
  const program = await LoyaltyProgram.findOneAndUpdate(
    { cafeId: req.cafeId },
    { $set: { ...req.body, cafeId: req.cafeId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.status(200).json({ success: true, message: 'Loyalty program saved', program });
});

// 3. List loyalty cards (with customer details)
const getCards = asyncHandler(async (req, res) => {
  const { page = 1, limit = 25, search } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = { cafeId: req.cafeId };

  const [cards, totalCount] = await Promise.all([
    LoyaltyCard.find(filter)
      .populate('customerId', 'name phone email visitCount lifetimeSpend')
      .sort({ lastStampAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    LoyaltyCard.countDocuments(filter),
  ]);

  let filtered = cards;
  if (search) {
    const term = String(search).toLowerCase();
    filtered = cards.filter((c) => {
      const customer = c.customerId;
      if (!customer) return false;
      return (
        (customer.name || '').toLowerCase().includes(term) ||
        (customer.phone || '').toLowerCase().includes(term) ||
        (customer.email || '').toLowerCase().includes(term)
      );
    });
  }

  res.status(200).json({
    success: true,
    page: Number(page),
    limit: Number(limit),
    totalCount,
    totalPages: Math.ceil(totalCount / Number(limit)),
    cards: filtered,
  });
});

// 4. A single customer's card + program
const getCustomerCard = asyncHandler(async (req, res) => {
  const { customerId } = req.params;
  const summary = await loyaltyService.getCardSummary(req.cafeId, customerId);
  res.status(200).json({ success: true, ...(summary || { stamps: 0, vouchers: [] }) });
});

// 5. Manager stamp adjustment
const adjustCustomerStamps = asyncHandler(async (req, res) => {
  const { customerId } = req.params;
  const { delta, note = '' } = req.body;

  const card = await loyaltyService.adjustStamps({
    cafeId: req.cafeId,
    customerId,
    delta,
    note,
    staffName: req.user.name,
  });

  res.status(200).json({ success: true, message: 'Stamps adjusted', card });
});

// 6. Validate a reward voucher without consuming it
const validateVoucher = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const voucher = await loyaltyService.validateVoucher(req.cafeId, code);
  res.status(200).json({ success: true, voucher });
});

// 7. Redeem (consume) a reward voucher
const redeemVoucher = asyncHandler(async (req, res) => {
  const { code, orderId } = req.body;
  const voucher = await loyaltyService.redeemVoucher({
    cafeId: req.cafeId,
    code,
    orderId: orderId || null,
    staffId: req.user._id,
    staffName: req.user.name,
  });
  res.status(200).json({ success: true, message: 'Voucher redeemed', voucher });
});

// 8. Customer-facing: their own card via an active dining session guest token
const getMyCard = asyncHandler(async (req, res) => {
  const { sessionId } = req.query;

  const guestToken = resolveGuestToken(req);
  if (!guestToken) throw new AppError('Forbidden: Invalid or missing guest session token', 403);

  // Prefer the explicit session id; otherwise the guest token itself identifies
  // the session (the token is unique per dining session).
  const session = sessionId
    ? await DiningSession.findById(sessionId)
    : await DiningSession.findOne({ guestToken });
  if (!session) throw new AppError('Dining session not found', 404);

  if (session.guestToken !== guestToken) {
    throw new AppError('Forbidden: Invalid or missing guest session token', 403);
  }

  // Resolve the customer from any linked order in this session
  const order = await Order.findOne({ sessionId: session._id, customerId: { $ne: null } })
    .sort({ createdAt: -1 })
    .select('customerId');

  if (!order || !order.customerId) {
    return res.status(200).json({ success: true, card: null });
  }

  const summary = await loyaltyService.getCardSummary(session.cafeId, order.customerId);
  res.status(200).json({ success: true, card: summary });
});

module.exports = {
  getProgram,
  upsertProgram,
  getCards,
  getCustomerCard,
  adjustCustomerStamps,
  validateVoucher,
  redeemVoucher,
  getMyCard,
};

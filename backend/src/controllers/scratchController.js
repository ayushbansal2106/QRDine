const ScratchCampaign = require('../models/ScratchCampaign');
const ScratchCard = require('../models/ScratchCard');
const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const scratchService = require('../services/scratchService');
const resolveGuestToken = require('../utils/resolveGuestToken');

/** Resolve the customer behind a guest session token (throws if unauthorised). */
const resolveGuestCustomerId = async (req, sessionId) => {
  const guestToken = resolveGuestToken(req);
  if (!guestToken) throw new AppError('Forbidden: Invalid or missing guest session token', 403);

  const session = sessionId
    ? await DiningSession.findById(sessionId)
    : await DiningSession.findOne({ guestToken });
  if (!session) throw new AppError('Dining session not found', 404);
  if (session.guestToken !== guestToken) {
    throw new AppError('Forbidden: Invalid or missing guest session token', 403);
  }

  const order = await Order.findOne({ sessionId: session._id, customerId: { $ne: null } })
    .sort({ createdAt: -1 })
    .select('customerId');

  return { cafeId: session.cafeId, customerId: order ? order.customerId : null };
};

// 1. Get the cafe's scratch campaign
const getCampaign = asyncHandler(async (req, res) => {
  const campaign = await scratchService.getCampaign(req.cafeId);
  res.status(200).json({ success: true, campaign: campaign || null });
});

// 2. Create / update the campaign (one per cafe)
const upsertCampaign = asyncHandler(async (req, res) => {
  const campaign = await ScratchCampaign.findOneAndUpdate(
    { cafeId: req.cafeId },
    { $set: { ...req.body, cafeId: req.cafeId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.status(200).json({ success: true, message: 'Scratch campaign saved', campaign });
});

// 3. List issued/revealed cards (admin)
const listCards = asyncHandler(async (req, res) => {
  const { page = 1, limit = 25, status } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = { cafeId: req.cafeId };
  if (status) filter.status = status;

  const [cards, totalCount] = await Promise.all([
    ScratchCard.find(filter)
      .populate('customerId', 'name phone email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    ScratchCard.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    page: Number(page),
    limit: Number(limit),
    totalCount,
    totalPages: Math.ceil(totalCount / Number(limit)),
    cards,
  });
});

// 4. Admin: reveal a card on a customer's behalf (support / redeem at counter)
const revealCardAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { card, voucher } = await scratchService.revealCard({
    cafeId: req.cafeId,
    cardId: id,
    staffName: req.user.name,
  });

  res.status(200).json({ success: true, message: 'Card revealed', card, voucher });
});

// 5. Customer-facing: their own pending + recent cards
const getMyCards = asyncHandler(async (req, res) => {
  const { sessionId } = req.query;
  const { cafeId, customerId } = await resolveGuestCustomerId(req, sessionId);

  if (!customerId) {
    return res.status(200).json({ success: true, cards: [], pending: [] });
  }

  const cards = await ScratchCard.find({ cafeId, customerId })
    .sort({ createdAt: -1 })
    .limit(20);

  // Expire stale unrevealed cards on read
  const now = new Date();
  const pending = cards.filter((c) => c.status === 'issued' && (!c.expiresAt || c.expiresAt > now));

  res.status(200).json({
    success: true,
    cards,
    pending: pending.map((c) => ({ id: c._id, issuedAt: c.issuedAt, expiresAt: c.expiresAt })),
  });
});

// 6. Customer-facing: reveal one of their own cards
const revealMyCard = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { sessionId } = req.body;
  const { cafeId, customerId } = await resolveGuestCustomerId(req, sessionId);

  if (!customerId) {
    throw new AppError('Link a phone number to your order to scratch a card', 400);
  }

  const { card, voucher } = await scratchService.revealCard({
    cafeId,
    cardId: id,
    customerId,
    staffName: 'customer',
  });

  res.status(200).json({
    success: true,
    message: 'Card revealed',
    prize: card.prize,
    voucher: voucher ? { code: voucher.code, label: voucher.label, type: voucher.type, value: voucher.value } : null,
  });
});

module.exports = { getCampaign, upsertCampaign, listCards, revealCardAdmin, getMyCards, revealMyCard };

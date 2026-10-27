const ScratchCampaign = require('../models/ScratchCampaign');
const ScratchCard = require('../models/ScratchCard');
const AppError = require('../utils/AppError');
const loyaltyService = require('./loyaltyService');
const auditService = require('./auditService');
const socketService = require('./socketService');

/**
 * Module #16 — scratch cards.
 *
 * A card is issued on settlement when the campaign is live and the order meets
 * the minimum spend. The prize is drawn server-side at reveal time using the
 * configured weights, so odds are never sent to the client.
 */

const CARD_TTL_DAYS = 30;

const getCampaign = (cafeId) => ScratchCampaign.findOne({ cafeId });

const isCampaignLive = (campaign, now = new Date()) => {
  if (!campaign || !campaign.isActive) return false;
  if (campaign.startAt && now < campaign.startAt) return false;
  if (campaign.endAt && now > campaign.endAt) return false;
  return true;
};

/** Issue a scratch card for a settled order, subject to campaign limits. */
const maybeIssueCard = async ({ cafeId, customerId, orderId = null, amount = 0 }) => {
  if (!customerId) return null;

  const campaign = await getCampaign(cafeId);
  if (!isCampaignLive(campaign)) return null;
  if (campaign.eligibleMinSpend > 0 && Number(amount) < campaign.eligibleMinSpend) return null;

  if (campaign.maxCardsPerDay > 0) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const count = await ScratchCard.countDocuments({ cafeId, createdAt: { $gte: start, $lte: end } });
    if (count >= campaign.maxCardsPerDay) return null;
  }

  if (campaign.maxCardsPerCustomer > 0) {
    const count = await ScratchCard.countDocuments({ cafeId, customerId });
    if (count >= campaign.maxCardsPerCustomer) return null;
  }

  const card = await ScratchCard.create({
    cafeId,
    customerId,
    campaignId: campaign._id,
    orderId,
    status: 'issued',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + CARD_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  socketService.emitScratchIssued(cafeId, { customerId, cardId: card._id });

  return card;
};

const availablePrizes = (campaign) =>
  (campaign.prizes || []).filter((p) => p.weight > 0 && (p.stock === 0 || p.claimed < p.stock));

/** Weighted random draw over the available prize pool. */
const drawPrize = (campaign, random = Math.random) => {
  const pool = availablePrizes(campaign);
  if (pool.length === 0) return null;

  const total = pool.reduce((sum, p) => sum + (Number(p.weight) || 0), 0);
  if (total <= 0) return null;

  let roll = random() * total;
  for (const prize of pool) {
    roll -= Number(prize.weight) || 0;
    if (roll <= 0) {
      return { prize, index: campaign.prizes.indexOf(prize) };
    }
  }
  const fallback = pool[pool.length - 1];
  return { prize: fallback, index: campaign.prizes.indexOf(fallback) };
};

/** Reveal a card: draw the prize, decrement stock, and issue a voucher if won. */
const revealCard = async ({ cafeId, cardId, customerId = null, staffName = '' }) => {
  const card = await ScratchCard.findOne({ _id: cardId, cafeId });
  if (!card) throw new AppError('Scratch card not found', 404);
  if (card.status !== 'issued') throw new AppError('This card has already been revealed', 400);
  if (customerId && String(card.customerId) !== String(customerId)) {
    throw new AppError('Forbidden: this card does not belong to you', 403);
  }

  const campaign = await getCampaign(cafeId);
  const drawn = campaign ? drawPrize(campaign) : null;

  card.revealedAt = new Date();
  card.status = 'revealed';

  if (!drawn) {
    card.prize = { label: 'Better luck next time', type: 'none', value: 0, menuItemId: null };
    await card.save();
    return { card, voucher: null };
  }

  const { prize, index } = drawn;

  // Deplete finite stock atomically-safe within this request
  if (prize.stock > 0) {
    campaign.prizes[index].claimed = (campaign.prizes[index].claimed || 0) + 1;
    await campaign.save();
  }

  card.prize = {
    label: prize.label,
    type: prize.type,
    value: prize.value,
    menuItemId: prize.menuItemId || null,
  };

  let voucher = null;
  if (prize.type !== 'none') {
    voucher = await loyaltyService.issueVoucher({
      cafeId,
      customerId: card.customerId,
      label: prize.label || 'Scratch reward',
      type: prize.type,
      value: prize.value,
      menuItemId: prize.menuItemId || null,
      validDays: campaign.voucherValidDays || 15,
    });
    card.voucherCode = voucher.code;
  }

  await card.save();

  auditService
    .recordEvent({
      cafeId,
      type: 'scratch.revealed',
      entityType: 'ScratchCard',
      entityId: card._id,
      staffName,
      metadata: { prize: card.prize, voucherCode: card.voucherCode },
    })
    .catch((err) => console.error('Scratch audit write failed (non-blocking):', err.message));

  socketService.emitScratchRevealed(cafeId, {
    cardId: card._id,
    customerId: card.customerId,
    prize: card.prize,
  });

  return { card, voucher };
};

module.exports = { getCampaign, isCampaignLive, maybeIssueCard, drawPrize, revealCard, availablePrizes };

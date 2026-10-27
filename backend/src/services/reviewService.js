const Review = require('../models/Review');
const env = require('../config/env');
const Order = require('../models/Order');
const Cafe = require('../models/Cafe');
const AppError = require('../utils/AppError');
const geminiService = require('./geminiService');
const notificationService = require('./notificationService');
const qrService = require('./qrService');
const auditService = require('./auditService');
const socketService = require('./socketService');

/**
 * Module #18 — Smart review engine.
 *
 * Behavioural contract:
 *  - A rating of `cafe.review.minRatingForGoogle` or better is routed to a
 *    Google draft, generated from what the customer actually ordered. The
 *    customer copies it themselves; we never post to Google on their behalf.
 *  - Anything lower is kept private as actionable feedback and alerts a manager
 *    in real time. That is the whole point of the module: catch the unhappy
 *    customer before they write a public review.
 *  - With no `GOOGLE_API_KEY`, every AI path degrades to a template so the
 *    feature still works, just without AI.
 */

const RATING_TAGS = [
  'taste',
  'freshness',
  'portion',
  'temperature',
  'presentation',
  'staff_service',
  'wait_time',
  'cleanliness',
  'value_for_money',
  'ambience',
];

const round1 = (value) => Number(Number(value).toFixed(1));

const getReviewConfig = (cafe) => {
  const review = (cafe && cafe.review) || {};
  return {
    aiEnabled: Boolean(review.aiEnabled),
    googlePlaceId: review.googlePlaceId || '',
    googleReviewUrl: review.googleReviewUrl || '',
    minRatingForGoogle: Number(review.minRatingForGoogle) || 4,
    brandVoice: review.brandVoice || 'warm, concise, appreciative',
    promptDelayHours: Number(review.promptDelayHours) || 0,
    promptSampleRate: Number(review.promptSampleRate) || 100,
    autoSendLowRatingAlerts: review.autoSendLowRatingAlerts !== false,
  };
};

/** Plain-language description of an order, with no customer PII. */
const describeOrder = async (orderId) => {
  if (!orderId) return null;
  const order = await Order.findById(orderId)
    .select('orderNumber items orderType createdAt totalAmount')
    .lean();
  if (!order) return null;

  return {
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    totalAmount: order.totalAmount,
    items: (order.items || []).map((i) => `${i.quantity}x ${i.itemName}`),
    topItem: (order.items || []).reduce(
      (best, i) => (best && best.quantity >= i.quantity ? best : i),
      null
    ),
  };
};

const TEMPLATE_DRAFT = (order, tone) =>
  order && order.items.length
    ? `${tone} Just had ${order.items.slice(0, 3).join(', ')} at the cafe and it was exactly what I was after. Fresh, well made and worth the visit.`
    : `${tone} Great experience all round — the food came out hot and the service was quick.`;

const TEMPLATE_SUMMARY = (rating, comment) =>
  comment ? `Customer rated ${rating}/5: ${comment}` : `Customer rated ${rating}/5 with no written comment.`;

/** Persist AI output on the review, tolerating a no-key environment. */
const applyAiResult = async (review, { sentiment, themes, summary, draft, ownerReplyDraft, model, reason }) => {
  // Older documents (and lean/fixture objects) may not carry the `ai` subdoc;
  // initialise it rather than crashing a customer's rating.
  if (!review.ai) review.ai = { themes: [] };
  if (!Array.isArray(review.ai.themes)) review.ai.themes = [];

  review.ai.sentiment = sentiment || review.ai.sentiment;
  review.ai.themes = themes && themes.length ? themes.slice(0, 6) : review.ai.themes;
  review.ai.summary = summary || review.ai.summary;
  if (draft) review.ai.draft = draft;
  if (ownerReplyDraft) review.ai.ownerReplyDraft = ownerReplyDraft;
  review.ai.model = model || (geminiService.isEnabled() ? env.geminiModel : '');
  review.ai.generatedAt = new Date();
  review.ai.error = reason || '';
  if (draft) review.status = 'drafted';
  if (typeof review.save === 'function') await review.save();
  return review;
};

/**
 * Record a rating. Returns the review plus what the customer should be shown:
 * a Google deep link + AI draft for happy customers, or a thank-you for the
 * rest (their feedback goes straight to the manager).
 */
const submitRating = async ({
  cafeId,
  orderId = null,
  sessionId = null,
  customerId = null,
  rating,
  tags = [],
  comment = '',
}) => {
  const numericRating = Number(rating);
  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new AppError('rating must be a whole number between 1 and 5', 400);
  }

  const cafe = await Cafe.findById(cafeId).select('name review').lean();
  if (!cafe) throw new AppError('Cafe not found', 404);
  const config = getReviewConfig(cafe);

  const cleanTags = Array.isArray(tags)
    ? tags.filter((t) => RATING_TAGS.includes(t)).slice(0, 6)
    : [];

  // One rating per order keeps the prompt honest and blocks rating spam.
  if (orderId) {
    const existing = await Review.findOne({ cafeId, orderId });
    if (existing) {
      return {
        review: existing,
        alreadySubmitted: true,
        outcome: {
          visibility: existing.visibility,
          googleReviewUrl: config.googleReviewUrl || qrService.buildGoogleReviewUrl(config.googlePlaceId),
          draft: existing.ai.draft,
        },
      };
    }
  }

  const isPublicCandidate = numericRating >= config.minRatingForGoogle;

  const review = await Review.create({
    cafeId,
    orderId,
    sessionId,
    customerId,
    rating: numericRating,
    tags: cleanTags,
    comment: String(comment || '').slice(0, 2000),
    visibility: isPublicCandidate ? 'public_draft' : 'private_feedback',
  });

  // A freshly created document always has these; normalise defensively so the
  // notification/socket paths below never read through undefined.
  if (!review.ai) review.ai = { themes: [] };
  if (!Array.isArray(review.ai.themes)) review.ai.themes = [];
  if (!review.status) review.status = 'new';

  let draft = '';
  if (isPublicCandidate) {
    const order = await describeOrder(orderId);
    const result = await generateDraft({ review, order, config });
    draft = result.draft || '';
  }

  socketService.emitReviewReceived(cafeId, {
    id: review._id,
    rating: review.rating,
    visibility: review.visibility,
    status: review.status,
    hasDraft: Boolean(review.ai.draft),
    createdAt: review.createdAt,
  });

  if (!isPublicCandidate && config.autoSendLowRatingAlerts) {
    await notificationService.alertManagers({
      cafeId,
      cafeName: cafe.name,
      subject: `New ${numericRating}-star feedback`,
      body: `${cafe.name} received a ${numericRating}/5 rating.\n${review.comment || '(no comment)'}\nTags: ${cleanTags.join(', ') || 'none'}`,
      payload: { reviewId: review._id, rating: review.rating, tags: cleanTags },
    });
  }

  await auditService.recordEvent({
    cafeId,
    type: 'review.submitted',
    entityType: 'Review',
    entityId: review._id,
    amount: 0,
    metadata: { rating: review.rating, visibility: review.visibility, orderId: orderId ? String(orderId) : null },
  });

  return {
    review,
    alreadySubmitted: false,
    outcome: {
      visibility: review.visibility,
      googleReviewUrl: config.googleReviewUrl || qrService.buildGoogleReviewUrl(config.googlePlaceId),
      draft,
    },
  };
};

/** AI (or template) draft of a public Google review from the real order. */
const generateDraft = async ({ review, order = undefined, config: configOverride }) => {
  const resolvedOrder = order === undefined ? await describeOrder(review.orderId) : order;
  const cafe = await Cafe.findById(review.cafeId).select('name review').lean();
  const config = configOverride || getReviewConfig(cafe);

  if (!config.aiEnabled || !geminiService.isEnabled()) {
    const draft = TEMPLATE_DRAFT(resolvedOrder, config.brandVoice.split(',')[0].trim());
    await applyAiResult(review, {
      sentiment: review.rating >= 4 ? 'positive' : 'neutral',
      themes: review.tags,
      summary: TEMPLATE_SUMMARY(review.rating, review.comment),
      draft,
      reason: geminiService.isEnabled() ? 'ai_disabled_for_cafe' : 'ai_not_configured',
    });
    return { draft, source: 'template' };
  }

  const schema = geminiService.buildSchema({
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'mixed'], required: true },
    themes: { type: 'array', itemsType: 'string' },
    summary: { type: 'string', required: true },
    draft: { type: 'string', required: true },
  });

  const result = await geminiService.generateJson({
    system:
      'You write short, authentic Google reviews for a cafe on behalf of a satisfied customer. ' +
      'Use first person, 2-3 sentences, no hashtags, no emoji spam, no superlatives that sound fake, ' +
      'never invent dishes the customer did not order, and never include personal data.',
    prompt: [
      `Cafe: ${cafe.name}`,
      `Customer rating: ${review.rating}/5`,
      `Customer tags: ${review.tags.join(', ') || 'none'}`,
      `Customer comment: ${review.comment || '(none)'}`,
      `What they ordered: ${resolvedOrder ? resolvedOrder.items.join(', ') : 'unknown'}`,
      `Brand voice: ${config.brandVoice}`,
      'Return: sentiment, up to 3 short themes, a one-line internal summary, and the review draft.',
    ].join('\n'),
    schema,
  });

  if (!result.ok) {
    const draft = TEMPLATE_DRAFT(resolvedOrder, config.brandVoice.split(',')[0].trim());
    await applyAiResult(review, {
      sentiment: review.rating >= 4 ? 'positive' : 'neutral',
      themes: review.tags,
      summary: TEMPLATE_SUMMARY(review.rating, review.comment),
      draft,
      reason: result.reason,
    });
    return { draft, source: 'template', reason: result.reason };
  }

  const { sentiment, themes, summary, draft } = result.data;
  await applyAiResult(review, { sentiment, themes, summary, draft });
  return { draft, source: 'ai', sentiment, themes, summary };
};

/** AI draft of the owner's public reply to a review. */
const generateOwnerReply = async ({ review }) => {
  const cafe = await Cafe.findById(review.cafeId).select('name review').lean();
  const config = getReviewConfig(cafe);

  const fallback = (() => {
    if (review.rating >= 4) {
      return `Thank you so much for the kind words, and thank you for visiting ${cafe.name}. We would love to see you again soon!`;
    }
    return `Thank you for taking the time to tell us this. We are sorry we fell short of the experience you were hoping for, and we would like to make it right. Please reach out to us directly so our manager can look into it.`;
  })();

  if (!config.aiEnabled || !geminiService.isEnabled()) {
    await applyAiResult(review, { ownerReplyDraft: fallback, reason: geminiService.isEnabled() ? 'ai_disabled_for_cafe' : 'ai_not_configured' });
    return { reply: fallback, source: 'template' };
  }

  const result = await geminiService.generateText({
    system:
      'You write the cafe owner\'s public reply to a Google review. Stay in the owner\'s voice, ' +
      'acknowledge the specific experience, apologise sincerely when the rating is low without being defensive, ' +
      'offer a concrete next step, and keep it under 90 words. No hashtags.',
    prompt: [
      `Cafe: ${cafe.name}`,
      `Rating: ${review.rating}/5`,
      `Customer comment: ${review.comment || '(none)'}`,
      `Internal summary: ${review.ai.summary || 'not analysed yet'}`,
      `Detected themes: ${review.ai.themes.join(', ') || 'none'}`,
      `Brand voice: ${config.brandVoice}`,
    ].join('\n'),
  });

  if (!result.ok) {
    await applyAiResult(review, { ownerReplyDraft: fallback, reason: result.reason });
    return { reply: fallback, source: 'template', reason: result.reason };
  }

  await applyAiResult(review, { ownerReplyDraft: result.data });
  return { reply: result.data, source: 'ai' };
};

/** Manager dashboard roll-up: rating distribution, themes, response rate, AI digest. */
const summarize = async ({ cafeId, from, to }) => {
  const filter = { cafeId };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const reviews = await Review.find(filter).sort({ createdAt: -1 }).lean();

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const themeCounts = {};
  let totalRating = 0;
  let answered = 0;

  for (const r of reviews) {
    distribution[r.rating] = (distribution[r.rating] || 0) + 1;
    totalRating += r.rating;
    if (r.ownerReply) answered += 1;
    for (const theme of [...(r.tags || []), ...((r.ai && r.ai.themes) || [])]) {
      themeCounts[theme] = (themeCounts[theme] || 0) + 1;
    }
  }

  const lowRatings = reviews.filter((r) => r.rating <= 2).slice(0, 10);
  const recent = reviews.slice(0, 20);

  let digest = '';
  if (lowRatings.length && geminiService.isEnabled()) {
    const cafe = await Cafe.findById(cafeId).select('name review').lean();
    const config = getReviewConfig(cafe);
    if (config.aiEnabled) {
      const result = await geminiService.generateText({
        system:
          'You are a cafe operations analyst. Summarise the recurring problems in these low customer ' +
          'ratings in at most 4 bullet points, then give one concrete operational action. ' +
          'Do not include customer names or contact details.',
        prompt: [
          `Cafe: ${cafe.name}`,
          ...lowRatings.map(
            (r) => `- ${r.rating}/5 ${r.comment || '(no comment)'} [tags: ${(r.tags || []).join(', ') || 'none'}]`
          ),
        ].join('\n'),
      });
      if (result.ok) digest = result.data;
    }
  }

  return {
    total: reviews.length,
    averageRating: reviews.length ? round1(totalRating / reviews.length) : 0,
    distribution,
    topThemes: Object.entries(themeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([theme, count]) => ({ theme, count })),
    responseRate: reviews.length ? round1((answered / reviews.length) * 100) : 0,
    privateFeedbackCount: reviews.filter((r) => r.visibility === 'private_feedback').length,
    pendingActionCount: reviews.filter((r) => r.status === 'new' || r.status === 'drafted').length,
    aiDigest: digest,
    recent: recent.map((r) => ({
      id: r._id,
      rating: r.rating,
      comment: r.comment,
      tags: r.tags,
      visibility: r.visibility,
      status: r.status,
      createdAt: r.createdAt,
    })),
  };
};

module.exports = {
  RATING_TAGS,
  getReviewConfig,
  submitRating,
  generateDraft,
  generateOwnerReply,
  summarize,
  describeOrder,
};

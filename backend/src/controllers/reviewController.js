const Review = require('../models/Review');
const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');
const Cafe = require('../models/Cafe');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const reviewService = require('../services/reviewService');
const geminiService = require('../services/geminiService');
const qrService = require('../services/qrService');
const auditService = require('../services/auditService');
const resolveGuestToken = require('../utils/resolveGuestToken');

/**
 * Module #18 — review capture + manager inbox.
 *
 * Two audiences:
 *  - The customer, at the table: `POST /api/reviews` is scoped by the dining
 *    session's guest token (the same cookie the order flow already uses), so a
 *    rating can never be posted against somebody else's bill.
 *  - The manager: everything else is tenant-scoped and permission-gated.
 */

const isValidObjectId = (value) => /^[a-fA-F0-9]{24}$/.test(String(value));

/** Customer-facing: submit a rating for an order in one of your own sessions. */
const submitRating = asyncHandler(async (req, res) => {
  const { orderId, rating, tags, comment } = req.body || {};

  if (!orderId || !isValidObjectId(orderId)) {
    throw new AppError('A valid orderId is required', 400);
  }

  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Order not found', 404);

  const guestToken = resolveGuestToken(req);
  let session = null;

  if (guestToken) {
    session = await DiningSession.findOne({ guestToken });
  }

  // A guest token must belong to the session this order was placed in. Staff can
  // also record a rating on the customer's behalf (handled by the admin route).
  if (session) {
    const sessionId = order.sessionId ? String(order.sessionId) : null;
    if (sessionId && sessionId !== String(session._id)) {
      throw new AppError('This order does not belong to your session', 403);
    }
  } else if (req.user && String(req.user.cafeId) === String(order.cafeId)) {
    // Staff-entered rating for a walk-in order.
  } else {
    throw new AppError('A valid guest session token is required to rate this order', 403);
  }

  const result = await reviewService.submitRating({
    cafeId: order.cafeId,
    orderId: order._id,
    sessionId: order.sessionId,
    customerId: order.customerId,
    rating,
    tags,
    comment,
  });

  res.status(201).json({
    success: true,
    alreadySubmitted: result.alreadySubmitted,
    visibility: result.outcome.visibility,
    googleReviewUrl: result.outcome.googleReviewUrl,
    draft: result.outcome.draft,
    message:
      result.outcome.visibility === 'public_draft'
        ? 'Thanks! Here is a review you can post — we only ever suggest, you decide what to publish.'
        : 'Thanks — your feedback went straight to the cafe manager.',
  });
});

/** Manager inbox. */
const listReviews = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const filter = { cafeId: req.cafeId };
  if (req.query.visibility) filter.visibility = req.query.visibility;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.rating) filter.rating = Number(req.query.rating);
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const [reviews, totalCount] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('customerId', 'name phone')
      .populate('orderId', 'orderNumber totalAmount'),
    Review.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    page,
    limit,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    reviews,
  });
});

const getSummary = asyncHandler(async (req, res) => {
  const summary = await reviewService.summarize({
    cafeId: req.cafeId,
    from: req.query.from,
    to: req.query.to,
  });
  res.status(200).json({ success: true, summary });
});

const getReview = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, cafeId: req.cafeId });
  if (!review) throw new AppError('Review not found', 404);
  res.status(200).json({ success: true, review });
});

/** Re-run (or first run) the AI draft for a public-candidate review. */
const draftReview = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, cafeId: req.cafeId });
  if (!review) throw new AppError('Review not found', 404);

  const result = await reviewService.generateDraft({ review });
  res.status(200).json({ success: true, draft: result.draft, source: result.source, review });
});

/** Generate an owner reply draft. */
const draftReply = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, cafeId: req.cafeId });
  if (!review) throw new AppError('Review not found', 404);

  const result = await reviewService.generateOwnerReply({ review });
  res.status(200).json({ success: true, reply: result.reply, source: result.source, review });
});

/** Publish the reply the manager actually typed. */
const publishReply = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, cafeId: req.cafeId });
  if (!review) throw new AppError('Review not found', 404);

  const reply = String((req.body || {}).reply || review.ai.ownerReplyDraft || '').trim();
  if (!reply) throw new AppError('reply text is required', 400);

  review.ownerReply = reply.slice(0, 2000);
  review.repliedAt = new Date();
  review.repliedBy = req.user._id;
  review.status = 'acknowledged';
  await review.save();

  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'review.replied',
    entityType: 'Review',
    entityId: review._id,
    staffId: req.user._id,
    staffName: req.user.name || '',
    metadata: { rating: review.rating },
  });

  res.status(200).json({ success: true, review });
});

/** Triage: status + internal note. */
const updateReview = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, cafeId: req.cafeId });
  if (!review) throw new AppError('Review not found', 404);

  const body = req.body || {};
  if (body.status) {
    const allowed = ['new', 'drafted', 'acknowledged', 'actioned', 'dismissed'];
    if (!allowed.includes(body.status)) throw new AppError('Invalid review status', 400);
    review.status = body.status;
  }
  if (body.internalNote !== undefined) review.internalNote = String(body.internalNote).slice(0, 2000);
  if (body.published !== undefined) {
    review.published = Boolean(body.published);
    review.publishedAt = review.published ? new Date() : null;
  }

  await review.save();
  res.status(200).json({ success: true, review });
});

// --- Review settings (Cafe.review) ------------------------------------------

const getSettings = asyncHandler(async (req, res) => {
  const cafe = await Cafe.findById(req.cafeId).select('name review').lean();
  if (!cafe) throw new AppError('Cafe not found', 404);

  // A cafe created before Module #18 has no `review` subdocument at all, so
  // read through getReviewConfig (which supplies defaults) rather than
  // dereferencing cafe.review directly.
  const config = reviewService.getReviewConfig(cafe);

  res.status(200).json({
    success: true,
    settings: config,
    googleReviewUrl:
      config.googleReviewUrl || qrService.buildGoogleReviewUrl(config.googlePlaceId),
    availableTags: reviewService.RATING_TAGS,
    ai: { configured: geminiService.isConfigured(), enabled: config.aiEnabled },
  });
});

const updateSettings = asyncHandler(async (req, res) => {
  const cafe = await Cafe.findById(req.cafeId);
  if (!cafe) throw new AppError('Cafe not found', 404);

  const body = req.body || {};
  const review = cafe.review || {};

  if (body.googlePlaceId !== undefined) review.googlePlaceId = String(body.googlePlaceId).trim();
  if (body.googleReviewUrl !== undefined) review.googleReviewUrl = String(body.googleReviewUrl).trim();
  if (body.aiEnabled !== undefined) review.aiEnabled = Boolean(body.aiEnabled);
  if (body.minRatingForGoogle !== undefined) {
    const min = Number(body.minRatingForGoogle);
    if (!(min >= 1 && min <= 5)) throw new AppError('minRatingForGoogle must be between 1 and 5', 400);
    review.minRatingForGoogle = min;
  }
  if (body.brandVoice !== undefined) review.brandVoice = String(body.brandVoice).slice(0, 200);
  if (body.promptSampleRate !== undefined) review.promptSampleRate = Math.min(100, Math.max(1, Number(body.promptSampleRate) || 100));
  if (body.autoSendLowRatingAlerts !== undefined) review.autoSendLowRatingAlerts = Boolean(body.autoSendLowRatingAlerts);

  cafe.review = review;
  await cafe.save();

  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'review.settings_updated',
    entityType: 'Cafe',
    entityId: req.cafeId,
    staffId: req.user._id,
    staffName: req.user.name || '',
    metadata: { aiEnabled: review.aiEnabled, minRatingForGoogle: review.minRatingForGoogle },
  });

  res.status(200).json({ success: true, settings: cafe.review });
});

module.exports = {
  submitRating,
  listReviews,
  getSummary,
  getReview,
  draftReview,
  draftReply,
  publishReply,
  updateReview,
  getSettings,
  updateSettings,
};
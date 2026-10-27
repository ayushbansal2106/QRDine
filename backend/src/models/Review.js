const mongoose = require('mongoose');

/**
 * Module #18 — Smart review engine.
 *
 * One collection holds the full loop:
 *   rating captured at the table  →  AI draft (Google copy) or private feedback
 *   →  manager triage  →  published reply.
 *
 * `visibility` decides the routing: anything below the cafe's
 * `review.minRatingForGoogle` stays internal as actionable feedback; higher
 * ratings are drafted for Google. The AI never sees customer PII — drafts are
 * built from order contents and the cafe's brand voice only.
 */
const reviewSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DiningSession',
      default: null,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    // What the customer selected as the reason (multi-select, controlled vocabulary).
    tags: {
      type: [String],
      default: [],
    },
    // Free text. For a low rating this is the private feedback record.
    comment: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
    },
    visibility: {
      type: String,
      enum: ['public_draft', 'private_feedback'],
      default: 'private_feedback',
    },
    status: {
      type: String,
      enum: ['new', 'drafted', 'acknowledged', 'actioned', 'dismissed'],
      default: 'new',
    },
    // AI output (Module #18)
    ai: {
      sentiment: { type: String, enum: ['positive', 'neutral', 'negative', 'mixed', null], default: null },
      themes: { type: [String], default: [] },
      summary: { type: String, default: '' },
      suggestedAction: { type: String, default: '' },
      draft: { type: String, default: '' },
      ownerReplyDraft: { type: String, default: '' },
      model: { type: String, default: '' },
      generatedAt: { type: Date, default: null },
      error: { type: String, default: '' },
    },
    // Manager actions
    published: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    ownerReply: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    repliedAt: {
      type: Date,
      default: null,
    },
    repliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    internalNote: {
      type: String,
      default: '',
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
  }
);

reviewSchema.index({ cafeId: 1 });
reviewSchema.index({ cafeId: 1, createdAt: -1 });
reviewSchema.index({ cafeId: 1, rating: 1, createdAt: -1 });
reviewSchema.index({ cafeId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ cafeId: 1, visibility: 1 });
reviewSchema.index({ cafeId: 1, orderId: 1 });

module.exports = mongoose.model('Review', reviewSchema);

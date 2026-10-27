const mongoose = require('mongoose');

/**
 * AI menu digitisation (Module #19).
 *
 * A job holds the uploaded menu photos, the AI-extracted draft, and its
 * lifecycle. Nothing is written to the live `Category` / `MenuItem` collections
 * until the owner reviews the draft and explicitly publishes it — AI misreads
 * prices, so the draft is never auto-applied.
 *
 *   pending → processing → awaiting_review → published
 *                          ↘ failed
 */
const menuImportJobSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    status: {
      type: String,
      enum: ['pending', 'processing', 'awaiting_review', 'published', 'failed'],
      default: 'pending',
    },

    /** Source menu photographs, as returned by the upload endpoint. */
    sourceImages: [
      {
        url: { type: String, required: true },
        publicId: { type: String, default: null },
        addedAt: { type: Date, default: Date.now },
      },
    ],

    /**
     * The AI-extracted menu, awaiting owner review.
     *   { categories: [{ name, items: [{ name, description, price, ... }] }] }
     * Kept as Mixed because it is an intermediate review artefact, not a
     * domain entity — it is validated and mapped into Category/MenuItem on
     * publish rather than being queried directly.
     */
    draft: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    stats: {
      imageCount: { type: Number, default: 0 },
      categoryCount: { type: Number, default: 0 },
      itemCount: { type: Number, default: 0 },
      variantCount: { type: Number, default: 0 },
      /** Items we could not confidently price — surfaced for owner attention. */
      unpricedCount: { type: Number, default: 0 },
      /** Items matched to the bundled dish-image library. */
      imageMatchedCount: { type: Number, default: 0 },
    },

    /** Why digitisation failed, when status is `failed`. */
    error: {
      code: { type: String, default: null },
      message: { type: String, default: null },
    },

    /** Audit trail of what was actually created, so publish is idempotent. */
    publishedResult: {
      createdCategories: { type: [String], default: [] },
      createdItems: { type: Number, default: 0 },
      skippedItems: { type: Number, default: 0 },
      publishedAt: { type: Date, default: null },
    },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

menuImportJobSchema.index({ cafeId: 1, createdAt: -1 });
menuImportJobSchema.index({ cafeId: 1, status: 1 });

module.exports = mongoose.model('MenuImportJob', menuImportJobSchema);
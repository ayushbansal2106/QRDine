const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const menuDigitizationService = require('../services/menuDigitizationService');
const MenuImportJob = require('../models/MenuImportJob');
const { DISH_LIBRARY, LIBRARY_SIZE } = require('../data/dishImageLibrary');

/** Shape a job for the client — strips the large inline draft internals. */
const present = (job) => ({
  id: job._id,
  status: job.status,
  stats: job.stats,
  error: job.error,
  sourceImages: job.sourceImages,
  draft: job.draft,
  publishedResult: job.publishedResult,
  createdAt: job.createdAt,
  completedAt: job.completedAt,
});

/**
 * POST /api/menu/digitize
 * Accepts previously-uploaded image URLs, runs extraction, returns the draft.
 */
const digitize = asyncHandler(async (req, res) => {
  const images = Array.isArray(req.body.images) ? req.body.images : [];

  const job = await menuDigitizationService.digitizeMenu({
    cafeId: req.cafeId,
    userId: req.user._id,
    images,
  });

  // A failed job is a normal outcome (no key, unreadable photo), reported with
  // 422 so the UI can show the reason without treating it as a server fault.
  if (job.status === 'failed') {
    return res.status(422).json({
      success: false,
      message: job.error?.message || 'Menu scanning failed.',
      code: job.error?.code || 'digitisation_failed',
      job: present(job),
    });
  }

  res.status(200).json({
    success: true,
    message: `Extracted ${job.stats.itemCount} items across ${job.stats.categoryCount} categories.`,
    job: present(job),
  });
});

/** GET /api/menu/digitize/jobs */
const listJobs = asyncHandler(async (req, res) => {
  const jobs = await MenuImportJob.find({ cafeId: req.cafeId })
    .sort({ createdAt: -1 })
    .limit(20);

  res.status(200).json({ success: true, jobs: jobs.map(present) });
});

/** GET /api/menu/digitize/jobs/:id */
const getJob = asyncHandler(async (req, res) => {
  const job = await MenuImportJob.findOne({ _id: req.params.id, cafeId: req.cafeId });
  if (!job) throw new AppError('Digitisation job not found', 404);
  res.status(200).json({ success: true, job: present(job) });
});

/**
 * PUT /api/menu/digitize/jobs/:id/draft
 * Persist owner edits made during review.
 */
const updateDraft = asyncHandler(async (req, res) => {
  const job = await MenuImportJob.findOne({ _id: req.params.id, cafeId: req.cafeId });
  if (!job) throw new AppError('Digitisation job not found', 404);
  if (job.status === 'published') {
    throw new AppError('This job has already been published', 400);
  }

  const draft = req.body.draft;
  if (!draft || !Array.isArray(draft.categories)) {
    throw new AppError('draft.categories must be an array', 400);
  }

  const normalised = menuDigitizationService.normaliseDraft(draft);
  job.draft = { categories: normalised.categories };
  job.stats = { ...job.stats, ...normalised.stats };
  if (job.status === 'failed' && normalised.categories.length > 0) {
    job.status = 'awaiting_review';
    job.error = { code: null, message: null };
  }
  await job.save();

  res.status(200).json({ success: true, job: present(job) });
});

/**
 * POST /api/menu/digitize/jobs/:id/publish
 * Write the reviewed draft into the live menu.
 */
const publish = asyncHandler(async (req, res) => {
  const { result, alreadyPublished } = await menuDigitizationService.publishDraft({
    cafeId: req.cafeId,
    jobId: req.params.id,
    draft: req.body.draft,
    userId: req.user._id,
  });

  res.status(200).json({
    success: true,
    alreadyPublished,
    message: alreadyPublished
      ? 'This menu was already published.'
      : `Published ${result.createdItems} item${result.createdItems === 1 ? '' : 's'}.` +
        (result.skippedItems ? ` Skipped ${result.skippedItems} duplicate or unpriced.` : '') +
        (result.failedItems && result.failedItems.length
          ? ` ${result.failedItems.length} could not be saved: ${result.failedItems
              .slice(0, 3)
              .map((f) => f.name)
              .join(', ')}${result.failedItems.length > 3 ? '…' : ''}.`
          : ''),
    result,
  });
});

/**
 * GET /api/menu/dish-library
 * The curated dish-image vocabulary, so the UI can show what is available.
 */
const listDishLibrary = asyncHandler(async (req, res) => {
  const entries = Object.entries(DISH_LIBRARY).map(([name, meta]) => ({ name, ...meta }));
  res.status(200).json({ success: true, count: entries.length, entries });
});

module.exports = {
  digitize,
  listJobs,
  getJob,
  updateDraft,
  publish,
  listDishLibrary,
  LIBRARY_SIZE,
};
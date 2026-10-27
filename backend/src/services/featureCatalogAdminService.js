const FeatureCatalog = require('../models/FeatureCatalog');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { FEATURE_METADATA } = require('../config/plans');
const { loadCatalog, clearCachedCatalog } = require('./featureCatalogService');

const knownFeatureKeys = Object.keys(FEATURE_METADATA);

/** Mongoose returns a Map on a hydrated document and a plain object on lean. */
const toPlainObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === 'function') return value.toObject();
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return { ...value };
};

const sanitizeCatalog = (row) => {
  const features = toPlainObject(row?.features);
  const blocked = toPlainObject(row?.blocked);

  const out = {};
  const outBlocked = {};
  for (const key of knownFeatureKeys) {
    out[key] = Boolean(features[key]);
    outBlocked[key] = Boolean(blocked[key]);
  }

  return {
    id: row?._id?.toString() || null,
    features: out,
    blocked: outBlocked,
    createdAt: row?.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
};

/**
 * The feature registry, so the interface can label and group the rows.
 *
 * The saved catalog is a pair of maps keyed by feature key; without the
 * registry the client would have to hard-code the labels, and a feature
 * added to `config/plans.js` would show up as a bare key — or not at all.
 */
const featureRegistry = () =>
  knownFeatureKeys.map((key) => ({
    key,
    label: FEATURE_METADATA[key].label,
    group: FEATURE_METADATA[key].group,
    description: FEATURE_METADATA[key].description || '',
    core: Boolean(FEATURE_METADATA[key].core),
  }));

const getCatalogRaw = asyncHandler(async (req, res) => {
  const catalog = await loadCatalog();
  res.status(200).json({
    success: true,
    exists: catalog.exists,
    catalog: catalog.exists ? sanitizeCatalog(catalog.row) : null,
    registry: featureRegistry(),
  });
});

/**
 * The global availability override.
 *
 * Two independent maps, and they are not the same control:
 *  - `features` — platform-wide *grant* (rollout).
 *  - `blocked`  — platform-wide *block* (emergency switch-off).
 *
 * A block wins over a plan entitlement: the plan matrix cannot re-open a
 * globally blocked module.
 */
const upsertCatalog = asyncHandler(async (req, res) => {
  const { features, blocked } = req.body || {};

  if (!features || typeof features !== 'object') {
    throw new AppError('features must be an object.', 400);
  }

  const parsed = {};
  for (const key of knownFeatureKeys) {
    parsed[key] = Boolean(features[key]);
  }

  const parsedBlocked = {};
  if (blocked !== undefined) {
    if (!blocked || typeof blocked !== 'object' || Array.isArray(blocked)) {
      throw new AppError('blocked must be an object.', 400);
    }
    for (const key of knownFeatureKeys) {
      parsedBlocked[key] = Boolean(blocked[key]);
    }
  }

  let row = await FeatureCatalog.findOne();
  if (!row) {
    row = await FeatureCatalog.create({
      features: parsed,
      blocked: parsedBlocked,
    });
  } else {
    row.features = parsed;
    if (blocked !== undefined) row.blocked = parsedBlocked;
    await row.save();
  }

  await clearCachedCatalog();
  res.status(200).json({
    success: true,
    message: row.isNew ? 'Feature catalog created.' : 'Feature catalog updated.',
    catalog: sanitizeCatalog(row),
  });
});

module.exports = {
  getCatalogRaw,
  upsertCatalog,
  sanitizeCatalog,
  knownFeatureKeys,
};

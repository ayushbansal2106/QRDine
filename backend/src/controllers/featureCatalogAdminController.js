const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const {
  getCatalogRaw,
  upsertCatalog,
  sanitizeCatalog,
} = require('../services/featureCatalogAdminService');

const getCatalog = asyncHandler(async (req, res) => {
  const catalog = await getCatalogRaw(req, res);
  if (!catalog || !catalog.success) {
    throw new AppError('Failed to load feature catalog.', 500);
  }
  return catalog;
});

const upsertCatalogHandler = asyncHandler(async (req, res) => {
  const catalog = await upsertCatalog(req, res);
  if (!catalog || !catalog.success) {
    throw new AppError('Failed to save feature catalog.', 500);
  }
  return catalog;
});

module.exports = {
  getCatalog,
  upsertCatalog: upsertCatalogHandler,
  sanitizeCatalog,
};

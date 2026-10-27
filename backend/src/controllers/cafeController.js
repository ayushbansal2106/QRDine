const mongoose = require('mongoose');
const Cafe = require('../models/Cafe');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const orderService = require('../services/orderService');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

// 1. Get cafe profile
const getCafe = asyncHandler(async (req, res) => {
  const cafe = await Cafe.findById(req.cafeId);

  if (!cafe) {
    throw new AppError('Cafe not found', 404);
  }

  res.status(200).json({
    success: true,
    cafe,
  });
});

/**
 * Public café profile for the QR menu screen.
 *
 * A guest scanning a table QR has no session, so every authenticated cafe
 * endpoint is closed to them — yet the menu header is expected to name the
 * café. This returns ONLY display fields. Deliberately excluded: phone, email,
 * GST/tax identifiers, billing, subscription state and anything else in the
 * Cafe document that is not on a shop front.
 *
 * No rating is exposed. Reviews default to `visibility: 'private_feedback'`,
 * so averaging them here would publish private sentiment; the header renders
 * its rating chip only from genuinely public ratings when that data exists.
 */
const getCafePublic = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;

  if (!isValidObjectId(cafeId)) {
    throw new AppError('Cafe not found', 404);
  }

  const cafe = await Cafe.findById(cafeId)
    .select('name legalName tradeName fssaiNumber gstin logo address')
    .lean();

  if (!cafe) {
    throw new AppError('Cafe not found', 404);
  }

  res.status(200).json({
    success: true,
    cafe: {
      name: cafe.name || '',
      legalName: cafe.legalName || cafe.name || '',
      tradeName: cafe.tradeName || cafe.name || '',
      fssaiNumber: cafe.fssaiNumber || '',
      gstin: cafe.gstin || '',
      logo: cafe.logo || '',
      address: cafe.address || '',
    },
  });
});

/**
 * Public operational and ordering status for QR diners (CUS-015).
 */
const getCafeOperationalStatus = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;

  if (!isValidObjectId(cafeId)) {
    throw new AppError('Cafe not found', 404);
  }

  const cafe = await Cafe.findById(cafeId)
    .select('isOrderingPaused orderingPausedReason operatingHours timezone')
    .lean();

  if (!cafe) {
    throw new AppError('Cafe not found', 404);
  }

  const hoursCheck = orderService.checkOperatingHours(cafe.operatingHours, cafe.timezone);

  res.status(200).json({
    success: true,
    isOrderingPaused: Boolean(cafe.isOrderingPaused),
    orderingPausedReason: cafe.orderingPausedReason || '',
    isOpen: !cafe.isOrderingPaused && hoursCheck.isOpen,
    reason: cafe.isOrderingPaused
      ? (cafe.orderingPausedReason || 'Cafe is currently not accepting orders')
      : (hoursCheck.isOpen ? '' : hoursCheck.reason),
    operatingHours: cafe.operatingHours || { enabled: false },
  });
});

// 2. Update cafe profile
const updateCafe = asyncHandler(async (req, res) => {
  const { name, address, phone, email, logo, isOrderingPaused, orderingPausedReason, operatingHours } = req.body;

  const cafe = await Cafe.findById(req.cafeId);

  if (!cafe) {
    throw new AppError('Cafe not found', 404);
  }

  if (name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new AppError('Cafe name is required and must be a non-empty string', 400);
    }
    cafe.name = name.trim();
  }

  if (address !== undefined) {
    cafe.address = address.trim();
  }

  if (phone !== undefined) {
    cafe.phone = phone.trim();
  }

  if (email !== undefined) {
    cafe.email = email.trim().toLowerCase();
  }

  if (logo !== undefined) {
    cafe.logo = logo.trim();
  }

  if (isOrderingPaused !== undefined) {
    cafe.isOrderingPaused = Boolean(isOrderingPaused);
  }

  if (orderingPausedReason !== undefined) {
    cafe.orderingPausedReason = typeof orderingPausedReason === 'string'
      ? orderingPausedReason.trim()
      : '';
  }

  if (operatingHours !== undefined && typeof operatingHours === 'object' && operatingHours !== null) {
    cafe.operatingHours = {
      enabled: operatingHours.enabled !== undefined ? Boolean(operatingHours.enabled) : (cafe.operatingHours?.enabled ?? false),
      openTime: operatingHours.openTime ? String(operatingHours.openTime).trim() : (cafe.operatingHours?.openTime || '00:00'),
      closeTime: operatingHours.closeTime ? String(operatingHours.closeTime).trim() : (cafe.operatingHours?.closeTime || '23:59'),
      days: Array.isArray(operatingHours.days) ? operatingHours.days : (cafe.operatingHours?.days || [0, 1, 2, 3, 4, 5, 6]),
    };
  }

  // Statutory Compliance & Registration (Form A)
  const { legalName, tradeName, gstin, fssaiNumber, taxMode } = req.body;
  if (legalName !== undefined) {
    cafe.legalName = String(legalName).trim();
  }
  if (tradeName !== undefined) {
    cafe.tradeName = String(tradeName).trim();
  }
  if (gstin !== undefined) {
    const trimmedGstin = String(gstin).trim().toUpperCase();
    if (trimmedGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(trimmedGstin)) {
      throw new AppError('Invalid GSTIN format (must be 15 alphanumeric characters)', 400);
    }
    cafe.gstin = trimmedGstin;
  }
  if (fssaiNumber !== undefined) {
    const trimmedFssai = String(fssaiNumber).trim();
    if (trimmedFssai && !/^\d{14}$/.test(trimmedFssai)) {
      throw new AppError('Invalid FSSAI registration number (must be exactly 14 digits)', 400);
    }
    cafe.fssaiNumber = trimmedFssai;
  }
  if (taxMode !== undefined) {
    if (!['composite_5', 'regular_18', 'exempt'].includes(taxMode)) {
      throw new AppError('Invalid taxMode. Must be composite_5, regular_18, or exempt', 400);
    }
    cafe.taxMode = taxMode;
  }

  await cafe.save();

  res.status(200).json({
    success: true,
    message: 'Cafe profile updated successfully',
    cafe,
  });
});

module.exports = {
  getCafe,
  getCafePublic,
  getCafeOperationalStatus,
  updateCafe,
};

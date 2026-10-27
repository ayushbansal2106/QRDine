const Coupon = require('../models/Coupon');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const couponService = require('../services/couponService');
const segmentService = require('../services/segmentService');
const CouponGrant = require('../models/CouponGrant');
const { round2 } = require('../services/orderService');

// 1. List coupons for the cafe
const getCoupons = asyncHandler(async (req, res) => {
  const { active, search } = req.query;
  const filter = { cafeId: req.cafeId };

  if (active !== undefined) filter.isActive = active !== 'false';
  if (search) {
    filter.code = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  const coupons = await Coupon.find(filter).sort({ createdAt: -1 });

  res.status(200).json({ success: true, coupons });
});

// 2. Create a coupon
const createCoupon = asyncHandler(async (req, res) => {
  const {
    code,
    description,
    type,
    value,
    minOrder,
    maxDiscount,
    appliesTo,
    audience,
    autoIssue,
    validFrom,
    validTo,
    happyHour,
    singleUse,
    usageLimit,
    perCustomerLimit,
    isActive,
  } = req.body;

  const normalized = couponService.normalizeCode(code);
  if (!normalized) throw new AppError('code is required', 400);
  if (!['percent', 'flat'].includes(type)) throw new AppError('type must be "percent" or "flat"', 400);
  if (!(Number(value) > 0)) throw new AppError('value must be greater than 0', 400);
  if (type === 'percent' && Number(value) > 100) throw new AppError('A percent coupon cannot exceed 100%', 400);

  const existing = await Coupon.findOne({ cafeId: req.cafeId, code: normalized });
  if (existing) throw new AppError('A coupon with this code already exists', 409);

  const coupon = await Coupon.create({
    cafeId: req.cafeId,
    code: normalized,
    description: description || '',
    type,
    value: Number(value),
    minOrder: Number(minOrder) || 0,
    maxDiscount: Number(maxDiscount) || 0,
    appliesTo: {
      scope: appliesTo?.scope || 'all',
      itemIds: appliesTo?.itemIds || [],
      categoryIds: appliesTo?.categoryIds || [],
      customerIds: appliesTo?.customerIds || [],
    },
    // Stored validated: an audience the engine would silently refuse is worse
    // than none, because it looks targeted in the list and is not.
    audience: segmentService.normalizeAudience(audience),
    autoIssue: {
      enabled: Boolean(autoIssue?.enabled),
      repeatEveryDays: Number(autoIssue?.repeatEveryDays) || 0,
    },
    validFrom: validFrom ? new Date(validFrom) : null,
    validTo: validTo ? new Date(validTo) : null,
    happyHour: happyHour || {},
    singleUse: Boolean(singleUse),
    usageLimit: Number(usageLimit) || 0,
    perCustomerLimit: Number(perCustomerLimit) || 0,
    isActive: isActive !== false,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, message: 'Coupon created', coupon });
});

// 3. Update a coupon
const updateCoupon = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const coupon = await Coupon.findOne({ _id: id, cafeId: req.cafeId });
  if (!coupon) throw new AppError('Coupon not found', 404);

  const allowed = [
    'description',
    'type',
    'value',
    'minOrder',
    'maxDiscount',
    'validFrom',
    'validTo',
    'singleUse',
    'usageLimit',
    'perCustomerLimit',
    'isActive',
    'happyHour',
    'appliesTo',
    'audience',
    'autoIssue',
  ];

  for (const field of allowed) {
    if (req.body[field] === undefined) continue;
    if (field === 'validFrom' || field === 'validTo') {
      coupon[field] = req.body[field] ? new Date(req.body[field]) : null;
    } else if (field === 'value' || field === 'minOrder' || field === 'maxDiscount') {
      coupon[field] = Number(req.body[field]) || 0;
    } else if (field === 'audience') {
      coupon.audience = segmentService.normalizeAudience(req.body[field]);
    } else if (field === 'autoIssue') {
      coupon.autoIssue = {
        enabled: Boolean(req.body[field]?.enabled),
        repeatEveryDays: Number(req.body[field]?.repeatEveryDays) || 0,
      };
    } else {
      coupon[field] = req.body[field];
    }
  }

  if (req.body.code !== undefined) {
    const normalized = couponService.normalizeCode(req.body.code);
    if (!normalized) throw new AppError('code cannot be empty', 400);
    const clash = await Coupon.findOne({ cafeId: req.cafeId, code: normalized, _id: { $ne: coupon._id } });
    if (clash) throw new AppError('A coupon with this code already exists', 409);
    coupon.code = normalized;
  }

  await coupon.save();
  res.status(200).json({ success: true, message: 'Coupon updated', coupon });
});

// 4. Delete a coupon
const deleteCoupon = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const coupon = await Coupon.findOneAndDelete({ _id: id, cafeId: req.cafeId });
  if (!coupon) throw new AppError('Coupon not found', 404);

  res.status(200).json({ success: true, message: 'Coupon deleted' });
});

// 5. Validate a code against a subtotal (POS preview / server checkout)
const validateCoupon = asyncHandler(async (req, res) => {
  const { code, subtotal, customerId, items } = req.body;

  const result = await couponService.validate({
    cafeId: req.cafeId,
    code,
    subtotal: Number(subtotal) || 0,
    // Scoped coupons need the lines to know what they may discount.
    items: Array.isArray(items) ? items : null,
    customerId: customerId || null,
  });

  res.status(200).json({
    success: true,
    code: result.code,
    label: result.label,
    discount: round2(result.discount),
    eligibleSubtotal: round2(result.eligibleSubtotal),
  });
});

// 6. What the audience rule builder may offer, and who it currently matches.
//
// The form is generated from the engine's own whitelist rather than a copy of
// it, so the picker can never present a rule that redemption would refuse.
const getAudienceCatalogue = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    fields: segmentService.ruleCatalogue(),
    presets: segmentService.AUDIENCE_PRESETS.map((p) => ({
      key: p.key,
      label: p.label,
      hint: p.hint,
    })),
  });
});

// 7. How many people an unsaved audience would reach right now.
const previewAudience = asyncHandler(async (req, res) => {
  const { audience, customerIds = [] } = req.body;

  const draft = {
    cafeId: req.cafeId,
    audience: segmentService.normalizeAudience(audience),
    appliesTo: { customerIds: Array.isArray(customerIds) ? customerIds : [] },
  };

  const preview = await segmentService.previewAudience({ coupon: draft, cafeId: req.cafeId });
  res.status(200).json({ success: true, ...preview });
});

// 8. Grants issued for one coupon — who was actually reached.
const getCouponGrants = asyncHandler(async (req, res) => {
  const grants = await CouponGrant.find({ cafeId: req.cafeId, couponId: req.params.id })
    .sort({ issuedAt: -1 })
    .limit(200)
    .populate('customerId', 'name phone');

  res.status(200).json({
    success: true,
    totalCount: grants.length,
    grants: grants.map((g) => ({
      id: g._id,
      code: g.code,
      customer: g.customerId ? { name: g.customerId.name, phone: g.customerId.phone } : null,
      status: g.status,
      issuedAt: g.issuedAt,
      expiresAt: g.expiresAt,
      redeemedAt: g.redeemedAt,
    })),
  });
});

module.exports = {
  getAudienceCatalogue,
  previewAudience,
  getCouponGrants, getCoupons, createCoupon, updateCoupon, deleteCoupon, validateCoupon };

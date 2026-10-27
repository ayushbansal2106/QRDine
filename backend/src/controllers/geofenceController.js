const Cafe = require('../models/Cafe');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const geofenceService = require('../services/geofenceService');
const auditService = require('../services/auditService');

/**
 * Module #10 — geofence configuration + suspicious-order review queue.
 *
 * All reads/writes are scoped to `req.cafeId`, which `tenantMiddleware` derives
 * from the authenticated user. Coordinates arrive as advisory input and every
 * verdict is recomputed here rather than trusted from a client flag.
 */

const toBool = (value, fallback = false) => {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const getConfig = asyncHandler(async (req, res) => {
  const cafe = await Cafe.findById(req.cafeId).select('geofence').lean();
  if (!cafe) throw new AppError('Cafe not found', 404);

  res.status(200).json({ success: true, config: cafe.geofence, stats: await geofenceService.getGeofenceStats(req.cafeId) });
});

const updateConfig = asyncHandler(async (req, res) => {
  const cafe = await Cafe.findById(req.cafeId);
  if (!cafe) throw new AppError('Cafe not found', 404);

  const body = req.body || {};
  const geofence = cafe.geofence || {};

  const enabled = toBool(body.enabled, geofence.enabled);
  const lat = body.lat !== undefined ? toNumberOrNull(body.lat) : geofence.lat;
  const lng = body.lng !== undefined ? toNumberOrNull(body.lng) : geofence.lng;
  const radiusMeters = body.radiusMeters !== undefined ? Number(body.radiusMeters) : geofence.radiusMeters;
  const fallback = body.fallback !== undefined ? (body.fallback === 'reject' ? 'reject' : 'flag') : geofence.fallback;

  if (enabled && (lat === null || lng === null)) {
    throw new AppError('Latitude and longitude are required to enable the geofence', 400);
  }
  if (lat !== null && (lat < -90 || lat > 90)) throw new AppError('latitude must be between -90 and 90', 400);
  if (lng !== null && (lng < -180 || lng > 180)) throw new AppError('longitude must be between -180 and 180', 400);
  if (!Number.isFinite(Number(radiusMeters)) || Number(radiusMeters) < 5 || Number(radiusMeters) > 5000) {
    throw new AppError('radiusMeters must be between 5 and 5000', 400);
  }

  cafe.geofence = {
    ...geofence.toObject ? geofence.toObject() : geofence,
    enabled,
    lat,
    lng,
    radiusMeters: Number(radiusMeters),
    fallback,
  };
  await cafe.save();

  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'geofence.updated',
    entityType: 'Cafe',
    entityId: req.cafeId,
    staffId: req.user._id,
    staffName: req.user.name || '',
    metadata: { enabled, lat, lng, radiusMeters: Number(radiusMeters), fallback },
  });

  res.status(200).json({ success: true, config: cafe.geofence });
});

/** Flagged orders, newest first, with the geofence reason codes. */
const listFlags = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const filter = { cafeId: req.cafeId, 'geolocation.flagged': true };
  if (req.query.outcome === 'pending') filter['geolocation.reviewOutcome'] = 'pending';
  if (req.query.outcome === 'resolved') filter['geolocation.reviewOutcome'] = { $ne: 'pending' };

  const [orders, totalCount] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('tableId', 'tableNumber')
      .populate('customerId', 'name phone'),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    page,
    limit,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    flags: orders.map((o) => ({
      id: o._id,
      orderNumber: o.orderNumber,
      orderType: o.orderType,
      channel: o.channel,
      status: o.status,
      totalAmount: o.totalAmount,
      tableNumber: o.tableId ? o.tableId.tableNumber : null,
      customer: o.customerId ? { name: o.customerId.name, phone: o.customerId.phone } : null,
      createdAt: o.createdAt,
      geolocation: o.geolocation,
    })),
  });
});

/** Mark a flagged order as a genuine customer or as abuse. */
const resolveFlag = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { outcome, note } = req.body || {};

  if (!['confirmed_legit', 'confirmed_fraud'].includes(outcome)) {
    throw new AppError('outcome must be confirmed_legit or confirmed_fraud', 400);
  }

  const order = await Order.findOne({ _id: id, cafeId: req.cafeId });
  if (!order) throw new AppError('Order not found', 404);

  order.geolocation.reviewOutcome = outcome;
  order.geolocation.reviewedBy = req.user._id;
  order.geolocation.reviewedAt = new Date();
  order.geolocation.reviewNote = String(note || '').slice(0, 500);
  await order.save();

  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'geofence.flag_resolved',
    entityType: 'Order',
    entityId: order._id,
    staffId: req.user._id,
    staffName: req.user.name || '',
    metadata: { orderNumber: order.orderNumber, outcome, note: order.geolocation.reviewNote },
  });

  res.status(200).json({ success: true, order });
});

const getStats = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, stats: await geofenceService.getGeofenceStats(req.cafeId) });
});

module.exports = { getConfig, updateConfig, listFlags, resolveFlag, getStats };

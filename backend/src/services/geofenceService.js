const mongoose = require('mongoose');
const Cafe = require('../models/Cafe');
const Order = require('../models/Order');

/**
 * Module #10 — Geo-location fake-order prevention.
 *
 * Design notes
 *  - Client coordinates are ALWAYS advisory input. Nothing here trusts a flag
 *    such as `verified: true` coming from the browser; every decision is
 *    recomputed server-side from the cafe's configured geofence.
 *  - When the geofence is disabled, or the browser denied/omits location, we
 *    never hard-fail a customer order: the order is soft-flagged so staff can
 *    triage it (configurable via `geofence.fallback`).
 *  - Anti-spoof heuristics are layered on top of the radius check:
 *      * accuracy sanity (a device claiming 5m accuracy is treated as untrusted)
 *      * impossible travel (speed between consecutive orders from the same table)
 *      * velocity limit (too many orders placed from one table in a short window)
 */

const EARTH_RADIUS_METERS = 6371e3;

// A reported accuracy better than this is not credible from a phone browser.
const MIN_TRUSTWORTHY_ACCURACY_METERS = 25;
// Accuracy worse than this means the fix is useless for a radius check.
const MAX_USABLE_ACCURACY_METERS = 2000;
// Consecutive orders implying a speed above this are treated as impossible travel.
const MAX_PLAUSIBLE_SPEED_MPS = 55; // ~200 km/h
// More than this many orders from the same table inside the window is a burst.
const VELOCITY_WINDOW_MINUTES = 10;
const VELOCITY_LIMIT_ORDERS = 8;

/** Great-circle distance in meters between two lat/lng pairs. */
const haversineMeters = ({ lat1, lng1, lat2, lng2 }) => {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Coerce and range-check an incoming `{ lat, lng, accuracy }` payload. */
const normalizeLocation = (location) => {
  if (!location || typeof location !== 'object') return null;

  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lng ?? location.longitude);
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const rawAccuracy = Number(location.accuracy);
  return {
    lat,
    lng,
    accuracy: isFiniteNumber(rawAccuracy) && rawAccuracy >= 0 ? rawAccuracy : null,
  };
};

/** Resolve the effective geofence config for a cafe (never throws on a partial config). */
const getGeofenceConfig = (cafe) => {
  const geofence = (cafe && cafe.geofence) || {};
  return {
    enabled: Boolean(geofence.enabled),
    lat: isFiniteNumber(Number(geofence.lat)) ? Number(geofence.lat) : null,
    lng: isFiniteNumber(Number(geofence.lng)) ? Number(geofence.lng) : null,
    radiusMeters: Number(geofence.radiusMeters) || 50,
    fallback: geofence.fallback === 'reject' ? 'reject' : 'flag',
  };
};

/**
 * Look at recent orders from the same table for impossible-travel and burst signals.
 * `excludeOrderId` lets a retried order compare against history without self-matching.
 */
const collectVelocitySignals = async ({ cafeId, tableId, lat, lng, excludeOrderId = null }) => {
  const signals = { previousOrder: null, impliedSpeedMps: null, recentOrderCount: 0 };

  if (!tableId) return signals;

  const since = new Date(Date.now() - VELOCITY_WINDOW_MINUTES * 60 * 1000);

  const filter = {
    cafeId,
    tableId,
    createdAt: { $gte: since },
    'geolocation.lat': { $ne: null },
  };
  if (excludeOrderId) filter._id = { $ne: excludeOrderId };

  const recent = await Order.find(filter).sort({ createdAt: -1 }).limit(VELOCITY_LIMIT_ORDERS);
  signals.recentOrderCount = recent.length;

  const previous = recent[0];
  if (previous && previous.geolocation) {
    const previousLat = Number(previous.geolocation.lat);
    const previousLng = Number(previous.geolocation.lng);
    if (isFiniteNumber(previousLat) && isFiniteNumber(previousLng)) {
      const meters = haversineMeters({ lat1: previousLat, lng1: previousLng, lat2: lat, lng2: lng });
      const minutes = Math.max(
        0.5,
        (new Date() - new Date(previous.createdAt || Date.now())) / 60000
      );
      signals.previousOrder = { id: previous._id, createdAt: previous.createdAt };
      signals.impliedSpeedMps = Number((meters / (minutes * 60)).toFixed(2));
    }
  }

  return signals;
};

/**
 * Verify an order's claimed position against the cafe geofence.
 *
 * Returns the snapshot persisted on `Order.geolocation` plus a `decision` of
 * `accept` | `flag` | `reject`. Throws nothing — the caller decides what a
 * `reject` means for its surface.
 */
const verifyOrderLocation = async ({ cafeId, tableId = null, location, excludeOrderId = null }) => {
  const base = {
    lat: null,
    lng: null,
    accuracy: null,
    distanceMeters: null,
    verified: false,
    flagged: false,
    riskScore: 0,
    reasons: [],
    decision: 'accept',
    checkedAt: new Date(),
  };

  // A non-ObjectId tenant id can never reach a real order (the schema rejects
  // it), so there is nothing to enforce against.
  if (!mongoose.Types.ObjectId.isValid(cafeId)) {
    return { ...base, reasons: ['unknown_cafe'] };
  }

  const cafe = await Cafe.findById(cafeId).select('geofence').lean();
  if (!cafe) {
    throw new Error(`Cafe ${cafeId} not found while verifying geofence`);
  }

  const config = getGeofenceConfig(cafe);
  const reasons = [];
  let riskScore = 0;

  if (!config.enabled || config.lat === null || config.lng === null) {
    // Geofence off (or not yet configured): accept, but record that no check ran.
    return { ...base, reasons: ['geofence_disabled'] };
  }

  const point = normalizeLocation(location);
  if (!point) {
    // No usable fix. Honour the configured fallback rather than failing hard by default.
    return {
      ...base,
      flagged: config.fallback === 'flag',
      riskScore: 40,
      reasons: ['location_missing_or_invalid'],
      decision: config.fallback === 'reject' ? 'reject' : 'flag',
    };
  }

  const distanceMeters = haversineMeters({
    lat1: config.lat,
    lng1: config.lng,
    lat2: point.lat,
    lng2: point.lng,
  });

  const snapshot = {
    lat: point.lat,
    lng: point.lng,
    accuracy: point.accuracy,
    distanceMeters: Number(distanceMeters.toFixed(1)),
    verified: distanceMeters <= config.radiusMeters,
    flagged: false,
    riskScore: 0,
    reasons: [],
    decision: 'accept',
    radiusMeters: config.radiusMeters,
    checkedAt: new Date(),
  };

  if (!snapshot.verified) {
    reasons.push('outside_radius');
    riskScore += 60;
  }

  if (point.accuracy === null) {
    reasons.push('accuracy_missing');
    riskScore += 10;
  } else if (point.accuracy < MIN_TRUSTWORTHY_ACCURACY_METERS) {
    // Suspiciously perfect fix — usually a spoofed or emulated position.
    reasons.push('accuracy_implausibly_precise');
    riskScore += 30;
  } else if (point.accuracy > MAX_USABLE_ACCURACY_METERS) {
    reasons.push('accuracy_too_low');
    riskScore += 15;
  }

  const velocity = await collectVelocitySignals({
    cafeId,
    tableId,
    lat: point.lat,
    lng: point.lng,
    excludeOrderId,
  });

  if (velocity.recentOrderCount >= VELOCITY_LIMIT_ORDERS) {
    reasons.push('velocity_limit_exceeded');
    riskScore += 25;
  }

  if (velocity.impliedSpeedMps !== null && velocity.impliedSpeedMps > MAX_PLAUSIBLE_SPEED_MPS) {
    reasons.push('impossible_travel');
    riskScore += 40;
  }

  snapshot.riskScore = Math.min(100, riskScore);
  snapshot.reasons = reasons;
  snapshot.velocity = {
    recentOrderCount: velocity.recentOrderCount,
    impliedSpeedMps: velocity.impliedSpeedMps,
  };

  const hardReject = !snapshot.verified && config.fallback === 'reject';
  snapshot.flagged = !hardReject && (riskScore > 0 || reasons.length > 0);
  snapshot.decision = hardReject ? 'reject' : snapshot.flagged ? 'flag' : 'accept';

  return snapshot;
};

/** Aggregate flagged-order counts for the geofence dashboard. */
const getGeofenceStats = async (cafeId) => {
  const [totalFlagged, pendingFlagged, unverified, rejected] = await Promise.all([
    Order.countDocuments({ cafeId, 'geolocation.flagged': true }),
    Order.countDocuments({ cafeId, 'geolocation.flagged': true, 'geolocation.reviewOutcome': 'pending' }),
    Order.countDocuments({ cafeId, 'geolocation.verified': false, 'geolocation.distanceMeters': { $ne: null } }),
    Order.countDocuments({ cafeId, 'geolocation.decision': 'reject' }),
  ]);

  return { totalFlagged, pendingFlagged, unverified, rejected };
};

module.exports = {
  haversineMeters,
  normalizeLocation,
  getGeofenceConfig,
  verifyOrderLocation,
  collectVelocitySignals,
  getGeofenceStats,
  EARTH_RADIUS_METERS,
  MAX_PLAUSIBLE_SPEED_MPS,
  VELOCITY_LIMIT_ORDERS,
  VELOCITY_WINDOW_MINUTES,
};

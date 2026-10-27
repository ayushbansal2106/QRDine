/**
 * Module #10 — geo-location fake-order prevention.
 * Covers the pure distance maths, the server-side verdict for each configuration,
 * the anti-spoof heuristics, and the manager config/flag-queue endpoints.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';

// `Cafe.findById(...).select(...).lean()` is a chained query; mirror that shape.
const chainable = (value) => {
  const query = Promise.resolve(value);
  query.select = () => query;
  query.limit = () => query;
  query.skip = () => query;
  query.sort = () => query;
  query.lean = () => Promise.resolve(value);
  return query;
};

const mockCafeFindById = jest.fn();
const mockOrderFind = jest.fn();
const mockOrderCountDocuments = jest.fn();
const mockAuditRecordEvent = jest.fn().mockResolvedValue({});
const mockEmitGeofenceFlagged = jest.fn();

// `Cafe.findById(...).select(...).lean()` is a chained query; mirror that shape.

jest.mock('../src/models/Cafe', () => ({
  // Always hand back a chainable query that resolves to the queued document.
  findById: (...a) => {
    const pending = mockCafeFindById(...a);
    const query = Promise.resolve(pending);
    query.select = () => query;
    query.lean = () => query;
    return query;
  },
}));

jest.mock('../src/models/Order', () => ({
  find: (...a) => chainable(mockOrderFind(...a)),
  countDocuments: (...a) => mockOrderCountDocuments(...a),
}));

jest.mock('../src/services/auditService', () => ({
  recordEvent: (...a) => mockAuditRecordEvent(...a),
}));

jest.mock('../src/services/socketService', () => ({
  emitGeofenceFlagged: (...a) => mockEmitGeofenceFlagged(...a),
}));

const geofenceService = require('../src/services/geofenceService');

// ── Pure helpers ────────────────────────────────────────────────

describe('geofenceService — distance maths', () => {
  it('returns 0 for the same point', () => {
    const distance = geofenceService.haversineMeters({ lat1: 19.076, lng1: 72.8777, lat2: 19.076, lng2: 72.8777 });
    expect(distance).toBeCloseTo(0, 3);
  });

  it('computes a known short distance (Mumbai CST to Fort, ~1.2km)', () => {
    const distance = geofenceService.haversineMeters({
      lat1: 18.9408,
      lng1: 72.8354,
      lat2: 18.9339,
      lng2: 72.8297,
    });
    expect(distance).toBeGreaterThan(900);
    expect(distance).toBeLessThan(1600);
  });

  it('rejects out-of-range and non-numeric coordinates', () => {
    expect(geofenceService.normalizeLocation({ lat: 91, lng: 0 })).toBeNull();
    expect(geofenceService.normalizeLocation({ lat: 0, lng: 181 })).toBeNull();
    expect(geofenceService.normalizeLocation({ lat: 'abc', lng: 10 })).toBeNull();
    expect(geofenceService.normalizeLocation(null)).toBeNull();
  });

  it('normalises a valid payload and keeps the accuracy', () => {
    expect(geofenceService.normalizeLocation({ lat: 19.076, lng: 72.8777, accuracy: 25 })).toEqual({
      lat: 19.076,
      lng: 72.8777,
      accuracy: 25,
    });
  });
});

// ── Verdict logic ──────────────────────────────────────────────

describe('geofenceService — verification verdicts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderFind.mockResolvedValue([]);
  });

  const cafeWith = (geofence) => mockCafeFindById.mockResolvedValue({ geofence, _id: CAFE_ID });

  it('accepts without checks when the geofence is disabled', async () => {
    cafeWith({ enabled: false });
    const result = await geofenceService.verifyOrderLocation({ cafeId: CAFE_ID, location: null });
    expect(result.decision).toBe('accept');
    expect(result.reasons).toContain('geofence_disabled');
    expect(result.flagged).toBe(false);
  });

  it('flags a missing fix by default rather than blocking the customer', async () => {
    cafeWith({ enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 50, fallback: 'flag' });
    const result = await geofenceService.verifyOrderLocation({ cafeId: CAFE_ID, location: null });
    expect(result.decision).toBe('flag');
    expect(result.reasons).toContain('location_missing_or_invalid');
    expect(result.flagged).toBe(true);
  });

  it('rejects a missing fix when the cafe configured fallback=reject', async () => {
    cafeWith({ enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 50, fallback: 'reject' });
    const result = await geofenceService.verifyOrderLocation({ cafeId: CAFE_ID, location: null });
    expect(result.decision).toBe('reject');
  });

  it('accepts a customer standing on the cafe doorstep', async () => {
    cafeWith({ enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 50, fallback: 'flag' });
    const result = await geofenceService.verifyOrderLocation({
      cafeId: CAFE_ID,
      location: { lat: 19.07601, lng: 72.87771, accuracy: 30 },
    });
    expect(result.verified).toBe(true);
    expect(result.decision).toBe('accept');
    expect(result.distanceMeters).toBeLessThan(50);
  });

  it('flags a customer ordering from far away and reports the distance', async () => {
    cafeWith({ enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 50, fallback: 'flag' });
    const result = await geofenceService.verifyOrderLocation({
      cafeId: CAFE_ID,
      location: { lat: 19.15, lng: 72.95, accuracy: 30 },
    });
    expect(result.verified).toBe(false);
    expect(result.decision).toBe('flag');
    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain('outside_radius');
    expect(result.distanceMeters).toBeGreaterThan(5000);
  });

  it('rejects an out-of-radius order when fallback=reject', async () => {
    cafeWith({ enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 50, fallback: 'reject' });
    const result = await geofenceService.verifyOrderLocation({
      cafeId: CAFE_ID,
      location: { lat: 19.2, lng: 72.9, accuracy: 30 },
    });
    expect(result.decision).toBe('reject');
    expect(result.flagged).toBe(false);
  });

  it('treats an impossibly precise fix as spoofed', async () => {
    cafeWith({ enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 50, fallback: 'flag' });
    const result = await geofenceService.verifyOrderLocation({
      cafeId: CAFE_ID,
      location: { lat: 19.07601, lng: 72.87771, accuracy: 2 },
    });
    expect(result.reasons).toContain('accuracy_implausibly_precise');
    expect(result.decision).toBe('flag');
  });

  it('flags impossible travel between two consecutive orders', async () => {
    cafeWith({ enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 5000, fallback: 'flag' });
    // ~110km away, 1 minute ago → ~66 km/h … bump the distance so it is impossible.
    mockOrderFind.mockResolvedValue([
      {
        _id: 'prev-order',
        createdAt: new Date(Date.now() - 60 * 1000),
        geolocation: { lat: 19.0, lng: 72.8 },
      },
    ]);

    const result = await geofenceService.verifyOrderLocation({
      cafeId: CAFE_ID,
      tableId: 'table-1',
      location: { lat: 19.9, lng: 72.8, accuracy: 30 },
    });

    expect(result.velocity.impliedSpeedMps).toBeGreaterThan(geofenceService.MAX_PLAUSIBLE_SPEED_MPS);
    expect(result.reasons).toContain('impossible_travel');
  });

  it('flags a burst of orders from one table', async () => {
    cafeWith({ enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 50, fallback: 'flag' });
    mockOrderFind.mockResolvedValue(
      new Array(geofenceService.VELOCITY_LIMIT_ORDERS).fill(0).map((_, i) => ({
        _id: `o${i}`,
        createdAt: new Date(),
        geolocation: { lat: 19.076, lng: 72.8777 },
      }))
    );

    const result = await geofenceService.verifyOrderLocation({
      cafeId: CAFE_ID,
      tableId: 'table-1',
      location: { lat: 19.076, lng: 72.8777, accuracy: 25 },
    });

    expect(result.reasons).toContain('velocity_limit_exceeded');
  });

  it('skips enforcement for a non-ObjectId tenant instead of throwing', async () => {
    const result = await geofenceService.verifyOrderLocation({ cafeId: 'cafe-001', location: null });
    expect(result.reasons).toContain('unknown_cafe');
    expect(mockCafeFindById).not.toHaveBeenCalled();
  });
});

// ── Controller ─────────────────────────────────────────────────

describe('geofenceController', () => {
  let controller;
  let mockCafeFindByIdForController;
  let mockCafeSave;
  let mockOrderFindOne;
  let mockOrderFindOneAndUpdate;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockCafeFindByIdForController = jest.fn();
    mockCafeSave = jest.fn().mockResolvedValue(true);
    mockOrderFindOne = jest.fn();
    mockOrderFindOneAndUpdate = jest.fn();

    // The controller both awaits the document (updateConfig → .save()) and
    // chains .select().lean() (getConfig), so the mock returns one query object
    // that satisfies both.
    mockCafeFindByIdForController.mockImplementation(() => {
      const query = Promise.resolve(mockCafeFindByIdForController.result);
      query.select = () => query;
      query.lean = () => query;
      return query;
    });

    jest.doMock('../src/models/Cafe', () => ({
      findById: (...a) => mockCafeFindByIdForController(...a),
    }));
    jest.doMock('../src/models/Order', () => ({
      find: (...a) => mockOrderFind(...a),
      countDocuments: (...a) => mockOrderCountDocuments(...a),
      findOne: (...a) => mockOrderFindOne(...a),
      findOneAndUpdate: (...a) => mockOrderFindOneAndUpdate(...a),
    }));

    controller = require('../src/controllers/geofenceController');
  });

  /** Queue the document the chained `.lean()` will resolve to. */
  const setCafeDoc = (doc) => {
    mockCafeFindByIdForController.result = doc;
  };

  it('returns the current config with stats', async () => {
    setCafeDoc({
      geofence: { enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 50, fallback: 'flag' },
    });
    mockOrderCountDocuments.mockResolvedValue(0);

    const res = mockRes();
    await controller.getConfig(mockReq({ cafeId: CAFE_ID }), res, mockNext());

    expect(res._statusCode).toBe(200);
    expect(res._jsonData.config.radiusMeters).toBe(50);
    expect(res._jsonData.stats).toBeDefined();
  });

  it('refuses to enable the geofence without coordinates', async () => {
    setCafeDoc({
      geofence: {},
      save: mockCafeSave,
    });

    const res = mockRes();
    const next = mockNext();
    await controller.updateConfig(
      mockReq({ cafeId: CAFE_ID, body: { enabled: true, lat: null, lng: null } }),
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects an out-of-bounds radius', async () => {
    setCafeDoc({ geofence: {}, save: mockCafeSave });
    const next = mockNext();

    await controller.updateConfig(
      mockReq({ cafeId: CAFE_ID, body: { enabled: true, lat: 1, lng: 1, radiusMeters: 99999 } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('persists a valid config and writes an audit entry', async () => {
    const cafe = {
      geofence: { enabled: false, lat: null, lng: null, radiusMeters: 50, fallback: 'flag' },
      save: mockCafeSave,
    };
    setCafeDoc(cafe);

    const res = mockRes();
    await controller.updateConfig(
      mockReq({
        cafeId: CAFE_ID,
        user: { _id: 'user-1', name: 'Asha' },
        body: { enabled: true, lat: 19.076, lng: 72.8777, radiusMeters: 75, fallback: 'flag' },
      }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(200);
    expect(res._jsonData.config.radiusMeters).toBe(75);
    expect(mockAuditRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'geofence.updated' })
    );
  });

  it('lists only flagged orders for the tenant', async () => {
    const query = Promise.resolve([
      {
        _id: 'order-1',
        orderNumber: 'ORD-1',
        channel: 'qr',
        orderType: 'dine_in',
        status: 'pending',
        totalAmount: 400,
        tableId: { tableNumber: '4' },
        customerId: null,
        createdAt: new Date(),
        geolocation: { flagged: true, riskScore: 60, reasons: ['outside_radius'], reviewOutcome: 'pending' },
      },
    ]);
    query.sort = jest.fn().mockReturnValue(query);
    query.skip = jest.fn().mockReturnValue(query);
    query.limit = jest.fn().mockReturnValue(query);
    query.populate = jest.fn().mockReturnValue(query);
    mockOrderFind.mockReturnValue(query);
    mockOrderCountDocuments.mockResolvedValue(1);

    const res = mockRes();
    await controller.listFlags(mockReq({ cafeId: CAFE_ID, query: {} }), res, mockNext());

    expect(mockOrderFind).toHaveBeenCalledWith(
      expect.objectContaining({ cafeId: CAFE_ID, 'geolocation.flagged': true })
    );
    expect(res._jsonData.flags).toHaveLength(1);
  });

  it('records a triage decision on the order', async () => {
    const order = {
      _id: 'order-1',
      orderNumber: 'ORD-1',
      geolocation: {},
      save: jest.fn().mockResolvedValue(true),
    };
    mockOrderFindOne.mockResolvedValue(order);

    const res = mockRes();
    await controller.resolveFlag(
      mockReq({ cafeId: CAFE_ID, params: { id: 'order-1' }, user: { _id: 'u1', name: 'Asha' }, body: { outcome: 'confirmed_legit' } }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(200);
    expect(order.geolocation.reviewOutcome).toBe('confirmed_legit');
    expect(mockAuditRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'geofence.flag_resolved' })
    );
  });

  it('rejects an unknown triage outcome', async () => {
    const next = mockNext();
    await controller.resolveFlag(
      mockReq({ cafeId: CAFE_ID, params: { id: 'order-1' }, body: { outcome: 'maybe' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});
/**
 * Module #11 — social NFC tap integration.
 * The important behaviours are that a tag resolves at tap time (so re-pointing
 * works without re-printing) and that an unresolvable tag never redirects a
 * guest somewhere wrong.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';

const mockTagFindOne = jest.fn();
const mockTagCreate = jest.fn();
const mockTagFind = jest.fn();
const mockTagCountDocuments = jest.fn();
const mockTagAggregate = jest.fn();
const mockTagUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
const mockTableFindOne = jest.fn();
const mockCafeFindById = jest.fn();
const mockAuditRecordEvent = jest.fn().mockResolvedValue({});
const mockEmitNfcTapped = jest.fn();

jest.mock('../src/models/NfcTag', () => ({
  findOne: (...a) => mockTagFindOne(...a),
  create: (...a) => mockTagCreate(...a),
  find: (...a) => mockTagFind(...a),
  countDocuments: (...a) => mockTagCountDocuments(...a),
  aggregate: (...a) => mockTagAggregate(...a),
  updateOne: (...a) => mockTagUpdateOne(...a),
}));

jest.mock('../src/models/Table', () => ({
  findOne: (...a) => {
    const query = Promise.resolve(mockTableFindOne(...a));
    query.select = () => query;
    query.save = jest.fn().mockResolvedValue(true);
    return query;
  },
}));

jest.mock('../src/models/Cafe', () => ({
  findById: (...a) => {
    const query = Promise.resolve(mockCafeFindById(...a));
    query.select = () => query;
    query.lean = () => query;
    return query;
  },
}));

jest.mock('../src/services/auditService', () => ({
  recordEvent: (...a) => mockAuditRecordEvent(...a),
}));

jest.mock('../src/services/socketService', () => ({
  emitNfcTapped: (...a) => mockEmitNfcTapped(...a),
}));

jest.mock('../src/services/qrService', () => ({
  buildTableGuestUrl: (publicId) => `https://cafe.app/table/${publicId}`,
  buildNfcTagUrl: (tagId) => `https://api.cafe.app/api/nfc/${tagId}`,
  buildGoogleReviewUrl: (placeId) => (placeId ? `https://search.google.com/local/writereview?placeid=${placeId}` : ''),
  buildCafeMenuUrl: (cafeId) => `https://cafe.app/table/cafe-${cafeId}`,
  generateQrDataUrl: async (url) => `data:image/png;base64,${Buffer.from(url).toString('base64')}`,
  generateTagId: () => 'nfc_abc123',
  generateTablePublicId: () => 'tbl_generated',
  ensureTableIdentity: jest.fn().mockImplementation(async (table) => table),
  getFrontendUrl: () => 'https://cafe.app',
  getApiUrl: () => 'https://api.cafe.app',
}));

const nfcService = require('../src/services/nfcService');

afterEach(() => jest.clearAllMocks());

describe('nfcService — tag payload', () => {
  it('writes a resolver URL into the tag, not the menu URL', () => {
    expect(nfcService.buildTagPayload('nfc_abc123')).toBe('https://api.cafe.app/api/nfc/nfc_abc123');
  });
});

describe('nfcService — destination resolution', () => {
  const cafe = { review: { googlePlaceId: 'place-123' }, nfc: { instagramUrl: 'https://instagram.com/cafe' } };

  beforeEach(() => {
    mockCafeFindById.mockResolvedValue(cafe);
  });

  it('resolves a table-bound tag to that table menu', async () => {
    mockTagFindOne.mockResolvedValue({ _id: '507f1f77bcf86cd7994390aa', tagId: 'nfc_abc123', cafeId: CAFE_ID, destination: 'menu', tableId: '507f1f77bcf86cd7994390bb', isActive: true });
    mockTableFindOne.mockResolvedValue({ _id: '507f1f77bcf86cd7994390bb', tableNumber: '4', guestUrl: 'https://cafe.app/table/tbl_x' });

    const result = await nfcService.resolveDestination({ tagId: 'nfc_abc123' });

    expect(result.url).toBe('https://cafe.app/table/tbl_x');
    expect(result.table.tableNumber).toBe('4');
  });

  it('resolves to the cafe-wide menu when no table is bound', async () => {
    mockTagFindOne.mockResolvedValue({ _id: '507f1f77bcf86cd7994390aa', tagId: 'nfc_abc123', cafeId: CAFE_ID, destination: 'menu', tableId: null, isActive: true });

    const result = await nfcService.resolveDestination({ tagId: 'nfc_abc123' });
    expect(result.url).toContain('cafe.app/table/cafe-');
  });

  it('resolves to the Google review dialog when the place id is configured', async () => {
    mockTagFindOne.mockResolvedValue({ _id: '507f1f77bcf86cd7994390aa', tagId: 'nfc_abc123', cafeId: CAFE_ID, destination: 'google_review', isActive: true });

    const result = await nfcService.resolveDestination({ tagId: 'nfc_abc123' });
    expect(result.url).toContain('placeid=place-123');
  });

  it('resolves to Instagram', async () => {
    mockTagFindOne.mockResolvedValue({ _id: '507f1f77bcf86cd7994390aa', tagId: 'nfc_abc123', cafeId: CAFE_ID, destination: 'instagram', isActive: true });

    const result = await nfcService.resolveDestination({ tagId: 'nfc_abc123' });
    expect(result.url).toBe('https://instagram.com/cafe');
  });

  it('resolves a custom destination verbatim', async () => {
    mockTagFindOne.mockResolvedValue({
      _id: '507f1f77bcf86cd7994390aa',
      tagId: 'nfc_abc123',
      cafeId: CAFE_ID,
      destination: 'custom',
      targetUrl: 'https://example.com/menu',
      isActive: true,
    });

    const result = await nfcService.resolveDestination({ tagId: 'nfc_abc123' });
    expect(result.url).toBe('https://example.com/menu');
  });

  it('re-points live: changing the stored destination changes the next tap', async () => {
    mockTagFindOne.mockResolvedValue({
      _id: '507f1f77bcf86cd7994390aa',
      tagId: 'nfc_abc123',
      cafeId: CAFE_ID,
      destination: 'google_review',
      isActive: true,
    });

    const result = await nfcService.resolveDestination({ tagId: 'nfc_abc123' });
    expect(result.destination).toBe('google_review');
    // No caching anywhere: the next tap re-reads the document.
    expect(mockTagFindOne).toHaveBeenCalledWith({ tagId: 'nfc_abc123', isActive: true });
  });

  it('rejects an unknown or inactive tag', async () => {
    mockTagFindOne.mockResolvedValue(null);
    await expect(nfcService.resolveDestination({ tagId: 'nfc_missing' })).rejects.toThrow(/not active or does not exist/i);
  });

  it('rejects a google_review tag when no place id is configured', async () => {
    mockCafeFindById.mockResolvedValue({ review: {}, nfc: {} });
    mockTagFindOne.mockResolvedValue({ _id: 't', tagId: 'nfc_abc123', cafeId: CAFE_ID, destination: 'google_review', isActive: true });

    await expect(nfcService.resolveDestination({ tagId: 'nfc_abc123' })).rejects.toThrow(/not configured/i);
  });

  it('rejects a custom tag with no target URL', async () => {
    mockTagFindOne.mockResolvedValue({ _id: 't', tagId: 'nfc_abc123', cafeId: CAFE_ID, destination: 'custom', targetUrl: '', isActive: true });

    await expect(nfcService.resolveDestination({ tagId: 'nfc_abc123' })).rejects.toThrow(/no destination URL/i);
  });
});

describe('nfcService — tap recording', () => {
  it('increments the tap count and notifies the cafe room', async () => {
    const tag = { _id: '507f1f77bcf86cd7994390aa', tagId: 'nfc_abc123', cafeId: CAFE_ID, label: 'Table 4' };

    await nfcService.recordTap(tag, { table: { tableNumber: '4' } });

    expect(mockTagUpdateOne).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd7994390aa' },
      expect.objectContaining({ $inc: { tapCount: 1 } })
    );
    expect(mockEmitNfcTapped).toHaveBeenCalledWith(
      CAFE_ID,
      expect.objectContaining({ tagId: 'nfc_abc123', tableNumber: '4' })
    );
  });

  it('never throws when analytics fail', async () => {
    mockTagUpdateOne.mockImplementationOnce(() => {
      throw new Error('db down');
    });
    await expect(nfcService.recordTap({ _id: 't', tagId: 'x', cafeId: CAFE_ID })).resolves.toBeUndefined();
  });
});

describe('nfcController — public tap resolver', () => {
  let controller;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/models/NfcTag', () => ({
      findOne: (...a) => mockTagFindOne(...a),
      create: (...a) => mockTagCreate(...a),
      find: (...a) => mockTagFind(...a),
      countDocuments: (...a) => mockTagCountDocuments(...a),
      aggregate: (...a) => mockTagAggregate(...a),
      updateOne: (...a) => mockTagUpdateOne(...a),
    }));
    controller = require('../src/controllers/nfcController');
  });

  it('302-redirects a tap to the resolved destination', async () => {
    mockTagFindOne.mockResolvedValue({
      _id: '507f1f77bcf86cd7994390aa',
      tagId: 'nfc_abc123',
      cafeId: CAFE_ID,
      destination: 'custom',
      targetUrl: 'https://example.com/menu',
      isActive: true,
    });
    mockCafeFindById.mockResolvedValue({ review: {}, nfc: {} });

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), redirect: jest.fn() };

    await controller.resolveTag(mockReq({ params: { tagId: 'nfc_abc123' } }), res, mockNext());

    expect(res.redirect).toHaveBeenCalledWith(302, 'https://example.com/menu');
  });

  it('does not redirect an unknown tag', async () => {
    mockTagFindOne.mockResolvedValue(null);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), redirect: jest.fn() };
    const next = mockNext();

    await controller.resolveTag(mockReq({ params: { tagId: 'nfc_nope' } }), res, next);

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('nfcController — tag management', () => {
  let controller;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/models/NfcTag', () => ({
      findOne: (...a) => mockTagFindOne(...a),
      create: (...a) => mockTagCreate(...a),
      find: (...a) => mockTagFind(...a),
      countDocuments: (...a) => mockTagCountDocuments(...a),
      aggregate: (...a) => mockTagAggregate(...a),
      updateOne: (...a) => mockTagUpdateOne(...a),
    }));
    controller = require('../src/controllers/nfcController');
  });

  it('creates a tag with a generated id and returns a printable card', async () => {
    mockTableFindOne.mockResolvedValue({ _id: '507f1f77bcf86cd7994390bb' });
    mockTagCreate.mockImplementation(async (data) => ({ _id: '507f1f77bcf86cd7994390aa', ...data }));
    mockTagFindOne.mockResolvedValue({
      _id: '507f1f77bcf86cd7994390aa',
      tagId: 'nfc_abc123',
      cafeId: CAFE_ID,
      destination: 'menu',
      tableId: { _id: '507f1f77bcf86cd7994390bb', tableNumber: '4' },
      isActive: true,
      label: 'Table 4',
    });

    const res = mockRes();
    await controller.createTag(
      mockReq({ cafeId: CAFE_ID, user: { _id: 'u1', name: 'Asha' }, body: { label: 'Table 4', destination: 'menu', tableId: '507f1f77bcf86cd7994390bb' } }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(201);
    expect(res._jsonData.card.ndefRecord.url).toContain('nfc_abc123');
    expect(res._jsonData.card.qrDataUrl).toContain('data:image/png');
    expect(mockAuditRecordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'nfc.tag_created' }));
  });

  it('rejects a custom destination without a valid URL', async () => {
    const next = mockNext();
    await controller.createTag(
      mockReq({ cafeId: CAFE_ID, user: { _id: 'u1' }, body: { destination: 'custom', targetUrl: 'not-a-url' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects an unknown destination type', async () => {
    const next = mockNext();
    await controller.createTag(
      mockReq({ cafeId: CAFE_ID, user: { _id: 'u1' }, body: { destination: 'telepathy' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects binding a table that belongs to another cafe', async () => {
    mockTableFindOne.mockResolvedValue(null);
    const next = mockNext();
    await controller.createTag(
      mockReq({ cafeId: CAFE_ID, user: { _id: 'u1' }, body: { destination: 'menu', tableId: '507f1f77bcf86cd7994390cc' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('updates a tag destination and audits the change', async () => {
    const tag = {
      _id: '507f1f77bcf86cd7994390aa',
      tagId: 'nfc_abc123',
      cafeId: CAFE_ID,
      destination: 'menu',
      tableId: null,
      isActive: true,
      save: jest.fn().mockResolvedValue(true),
    };
    mockTagFindOne.mockResolvedValue(tag);

    const res = mockRes();
    await controller.updateTag(
      mockReq({ cafeId: CAFE_ID, params: { id: '507f1f77bcf86cd7994390aa' }, user: { _id: 'u1', name: 'Asha' }, body: { destination: 'google_review' } }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(200);
    expect(tag.destination).toBe('google_review');
    expect(mockAuditRecordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'nfc.tag_updated' }));
  });

  it('scopes tag lookups to the tenant', async () => {
    mockTagFindOne.mockResolvedValue(null);
    const next = mockNext();

    await controller.updateTag(
      mockReq({ cafeId: CAFE_ID, params: { id: '507f1f77bcf86cd7994390aa' }, body: { label: 'x' } }),
      mockRes(),
      next
    );

    expect(mockTagFindOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd7994390aa', cafeId: CAFE_ID });
  });
});
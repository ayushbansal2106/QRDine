/**
 * Regression cover for the Module #18 settings crash and the production
 * hardening of the error/config layer.
 *
 * Background: `GET /api/reviews/settings` dereferenced `cafe.review` directly.
 * Every cafe created before Module #18 shipped has no `review` subdocument, so
 * the whole /admin/reviews page 500'd and the frontend reported it as an Axios
 * error. The controller now reads through `getReviewConfig`, which supplies
 * defaults.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';

const mockCafeFindById = jest.fn();
const mockGenerateJson = jest.fn();
const mockGenerateText = jest.fn();

jest.mock('../src/models/Cafe', () => ({
  findById: (...a) => {
    const query = Promise.resolve(mockCafeFindById(...a));
    query.select = () => query;
    query.lean = () => query;
    return query;
  },
}));

jest.mock('../src/models/Review', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../src/models/Order', () => ({ findById: jest.fn() }));
jest.mock('../src/services/notificationService', () => ({ alertManagers: jest.fn() }));
jest.mock('../src/services/auditService', () => ({ recordEvent: jest.fn() }));
jest.mock('../src/services/socketService', () => ({ emitReviewReceived: jest.fn() }));
jest.mock('../src/services/geminiService', () => ({
  isConfigured: () => false,
  isEnabled: () => false,
  generateJson: (...a) => mockGenerateJson(...a),
  generateText: (...a) => mockGenerateText(...a),
  buildSchema: (f) => f,
  SchemaTypeStrings: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
}));

const { getSettings } = require('../src/controllers/reviewController');

describe('reviewController.getSettings — legacy cafes', () => {
  // A cafe row created before Module #18 exists: no `review` key at all.
  const legacyCafe = { _id: CAFE_ID, name: 'Old Cafe' };

  it('does not crash when cafe.review is missing entirely', async () => {
    mockCafeFindById.mockResolvedValue(legacyCafe);
    const res = mockRes();

    await getSettings(mockReq({ cafeId: CAFE_ID }), res, mockNext());

    expect(res._statusCode).toBe(200);
    expect(res._jsonData.success).toBe(true);
  });

  it('supplies defaults for a cafe that never configured reviews', async () => {
    mockCafeFindById.mockResolvedValue(legacyCafe);
    const res = mockRes();

    await getSettings(mockReq({ cafeId: CAFE_ID }), res, mockNext());

    expect(res._jsonData.settings).toMatchObject({
      aiEnabled: false,
      googlePlaceId: '',
      minRatingForGoogle: 4,
      promptSampleRate: 100,
    });
    expect(res._jsonData.googleReviewUrl).toBe('');
    expect(res._jsonData.availableTags.length).toBeGreaterThan(0);
  });

  it('prefers a configured google review url over a generated deep link', async () => {
    mockCafeFindById.mockResolvedValue({
      _id: CAFE_ID,
      name: 'Cafe',
      review: { googlePlaceId: 'abc', googleReviewUrl: 'https://maps.example/review' },
    });
    const res = mockRes();

    await getSettings(mockReq({ cafeId: CAFE_ID }), res, mockNext());

    expect(res._jsonData.googleReviewUrl).toBe('https://maps.example/review');
  });

  it('falls back to a generated deep link when only a place id is set', async () => {
    mockCafeFindById.mockResolvedValue({
      _id: CAFE_ID,
      name: 'Cafe',
      review: { googlePlaceId: 'ChIJ123' },
    });
    const res = mockRes();

    await getSettings(mockReq({ cafeId: CAFE_ID }), res, mockNext());

    expect(res._jsonData.googleReviewUrl).toContain('ChIJ123');
  });

  it('404s for an unknown cafe', async () => {
    mockCafeFindById.mockResolvedValue(null);
    const res = mockRes();
    const next = mockNext();

    await getSettings(mockReq({ cafeId: CAFE_ID }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cafe not found' }));
  });
});

describe('errorMiddleware — no internal leakage in production', () => {
  const { errorHandler } = require('../src/middlewares/errorMiddleware');
  const env = require('../src/config/env');

  afterEach(() => {
    env.nodeEnv = 'development';
  });

  it('hides the message and stack for a 500 in production', () => {
    env.nodeEnv = 'production';
    const res = mockRes();
    const err = Object.assign(new Error('E:\\secret\\path\\file.js blew up'), { statusCode: 500 });

    errorHandler(err, mockReq({ method: 'GET', originalUrl: '/api/x' }), res, mockNext());

    expect(res._statusCode).toBe(500);
    expect(res._jsonData.message).not.toContain('secret');
    expect(res._jsonData.stack).toBeUndefined();
    expect(res._jsonData.success).toBe(false);
  });

  it('still returns the real message and stack outside production', () => {
    env.nodeEnv = 'development';
    const res = mockRes();

    errorHandler(
      Object.assign(new Error('boom'), { statusCode: 500 }),
      mockReq({ method: 'GET', originalUrl: '/api/x' }),
      res,
      mockNext()
    );

    expect(res._jsonData.message).toBe('boom');
    expect(res._jsonData.stack).toBeDefined();
  });

  it('passes 4xx messages through unchanged (they are not sensitive)', () => {
    env.nodeEnv = 'production';
    const res = mockRes();

    errorHandler(
      Object.assign(new Error('Table not found'), { statusCode: 404 }),
      mockReq({ method: 'GET', originalUrl: '/api/x' }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(404);
    expect(res._jsonData.message).toBe('Table not found');
  });
});
/**
 * Module #18 — smart review engine.
 *
 * The tests deliberately run with NO Gemini key, which is the important case:
 * the module must still capture ratings, route feedback and produce usable
 * drafts without ever depending on a third-party model being available.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';
const ORDER_ID = '507f1f77bcf86cd799439022';

const mockReviewFindOne = jest.fn();
const mockReviewCreate = jest.fn();
const mockReviewFind = jest.fn();
const mockOrderFindById = jest.fn();
const mockCafeFindById = jest.fn();
const mockAlertManagers = jest.fn().mockResolvedValue([]);
const mockAuditRecordEvent = jest.fn().mockResolvedValue({});
const mockEmitReviewReceived = jest.fn();

jest.mock('../src/models/Review', () => ({
  findOne: (...a) => mockReviewFindOne(...a),
  create: (...a) => mockReviewCreate(...a),
  find: (...a) => mockReviewFind(...a),
}));

jest.mock('../src/models/Order', () => ({
  findById: (...a) => {
    const query = Promise.resolve(mockOrderFindById(...a));
    query.select = () => query;
    query.lean = () => query;
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

jest.mock('../src/services/notificationService', () => ({
  alertManagers: (...a) => mockAlertManagers(...a),
}));

jest.mock('../src/services/auditService', () => ({
  recordEvent: (...a) => mockAuditRecordEvent(...a),
}));

jest.mock('../src/services/socketService', () => ({
  emitReviewReceived: (...a) => mockEmitReviewReceived(...a),
}));

// The AI-free degradation tests must not depend on whether the developer
// happens to have GOOGLE_API_KEY in .env — mock the service so both the
// configured and unconfigured paths are exercised deterministically.
const mockGenerateJson = jest.fn();
const mockGenerateText = jest.fn();

jest.mock('../src/services/geminiService', () => ({
  isConfigured: () => false,
  isEnabled: () => false,
  generateJson: (...a) => mockGenerateJson(...a),
  generateText: (...a) => mockGenerateText(...a),
  buildSchema: (fields) => fields,
  SchemaTypeStrings: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
}));

const reviewService = require('../src/services/reviewService');

const cafeDoc = (overrides = {}) => ({
  name: 'Blue Tokai',
  review: {
    googlePlaceId: 'place-1',
    googleReviewUrl: '',
    aiEnabled: true,
    minRatingForGoogle: 4,
    brandVoice: 'warm, concise, appreciative',
    promptSampleRate: 100,
    autoSendLowRatingAlerts: true,
  },
  ...overrides,
});

const orderDoc = () => ({
  _id: ORDER_ID,
  orderNumber: 'ORD-1',
  orderType: 'dine_in',
  totalAmount: 450,
  items: [
    { menuItemId: 'm1', itemName: 'Cold Brew', quantity: 2, price: 200, gstAmount: 20 },
    { menuItemId: 'm2', itemName: 'Croissant', quantity: 1, price: 120, gstAmount: 12 },
  ],
  createdAt: new Date(),
});

afterEach(() => jest.clearAllMocks());

// ── Validation & routing ──────────────────────────────────────

describe('reviewService.submitRating', () => {
  beforeEach(() => {
    mockCafeFindById.mockResolvedValue(cafeDoc());
    mockReviewFindOne.mockResolvedValue(null);
    mockReviewCreate.mockImplementation(async (data) => ({ _id: 'review-1', createdAt: new Date(), ...data }));
    mockOrderFindById.mockResolvedValue(orderDoc());
  });

  it('rejects an out-of-range rating', async () => {
    await expect(reviewService.submitRating({ cafeId: CAFE_ID, rating: 6 })).rejects.toThrow(/between 1 and 5/i);
    await expect(reviewService.submitRating({ cafeId: CAFE_ID, rating: 0 })).rejects.toThrow(/between 1 and 5/i);
    await expect(reviewService.submitRating({ cafeId: CAFE_ID, rating: 4.5 })).rejects.toThrow(/between 1 and 5/i);
  });

  it('routes a 5-star rating to a public draft and returns a Google link', async () => {
    const result = await reviewService.submitRating({
      cafeId: CAFE_ID,
      orderId: ORDER_ID,
      rating: 5,
      tags: ['taste'],
    });

    expect(result.outcome.visibility).toBe('public_draft');
    expect(result.outcome.googleReviewUrl).toContain('placeid=place-1');
    expect(result.outcome.draft.length).toBeGreaterThan(0);
    expect(mockAlertManagers).not.toHaveBeenCalled();
  });

  it('mentions the dishes the customer actually ordered in the draft', async () => {
    const result = await reviewService.submitRating({ cafeId: CAFE_ID, orderId: ORDER_ID, rating: 5 });
    expect(result.outcome.draft).toMatch(/Cold Brew/);
  });

  it('keeps a low rating private and alerts a manager immediately', async () => {
    const result = await reviewService.submitRating({
      cafeId: CAFE_ID,
      orderId: ORDER_ID,
      rating: 2,
      tags: ['wait_time'],
      comment: 'Waited 40 minutes',
    });

    expect(result.outcome.visibility).toBe('private_feedback');
    expect(mockAlertManagers).toHaveBeenCalledWith(
      expect.objectContaining({ cafeId: CAFE_ID, subject: expect.stringContaining('2-star') })
    );
  });

  it('filters unknown tags so the theme list stays a controlled vocabulary', async () => {
    await reviewService.submitRating({
      cafeId: CAFE_ID,
      orderId: ORDER_ID,
      rating: 5,
      tags: ['taste', 'invented-tag'],
    });

    expect(mockReviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['taste'] })
    );
  });

  it('is idempotent per order — a second rating returns the first', async () => {
    mockReviewFindOne.mockResolvedValue({
      _id: 'review-1',
      rating: 5,
      visibility: 'public_draft',
      ai: { draft: 'existing draft' },
    });

    const result = await reviewService.submitRating({ cafeId: CAFE_ID, orderId: ORDER_ID, rating: 1 });

    expect(result.alreadySubmitted).toBe(true);
    expect(result.outcome.draft).toBe('existing draft');
    expect(mockReviewCreate).not.toHaveBeenCalled();
  });

  it('honours the cafe threshold when it is raised to 5', async () => {
    mockCafeFindById.mockResolvedValue(cafeDoc({ review: { ...cafeDoc().review, minRatingForGoogle: 5 } }));

    const result = await reviewService.submitRating({ cafeId: CAFE_ID, orderId: ORDER_ID, rating: 4 });
    expect(result.outcome.visibility).toBe('private_feedback');
  });

  it('records the submission in the audit ledger', async () => {
    await reviewService.submitRating({ cafeId: CAFE_ID, orderId: ORDER_ID, rating: 5 });
    expect(mockAuditRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'review.submitted' })
    );
  });
});

// ── AI degradation ────────────────────────────────────────────

describe('reviewService — AI-free degradation', () => {
  beforeEach(() => {
    mockCafeFindById.mockResolvedValue(cafeDoc());
    mockReviewFindOne.mockResolvedValue(null);
    mockOrderFindById.mockResolvedValue(orderDoc());
    mockGenerateJson.mockResolvedValue({ ok: false, data: null, reason: 'ai_not_configured' });
    mockGenerateText.mockResolvedValue({ ok: false, data: null, reason: 'ai_not_configured' });
  });

  it('produces a template draft and flags why when AI is unavailable', async () => {
    const review = {
      _id: 'review-1',
      rating: 5,
      tags: ['taste'],
      comment: '',
      ai: { themes: [], sentiment: null, summary: '', draft: '', ownerReplyDraft: '', model: '', generatedAt: null, error: '' },
      save: jest.fn().mockResolvedValue(true),
    };
    mockReviewCreate.mockResolvedValue(review);

    const result = await reviewService.submitRating({ cafeId: CAFE_ID, orderId: ORDER_ID, rating: 5 });

    expect(result.outcome.draft.length).toBeGreaterThan(0);
    expect(review.ai.error).toBe('ai_not_configured');
    expect(review.status).toBe('drafted');
  });

  it('falls back to a template owner reply when AI is unavailable', async () => {
    mockCafeFindById.mockResolvedValue(cafeDoc());
    const review = {
      _id: 'review-2',
      rating: 2,
      comment: 'Cold coffee',
      ai: { themes: [], sentiment: null, summary: '', draft: '', ownerReplyDraft: '', model: '', generatedAt: null, error: '' },
      save: jest.fn().mockResolvedValue(true),
    };

    const result = await reviewService.generateOwnerReply({ review });

    expect(result.source).toBe('template');
    expect(result.reply).toMatch(/sorry/i);
    expect(review.ai.ownerReplyDraft).toContain('sorry');
  });

  it('thanks a happy customer in the template reply', async () => {
    const review = {
      _id: 'review-3',
      rating: 5,
      comment: 'Loved it',
      ai: { themes: [], sentiment: null, summary: '', draft: '', ownerReplyDraft: '', model: '', generatedAt: null, error: '' },
      save: jest.fn().mockResolvedValue(true),
    };

    const result = await reviewService.generateOwnerReply({ review });
    expect(result.reply).toMatch(/thank you/i);
  });
});

// ── Summary ───────────────────────────────────────────────────

describe('reviewService.summarize', () => {
  it('computes average, distribution, themes and response rate', async () => {
    const make = (rating, extra = {}) => ({
      _id: `r${rating}`,
      rating,
      comment: '',
      tags: [],
      visibility: rating >= 4 ? 'public_draft' : 'private_feedback',
      status: 'new',
      ownerReply: '',
      createdAt: new Date(),
      ai: { themes: [], summary: '' },
      ...extra,
    });

    const chainable = (value) => {
      const q = Promise.resolve(value);
      q.sort = () => q;
      q.lean = () => Promise.resolve(value);
      return q;
    };
    mockReviewFind.mockReturnValue(
      chainable([
        make(5, { tags: ['taste'], ai: { themes: ['taste'], summary: '' } }),
        make(4, { ownerReply: 'thanks' }),
        make(2, { tags: ['wait_time'], ai: { themes: ['wait_time'], summary: '' } }),
      ])
    );

    const summary = await reviewService.summarize({ cafeId: CAFE_ID });

    expect(summary.total).toBe(3);
    expect(summary.averageRating).toBe(3.7);
    expect(summary.distribution['5']).toBe(1);
    // themes are counted from both the customer tags and the AI themes
    expect(summary.topThemes[0]).toEqual({ theme: 'taste', count: 2 });
    expect(summary.responseRate).toBe(33.3);
    expect(summary.privateFeedbackCount).toBe(1);
  });

  it('handles an empty inbox without dividing by zero', async () => {
    const q = Promise.resolve([]);
    q.sort = () => q;
    q.lean = () => Promise.resolve([]);
    mockReviewFind.mockReturnValue(q);

    const summary = await reviewService.summarize({ cafeId: CAFE_ID });

    expect(summary.total).toBe(0);
    expect(summary.averageRating).toBe(0);
    expect(summary.responseRate).toBe(0);
  });
});

// ── Controller ────────────────────────────────────────────────

describe('reviewController.submitRating (guest)', () => {
  let controller;
  const SESSION_ID = '507f1f77bcf86cd799439033';

  beforeEach(() => {
    jest.resetModules();
    mockReviewFindOne.mockResolvedValue(null);
    mockReviewCreate.mockImplementation(async (data) => ({ _id: 'review-1', createdAt: new Date(), ...data }));
    mockCafeFindById.mockResolvedValue(cafeDoc());
    mockOrderFindById.mockResolvedValue({ ...orderDoc(), cafeId: CAFE_ID, sessionId: SESSION_ID });

    jest.doMock('../src/models/Review', () => ({
      findOne: (...a) => mockReviewFindOne(...a),
      create: (...a) => mockReviewCreate(...a),
      find: (...a) => mockReviewFind(...a),
    }));
    jest.doMock('../src/models/DiningSession', () => ({
      findOne: (...a) => mockSessionFindOne(...a),
    }));

    controller = require('../src/controllers/reviewController');
  });

  const mockSessionFindOne = jest.fn();

  it('accepts a rating from the guest who owns the session', async () => {
    mockSessionFindOne.mockResolvedValue({ _id: SESSION_ID });

    const res = mockRes();
    await controller.submitRating(
      mockReq({
        body: { orderId: ORDER_ID, rating: 5 },
        cookies: { guest_token: 'gt-1' },
        headers: { 'x-guest-token': 'gt-1' },
      }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(201);
    expect(res._jsonData.visibility).toBe('public_draft');
  });

  it('refuses a guest token that belongs to a different session', async () => {
    mockSessionFindOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439099' });

    const next = mockNext();
    await controller.submitRating(
      mockReq({ body: { orderId: ORDER_ID, rating: 5 }, headers: { 'x-guest-token': 'gt-1' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('refuses a rating with no guest token at all', async () => {
    mockSessionFindOne.mockResolvedValue(null);

    const next = mockNext();
    await controller.submitRating(mockReq({ body: { orderId: ORDER_ID, rating: 5 } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('validates the order id shape before touching the database', async () => {
    const next = mockNext();
    await controller.submitRating(mockReq({ body: { orderId: 'nope', rating: 5 } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('reviewController — settings', () => {
  let controller;

  beforeEach(() => {
    jest.resetModules();
    mockCafeFindById.mockResolvedValue({
      name: 'Blue Tokai',
      review: cafeDoc().review,
      save: jest.fn().mockResolvedValue(true),
    });
    controller = require('../src/controllers/reviewController');
  });

  it('rejects a min rating outside 1–5', async () => {
    const next = mockNext();
    await controller.updateSettings(
      mockReq({ cafeId: CAFE_ID, user: { _id: 'u1' }, body: { minRatingForGoogle: 9 } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('persists a valid settings change and audits it', async () => {
    const res = mockRes();
    await controller.updateSettings(
      mockReq({ cafeId: CAFE_ID, user: { _id: 'u1', name: 'Asha' }, body: { aiEnabled: false, minRatingForGoogle: 5 } }),
      res,
      mockNext()
    );

    expect(res._statusCode).toBe(200);
    expect(res._jsonData.settings.aiEnabled).toBe(false);
    expect(mockAuditRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'review.settings_updated' })
    );
  });
});
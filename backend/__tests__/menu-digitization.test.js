/**
 * Module #19 — AI menu digitisation.
 *
 * The properties that matter and are easy to get wrong:
 *  - a price the AI cannot read must become `null`, never a guess;
 *  - a publish must not silently blank the extracted description/price
 *    (a defaults-spread ordering bug shipped once already);
 *  - publish must be idempotent, so a double-click cannot double the menu;
 *  - a café can never read or publish another café's job.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';
const OTHER_CAFE = '507f1f77bcf86cd799439099';
const JOB_ID = '507f1f77bcf86cd799439088';
const CATEGORY_ID = '507f1f77bcf86cd799439077';

const mockJobCreate = jest.fn();
const mockJobFindOne = jest.fn();
const mockJobFind = jest.fn();
const mockJobSave = jest.fn();
const mockCategoryFindOne = jest.fn();
const mockCategoryCreate = jest.fn();
const mockItemFindOne = jest.fn();
const mockItemCreate = jest.fn();

jest.mock('../src/models/MenuImportJob', () => ({
  create: (...a) => mockJobCreate(...a),
  findOne: (...a) => mockJobFindOne(...a),
  find: (...a) => {
    const q = Promise.resolve(mockJobFind(...a));
    q.sort = () => q;
    q.limit = () => q;
    return q;
  },
}));

jest.mock('../src/models/Category', () => ({
  create: (...a) => mockCategoryCreate(...a),
  findOne: (...a) => mockCategoryFindOne(...a),
}));

jest.mock('../src/models/MenuItem', () => ({
  create: (...a) => mockItemCreate(...a),
  findOne: (...a) => mockItemFindOne(...a),
}));

const service = require('../src/services/menuDigitizationService');
const controller = require('../src/controllers/menuDigitizationController');

/** A MenuImportJob-shaped object with a working save(). */
function makeJob(overrides = {}) {
  return {
    _id: JOB_ID,
    cafeId: CAFE_ID,
    status: 'awaiting_review',
    stats: {},
    error: {},
    sourceImages: [],
    draft: { categories: [] },
    publishedResult: {},
    createdAt: new Date(),
    completedAt: null,
    save: mockJobSave,
    ...overrides,
  };
}

const validDraft = {
  categories: [
    {
      name: 'Starters',
      items: [
        {
          name: 'Paneer Tikka',
          description: 'Charred paneer with mint chutney',
          price: 240,
          variants: [],
          modifierGroups: [],
          isVeg: true,
          gstPercentage: 5,
        },
        {
          name: 'Chicken 65',
          description: '',
          price: 280,
          variants: [],
          modifierGroups: [],
          isVeg: false,
          gstPercentage: 5,
        },
      ],
    },
  ],
};

beforeEach(() => {
  mockJobSave.mockResolvedValue(true);
  mockItemCreate.mockResolvedValue({});
  mockCategoryFindOne.mockResolvedValue(null);
  mockCategoryCreate.mockResolvedValue({ _id: CATEGORY_ID });
  mockItemFindOne.mockResolvedValue(null);
});

// ── Price parsing: never invent a number ─────────────────────────
describe('parsePrice — prices are never trusted', () => {
  it('strips currency symbols and separators', () => {
    expect(service.parsePrice('₹240')).toBe(240);
    expect(service.parsePrice('Rs. 240')).toBe(240);
    expect(service.parsePrice('240/-')).toBe(240);
    expect(service.parsePrice('1,250')).toBe(1250);
    expect(service.parsePrice(180.5)).toBe(180.5);
  });

  it('returns null when no price can be read', () => {
    expect(service.parsePrice(null)).toBeNull();
    expect(service.parsePrice(undefined)).toBeNull();
    expect(service.parsePrice('')).toBeNull();
    expect(service.parsePrice('ask the counter')).toBeNull();
  });

  it('rejects negative prices', () => {
    expect(service.parsePrice(-50)).toBeNull();
  });
});

// ── Dish library matching ────────────────────────────────────────
describe('dish image library matching', () => {
  const { matchDishImage, guessDietary } = require('../src/data/dishImageLibrary');

  it('matches common dishes exactly', () => {
    expect(matchDishImage('Paneer Tikka')?.key).toBe('paneer tikka');
    expect(matchDishImage('MASALA DOSA')?.key).toBe('masala dosa');
    expect(matchDishImage('Butter Naan')?.key).toBe('butter naan');
  });

  it('recovers from common spelling drift via curated aliases', () => {
    expect(matchDishImage('butter chiken')?.key).toBe('butter chicken');
    expect(matchDishImage('Gulab Jamoon')?.key).toBe('gulab jamun');
    expect(matchDishImage('tea')?.key).toBe('chai');
  });

  it('returns null for an unknown dish rather than a wrong photo', () => {
    expect(matchDishImage('Chef Special Platter')).toBeNull();
    expect(matchDishImage('Vada Pav')).toBeNull();
  });

  it('infers veg / non-veg from the name as a fallback only', () => {
    expect(guessDietary('Chicken 65')).toBe('non-veg');
    expect(guessDietary('Paneer Tikka')).toBe('veg');
  });
});

// ── Draft normalisation ──────────────────────────────────────────
describe('normaliseDraft', () => {
  it('flags items with no readable price instead of inventing one', () => {
    const { categories, stats } = service.normaliseDraft({
      categories: [
        {
          name: 'Drinks',
          items: [{ name: 'Special Brew', price: null, variants: [], modifierGroups: [] }],
        },
      ],
    });

    expect(categories[0].items[0].price).toBeNull();
    expect(categories[0].items[0].needsPrice).toBe(true);
    expect(stats.unpricedCount).toBe(1);
  });

  it('does not flag an item that has variant prices but no base price', () => {
    const { categories } = service.normaliseDraft({
      categories: [
        {
          name: 'Chaats',
          items: [
            {
              name: 'Dahi Puri',
              price: null,
              variants: [
                { name: 'Regular', price: 90 },
                { name: 'Loaded', price: 150 },
              ],
              modifierGroups: [],
            },
          ],
        },
      ],
    });

    expect(categories[0].items[0].needsPrice).toBe(false);
  });

  it('drops items with no name and empty categories entirely', () => {
    const { categories } = service.normaliseDraft({
      categories: [
        { name: '', items: [{ name: 'Ghost Dish', price: 10 }] },
        { name: 'Real', items: [{ name: '', price: 10 }] },
      ],
    });
    expect(categories).toEqual([]);
  });

  it('caps a hostile category name length', () => {
    const { categories } = service.normaliseDraft({
      categories: [{ name: 'x'.repeat(500), items: [{ name: 'Dish', price: 10 }] }],
    });
    expect(categories[0].name.length).toBe(120);
  });

  it('clamps an out-of-range GST percentage', () => {
    const { categories } = service.normaliseDraft({
      categories: [
        { name: 'C', items: [{ name: 'D', price: 10, gstPercentage: 999 }] },
      ],
    });
    expect(categories[0].items[0].gstPercentage).toBe(0);
  });

  it('attaches a library image key when the dish is known', () => {
    const { categories, stats } = service.normaliseDraft(validDraft);
    const names = categories[0].items.map((i) => i.imageKey);
    expect(names).toContain('paneer tikka');
    expect(names).toContain('chicken 65');
    expect(stats.imageMatchedCount).toBe(2);
  });

  it('survives a completely malformed AI response', () => {
    expect(service.normaliseDraft(null).categories).toEqual([]);
    expect(service.normaliseDraft({}).categories).toEqual([]);
    expect(service.normaliseDraft({ categories: 'nope' }).categories).toEqual([]);
    expect(service.normaliseDraft({ categories: [{ items: 'nope' }] }).categories).toEqual([]);
  });
});

// ── Publish ──────────────────────────────────────────────────────
describe('publishDraft', () => {
  it('creates categories and items from the draft', async () => {
    mockJobFindOne.mockResolvedValue(makeJob({ draft: validDraft }));

    const { alreadyPublished, result } = await service.publishDraft({
      cafeId: CAFE_ID,
      jobId: JOB_ID,
    });

    expect(alreadyPublished).toBe(false);
    expect(result.createdItems).toBe(2);
    expect(mockCategoryCreate).toHaveBeenCalledTimes(1);
    expect(mockItemCreate).toHaveBeenCalledTimes(2);
  });

  it('persists the extracted description and price (defaults spread order)', async () => {
    mockJobFindOne.mockResolvedValue(makeJob({ draft: validDraft }));

    await service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID });

    const created = mockItemCreate.mock.calls[0][0];
    expect(created.description).toBe('Charred paneer with mint chutney');
    expect(created.price).toBe(240);
    expect(created.name).toBe('Paneer Tikka');
    expect(created.categoryId).toBe(CATEGORY_ID);
  });

  it('publishes the rest of the menu when one dish fails to save', async () => {
    // Regression: a single invalid item used to abort the whole publish with a
    // 500, losing every other dish the owner had just reviewed.
    const job = makeJob({ draft: validDraft });
    mockJobFindOne.mockResolvedValue(job);
    mockItemCreate
      .mockRejectedValueOnce(new Error('Validation failed: url is required'))
      .mockResolvedValueOnce({ _id: 'ok' });

    const { result } = await service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID });

    expect(result.createdItems).toBe(1);
    expect(result.failedItems).toHaveLength(1);
    expect(result.failedItems[0].name).toBe('Paneer Tikka');
    expect(job.status).toBe('published');
    expect(mockJobSave).toHaveBeenCalled();
  });

  it('fails loudly only when nothing at all could be published', async () => {
    const job = makeJob({ draft: validDraft });
    mockJobFindOne.mockResolvedValue(job);
    mockItemCreate.mockRejectedValue(new Error('Validation failed: gstPercentage'));

    await expect(
      service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID })
    ).rejects.toThrow(/Could not publish any items/);

    expect(job.status).toBe('failed');
    expect(job.error.code).toBe('publish_failed');
  });

  it('skips an existing dish instead of duplicating it', async () => {
    mockJobFindOne.mockResolvedValue(makeJob({ draft: validDraft }));
    mockItemFindOne.mockResolvedValueOnce({ _id: 'existing' }).mockResolvedValueOnce(null);

    const { result } = await service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID });

    expect(result.skippedItems).toBe(1);
    expect(result.createdItems).toBe(1);
  });

  it('reuses a category that already exists', async () => {
    mockJobFindOne.mockResolvedValue(makeJob({ draft: validDraft }));
    mockCategoryFindOne.mockResolvedValue({ _id: CATEGORY_ID });

    await service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID });

    expect(mockCategoryCreate).not.toHaveBeenCalled();
  });

  it('skips an item that has no price at all', async () => {
    mockJobFindOne.mockResolvedValue(
      makeJob({
        draft: {
          categories: [
            {
              name: 'Drinks',
              items: [{ name: 'Mystery Brew', price: null, variants: [], modifierGroups: [] }],
            },
          ],
        },
      })
    );

    const { result } = await service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID });

    expect(result.skippedItems).toBe(1);
    expect(result.createdItems).toBe(0);
  });

  it('derives a base price from the cheapest variant', async () => {
    mockJobFindOne.mockResolvedValue(
      makeJob({
        draft: {
          categories: [
            {
              name: 'Chaat',
              items: [
                {
                  name: 'Dahi Puri',
                  price: null,
                  variants: [
                    { name: 'Regular', price: 90 },
                    { name: 'Loaded', price: 150 },
                  ],
                  modifierGroups: [],
                },
              ],
            },
          ],
        },
      })
    );

    await service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID });

    expect(mockItemCreate.mock.calls[0][0].price).toBe(90);
  });

  it('is idempotent — republishing does not duplicate the menu', async () => {
    mockJobFindOne.mockResolvedValue(
      makeJob({
        status: 'published',
        publishedResult: { createdItems: 2, createdCategories: [], skippedItems: 0 },
      })
    );

    const { alreadyPublished } = await service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID });

    expect(alreadyPublished).toBe(true);
    expect(mockItemCreate).not.toHaveBeenCalled();
    expect(mockCategoryCreate).not.toHaveBeenCalled();
  });

  it('cannot read another cafe job', async () => {
    mockJobFindOne.mockResolvedValue(null); // tenant-scoped query misses
    await expect(
      service.publishDraft({ cafeId: OTHER_CAFE, jobId: JOB_ID })
    ).rejects.toThrow('Digitisation job not found');
    expect(mockItemCreate).not.toHaveBeenCalled();
  });

  it('refuses to publish a failed job', async () => {
    mockJobFindOne.mockResolvedValue(makeJob({ status: 'failed' }));
    await expect(
      service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID })
    ).rejects.toThrow('failed and cannot be published');
  });

  it('refuses to publish an empty draft', async () => {
    mockJobFindOne.mockResolvedValue(makeJob({ draft: { categories: [] } }));
    await expect(
      service.publishDraft({ cafeId: CAFE_ID, jobId: JOB_ID })
    ).rejects.toThrow('nothing to publish');
  });
});

// ── Controller ───────────────────────────────────────────────────
describe('menuDigitizationController', () => {
  it('rejects a digitise request with no images', async () => {
    const res = mockRes();
    const next = mockNext();

    await controller.digitize(mockReq({ cafeId: CAFE_ID, user: { _id: 'u1' }, body: {} }), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('at least one') })
    );
  });

  it('marks the job failed when the AI is unavailable', async () => {
    const job = makeJob({ status: 'processing' });
    mockJobCreate.mockResolvedValue(job);

    const result = await service.digitizeMenu({
      cafeId: CAFE_ID,
      userId: 'u1',
      images: [{ url: 'https://example.invalid/x.jpg' }],
    });

    // Either AI is unconfigured (ai_not_configured) or the image could not be
    // fetched (images_unreadable). Both are a clean failure, never a throw.
    expect(result.status).toBe('failed');
    expect(result.error.code).toBeTruthy();
    expect(mockJobSave).toHaveBeenCalled();
  });

  it('updates a draft only for the owning cafe', async () => {
    mockJobFindOne.mockResolvedValue(null);
    const res = mockRes();
    const next = mockNext();

    await controller.updateDraft(
      mockReq({ cafeId: OTHER_CAFE, params: { id: JOB_ID }, body: { draft: validDraft } }),
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('not found') })
    );
    expect(mockJobSave).not.toHaveBeenCalled();
  });

  it('persists an owner edit and re-normalises it', async () => {
    const job = makeJob({ draft: validDraft });
    mockJobFindOne.mockResolvedValue(job);
    const res = mockRes();

    await controller.updateDraft(
      mockReq({ cafeId: CAFE_ID, params: { id: JOB_ID }, body: { draft: validDraft } }),
      res,
      mockNext()
    );

    expect(job.draft.categories[0].name).toBe('Starters');
    expect(res._statusCode).toBe(200);
  });

  it('refuses to edit an already published job', async () => {
    mockJobFindOne.mockResolvedValue(makeJob({ status: 'published' }));
    const next = mockNext();

    await controller.updateDraft(
      mockReq({ cafeId: CAFE_ID, params: { id: JOB_ID }, body: { draft: validDraft } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('already been published') })
    );
  });
});
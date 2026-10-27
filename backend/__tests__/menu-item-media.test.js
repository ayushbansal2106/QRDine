/**
 * MenuItem.media validation.
 *
 * Regression guard for a 500 that hit the whole publish path: `media.url` was
 * `required: true`, but AI digitisation stores a bundled library photo as
 * `{ dishKey, source: 'dish_library' }` with no URL. Any dish that matched the
 * dish library therefore failed validation and `publishDraft` aborted.
 *
 * These use `validateSync()`, so no database connection is required — the
 * point is to exercise the real Mongoose schema, not a mock.
 */
const mongoose = require('mongoose');
const MenuItem = require('../src/models/MenuItem');

const CAFE_ID = new mongoose.Types.ObjectId();
const CATEGORY_ID = new mongoose.Types.ObjectId();

const baseItem = (overrides = {}) =>
  new MenuItem({
    cafeId: CAFE_ID,
    categoryId: CATEGORY_ID,
    name: 'ADRAK CHAI',
    price: 20,
    ...overrides,
  });

const errorFor = (doc, path) => {
  const err = doc.validateSync();
  if (!err) return null;
  return err.errors[path] || null;
};

describe('MenuItem.media', () => {
  it('accepts a normal uploaded photo', () => {
    const doc = baseItem({
      media: [{ url: 'https://res.cloudinary.com/demo/image/upload/a.jpg', caption: 'Chai' }],
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('accepts the dish-library entry that digitisation writes', () => {
    const doc = baseItem({
      media: [{ type: 'image', dishKey: 'chai/adrak', source: 'dish_library' }],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.media[0].dishKey).toBe('chai/adrak');
  });

  it('rejects an entry with neither a url nor a dishKey', () => {
    const doc = baseItem({ media: [{ caption: 'orphan' }] });
    expect(errorFor(doc, 'media')).not.toBeNull();
  });

  it('still accepts an item with no media at all', () => {
    const doc = baseItem({ media: [] });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('defaults source to upload for a url-only entry', () => {
    const doc = baseItem({ media: [{ url: 'https://example.com/x.jpg' }] });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.media[0].source).toBe('upload');
  });

  it('rejects an unknown source', () => {
    const doc = baseItem({ media: [{ url: 'https://example.com/x.jpg', source: 'nope' }] });
    expect(errorFor(doc, 'media.0.source')).not.toBeNull();
  });
});
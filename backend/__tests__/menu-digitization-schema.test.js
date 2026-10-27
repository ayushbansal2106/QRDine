/**
 * The digitisation responseSchema, pinned.
 *
 * This is the guard that was missing. `buildMenuSchema` was assembling its
 * schema through `geminiService.buildSchema`, which only understands FLAT
 * lowercase fields. It therefore produced
 *
 *     { type: OBJECT, properties: { categories: { type: OBJECT } } }
 *
 * Gemini faithfully returned `{"categories":{}}` for that, normaliseDraft
 * dropped it, and every scan reported "no dishes could be read" — while all 29
 * digitisation tests passed, because they mocked Gemini and never inspected
 * the schema that would actually be sent.
 *
 * These tests assert the schema *shape*, so a silent downgrade fails loudly.
 */
const { buildMenuSchema, normaliseDraft } = require('../src/services/menuDigitizationService');
const { SchemaTypeStrings } = require('../src/services/geminiService');

const { OBJECT, STRING, ARRAY, NUMBER, BOOLEAN } = SchemaTypeStrings;

describe('buildMenuSchema — shape sent to Gemini', () => {
  const schema = buildMenuSchema();

  it('declares categories as an ARRAY at the top level', () => {
    expect(schema.type).toBe(OBJECT);
    expect(schema.properties.categories.type).toBe(ARRAY);
    expect(schema.required).toContain('categories');
  });

  it('carries an item schema on the categories array', () => {
    const item = schema.properties.categories.items;
    expect(item).toBeDefined();
    expect(item.type).toBe(OBJECT);
    expect(item.properties.items.type).toBe(ARRAY);
    expect(item.properties.items.items).toBeDefined();
  });

  it('does not degrade categories to a bare OBJECT', () => {
    // The exact failure that shipped: an empty object with no nested detail.
    expect(Object.keys(schema.properties.categories)).toContain('items');
    expect(JSON.stringify(schema)).not.toBe(
      JSON.stringify({ type: OBJECT, properties: { categories: { type: OBJECT } } })
    );
  });

  it('keeps every dish field the normalisation step reads', () => {
    const item = schema.properties.categories.items.properties.items.items;
    expect(item.properties.name.type).toBe(STRING);
    expect(item.properties.description.type).toBe(STRING);
    expect(item.properties.price.type).toBe(NUMBER);
    expect(item.properties.isVeg.type).toBe(BOOLEAN);
    expect(item.properties.variants.type).toBe(ARRAY);
    expect(item.properties.modifierGroups.type).toBe(ARRAY);
    expect(item.properties.gstPercentage.type).toBe(NUMBER);
  });

  it('lets an unreadable price be null rather than zero', () => {
    const item = schema.properties.categories.items.properties.items.items;
    expect(item.properties.price.nullable).toBe(true);
  });

  it('lets an unreadable dietary mark be null rather than false', () => {
    const item = schema.properties.categories.items.properties.items.items;
    // Without this the model answered false for every dish whose veg symbol it
    // could not see, and the whole menu published as non-veg.
    expect(item.properties.isVeg.nullable).toBe(true);
  });

  it('nests variants and modifier options all the way down', () => {
    const item = schema.properties.categories.items.properties.items.items;

    const variant = item.properties.variants.items;
    expect(variant.type).toBe(OBJECT);
    expect(variant.properties.name.type).toBe(STRING);
    expect(variant.properties.price.type).toBe(NUMBER);

    const group = item.properties.modifierGroups.items;
    expect(group.type).toBe(OBJECT);
    expect(group.properties.options.type).toBe(ARRAY);
    expect(group.properties.options.items.properties.name.type).toBe(STRING);
  });

  it('requires name and price so Gemini must populate them', () => {
    const item = schema.properties.categories.items.properties.items.items;
    expect(item.required).toEqual(expect.arrayContaining(['name', 'price']));
  });

  it('is JSON-serialisable for the SDK', () => {
    expect(() => JSON.parse(JSON.stringify(schema))).not.toThrow();
  });
});

/**
 * The model is inconsistent about an unreadable price: sometimes null, often
 * a hard 0. Both mean "not read". A 0 that survived to publish put every
 * variants-only dish on the menu at zero cost.
 */
describe('normaliseDraft — a zero base price is unreadable, not free', () => {
  const draftWith = (item) => ({ categories: [{ name: 'CHAI', items: [item] }] });

  it('leaves the base unknown when the dish is priced only by variants', () => {
    const { categories, stats } = normaliseDraft(
      draftWith({
        name: 'ADRAK CHAI',
        price: 0,
        variants: [
          { name: 'S', price: 20 },
          { name: 'M', price: 35 },
        ],
      })
    );

    const item = categories[0].items[0];
    expect(item.price).toBeNull();
    expect(item.variants).toHaveLength(2);
    expect(item.needsPrice).toBe(false); // the variants do price it
    expect(stats.unpricedCount).toBe(0);
  });

  it('flags an unpriced, variant-free dish instead of selling it at zero', () => {
    const { categories, stats } = normaliseDraft(
      draftWith({ name: 'MYSTERY', price: 0, variants: [] })
    );

    const item = categories[0].items[0];
    expect(item.price).toBeNull();
    expect(item.needsPrice).toBe(true);
    expect(stats.unpricedCount).toBe(1);
  });

  it('keeps a genuine price untouched', () => {
    const { categories } = normaliseDraft(draftWith({ name: 'MASKA BUN', price: 50 }));
    expect(categories[0].items[0].price).toBe(50);
    expect(categories[0].items[0].needsPrice).toBe(false);
  });
});

describe('normaliseDraft — dietary fallback', () => {
  const withIsVeg = (isVeg) =>
    normaliseDraft({ categories: [{ name: 'CHAI', items: [{ name: 'ADRAK CHAI', isVeg }] }] });

  it('trusts an explicit false from the photo', () => {
    expect(withIsVeg(false).categories[0].items[0].dietaryTags).toEqual(['non-veg']);
  });

  it('trusts an explicit true from the photo', () => {
    expect(withIsVeg(true).categories[0].items[0].dietaryTags).toEqual(['veg']);
  });

  it('falls back to the heuristic when the photo was inconclusive (null)', () => {
    // Not non-veg: an unreadable symbol must never default a whole menu to
    // non-vegetarian.
    expect(withIsVeg(null).categories[0].items[0].dietaryTags).toEqual(['veg']);
  });
});
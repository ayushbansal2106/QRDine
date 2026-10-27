const AppError = require('../utils/AppError');
const geminiService = require('./geminiService');
const {
  matchDishImage,
  guessCategory,
  guessDietary,
  LIBRARY_SIZE,
} = require('../data/dishImageLibrary');

const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');
const MenuImportJob = require('../models/MenuImportJob');

/**
 * Module #19 — AI menu digitisation.
 *
 * Flow:  upload menu photos → Gemini extracts a structured draft → owner
 * reviews and edits → publish writes real Category / MenuItem documents.
 *
 * Two deliberate safety properties:
 *
 *  1. **Nothing is written to the live menu during extraction.** The AI output
 *     lands on a `MenuImportJob` draft. AI misreads prices and confuses
 *     half-broken menu typography, so publishing is always an explicit,
 *     owner-confirmed action.
 *
 *  2. **Prices are never trusted.** The AI supplies a price only as a starting
 *     suggestion; `normaliseDraft` drops anything unparseable and flags the
 *     item rather than inventing a number.
 */

const MAX_IMAGES = 12;
const MAX_CATEGORIES = 40;
const MAX_ITEMS_PER_CATEGORY = 100;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 500;

// Schema type constants, needed by `buildMenuSchema` below.
const { OBJECT, STRING, ARRAY, NUMBER, BOOLEAN } = geminiService.SchemaTypeStrings;

// ── Prompt & schema ──────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `You convert photographs of a restaurant's paper or screen menu into a structured digital menu.

You are doing careful transcription and light structuring — not rewriting the menu.

Rules:
- Reproduce dish names and prices EXACTLY as printed. Never translate, modernise, correct spelling, or "improve" a name.
- If a price is missing, obscured or unreadable, set price to null. Never guess a price.
- Group items under the section headings printed on the menu. Keep the menu's own wording for a section name.
- A line showing several prices for one dish (e.g. Small / Medium / Large, or Half / Full) is a VARIANT of that dish, not separate items. Put it in the "variants" array.
- A line showing a "choose one of" add-on list belongs in modifierGroups.
- Preserve rupee prices as plain numbers. Strip currency symbols and separators ("Rs. 240", "₹240", "240/-" all become 240).
- If veg/non-veg is marked on the menu, record it. Do not infer it from the dish name.
- Ignore any QR codes, social handles, offers/discount banners, or phone numbers on the menu.
- If an item genuinely has no description on the menu, use an empty string. Do not invent one.`;

/**
 * Why a scan failed, in the cafe owner's words. Throttling is called out
 * separately from a generic failure because it is the one case where waiting
 * and retrying is the correct response, and because the transient 503s behind
 * it routinely survive an immediate retry.
 */
const AI_FAILURE_MESSAGES = {
  unparseable_response:
    'The AI could not read this menu clearly. Try sharper, better-lit photos.',
  ai_throttled: 'Our AI service is busy right now. Please try again in a few minutes.',
  ai_model_unavailable: 'Menu scanning is temporarily unavailable. Please try again later.',
  ai_not_configured: 'Menu scanning is not enabled on this deployment.',
  no_images: 'No photos were received. Please attach at least one menu photo.',
  images_unreadable: 'We could not download the photos. Please try re-uploading them.',
  default: 'Menu scanning failed. Please try again.',
};

/**
 * The responseSchema sent to Gemini.
 *
 * Built directly rather than via `geminiService.buildSchema`, which only
 * understands FLAT fields (lowercase 'string'/'number'/'array' plus
 * `itemsType`) and silently maps anything else to OBJECT. Passing it this
 * nested schema produced
 *
 *     { type: OBJECT, properties: { categories: { type: OBJECT } } }
 *
 * i.e. the array type and every nested property were discarded. Gemini then
 * correctly answered `{"categories":{}}` and the scan reported no dishes.
 * Hence this explicit, native, recursive construction.
 */
const buildMenuSchema = () => {
  const { OBJECT, STRING, ARRAY, NUMBER, BOOLEAN } = geminiService.SchemaTypeStrings;

  const variant = {
    type: OBJECT,
    properties: {
      name: { type: STRING, description: 'Variant name exactly as printed, e.g. "Small", "Full"' },
      price: { type: NUMBER, nullable: true, description: 'Variant price; null when not printed' },
    },
    required: ['name'],
  };

  const modifierOption = {
    type: OBJECT,
    properties: {
      name: { type: STRING, description: 'Add-on name exactly as printed' },
      price: { type: NUMBER, nullable: true, description: 'Add-on price; null when not printed' },
    },
    required: ['name'],
  };

  const modifierGroup = {
    type: OBJECT,
    properties: {
      name: { type: STRING, description: 'Group heading, e.g. "Choose a base"' },
      isRequired: { type: BOOLEAN, description: 'Whether the menu marks this group as required' },
      options: { type: ARRAY, items: modifierOption },
    },
    required: ['name', 'options'],
  };

  const item = {
    type: OBJECT,
    properties: {
      name: { type: STRING, description: 'Dish name exactly as printed' },
      description: { type: STRING, description: 'Description as printed, or empty string' },
      // nullable matters: without it Gemini cannot express "price unreadable",
      // and normaliseDraft relies on null to flag the dish for the owner
      // instead of publishing it at zero cost.
      price: { type: NUMBER, nullable: true, description: 'Base price; null when unreadable' },
      variants: { type: ARRAY, items: variant },
      modifierGroups: { type: ARRAY, items: modifierGroup },
      // nullable is essential here. Previously the prompt asked for a strict
      // boolean ("true only if explicitly marked"), so the model answered
      // `false` for every dish whose veg symbol it could not see — and because
      // `typeof false === 'boolean'` beat the fallback, entire menus published
      // as non-veg. With null the uncertainty survives to normalisation, where
      // guessDietary() defaults to the safe answer for an Indian cafe.
      isVeg: {
        type: BOOLEAN,
        nullable: true,
        description:
          'true if the menu explicitly marks the dish vegetarian, false if it explicitly marks it non-vegetarian, and null if the photo does not say',
      },
      gstPercentage: { type: NUMBER, description: 'GST percentage printed on the menu, else 0' },
    },
    required: ['name', 'price'],
  };

  const category = {
    type: OBJECT,
    properties: {
      name: { type: STRING, description: 'Section heading as printed on the menu' },
      items: { type: ARRAY, items: item },
    },
    required: ['name', 'items'],
  };

  return {
    type: OBJECT,
    properties: {
      categories: {
        type: ARRAY,
        description: 'Every category on the menu, in the order it is printed',
        items: category,
      },
    },
    required: ['categories'],
  };
};

// ── Normalisation ────────────────────────────────────────────────

const cleanName = (value) =>
  String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);

/** Strip currency symbols and separators; return null when unreadable. */
function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  }

  // Keep only digits and decimal points, then drop *leading* points.
  //
  // The leading-point step is essential: "Rs. 240" strips to ".240", and
  // parseFloat(".240") is 0.24 — which would publish a Rs.240 dish as Rs.0.24.
  // "240/-" strips to "240"; "1,250.50" strips to "1250.50".
  const cleaned = String(value).replace(/[^\d.]/g, '').replace(/^\.+/, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

const clampPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 0;
  return Math.round(n * 100) / 100;
};

/**
 * Turn raw AI output into a draft that is safe to render and to publish.
 * Drops junk, flags unpriced items, and attaches library image suggestions.
 */
function normaliseDraft(raw) {
  const categoriesIn = Array.isArray(raw && raw.categories) ? raw.categories : [];
  const categories = [];
  let itemCount = 0;
  let variantCount = 0;
  let unpricedCount = 0;
  let imageMatchedCount = 0;

  for (const cat of categoriesIn.slice(0, MAX_CATEGORIES)) {
    const name = cleanName(cat && cat.name);
    if (!name) continue;

    const itemsIn = Array.isArray(cat.items) ? cat.items : [];
    const items = [];

    for (const rawItem of itemsIn.slice(0, MAX_ITEMS_PER_CATEGORY)) {
      const itemName = cleanName(rawItem && rawItem.name);
      if (!itemName) continue;

      const description = String((rawItem && rawItem.description) || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_DESCRIPTION);

      const variants = (Array.isArray(rawItem && rawItem.variants) ? rawItem.variants : [])
        .map((v) => ({
          name: cleanName(v && v.name),
          price: parsePrice(v && v.price) ?? 0,
        }))
        .filter((v) => v.name)
        .slice(0, 20);

      const modifierGroups = (Array.isArray(rawItem && rawItem.modifierGroups)
        ? rawItem.modifierGroups
        : [])
        .map((g) => ({
          name: cleanName(g && g.name),
          isRequired: Boolean(g && g.isRequired),
          options: (Array.isArray(g && g.options) ? g.options : [])
            .map((o) => ({ name: cleanName(o && o.name), price: parsePrice(o && o.price) ?? 0 }))
            .filter((o) => o.name)
            .slice(0, 25),
        }))
        .filter((g) => g.name && g.options.length > 0)
        .slice(0, 5);

      let price = parsePrice(rawItem && rawItem.price);
      // A base price of 0 is never a real price on an Indian cafe menu: it is
      // what the model emits when it could not read one. Treating it as ₹0
      // published every variants-only dish (Chai S/M, Coffee S/M) at zero
      // cost. Zero is therefore treated as "unreadable", which:
      //   - with variants  -> base left unknown, variants price the dish;
      //   - without variants -> flagged needsPrice, highlighted in review,
      //                        and skipped rather than sold at ₹0.
      if (price === 0) price = null;
      const hasVariantPrice = variants.length > 0;
      // An item with neither a base price nor any variant price cannot be sold.
      if (price === null && !hasVariantPrice) unpricedCount += 1;

      const dishMatch = matchDishImage(itemName);
      if (dishMatch) imageMatchedCount += 1;

    const dietaryTags = [
      // null (or missing) means the photo was inconclusive, so fall back to the
      // keyword heuristic rather than publishing the dish as non-veg.
      rawItem && typeof rawItem.isVeg === 'boolean'
        ? rawItem.isVeg
          ? 'veg'
          : 'non-veg'
        : guessDietary(itemName, description),
    ];

      items.push({
        name: itemName,
        description,
        price,
        variants,
        modifierGroups,
        dietaryTags,
        gstPercentage: clampPercent(rawItem && rawItem.gstPercentage),
        // Owner-facing hints only — applied on publish, always overridable.
        suggestedCategory: dishMatch ? dishMatch.category : guessCategory(itemName),
        imageKey: dishMatch ? dishMatch.key : null,
        imageMatchMethod: dishMatch ? dishMatch.how : null,
        needsPrice: price === null && !hasVariantPrice,
      });

      variantCount += variants.length;
      itemCount += 1;
    }

    if (items.length > 0) categories.push({ name, items });
  }

  return {
    categories,
    stats: {
      imageCount: 0, // filled by caller
      categoryCount: categories.length,
      itemCount,
      variantCount,
      unpricedCount,
      imageMatchedCount,
    },
  };
}

// ── Extraction ───────────────────────────────────────────────────

/**
 * Turn uploaded Cloudinary URLs into inline image parts.
 * Gemini needs base64 inline data (or a Files API handle), not a hotlink.
 */
async function toInlineImages(images) {
  const parts = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    if (!img || !img.url) continue;
    try {
      const res = await fetch(img.url);
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > 8 * 1024 * 1024) continue; // inline payload cap
      parts.push({ mimeType: contentType, base64: buffer.toString('base64') });
    } catch {
      // Skip an unreachable image rather than failing the whole job.
    }
  }
  return parts;
}

/**
 * Create a digitisation job and run extraction.
 * Returns the job with `status: 'awaiting_review'` and a normalised draft.
 */
async function digitizeMenu({ cafeId, userId, images }) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new AppError('Upload at least one clear photo of your menu', 400);
  }
  if (images.length > MAX_IMAGES) {
    throw new AppError(`You can upload up to ${MAX_IMAGES} menu photos at a time`, 400);
  }

  const job = await MenuImportJob.create({
    cafeId,
    uploadedBy: userId,
    status: 'processing',
    sourceImages: images.map((i) => ({ url: i.url, publicId: i.publicId || null })),
    startedAt: new Date(),
  });

  if (!geminiService.isEnabled()) {
    job.status = 'failed';
    job.error = {
      code: 'ai_not_configured',
      message:
        'AI menu scanning is not enabled on this account yet. An administrator needs to add a Google AI key.',
    };
    job.completedAt = new Date();
    await job.save();
    return job;
  }

  const inline = await toInlineImages(images);

  if (inline.length === 0) {
    job.status = 'failed';
    job.error = {
      code: 'images_unreadable',
      message: 'None of the uploaded photos could be read. Check they are valid image files.',
    };
    job.completedAt = new Date();
    await job.save();
    return job;
  }

  const result = await geminiService.generateJsonWithImages({
    system: SYSTEM_INSTRUCTION,
    prompt:
      `These are ${inline.length} photo(s) of a restaurant menu, in reading order. ` +
      'Transcribe every category and dish you can read across all pages. Return the ' +
      'complete structured menu.',
    schema: buildMenuSchema(),
    images: inline,
  });

  if (!result.ok) {
    job.status = 'failed';
    job.error = {
      code: result.reason,
      message: AI_FAILURE_MESSAGES[result.reason] || AI_FAILURE_MESSAGES.default,
    };
    job.completedAt = new Date();
    await job.save();
    return job;
  }

  const { categories, stats } = normaliseDraft(result.data);
  job.stats = { ...stats, imageCount: inline.length };
  job.draft = { categories };
  job.status = categories.length > 0 ? 'awaiting_review' : 'failed';
  if (categories.length === 0) {
    job.error = {
      code: 'nothing_extracted',
      message:
        'No dishes could be read from these photos. Try a closer, straighter shot of the menu.',
    };
  }
  job.completedAt = new Date();
  await job.save();

  return job;
}

// ── Publish ──────────────────────────────────────────────────────

const EMPTY_TO_MENUITEM = {
  description: '',
  image: '',
  gstPercentage: 0,
  isAvailable: true,
  variants: [],
  modifierGroups: [],
  dietaryTags: [],
  ingredients: [],
  allergens: [],
  calories: 0,
  prepMinutes: 0,
  spiceLevel: 0,
  story: '',
};

/**
 * Write a reviewed draft into the live menu.
 *
 * Idempotent: a job that has already been published returns its recorded
 * result instead of creating duplicates, so a double-click cannot double the
 * menu.
 */
async function publishDraft({ cafeId, jobId, draft, userId }) {
  const job = await MenuImportJob.findOne({ _id: jobId, cafeId });
  if (!job) throw new AppError('Digitisation job not found', 404);

  if (job.status === 'published') {
    return {
      alreadyPublished: true,
      result: job.publishedResult,
    };
  }
  if (job.status === 'failed') {
    throw new AppError('This job failed and cannot be published', 400);
  }

  const source = draft || job.draft;
  if (!source || !Array.isArray(source.categories) || source.categories.length === 0) {
    throw new AppError('There is nothing to publish', 400);
  }

  const { categories } = normaliseDraft(source);

  const createdCategories = [];
  let createdItems = 0;
  let skippedItems = 0;
  const failedItems = [];

  for (const category of categories) {
    // Reuse an existing category of the same name rather than duplicating it.
    let dbCategory = await Category.findOne({ cafeId, name: category.name });
    if (!dbCategory) {
      dbCategory = await Category.create({ cafeId, name: category.name });
      createdCategories.push(String(dbCategory._id));
    }

    for (const item of category.items) {
      // Skip items that cannot be sold (no price at all) rather than
      // publishing a broken row.
      if (item.price === null && item.variants.length === 0) {
        skippedItems += 1;
        continue;
      }

      // Never overwrite an existing dish the owner already added.
      const existing = await MenuItem.findOne({ cafeId, name: item.name });
      if (existing) {
        skippedItems += 1;
        continue;
      }

      const basePrice =
        item.price !== null
          ? item.price
          : Math.min(...item.variants.map((v) => v.price).filter((p) => p > 0), Infinity);

      // One malformed dish must not cost the owner the whole menu. Each item is
      // saved independently and failures are reported back, so a 43-dish scan
      // publishes 42 and names the one it could not.
      try {
        await MenuItem.create({
          // Defaults first: any field set after this spread wins. Spreading
          // afterwards would silently blank out the extracted values.
          ...EMPTY_TO_MENUITEM,
          cafeId,
          categoryId: dbCategory._id,
          name: item.name,
          description: item.description,
          price: Number.isFinite(basePrice) ? basePrice : 0,
          gstPercentage: item.gstPercentage,
          isAvailable: true,
          variants: item.variants,
          modifierGroups: item.modifierGroups,
          dietaryTags: item.dietaryTags,
          image: '',
          // Remember the library key so the UI can offer the bundled photo.
          // A media entry needs a url or a dishKey — see the MenuItem schema.
          media: item.imageKey
            ? [{ dishKey: item.imageKey, source: 'dish_library', caption: '' }]
            : [],
        });

        createdItems += 1;
      } catch (err) {
        failedItems.push({ name: item.name, reason: err.message });
        console.error(`Digitisation: could not publish "${item.name}" - ${err.message}`);
      }
    }
  }

  if (createdItems === 0 && failedItems.length > 0) {
    // Nothing at all landed: that is a real failure, not a partial success.
    job.status = 'failed';
    job.error = {
      code: 'publish_failed',
      message: `Could not publish any items. First problem: ${failedItems[0].name} - ${failedItems[0].reason}`,
    };
    await job.save();
    throw new AppError(job.error.message, 500);
  }

  job.publishedResult = {
    createdCategories,
    createdItems,
    skippedItems,
    failedItems,
    publishedAt: new Date(),
  };
  job.status = 'published';
  await job.save();

  return { alreadyPublished: false, result: job.publishedResult };
}

module.exports = {
  digitizeMenu,
  publishDraft,
  normaliseDraft,
  parsePrice,
  buildMenuSchema,
  MAX_IMAGES,
  LIBRARY_SIZE,
};
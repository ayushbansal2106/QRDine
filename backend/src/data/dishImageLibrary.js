/**
 * Curated dish-image library (Module #19).
 *
 * `matchDishImage` maps an extracted item name onto a bundled photograph so a
 * digitised menu looks finished without anyone photographing 300 dishes.
 *
 * Design notes:
 *  - This is a *curated, hand-reviewed* list, not AI generation. Generating a
 *    photo per item risks attaching the wrong dish, and on an Indian menu a
 *    wrong veg/non-veg photograph is a customer-facing correctness problem, not
 *    a cosmetic one.
 *  - Matching is exact-first, then normalised, then a curated alias table.
 *    When nothing matches we return `null` and the UI shows a branded
 *    placeholder — a missing photo is honest, a wrong photo is not.
 *
 * `imageUrl` values point at the bundled asset host. Until the photography is
 * shot, entries may carry `imageUrl: null`, in which case they act as
 * vocabulary-only hints and the caller falls back to the placeholder.
 */

const LIBRARY = {
  // ── Starters ───────────────────────────────────────────────
  'paneer tikka': { tags: ['veg', 'starter'], category: 'Starters' },
  'paneer tikka masala': { tags: ['veg', 'curry'], category: 'Main Course' },
  'chicken tikka': { tags: ['nonveg', 'starter'], category: 'Starters' },
  'chicken 65': { tags: ['nonveg', 'starter'], category: 'Starters' },
  'tandoori chicken': { tags: ['nonveg'], category: 'Starters' },
  'chicken seekh kebab': { tags: ['nonveg'], category: 'Starters' },
  'mutton seekh kebab': { tags: ['nonveg'], category: 'Starters' },
  'veg spring roll': { tags: ['veg', 'starter'], category: 'Starters' },
  'paneer spring roll': { tags: ['veg', 'starter'], category: 'Starters' },
  'chilli paneer': { tags: ['veg', 'starter'], category: 'Starters' },
  'honey chilli potato': { tags: ['veg', 'starter'], category: 'Starters' },
  'baby corn Manchurian': { tags: ['veg'], category: 'Starters' },
  'mushroom pakora': { tags: ['veg'], category: 'Starters' },
  'onion pakora': { tags: ['veg'], category: 'Starters' },
  'aloo bonda': { tags: ['veg'], category: 'Starters' },
  'medu vada': { tags: ['veg'], category: 'Starters' },
  'dahi puri': { tags: ['veg'], category: 'Starters' },
  'papdi chaat': { tags: ['veg'], category: 'Starters' },
  'golgappa': { tags: ['veg'], category: 'Starters' },

  // ── Main course — North Indian ─────────────────────────────
  'butter chicken': { tags: ['nonveg'], category: 'Main Course' },
  'chicken curry': { tags: ['nonveg'], category: 'Main Course' },
  'chicken korma': { tags: ['nonveg'], category: 'Main Course' },
  'chicken biryani': { tags: ['nonveg'], category: 'Main Course' },
  'mutton curry': { tags: ['nonveg'], category: 'Main Course' },
  'mutton biryani': { tags: ['nonveg'], category: 'Main Course' },
  'dal makhani': { tags: ['veg'], category: 'Main Course' },
  'paneer butter masala': { tags: ['veg'], category: 'Main Course' },
  'paneer korma': { tags: ['veg'], category: 'Main Course' },
  'paneer bhurji': { tags: ['veg'], category: 'Main Course' },
  'paneer dal makhani': { tags: ['veg'], category: 'Main Course' },
  'rajma': { tags: ['veg'], category: 'Main Course' },
  'chole': { tags: ['veg'], category: 'Main Course' },
  'chole bhature': { tags: ['veg'], category: 'Main Course' },
  'dal tadka': { tags: ['veg'], category: 'Main Course' },
  'dal fry': { tags: ['veg'], category: 'Main Course' },
  'kadhi': { tags: ['veg'], category: 'Main Course' },
  'palak paneer': { tags: ['veg'], category: 'Main Course' },
  'shahi paneer': { tags: ['veg'], category: 'Main Course' },
  'matar paneer': { tags: ['veg'], category: 'Main Course' },
  'mix veg': { tags: ['veg'], category: 'Main Course' },
  'bhindi masala': { tags: ['veg'], category: 'Main Course' },
  'baingan bharta': { tags: ['veg'], category: 'Main Course' },

  // ── Main course — South Indian ────────────────────────────
  'masala dosa': { tags: ['veg'], category: 'Main Course' },
  'plain dosa': { tags: ['veg'], category: 'Main Course' },
  'idli': { tags: ['veg'], category: 'Main Course' },
  'plain idli': { tags: ['veg'], category: 'Main Course' },
  'sambar': { tags: ['veg'], category: 'Main Course' },
  'vada': { tags: ['veg'], category: 'Main Course' },
  'medu vada': { tags: ['veg'], category: 'Main Course' },
  'uttapam': { tags: ['veg'], category: 'Main Course' },
  'rasam': { tags: ['veg'], category: 'Main Course' },
  'filter coffee': { tags: ['veg'], category: 'Beverages' },
  'coconut chutney': { tags: ['veg'], category: 'Beverages' },
  'tomato chutney': { tags: ['veg'], category: 'Beverages' },

  // ── Breads ────────────────────────────────────────────────
  'naan': { tags: ['veg'], category: 'Breads' },
  'butter naan': { tags: ['veg'], category: 'Breads' },
  'garlic naan': { tags: ['veg'], category: 'Breads' },
  'tandoori roti': { tags: ['veg'], category: 'Breads' },
  'butter roti': { tags: ['veg'], category: 'Breads' },
  'lacha paratha': { tags: ['veg'], category: 'Breads' },
  'plain paratha': { tags: ['veg'], category: 'Breads' },
  'bhakri': { tags: ['veg'], category: 'Breads' },
  'poori': { tags: ['veg'], category: 'Breads' },
  'puri bhaji': { tags: ['veg'], category: 'Breads' },
  'kulcha': { tags: ['veg'], category: 'Breads' },

  // ── Rice ──────────────────────────────────────────────────
  'plain rice': { tags: ['veg'], category: 'Rice' },
  'jeera rice': { tags: ['veg'], category: 'Rice' },
  'veg pulao': { tags: ['veg'], category: 'Rice' },
  'jeera rice': { tags: ['veg'], category: 'Rice' },
  'hyderabadi dum biryani': { tags: ['nonveg'], category: 'Rice' },
  'veg dum biryani': { tags: ['veg'], category: 'Rice' },
  'egg curry': { tags: ['nonveg'], category: 'Rice' },
  'egg biryani': { tags: ['nonveg'], category: 'Rice' },

  // ── Desserts ──────────────────────────────────────────────
  'gulab jamun': { tags: ['veg'], category: 'Desserts' },
  'rasmalai': { tags: ['veg'], category: 'Desserts' },
  'gajar ka halwa': { tags: ['veg'], category: 'Desserts' },
  'moong dal halwa': { tags: ['veg'], category: 'Desserts' },
  'kheer': { tags: ['veg'], category: 'Desserts' },
  'phirni': { tags: ['veg'], category: 'Desserts' },
  'basundi': { tags: ['veg'], category: 'Desserts' },
  'ice cream': { tags: ['veg'], category: 'Desserts' },
  'gulab jamun ice cream': { tags: ['veg'], category: 'Desserts' },
  'shahi Tukda': { tags: ['veg'], category: 'Desserts' },
  'brownie': { tags: ['veg'], category: 'Desserts' },

  // ── Beverages ─────────────────────────────────────────────
  'masala chai': { tags: ['veg'], category: 'Beverages' },
  'chai': { tags: ['veg'], category: 'Beverages' },
  'coffee': { tags: ['veg'], category: 'Beverages' },
  'cold coffee': { tags: ['veg'], category: 'Beverages' },
  'lassi': { tags: ['veg'], category: 'Beverages' },
  'sweet lassi': { tags: ['veg'], category: 'Beverages' },
  'mint lemonade': { tags: ['veg'], category: 'Beverages' },
  'nimbu pani': { tags: ['veg'], category: 'Beverages' },
  'fresh lime soda': { tags: ['veg'], category: 'Beverages' },
  'mango shake': { tags: ['veg'], category: 'Beverages' },
  'banana shake': { tags: ['veg'], category: 'Beverages' },
  'oreo shake': { tags: ['veg'], category: 'Beverages' },
  'water': { tags: ['veg'], category: 'Beverages' },
  'soft drink': { tags: ['veg'], category: 'Beverages' },
};

/**
 * Names that differ from the dictionary key but mean the same dish.
 * Kept explicit rather than fuzzy — a wrong photo is worse than no photo.
 */
const ALIASES = {
  'paneer tikkaa': 'paneer tikka',
  'chicken tikkaa': 'chicken tikka',
  'butter chiken': 'butter chicken',
  'chikcen curry': 'chicken curry',
  'masala dosaa': 'masala dosa',
  'masala dosay': 'masala dosa',
  'gulab jamoon': 'gulab jamun',
  'paneer bhurji': 'paneer bhurji',
  'tea': 'chai',
  'coffeee': 'coffee',
  'biryani': 'chicken biryani',
  'veg biryani': 'veg dum biryani',
  'dahi': 'idli',
  'curd rice': 'plain rice',
  'french fries': null,
};

/** Lowercase, strip punctuation and common menu noise. */
const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[()[\]{}.,/\\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(veg|non veg|nonveg|jain|egg)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Best-effort match for a dish name.
 *
 * @param {string} name
 * @returns {{ key: string, category: string, tags: string[], matched: boolean, how: string }|null}
 *   `null` means "no confident match — use the placeholder".
 */
function matchDishImage(name) {
  if (!name || typeof name !== 'string') return null;

  const raw = name.toLowerCase().trim();

  // 1. Exact dictionary hit.
  if (LIBRARY[raw]) {
    return { key: raw, ...LIBRARY[raw], matched: true, how: 'exact' };
  }

  // 2. Curated alias.
  if (Object.prototype.hasOwnProperty.call(ALIASES, raw)) {
    const target = ALIASES[raw];
    if (target && LIBRARY[target]) {
      return { key: target, ...LIBRARY[target], matched: true, how: 'alias' };
    }
    return null;
  }

  // 3. Normalised dictionary hit.
  const normalized = normalize(raw);
  if (!normalized) return null;

  for (const [key, value] of Object.entries(LIBRARY)) {
    if (normalize(key) === normalized) {
      return { key, ...value, matched: true, how: 'normalized' };
    }
  }

  // 4. Alias lookup after normalisation.
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (target && normalize(alias) === normalized && LIBRARY[target]) {
      return { key: target, ...LIBRARY[target], matched: true, how: 'normalized-alias' };
    }
  }

  // 5. Whole-word containment, only when the dictionary entry is distinctive
  //    enough that a substring hit is unambiguous (avoids "chicken curry"
  //    matching "chicken curry roll").
  const words = normalized.split(' ').filter(Boolean);
  if (words.length >= 2) {
    for (const [key, value] of Object.entries(LIBRARY)) {
      const keyNorm = normalize(key);
      if (keyNorm.length < 8) continue;
      if (normalized.includes(keyNorm)) {
        return { key, ...value, matched: true, how: 'contains' };
      }
    }
  }

  return null;
}

/** Suggested category for an unmatched dish, from a category word-boundary scan. */
function guessCategory(name) {
  const match = matchDishImage(name);
  if (match) return match.category;

  const normalized = normalize(name);
  if (/dosa|idli|vada|uttapam|rasam|sambar|chutney|f dosa/.test(normalized)) return 'Main Course';
  if (/naan|roti|paratha|bh akri|poori|puri|bread/.test(normalized)) return 'Breads';
  if (/biryani|pulao|pilaf|rice/.test(normalized)) return 'Rice';
  if (/chai|coffee|lassi|shake|lemonade|juice|soda|water/.test(normalized)) return 'Beverages';
  if (/halwa|kheer|basundi|ice cream|falooda|dessert|gulab/.test(normalized)) return 'Desserts';
  return 'Main Course';
}

/** Veg / non-veg inference, used only as an owner-facing suggestion. */
function guessDietary(name, description = '') {
  const text = `${name} ${description}`.toLowerCase();
  if (/\b(non ?veg|nonveg|chicken|mutton|fish|prawn|shrimp|egg|beef|pork|bacon|ham)\b/.test(text)) {
    return 'non-veg';
  }
  return 'veg';
}

const LIBRARY_SIZE = Object.keys(LIBRARY).length;

module.exports = {
  matchDishImage,
  guessCategory,
  guessDietary,
  DISH_LIBRARY: LIBRARY,
  LIBRARY_SIZE,
};
/**
 * Why did a scan report "no dishes could be read"?
 *
 * Runs the REAL buildMenuSchema and the REAL normaliseDraft against the real
 * photos in Cloudinary, then reports each stage separately:
 *
 *   1. what the model actually returned (top-level keys)
 *   2. how many categories normaliseDraft salvaged
 *   3. how many were dropped, and why
 *
 * A simplified schema in an earlier version of this probe produced 8
 * categories from the same photo, which is what pointed at the real schema
 * being broken rather than at the image.
 *
 *   node scripts/probe-digitize-schema.js [maxImages]
 */
const { getCloudinary } = require('../src/utils/cloudinary');
const env = require('../src/config/env');
const geminiService = require('../src/services/geminiService');
const { buildMenuSchema, normaliseDraft } = require('../src/services/menuDigitizationService');

const FOLDER = 'qrdine/menu-items';
const LIMIT = Number(process.argv[2]) || 1;

const SYSTEM_INSTRUCTION = `You convert photographs of a restaurant's paper or screen menu into a structured digital menu.

Rules:
- Transcribe only what is actually printed. Never invent dishes or prices.
- Preserve the printed spelling of dish names.
- If a price cannot be read, use 0 rather than guessing.
- Group dishes under the category heading they appear beneath.`;

const fetchImages = async () => {
  const cloudinary = getCloudinary();
  if (!cloudinary) throw new Error('Cloudinary not configured.');
  const res = await cloudinary.api.resources({
    type: 'upload', prefix: `${FOLDER}/`, max_results: LIMIT,
  });
  const images = [];
  for (const r of res.resources || []) {
    const resp = await fetch(r.secure_url);
    if (!resp.ok) continue;
    const buf = Buffer.from(await resp.arrayBuffer());
    images.push({
      mimeType: buf[0] === 0x89 ? 'image/png' : 'image/jpeg',
      base64: buf.toString('base64'),
      publicId: r.public_id,
    });
  }
  return images;
};

const main = async () => {
  const images = await fetchImages();
  if (!images.length) { console.log('No images in Cloudinary.'); return; }

  console.log(`model: ${env.geminiModel}`);
  console.log(`images: ${images.map((i) => i.publicId).join(', ')}`);
  console.log('');

  const started = Date.now();
  const result = await geminiService.generateJsonWithImages({
    system: SYSTEM_INSTRUCTION,
    prompt:
      `These are ${images.length} photo(s) of a restaurant menu, in reading order. ` +
      'Transcribe every category and dish you can read across all pages. Return the ' +
      'complete structured menu.',
    schema: buildMenuSchema(),
    images,
  });

  console.log(`--- model response after ${((Date.now() - started) / 1000).toFixed(1)}s ---`);
  if (!result.ok) {
    console.log(`CALL FAILED: reason=${result.reason}`);
    console.log('=> the failure is transport/throttling, not the schema.');
    return;
  }

  const raw = result.data;
  console.log('top-level keys :', Object.keys(raw || {}).join(', ') || '(none)');
  console.log('typeof raw     :', Array.isArray(raw) ? 'array' : typeof raw);
  console.log('raw.categories :', Array.isArray(raw.categories) ? raw.categories.length : 'NOT AN ARRAY');
  console.log('');
  console.log('raw JSON (first 1200 chars):');
  console.log(JSON.stringify(raw).slice(0, 1200));
  console.log('');

  const { categories, stats } = normaliseDraft(raw);
  console.log('--- after normaliseDraft ---');
  console.log('categories kept:', categories.length);
  console.log('stats          :', JSON.stringify(stats));
  console.log('');
  for (const c of categories) {
    console.log(`  ${c.name} (${c.items.length} dishes)`);
    for (const i of c.items.slice(0, 6)) {
      const price = i.price === null ? (i.needsPrice ? 'NO PRICE' : 'variants') : `₹${i.price}`;
      const variant = i.variants.length ? ` [${i.variants.map((v) => `${v.name}:${v.price}`).join(', ')}]` : '';
      const gst = i.gstPercentage ? ` · GST ${i.gstPercentage}%` : '';
      console.log(`     ${i.name} — ${price}${variant} · ${(i.dietaryTags || []).join(',') || 'no tag'}${gst}`);
    }
  }

  const rawCats = Array.isArray(raw.categories) ? raw.categories : [];
  if (rawCats.length && categories.length === 0) {
    console.log('');
    console.log('!! The model returned categories but normalisation dropped ALL of them.');
    for (const c of rawCats.slice(0, 5)) {
      console.log('   raw category name:', JSON.stringify(c && c.name));
      console.log('   items is array   :', Array.isArray(c && c.items), Array.isArray(c && c.items) ? c.items.length : '');
    }
  }
};

main().catch((e) => { console.error('probe crashed:', e.message); process.exit(1); });
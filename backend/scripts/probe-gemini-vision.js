/**
 * Prove which Gemini models can actually run the digitisation call before
 * changing GEMINI_MODEL: an image part (inlineData) plus a responseSchema plus
 * a JSON mimeType, exercised through the real geminiService so the test covers
 * the same code path production uses.
 *
 *   node scripts/probe-gemini-vision.js
 *
 * A model that does not accept image input answers 400 with a message about
 * inlineData, which is the signal we want — the 1x1 PNG is enough to
 * discriminate because the request is rejected at parse time, before the
 * pixels matter.
 */
const env = require('../src/config/env');
const geminiService = require('../src/services/geminiService');

const CANDIDATES = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
];

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const schema = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          price: { type: 'NUMBER' },
        },
        required: ['name', 'price'],
      },
    },
  },
  required: ['items'],
};

const main = async () => {
  if (!env.googleApiKey) {
    console.log('GOOGLE_API_KEY is not set.');
    return;
  }
  console.log('current GEMINI_MODEL default:', env.geminiModel);
  console.log('');

  const results = [];
  for (const model of CANDIDATES) {
    env.geminiModel = model;
    const started = Date.now();
    const res = await geminiService.generateJsonWithImages({
      system: 'You transcribe food menus. Reply with JSON only.',
      prompt: 'List every dish visible in this image with its price.',
      schema,
      images: [{ mimeType: 'image/png', base64: PIXEL }],
    });
    const ms = Date.now() - started;
    results.push({ model, res, ms });
    console.log(
      `${res.ok ? 'OK  ' : 'FAIL'} ${model.padEnd(22)} ${String(ms).padStart(6)}ms  reason=${res.reason || '-'}`
    );
  }

  console.log('');
  const winners = results.filter((r) => r.res.ok);
  console.log(winners.length ? 'usable for vision+JSON:' : 'NO model handled image+JSON.');
  for (const w of winners) {
    console.log(`  ${w.model} -> ${JSON.stringify(w.res.data).slice(0, 160)}`);
  }
};

main().catch((err) => {
  console.error('probe crashed:', err.message);
  process.exit(1);
});
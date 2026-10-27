/**
 * List the Gemini models this GOOGLE_API_KEY can actually call, and which of
 * them accept images. Used to pick a real default for GEMINI_MODEL instead of
 * guessing at a model name that may have been retired.
 *
 *   node scripts/list-gemini-models.js
 *
 * Prints no secret values.
 */
const env = require('../src/config/env');

const KEY = env.googleApiKey;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const get = async (url) => {
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return json;
};

const main = async () => {
  if (!KEY) {
    console.log('GOOGLE_API_KEY is not set.');
    return;
  }

  const data = await get(`${BASE}/models?pageSize=200&key=${encodeURIComponent(KEY)}`);
  const models = (data.models || []).map((m) => ({
    name: String(m.name || '').replace(/^models\//, ''),
    displayName: m.displayName || '',
    version: m.version || '',
    methods: m.supportedGenerationMethods || [],
  }));

  const canGenerate = models.filter((m) => m.methods.includes('generateContent'));
  const canStream = models.filter((m) => m.methods.includes('streamGenerateContent'));

  console.log(`total models visible: ${models.length}`);
  console.log(`  support generateContent: ${canGenerate.length}`);
  console.log(`  support streamGenerateContent: ${canStream.length}`);

  console.log('');
  console.log('=== flash / pro / vision candidates (callable, not preview-only) ===');
  const interesting = canGenerate.filter(
    (m) =>
      /gemini-(?:3|2\.5|4)/i.test(m.name) &&
      !/-preview-|-exp-|embedding|embedding-001|aqa|robot/i.test(m.name)
  );
  for (const m of interesting.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${m.name.padEnd(34)} v${(m.version || '?').padEnd(6)} ${m.displayName}`);
  }

  console.log('');
  console.log('NOTE: this list cannot prove which models accept image input.');
  console.log('      Confirm vision support before switching GEMINI_MODEL.');
};

main().catch((err) => {
  console.error('listing failed:', err.message);
  process.exit(1);
});
/**
 * Cloudinary credential diagnostic.
 *
 * Prints NOTHING sensitive: only shape/hygiene facts about the credentials
 * plus which Cloudinary API layers accept them. Safe to run and to paste
 * the output of into an issue.
 *
 *   node scripts/diagnose-cloudinary.js
 */
const { getCloudinary } = require('../src/utils/cloudinary');
const env = require('../src/config/env');

const cloudinary = getCloudinary();

const main = async () => {
  if (!cloudinary) {
    console.log('CONFIGURED: false');
    console.log('One or more of CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET is missing.');
    return;
  }

  const secret = env.cloudinaryApiSecret;
  const key = env.cloudinaryApiKey;
  const name = env.cloudinaryCloudName;

  console.log('CONFIGURED: true');
  console.log('');
  console.log('--- shape (no values printed) ---');
  console.log('  cloud_name length   :', name.length);
  console.log('  api_key length      :', key.length);
  console.log('  api_secret length   :', secret.length);
  console.log('  all three numeric-ish:',
    /^[0-9a-z]+$/i.test(name), /^[0-9]+$/.test(key), /^[0-9a-z]+$/i.test(secret));

  console.log('');
  console.log('--- hygiene (no values printed) ---');
  console.log('  any whitespace anywhere  :', /\s/.test(secret) || /\s/.test(key) || /\s/.test(name));
  console.log('  secret has CR or LF      :', /[\r\n]/.test(secret));
  console.log('  secret has quotes        :', /["']/.test(secret));
  console.log('  secret has backslash     :', secret.includes('\\'));
  const odd = secret.replace(/[A-Za-z0-9]/g, '');
  console.log('  secret non-alphanumerics :', odd.length === 0 ? 'none' : JSON.stringify(odd));

  console.log('');
  console.log('--- which Cloudinary layers accept these credentials ---');
  const layers = [
    ['api.ping()', () => cloudinary.api.ping()],
    ['api.config()', () => cloudinary.api.config()],
    ['uploader.upload()', () => cloudinary.uploader.upload(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      { folder: 'qrdine/menu-items' }
    )],
  ];

  for (const [label, fn] of layers) {
    try {
      const r = await fn();
      const detail = label.startsWith('uploader')
        ? r.secure_url
        : JSON.stringify(r).slice(0, 120);
      console.log('  OK   ' + label + ' -> ' + detail);
    } catch (e) {
      console.log('  FAIL ' + label + ' -> ' + [e.name, e.http_code, String(e.message).slice(0, 140)].filter(Boolean).join(' | '));
    }
  }
};

main().catch((err) => {
  console.error('diagnostic crashed:', err.message);
  process.exit(1);
});
/**
 * Raw Cloudinary upload probe — bypasses the SDK's error handling so the
 * real Cloudinary error body is visible. The SDK collapses every non-2xx
 * into "Server returned unexpected status code - NNN", which hides the one
 * sentence that actually explains the failure.
 *
 *   node scripts/probe-cloudinary-upload.js
 *
 * Prints no secret values.
 */
const crypto = require('crypto');
const https = require('https');
const env = require('../src/config/env');

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const post = (hostname, path, body, headers) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'POST', headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    // body may be a string or a Buffer; write bytes verbatim so binary
    // multipart payloads are not mangled by an implicit utf8 encoding.
    req.write(Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'));
    req.end();
  });

const main = async () => {
  const cloudName = env.cloudinaryCloudName;
  const apiKey = env.cloudinaryApiKey;
  const apiSecret = env.cloudinaryApiSecret;

  if (!cloudName || !apiKey || !apiSecret) {
    console.log('Missing one or more CLOUDINARY_* values.');
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'qrdine/menu-items';
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  // Probe A: a data: URI body (what the SDK does by default).
  const formA =
    `timestamp=${timestamp}&folder=${encodeURIComponent(folder)}` +
    `&signature=${signature}&api_key=${encodeURIComponent(apiKey)}` +
    `&file=data:image/png;base64,${PNG_BASE64}`;

  // Probe B: multipart, which is what the real upload route does
  // (multer writes a file to disk and the SDK streams it).
  const boundary = '----qrdineprobe' + crypto.randomBytes(8).toString('hex');
  const text = (s) => Buffer.from(s, 'utf8');
  const head = Buffer.from(`--${boundary}\r\n`, 'utf8');
  const crlf = Buffer.from('\r\n', 'utf8');

  // Assembled as Buffers so the PNG bytes survive untouched. Joining with
  // .join('') would utf8-encode the binary payload and corrupt it.
  const parts = [
    head, text('Content-Disposition: form-data; name="timestamp"\r\n\r\n'), text(String(timestamp)), crlf,
    head, text('Content-Disposition: form-data; name="folder"\r\n\r\n'), text(folder), crlf,
    head, text('Content-Disposition: form-data; name="signature"\r\n\r\n'), text(signature), crlf,
    head, text('Content-Disposition: form-data; name="api_key"\r\n\r\n'), text(apiKey), crlf,
    head,
    text('Content-Disposition: form-data; name="file"; filename="probe.png"\r\nContent-Type: image/png\r\n\r\n'),
    Buffer.from(PNG_BASE64, 'base64'), crlf,
    text(`--${boundary}--\r\n`),
  ];
  const multipart = Buffer.concat(parts);

  const probes = [
    ['A: data-URI upload (SDK default)', formA,
      { 'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formA) }],
    ['B: multipart upload (real route)', multipart,
      { 'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipart.length }],
  ];

  for (const [label, body, headers] of probes) {
    const res = await post('api.cloudinary.com', `/v1_1/${cloudName}/image/upload`, body, headers);
    console.log('');
    console.log('=== ' + label + ' ===');
    console.log('  HTTP ' + res.status);
    console.log('  body: ' + res.body.slice(0, 800));
  }
};

main().catch((err) => {
  console.error('probe crashed:', err.message);
  process.exit(1);
});
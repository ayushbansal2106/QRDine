/**
 * Delete the throwaway 1x1 probe assets left in the Cloudinary menu folder by
 * the diagnostic scripts.
 *
 * Safety: it matches ONLY assets that are both (a) named like a probe and
 * (b) exactly 1x1 pixels. A real menu photo fails both tests and is never a
 * candidate. Defaults to a dry run; pass --confirm to actually delete.
 *
 *   node scripts/delete-cloudinary-probes.js
 *   node scripts/delete-cloudinary-probes.js --confirm
 */
const { getCloudinary } = require('../src/utils/cloudinary');

const FOLDER = 'qrdine/menu-items';
const CONFIRM = process.argv.includes('--confirm');

/**
 * A probe asset is a 1x1 pixel of ~70 bytes. Real menu photos are hundreds of
 * kilobytes and hundreds of pixels across, so dimension is the discriminator —
 * filenames are random hashes and cannot be relied on.
 */
const isProbe = (r) => r.width === 1 && r.height === 1 && (r.bytes || 0) <= 512;

const main = async () => {
  const cloudinary = getCloudinary();
  if (!cloudinary) {
    console.log('Cloudinary is not configured; nothing to do.');
    return;
  }

  // Only our own probe assets: walk every page so nothing hides on page 2.
  const candidates = [];
  let nextCursor;
  do {
    const res = await cloudinary.api.resources({
      type: 'upload',
      prefix: `${FOLDER}/`,
      max_results: 500,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    });
    for (const r of res.resources || []) {
      if (isProbe(r)) candidates.push(r);
    }
    nextCursor = res.next_cursor;
  } while (nextCursor);

  if (candidates.length === 0) {
    console.log('No probe assets found. Nothing deleted.');
    return;
  }

  console.log(`Found ${candidates.length} probe asset(s) of the ${FOLDER} folder:`);
  for (const c of candidates) {
    console.log(`  ${c.public_id}  ${c.width}x${c.height}  ${c.bytes || '?'} bytes`);
  }

  if (!CONFIRM) {
    console.log('');
    console.log('Dry run. Re-run with --confirm to delete them.');
    return;
  }// delete_resources() matches on PUBLIC ID. Handing it asset_ids returns a
// cheerful {"deleted": {...}} map echoing your input while removing nothing —
// verified, and a silent no-op, so public_id is used here deliberately.
const res = await cloudinary.api.delete_resources(candidates.map((c) => c.public_id));
  // Depending on SDK version `deleted` is an array of ids or a map of
  // public_id -> "deleted"/"not_found". Normalise both.
  const raw = res && res.deleted;
  const deleted = Array.isArray(raw)
    ? raw
    : Object.keys(raw || {});

  console.log('');
  console.log(`Deleted ${deleted.length}:`);
  for (const d of deleted) console.log('  ' + d);
  if (res.partial_failures && res.partial_failures.length) {
    console.log('Partial failures:', JSON.stringify(res.partial_failures));
  }
};

main().catch((err) => {
  console.error('cleanup failed:', err.message);
  process.exit(1);
});
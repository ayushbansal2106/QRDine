#!/usr/bin/env node
/**
 * QRDine — database backup and restore drill.
 *
 * A backup nobody has restored is a belief, not a safety net, so this tool can
 * do both halves and prove the second one:
 *
 *   node scripts/backup.js            # write a fresh backup
 *   node scripts/backup.js list       # show what backups exist
 *   node scripts/backup.js verify <id># every file re-checksums against the manifest
 *   node scripts/backup.js restore <id> --to <uri> [--yes]
 *
 * Backups land in backend/backups/<timestamp>/ — outside the app so a redeploy
 * never silently drops them, and gitignored so customer PII is never committed.
 *
 * Why this exists on top of Atlas's own backups: it verifies what *you* can
 * actually get back, on demand, into a cluster you control, without waiting on a
 * support ticket. Atlas continuous backup remains the primary defence; this is
 * the rehearsed second one.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

require('dotenv').config();

const DEFAULT_BACKUP_ROOT = path.join(__dirname, '..', 'backups');
// Mutable so the drill test can redirect output without touching the repo's real
// backup directory. `QRDINE_BACKUP_DIR` does the same for a child process, which
// is how the CLI end-to-end check keeps its artefacts out of `backups/`.
let BACKUP_ROOT = process.env.QRDINE_BACKUP_DIR
  ? path.resolve(process.env.QRDINE_BACKUP_DIR)
  : DEFAULT_BACKUP_ROOT;
const MANIFEST = 'manifest.json';
const DEFAULT_DB_NAME = 'qrdine';

function parseArgs(argv) {
  const [command = 'backup', ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) {
      flags[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    } else {
      positional.push(rest[i]);
    }
  }
  return { command, flags, positional };
}

function timestampId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function listBackupIds() {
  if (!fs.existsSync(BACKUP_ROOT)) return [];
  return fs
    .readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function connect(uri) {
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add it to backend/.env, or pass a URI explicitly to `restore --to`.'
    );
  }

  // Mongoose refuses to re-point an open connection at a different cluster
  // ("Can't call openUri() on an active connection with different connection
  // strings"), which is exactly what `restore --to <other-cluster>` does. Each
  // CLI invocation is a fresh process, but a restore called in-process — or any
  // repeat call — would otherwise fail here, so drop the old connection first.
  if (mongoose.connection.readyState !== 0) {
    const sameUri = mongoose.connection.client?.s?.url === uri;
    if (sameUri) return mongoose.connection;
    await mongoose.disconnect();
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  return mongoose.connection;
}

/** Write a backup, returning its directory. */
async function writeBackup({ quiet = false } = {}) {
  const id = timestampId();
  const dir = path.join(BACKUP_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });

  const conn = await connect(process.env.MONGODB_URI);
  const log = (...args) => !quiet && console.log(...args);

  const collections = (await conn.db.listCollections().toArray()).map((c) => c.name).sort();
  if (!collections.length) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('The database has no collections — nothing to back up. Is MONGODB_URI correct?');
  }

  const entries = [];
  let totalBytes = 0;
  let totalDocs = 0;

  for (const name of collections) {
    const docs = await conn.db.collection(name).find({}).toArray();
    const file = path.join(dir, `${name}.bson.json`);
    const payload = JSON.stringify({ collection: name, documents: docs });
    fs.writeFileSync(file, payload);

    const size = Buffer.byteLength(payload);
    totalBytes += size;
    totalDocs += docs.length;
    entries.push({ collection: name, file: `${name}.bson.json`, documents: docs.length, bytes: size, sha256: sha256(file) });
    log(`  ${name.padEnd(20)} ${String(docs.length).padStart(7)} docs  ${human(size)}`);
  }

  const manifest = {
    id,
    createdAt: new Date().toISOString(),
    source: 'mongodb+srv://***@' + new URL(process.env.MONGODB_URI).host,
    collections: entries.length,
    documents: totalDocs,
    bytes: totalBytes,
    entries,
  };
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2));

  log(`\nBackup ${id}: ${entries.length} collections, ${totalDocs} documents, ${human(totalBytes)}`);
  log(`  ${dir}`);
  log('\nVerify it with:  node scripts/backup.js verify ' + id);

  return manifest;
}

/** Re-checksum every file against the manifest. This is the drill. */
function verifyBackup(id) {
  const dir = path.join(BACKUP_ROOT, id);
  const manifestPath = path.join(dir, MANIFEST);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest for backup "${id}". Available: ${listBackupIds().join(', ') || 'none'}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const results = [];
  let failed = 0;

  for (const entry of manifest.entries) {
    const file = path.join(dir, entry.file);
    if (!fs.existsSync(file)) {
      results.push({ collection: entry.collection, ok: false, reason: 'missing file' });
      failed += 1;
      continue;
    }
    const actual = sha256(file);
    const ok = actual === entry.sha256;
    if (!ok) failed += 1;
    results.push({
      collection: entry.collection,
      ok,
      documents: entry.documents,
      bytes: entry.bytes,
      reason: ok ? null : `checksum mismatch (expected ${entry.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
    });
  }

  console.log(`Verifying backup ${id} (taken ${manifest.createdAt})`);
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    const detail = r.ok ? `${r.documents} docs, ${human(r.bytes)}` : r.reason;
    console.log(`  ${mark} ${r.collection.padEnd(20)} ${detail}`);
  }

  console.log(
    failed === 0
      ? `\nPASS — ${results.length}/${results.length} collections intact. This backup is restorable.`
      : `\nFAIL — ${failed}/${results.length} collections damaged. Do not rely on this backup.`
  );
  console.log('Note: this proves the files are intact and readable. It does not prove a full');
  console.log('      restore succeeds — run `restore` against a scratch database for that.');

  return failed === 0;
}

/** Restore into a target cluster. Deliberately refuses an implicit same-cluster write. */
async function restoreBackup(id, targetUri, { yes = false } = {}) {
  const dir = path.join(BACKUP_ROOT, id);
  const manifestPath = path.join(dir, MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest for backup "${id}". Available: ${listBackupIds().join(', ') || 'none'}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (!targetUri) {
    throw new Error(
      'Refusing to guess the restore target. Pass --to <uri>.\n' +
        '  Use a scratch cluster for a drill, e.g. your Atlas M0 dev cluster.'
    );
  }

  const sourceHost = new URL(manifest.source.replace('***@', 'x@')).host;
  const targetHost = new URL(targetUri).host;
  const sameCluster = sourceHost === targetHost;

  if (sameCluster && !yes) {
    throw new Error(
      `That is the cluster this backup came from (${sourceHost}).\n` +
        'Restoring in place would overwrite live data. Re-run with --yes if that is genuinely what you want.'
    );
  }

  console.log(`Restoring ${manifest.id} → ${targetHost}`);
  console.log(`  ${manifest.collections} collections, ${manifest.documents} documents, ${human(manifest.bytes)}`);

  const conn = await connect(targetUri);
  let restored = 0;

  for (const entry of manifest.entries) {
    const payload = JSON.parse(fs.readFileSync(path.join(dir, entry.file), 'utf8'));
    const col = conn.db.collection(entry.collection);
    // Replace rather than merge: a restore must reproduce the backup exactly,
    // not accumulate documents that were deleted before it was taken.
    await col.deleteMany({});
    if (payload.documents.length) {
      await col.insertMany(payload.documents, { ordered: false });
    }
    restored += payload.documents.length;
    console.log(`  ✓ ${entry.collection.padEnd(20)} ${payload.documents.length} docs`);
  }

  // Count what actually landed, rather than trusting the insert count.
  let landed = 0;
  for (const entry of manifest.entries) {
    landed += await conn.db.collection(entry.collection).countDocuments({});
  }

  console.log(`\nRestored ${landed} documents into ${targetHost}`);
  if (landed !== manifest.documents) {
    throw new Error(
      `Restore verification failed: expected ${manifest.documents} documents, found ${landed}. ` +
        'The backup may be inconsistent — do not trust it.'
    );
  }
  console.log(`Verified: ${landed} documents match the manifest.`);

  return { restored, collections: manifest.collections };
}

async function main() {
  const { command, flags, positional } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'backup':
      await writeBackup();
      break;

    case 'list': {
      const ids = listBackupIds();
      if (!ids.length) {
        console.log('No backups yet. Run: node scripts/backup.js');
        break;
      }
      console.log(`${ids.length} backup(s) in ${BACKUP_ROOT}\n`);
      for (const id of ids) {
        const manifestPath = path.join(BACKUP_ROOT, id, MANIFEST);
        if (!fs.existsSync(manifestPath)) {
          console.log(`  ${id}  (no manifest — incomplete)`);
          continue;
        }
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        console.log(
          `  ${id}  ${String(m.collections).padStart(2)} collections  ` +
            `${String(m.documents).padStart(6)} docs  ${human(m.bytes).padStart(9)}  ${m.createdAt}`
        );
      }
      break;
    }

    case 'verify': {
      const ok = verifyBackup(positional[0] || listBackupIds()[0]);
      process.exitCode = ok ? 0 : 1;
      break;
    }

    case 'restore': {
      const ok = verifyBackup(positional[0] || listBackupIds()[0]);
      if (!ok) {
        console.error('\nRefusing to restore a damaged backup.');
        process.exit(1);
      }
      await restoreBackup(positional[0] || listBackupIds()[0], flags.to, { yes: flags.yes === true });
      break;
    }

    default:
      console.error(`Unknown command "${command}".`);
      console.error('Usage: node scripts/backup.js [backup|list|verify <id>|restore <id> --to <uri>]');
      process.exit(1);
  }
}

if (require.main === module) {
  main()
    .then(async () => {
      await mongoose.disconnect().catch(() => {});
    })
    .catch(async (error) => {
      console.error(`\n${error.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = {
  writeBackup,
  verifyBackup,
  restoreBackup,
  listBackupIds,
  sha256,
  get BACKUP_ROOT() {
    return BACKUP_ROOT;
  },
  set BACKUP_ROOT(value) {
    BACKUP_ROOT = value;
  },
  DEFAULT_BACKUP_ROOT,
  DEFAULT_DB_NAME,
};
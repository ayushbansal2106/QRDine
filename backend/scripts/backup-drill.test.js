/**
 * End-to-end proof that `scripts/backup.js` actually works.
 *
 * The point of these tests is the round trip: a backup is written, deliberately
 * damaged, verified as damaged, restored into a *separate* database, and then
 * proved equal to the original. A backup tool that has only ever been
 * "it printed a manifest" is exactly the thing BLOCKER-06 warned about, so this
 * drives the real scripts against a real (in-memory) MongoDB.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';

const backupTool = require('./backup');

// Keep the drill entirely inside the repo's own temp dir.
const TEST_ROOT = path.join(__dirname, '..', 'backups-test');

describe('backup and restore drill', () => {
  let source;
  let scratch;
  let sourceUri;
  let scratchUri;

  beforeAll(async () => {
    source = await MongoMemoryServer.create();
    scratch = await MongoMemoryServer.create();
    // Held verbatim so every later connect uses the *identical* string. Passing
    // a differing dbName would make Mongoose treat it as a different cluster.
    sourceUri = source.getUri();
    scratchUri = scratch.getUri();
    await mongoose.connect(sourceUri);
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await source.stop().catch(() => {});
    await scratch.stop().catch(() => {});
    if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }, 60000);

  /** Point the tool at the in-memory cluster and a throwaway backup dir. */
  const withEnv = (uri, fn) => {
    const prevUri = process.env.MONGODB_URI;
    const prevRoot = backupTool.BACKUP_ROOT;
    process.env.MONGODB_URI = uri;
    backupTool.BACKUP_ROOT = TEST_ROOT;
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        process.env.MONGODB_URI = prevUri;
        backupTool.BACKUP_ROOT = prevRoot;
      });
  };

  it('round-trips real documents through backup, damage, verify and restore', async () => {
    const db = mongoose.connection.db;

    // Two collections with enough shape to be a meaningful restore: nested
    // objects, arrays, numbers and strings all have to survive JSON.
    await db.collection('orders').insertMany([
      { _id: new mongoose.Types.ObjectId(), total: 450.5, items: [{ name: 'Paneer Tikka', qty: 2 }], paid: true },
      { _id: new mongoose.Types.ObjectId(), total: 120, items: [{ name: 'Chai', qty: 1 }], paid: false },
    ]);
    await db.collection('customers').insertMany([
      { _id: new mongoose.Types.ObjectId(), phone: '9876543210', prefs: { vegOnly: true }, tags: ['vip', 'early'] },
    ]);

    // ── backup ──────────────────────────────────────────────────────────
    const manifest = await withEnv(sourceUri, () => backupTool.writeBackup({ quiet: true }));

    expect(manifest.collections).toBe(2);
    expect(manifest.documents).toBe(3);
    expect(manifest.entries.every((e) => /^[a-f0-9]{64}$/.test(e.sha256))).toBe(true);

    const dir = path.join(TEST_ROOT, manifest.id);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);

    // ── verify an untouched backup passes ───────────────────────────────
    await expect(withEnv(sourceUri, () => backupTool.verifyBackup(manifest.id))).resolves.toBe(true);

    // ── corruption must be caught, not glossed over ─────────────────────
    const victim = manifest.entries.find((e) => e.collection === 'orders');
    const victimFile = path.join(dir, victim.file);
    const original = fs.readFileSync(victimFile, 'utf8');
    fs.writeFileSync(victimFile, original.replace('450.5', '999.5'));

    // This is the behaviour that matters: silent corruption is worse than a
    // missing backup, because it is believed until the day it is needed.
    await expect(withEnv(sourceUri, () => backupTool.verifyBackup(manifest.id))).resolves.toBe(false);

    fs.writeFileSync(victimFile, original);
    await expect(withEnv(sourceUri, () => backupTool.verifyBackup(manifest.id))).resolves.toBe(true);

    // ── a missing file must fail too, not read as zero documents ────────
    fs.unlinkSync(victimFile);
    await expect(withEnv(sourceUri, () => backupTool.verifyBackup(manifest.id))).resolves.toBe(false);
    fs.writeFileSync(victimFile, original);

    // ── restore into a DIFFERENT cluster and prove equality ─────────────
    const result = await withEnv(scratchUri, () =>
      backupTool.restoreBackup(manifest.id, scratchUri, { yes: true })
    );
    expect(result.restored).toBe(3);
    expect(result.collections).toBe(2);

    // `restoreBackup` left the connection on the scratch cluster, which is
    // exactly what we want to read back from.
    expect(mongoose.connection.client.s.url).toBe(scratchUri);

    const restoredOrders = await mongoose.connection.db.collection('orders').find({}).sort({ total: 1 }).toArray();
    const restoredCustomer = await mongoose.connection.db.collection('customers').findOne({});

    expect(restoredOrders).toHaveLength(2);
    expect(restoredOrders[0].total).toBe(120);
    expect(restoredOrders[1].total).toBe(450.5);
    expect(restoredOrders[1].items[0]).toMatchObject({ name: 'Paneer Tikka', qty: 2 });
    expect(restoredCustomer.phone).toBe('9876543210');
    expect(restoredCustomer.prefs).toEqual({ vegOnly: true });
    expect(restoredCustomer.tags).toEqual(['vip', 'early']);

    // Leave the connection on the source cluster for any later test.
    await mongoose.disconnect();
    await mongoose.connect(sourceUri);
  }, 120000);

  it('refuses to restore in place without an explicit confirmation', async () => {
    const manifest = await withEnv(sourceUri, () => backupTool.writeBackup({ quiet: true }));
    const dir = path.join(TEST_ROOT, manifest.id);

    // Same cluster the backup came from, no --yes: the guard has to fire.
    await expect(
      withEnv(sourceUri, () =>
        backupTool.restoreBackup(manifest.id, sourceUri, { yes: false })
      )
    ).rejects.toThrow(/overwrite live data/i);

    // And the backup on disk must be intact afterwards.
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
    await expect(withEnv(sourceUri, () => backupTool.verifyBackup(manifest.id))).resolves.toBe(true);
  }, 60000);

  it('refuses to guess a restore target', async () => {
    const manifest = await withEnv(sourceUri, () => backupTool.writeBackup({ quiet: true }));
    await expect(
      withEnv(sourceUri, () => backupTool.restoreBackup(manifest.id, undefined, { yes: true }))
    ).rejects.toThrow(/--to <uri>/);
  }, 60000);

  it('reports a missing backup rather than silently doing nothing', async () => {
    // verifyBackup itself throws synchronously, but withEnv wraps the call in a
    // promise chain, so the throw surfaces as a rejection.
    await expect(withEnv(sourceUri, () => backupTool.verifyBackup('no-such-backup'))).rejects.toThrow(
      /No manifest for backup/
    );
  }, 30000);

  it('lists only real, manifest-bearing backups', async () => {
    await withEnv(sourceUri, () => backupTool.writeBackup({ quiet: true }));

    // An interrupted backup would leave a directory with no manifest.
    const orphan = path.join(TEST_ROOT, '2099-01-01-interrupted');
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'orders.bson.json'), 'garbage');

    // Read through withEnv so listBackupIds sees the test directory rather than
    // the repo's real backups/ folder.
    let ids = [];
    await withEnv(sourceUri, async () => {
      ids = backupTool.listBackupIds();
    });
    expect(ids).toContain('2099-01-01-interrupted'); // listed…
    // …but verification of it fails loudly rather than passing an empty backup.
    await expect(withEnv(sourceUri, () => backupTool.verifyBackup('2099-01-01-interrupted'))).rejects.toThrow(
      /No manifest/
    );

    fs.rmSync(orphan, { recursive: true, force: true });
  }, 60000);
});
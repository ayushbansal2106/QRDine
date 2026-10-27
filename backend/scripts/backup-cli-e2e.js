/**
 * Manual end-to-end exercise of the backup CLI.
 *
 * The jest drill calls the module directly. This spawns the *actual commands* —
 * `node scripts/backup.js backup | verify | restore` — against a seeded
 * in-memory MongoDB, so the argument parsing, exit codes and console output a
 * human would rely on are all covered rather than assumed.
 *
 *   node scripts/backup-cli-e2e.js
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const SCRIPT = path.join(__dirname, 'backup.js');
const BACKUP_DIR = path.join(__dirname, '..', 'backups-e2e');

/** Strip the dotenv-injection banner so the output stays readable. */
const clean = (s) => (s || '').split('\n').filter((l) => !l.includes('injected env')).join('\n');

function run(args, env) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: res.status, out: clean(res.stdout), err: clean(res.stderr) };
}

(async () => {
  const source = await MongoMemoryServer.create();
  const scratch = await MongoMemoryServer.create();

  await mongoose.connect(source.getUri());
  await mongoose.connection.db.collection('orders').insertMany([
    { _id: new mongoose.Types.ObjectId(), total: 450.5, items: [{ name: 'Paneer Tikka', qty: 2 }] },
    { _id: new mongoose.Types.ObjectId(), total: 120 },
  ]);
  await mongoose.connection.db.collection('customers').insertMany([
    { _id: new mongoose.Types.ObjectId(), phone: '9876543210', prefs: { vegOnly: true } },
  ]);
  await mongoose.disconnect();

  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  // QRDINE_BACKUP_DIR keeps the child's artefacts out of the repo's real
  // backups/ directory.
  const env = { MONGODB_URI: source.getUri(), QRDINE_BACKUP_DIR: BACKUP_DIR };

  const fail = (msg) => {
    console.error(`\nE2E FAIL: ${msg}`);
    process.exitCode = 1;
  };

  try {
    // 1. backup
    const backup = run(['backup'], env);
    console.log(backup.out.trim());
    if (backup.code !== 0) throw new Error(`backup exited ${backup.code}: ${backup.err}`);

    const id = fs
      .readdirSync(BACKUP_DIR)
      .filter((d) => fs.existsSync(path.join(BACKUP_DIR, d, 'manifest.json')))
      .sort()
      .pop();
    if (!id) throw new Error('no backup directory with a manifest was produced');
    console.log(`\n[1/5] backup written: ${id}`);

    // 2. list
    const list = run(['list'], env);
    if (list.code !== 0 || !list.out.includes(id)) throw new Error('list did not report the new backup');
    console.log(`[2/5] list reports it:\n${list.out.trim().split('\n').slice(1).join('\n')}`);

    // 3. verify passes on an intact backup
    const verify = run(['verify', id], env);
    console.log(verify.out.trim());
    if (verify.code !== 0) throw new Error(`verify exited ${verify.code} on a good backup`);
    console.log('[3/5] verify PASSES on an intact backup');

    // 4. corruption is caught with a non-zero exit
    const manifest = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, id, 'manifest.json'), 'utf8'));
    const victim = manifest.entries.find((e) => e.collection === 'orders');
    const victimPath = path.join(BACKUP_DIR, id, victim.file);
    const original = fs.readFileSync(victimPath, 'utf8');
    fs.writeFileSync(victimPath, original.replace('450.5', '1'));

    const damaged = run(['verify', id], env);
    console.log(damaged.out.trim());
    if (damaged.code === 0) throw new Error('verify exited 0 on a corrupted backup — the guard is broken');
    if (!damaged.out.includes('FAIL')) throw new Error('verify did not report FAIL');
    console.log('[4/5] verify FAILS loudly on corruption (exit non-zero)');

    // Restoring a damaged backup must be refused outright.
    const blocked = run(['restore', id, '--to', scratch.getUri()], env);
    if (blocked.code === 0) throw new Error('restore proceeded on a damaged backup');
    console.log('      restore refused on a damaged backup, as it should');

    fs.writeFileSync(victimPath, original);

    // 5. restore into the OTHER cluster and read the data back
    const restore = run(['restore', id, '--to', scratch.getUri()], env);
    console.log('\n' + restore.out.trim());
    if (restore.code !== 0) throw new Error(`restore exited ${restore.code}: ${restore.err}`);

    await mongoose.connect(scratch.getUri());
    const orders = await mongoose.connection.db.collection('orders').find({}).sort({ total: 1 }).toArray();
    const customer = await mongoose.connection.db.collection('customers').findOne({});
    await mongoose.disconnect();

    if (orders.length !== 2) throw new Error(`expected 2 restored orders, got ${orders.length}`);
    if (orders[1].total !== 450.5) throw new Error(`numeric round trip failed: ${orders[1].total}`);
    if (orders[1].items[0].name !== 'Paneer Tikka') throw new Error('nested array round trip failed');
    if (customer.phone !== '9876543210') throw new Error('customer round trip failed');
    if (customer.prefs.vegOnly !== true) throw new Error('nested object round trip failed');

    console.log('[5/5] RESTORED DATA READ BACK AND MATCHES (nested objects, arrays, floats)');
    console.log('\nE2E PASS — the backup and restore commands work end to end.');
  } catch (error) {
    fail(error.message);
  } finally {
    await mongoose.disconnect().catch(() => {});
    await source.stop().catch(() => {});
    await scratch.stop().catch(() => {});
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  }
})();
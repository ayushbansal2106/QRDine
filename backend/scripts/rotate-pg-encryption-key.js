#!/usr/bin/env node
/**
 * QRDine — Payment Gateway Secret Key Rotation Pipeline (Task 7.6 / SEC-105)
 *
 * Re-encrypts all stored payment gateway secrets (keySecretEncrypted, webhookSecretEncrypted)
 * from the previous encryption key to the new encryption key.
 *
 * Usage:
 *   node scripts/rotate-pg-encryption-key.js [--prev-key <key>] [--new-key <key>] [--dry-run] [--demo]
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Cafe = require('../src/models/Cafe');
const {
  deriveKey,
  tryDecryptWithKey,
  encryptTextWithKey,
} = require('../src/utils/cryptoHelper');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    prevKey: null,
    newKey: null,
    dryRun: false,
    demo: false,
    cafeId: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prev-key' && args[i + 1]) {
      options.prevKey = args[++i];
    } else if (args[i] === '--new-key' && args[i + 1]) {
      options.newKey = args[++i];
    } else if (args[i] === '--cafe-id' && args[i + 1]) {
      options.cafeId = args[++i];
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--demo') {
      options.demo = true;
    }
  }

  return options;
};

const runRotation = async () => {
  const options = parseArgs();
  let ephemeralMongo = null;

  console.log('\n============================================================');
  console.log('  QRDine Task 7.6: Payment Gateway Secret Key Rotation CLI');
  console.log('============================================================\n');

  if (options.dryRun) {
    console.log('ℹ️  DRY RUN MODE: No changes will be written to the database.\n');
  }

  const prevKeySecret =
    options.prevKey ||
    process.env.PG_ENCRYPTION_KEY_PREVIOUS ||
    process.env.JWT_SECRET ||
    '';
  const newKeySecret =
    options.newKey ||
    process.env.PG_ENCRYPTION_KEY ||
    '';

  if (!newKeySecret) {
    console.error('❌ ERROR: New encryption key is required. Set PG_ENCRYPTION_KEY in env or pass --new-key.');
    process.exit(1);
  }

  if (!prevKeySecret) {
    console.error('❌ ERROR: Previous encryption key is required. Set PG_ENCRYPTION_KEY_PREVIOUS (or JWT_SECRET) or pass --prev-key.');
    process.exit(1);
  }

  const oldKeyBuffer = deriveKey(prevKeySecret);
  const newKeyBuffer = deriveKey(newKeySecret);

  try {
    let connected = false;
    const mongoUri = process.env.MONGODB_URI;

    if (!options.demo && mongoUri) {
      try {
        console.log('Connecting to database...');
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
        connected = true;
        console.log(' Connected to MongoDB.');
      } catch (err) {
        console.warn(`⚠️  Could not connect to production/local DB (${err.message}). Falling back to ephemeral in-memory MongoDB.`);
      }
    }

    if (!connected) {
      ephemeralMongo = await MongoMemoryServer.create();
      await mongoose.connect(ephemeralMongo.getUri());
      console.log(' Connected to ephemeral in-memory MongoDB.');

      // Seed sample cafe for verification if needed
      const sampleOldKeyEncryptedKey = encryptTextWithKey('rzp_test_secret_12345', oldKeyBuffer);
      const sampleOldWebhookEncrypted = encryptTextWithKey('rzp_whsec_secret_67890', oldKeyBuffer);

      await Cafe.create({
        name: 'Rotation Verification Cafe',
        email: 'rotation@qrdine.local',
        phone: '9876543210',
        paymentGateway: {
          enabled: true,
          provider: 'razorpay',
          keyId: 'rzp_test_key_123',
          keySecretEncrypted: sampleOldKeyEncryptedKey,
          webhookSecretEncrypted: sampleOldWebhookEncrypted,
        },
      });
      console.log(' Seeded 1 test cafe with old-key encrypted PG secrets for demonstration.');
    }

    const query = {
      $or: [
        { 'paymentGateway.keySecretEncrypted': { $exists: true, $ne: '' } },
        { 'paymentGateway.webhookSecretEncrypted': { $exists: true, $ne: '' } },
      ],
    };
    if (options.cafeId) {
      query._id = options.cafeId;
    }

    const cafes = await Cafe.find(query);
    console.log(`Found ${cafes.length} cafe(s) with PG secrets configured.\n`);

    let rotatedCafesCount = 0;
    let rotatedFieldsCount = 0;
    let failureCount = 0;
    let alreadyUpToDateCount = 0;
    const bulkOps = [];

    for (const cafe of cafes) {
      const updates = {};
      let cafeChanged = false;

      // 1. Process keySecretEncrypted
      const currentKeySec = cafe.paymentGateway?.keySecretEncrypted;
      if (currentKeySec) {
        const checkNew = tryDecryptWithKey(currentKeySec, newKeyBuffer);
        if (checkNew.success) {
          alreadyUpToDateCount++;
        } else {
          const checkOld = tryDecryptWithKey(currentKeySec, oldKeyBuffer);
          if (checkOld.success) {
            const reEncrypted = encryptTextWithKey(checkOld.plaintext, newKeyBuffer);
            updates['paymentGateway.keySecretEncrypted'] = reEncrypted;
            rotatedFieldsCount++;
            cafeChanged = true;
          } else {
            console.error(`❌ Failed to decrypt keySecret for cafe ${cafe._id} (${cafe.name}) with both new and previous keys.`);
            failureCount++;
          }
        }
      }

      // 2. Process webhookSecretEncrypted
      const currentWhSec = cafe.paymentGateway?.webhookSecretEncrypted;
      if (currentWhSec) {
        const checkNew = tryDecryptWithKey(currentWhSec, newKeyBuffer);
        if (checkNew.success) {
          alreadyUpToDateCount++;
        } else {
          const checkOld = tryDecryptWithKey(currentWhSec, oldKeyBuffer);
          if (checkOld.success) {
            const reEncrypted = encryptTextWithKey(checkOld.plaintext, newKeyBuffer);
            updates['paymentGateway.webhookSecretEncrypted'] = reEncrypted;
            rotatedFieldsCount++;
            cafeChanged = true;
          } else {
            console.error(`❌ Failed to decrypt webhookSecret for cafe ${cafe._id} (${cafe.name}) with both new and previous keys.`);
            failureCount++;
          }
        }
      }

      if (cafeChanged) {
        rotatedCafesCount++;
        bulkOps.push({
          updateOne: {
            filter: { _id: cafe._id },
            update: { $set: updates },
          },
        });
      }
    }

    if (bulkOps.length > 0 && !options.dryRun) {
      await Cafe.bulkWrite(bulkOps);
      console.log(` Successfully executed atomic bulkWrite for ${bulkOps.length} cafe(s).`);
    } else if (options.dryRun && bulkOps.length > 0) {
      console.log(` Dry-run: would execute bulkWrite for ${bulkOps.length} cafe(s).`);
    }

    console.log('\n--- Key Rotation Report ---');
    console.log(`Cafes evaluated:           ${cafes.length}`);
    console.log(`Cafes re-encrypted:        ${rotatedCafesCount}`);
    console.log(`Fields rotated:            ${rotatedFieldsCount}`);
    console.log(`Fields already up-to-date: ${alreadyUpToDateCount}`);
    console.log(`Failures:                  ${failureCount}`);
    console.log('---------------------------\n');

    const summaryReport = `${rotatedCafesCount} cafes re-encrypted, ${rotatedFieldsCount} fields rotated, ${failureCount} failures`;
    console.log(`Result: ${summaryReport}`);

    if (failureCount > 0) {
      console.error('\n⚠️  Rotation completed with errors. Investigate un-decryptable secrets.');
      process.exitCode = 1;
    } else {
      console.log('\n Secret key rotation completed successfully!');
    }
  } catch (err) {
    console.error('Fatal error during key rotation:', err);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (ephemeralMongo) {
      await ephemeralMongo.stop();
    }
  }
};

if (require.main === module) {
  runRotation();
}

module.exports = { runRotation };

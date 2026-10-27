/**
 * Repair customer profiles that were split by inconsistent phone normalisation.
 *
 * ## Why this exists
 *
 * OTP sign-in normalised a number through `smsService.normalizePhone` (adding the
 * `91` country code) while the POS stored whatever the cashier typed. One person
 * could therefore end up with two profiles:
 *
 *     POS sale  -> customer "Ayush"  phone 9996696235   (holds the orders)
 *     OTP sign-in -> customer ""     phone 919996696235 (empty)
 *
 * The person paid, signed in, and saw an empty order history. `customerService`
 * now normalises on every path, but rows written before that fix are still split,
 * and `findByPhone` deliberately prefers the canonical row rather than guessing
 * at a merge on a read path.
 *
 * ## What it does
 *
 * For each profile whose phone is not canonical:
 *
 *   1. **No canonical counterpart** — heal it in place. Unambiguous.
 *   2. **Canonical counterpart with no live orders** — the canonical row is an
 *      empty shell from the sign-in flow, so fold everything into it and delete
 *      the legacy duplicate. "Live" excludes cancelled orders: a voided draft is
 *      a leftover of the same broken flow, not a competing visit history.
 *   3. **Canonical counterpart that also has orders** — two real histories.
 *      Merging those needs a human decision about which visits count, so the
 *      script reports and stops.
 *
 * Run with `--dry` first. Usage:
 *
 *     node scripts/repair-customer-phones.js --dry
 *     node scripts/repair-customer-phones.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const Customer = require('../src/models/Customer');
const Order = require('../src/models/Order');
const LoyaltyCard = require('../src/models/LoyaltyCard');
const ScratchCard = require('../src/models/ScratchCard');
const Wallet = require('../src/models/Wallet');
const WalletTransaction = require('../src/models/WalletTransaction');
const Review = require('../src/models/Review');
const Coupon = require('../src/models/Coupon');
const { canonicalPhone } = require('../src/services/customerService');

const DRY = process.argv.includes('--dry');

/** Everything that points at a customer and must follow a merge. */
const OWNED = [
  { name: 'Order', model: Order, field: 'customerId' },
  { name: 'LoyaltyCard', model: LoyaltyCard, field: 'customerId' },
  { name: 'ScratchCard', model: ScratchCard, field: 'customerId' },
  { name: 'WalletTransaction', model: WalletTransaction, field: 'customerId' },
  { name: 'Review', model: Review, field: 'customerId' },
];

/**
 * Wallets and loyalty cards are unique per (cafeId, customerId), so a naive
 * re-point hits a duplicate-key error. Fold the duplicate's rows into the
 * survivor and drop the loser.
 */
const mergeUniqueOwned = async (fromId, toId) => {
  const merged = [];

  const [fromWallet, toWallet] = await Promise.all([
    Wallet.findOne({ customerId: fromId }),
    Wallet.findOne({ customerId: toId }),
  ]);

  if (fromWallet && toWallet) {
    toWallet.balance = Number(((toWallet.balance || 0) + (fromWallet.balance || 0)).toFixed(2));
    await toWallet.save();
    await WalletTransaction.updateMany(
      { walletId: fromWallet._id },
      { $set: { walletId: toWallet._id, customerId: toId } }
    );
    await Wallet.deleteOne({ _id: fromWallet._id });
    merged.push('Wallet (balances combined)');
  } else if (fromWallet) {
    await Wallet.updateOne({ _id: fromWallet._id }, { $set: { customerId: toId } });
    merged.push('Wallet');
  }

  const [fromCard, toCard] = await Promise.all([
    LoyaltyCard.findOne({ customerId: fromId }),
    LoyaltyCard.findOne({ customerId: toId }),
  ]);

  if (fromCard && toCard) {
    toCard.stamps = Math.max(toCard.stamps || 0, fromCard.stamps || 0);
    if (fromCard.tier && (!toCard.tier || fromCard.tier > toCard.tier)) {
      toCard.tier = fromCard.tier;
    }
    await toCard.save();
    await LoyaltyCard.deleteOne({ _id: fromCard._id });
    merged.push('LoyaltyCard (stamps kept at the higher count)');
  } else if (fromCard) {
    await LoyaltyCard.updateOne({ _id: fromCard._id }, { $set: { customerId: toId } });
    merged.push('LoyaltyCard');
  }

  return merged;
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(DRY ? 'DRY RUN — nothing will be written\n' : 'LIVE RUN\n');

  const all = await Customer.find({}).lean();
  const legacy = all.filter((c) => canonicalPhone(c.phone) !== c.phone);

  console.log(`${all.length} customer profile(s); ${legacy.length} stored in a non-canonical form\n`);

  let healed = 0;
  let merged = 0;
  const skipped = [];

  for (const row of legacy) {
    const canonical = canonicalPhone(row.phone);
    const counterpart = all.find(
      (c) => String(c._id) !== String(row._id) && c.phone === canonical
    );

    // Case 1 — nobody else holds this number. Just fix the spelling.
    if (!counterpart) {
      console.log(`heal    ${row.phone} -> ${canonical}   (${row.name || 'no name'})`);
      if (!DRY) {
        await Customer.updateOne({ _id: row._id }, { $set: { phone: canonical } });
      }
      healed++;
      continue;
    }

    const [legacyOrders, canonicalOrders] = await Promise.all([
      Order.countDocuments({ customerId: row._id, status: { $ne: 'cancelled' } }),
      Order.countDocuments({ customerId: counterpart._id, status: { $ne: 'cancelled' } }),
    ]);

    // Case 3 — both sides have real history. Not ours to decide.
    //
    // The count deliberately excludes cancelled orders. A voided ₹200 QR draft
    // is not a competing visit history — it is a row left behind by the very
    // flow that created the empty shell — and treating it as one would strand
    // every real profile this bug ever split.
    if (canonicalOrders > 0) {
      skipped.push({
        legacy: row.phone,
        canonical,
        legacyOrders,
        canonicalOrders,
      });
      console.log(
        `SKIP    ${row.phone} vs ${canonical} — both have live orders ` +
          `(${legacyOrders} vs ${canonicalOrders}). Needs a human decision.\n`
      );
      continue;
    }

    // Case 2 — the canonical row is an empty shell; fold into it.
    console.log(
      `merge   ${row.phone} -> ${canonical}   ` +
        `moving ${legacyOrders} live order(s), keeping profile ${counterpart._id}`
    );

    if (!DRY) {
      for (const { name, model, field } of OWNED) {
        const res = await model.updateMany({ [field]: row._id }, { $set: { [field]: counterpart._id } });
        if (res.modifiedCount > 0) console.log(`          ${name}: ${res.modifiedCount}`);
      }
      const extra = await mergeUniqueOwned(row._id, counterpart._id);
      extra.forEach((line) => console.log(`          ${line}`));

      // Targeted coupons reference customers through an array.
      await Coupon.updateMany(
        { customerIds: row._id },
        { $addToSet: { customerIds: counterpart._id } }
      );
      await Coupon.updateMany(
        { customerIds: row._id },
        { $pull: { customerIds: row._id } }
      );

      // Carry over anything the empty shell was missing, then drop it.
      const patch = {};
      if (!counterpart.name && row.name) patch.name = row.name;
      if (!counterpart.email && row.email) patch.email = row.email;
      if (Object.keys(patch).length > 0) {
        await Customer.updateOne({ _id: counterpart._id }, { $set: patch });
        console.log(`          filled in: ${Object.keys(patch).join(', ')}`);
      }
      if (!counterpart.firstSeenAt || (row.firstSeenAt && row.firstSeenAt < counterpart.firstSeenAt)) {
        await Customer.updateOne({ _id: counterpart._id }, { $set: { firstSeenAt: row.firstSeenAt } });
      }

      await Customer.deleteOne({ _id: row._id });
    }
    merged++;
  }

  console.log(`\nhealed ${healed}, merged ${merged}, skipped ${skipped.length}`);
  if (skipped.length > 0) {
    console.log('Skipped pairs need reviewing before any merge.');
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('Repair failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});

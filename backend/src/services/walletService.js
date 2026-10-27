const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const AppError = require('../utils/AppError');
const auditService = require('./auditService');
const socketService = require('./socketService');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Module #17 — prepaid store wallet.
 *
 * Balance changes are atomic: debits use a conditional `$inc` so a concurrent
 * spend can never drive the balance negative. Every mutation writes a passbook
 * row, and an optional `clientRequestId` makes each mutation idempotent.
 */

const getWallet = (cafeId, customerId) => Wallet.findOne({ cafeId, customerId });

const getOrCreateWallet = async ({ cafeId, customerId, currency = 'INR' }) => {
  let wallet = await Wallet.findOne({ cafeId, customerId });
  if (!wallet) {
    wallet = await Wallet.create({ cafeId, customerId, currency });
  }
  return wallet;
};

const findByIdempotencyKey = async (clientRequestId) => {
  if (!clientRequestId) return null;
  const existing = await WalletTransaction.findOne({ clientRequestId });
  if (!existing) return null;
  const wallet = await Wallet.findById(existing.walletId);
  return { wallet, transaction: existing, idempotent: true };
};

/** Add money to a wallet (top-up / bonus / refund / adjustment). */
const credit = async ({
  cafeId,
  customerId,
  amount,
  type = 'topup',
  reference = '',
  note = '',
  staffId = null,
  staffName = '',
  clientRequestId = null,
}) => {
  const value = round2(amount);
  if (!(value > 0)) {
    throw new AppError('Credit amount must be positive', 400);
  }

  const duplicate = await findByIdempotencyKey(clientRequestId);
  if (duplicate) return duplicate;

  const wallet = await getOrCreateWallet({ cafeId, customerId });
  wallet.balance = round2(wallet.balance + value);
  if (type === 'topup') wallet.totalTopups = round2(wallet.totalTopups + value);
  wallet.lastTransactionAt = new Date();
  await wallet.save();

  const transaction = await WalletTransaction.create({
    cafeId,
    walletId: wallet._id,
    customerId,
    type,
    amount: value,
    balanceAfter: wallet.balance,
    reference,
    note,
    staffId,
    staffName,
    clientRequestId,
  });

  auditService
    .recordEvent({
      cafeId,
      type: 'wallet.credit',
      entityType: 'Wallet',
      entityId: wallet._id,
      amount: value,
      staffId,
      staffName,
      metadata: { customerId: String(customerId), type, reference },
    })
    .catch((err) => console.error('Wallet audit write failed (non-blocking):', err.message));

  socketService.emitWalletUpdated(cafeId, { customerId, balance: wallet.balance });

  return { wallet, transaction, idempotent: false };
};

/** Spend from a wallet (payment / adjustment). Never allows a negative balance. */
const debit = async ({
  cafeId,
  customerId,
  amount,
  type = 'payment',
  orderId = null,
  reference = '',
  note = '',
  staffId = null,
  staffName = '',
  clientRequestId = null,
}) => {
  const value = round2(amount);
  if (!(value > 0)) {
    throw new AppError('Debit amount must be positive', 400);
  }

  const duplicate = await findByIdempotencyKey(clientRequestId);
  if (duplicate) return duplicate;

  const wallet = await Wallet.findOne({ cafeId, customerId });
  if (!wallet) {
    throw new AppError('No wallet found for this customer', 404);
  }
  if (wallet.balance + 0.001 < value) {
    throw new AppError('Insufficient wallet balance', 400);
  }

  // Atomic conditional decrement guards against concurrent spends.
  const updated = await Wallet.findOneAndUpdate(
    { _id: wallet._id, balance: { $gte: value } },
    { $inc: { balance: -value, totalSpent: value }, $set: { lastTransactionAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    throw new AppError('Insufficient wallet balance', 400);
  }

  const transaction = await WalletTransaction.create({
    cafeId,
    walletId: updated._id,
    customerId,
    type,
    amount: -value,
    balanceAfter: round2(updated.balance),
    orderId,
    reference,
    note,
    staffId,
    staffName,
    clientRequestId,
  });

  auditService
    .recordEvent({
      cafeId,
      type: 'wallet.debit',
      entityType: 'Wallet',
      entityId: updated._id,
      amount: value,
      staffId,
      staffName,
      metadata: { customerId: String(customerId), orderId: orderId ? String(orderId) : null, reference },
    })
    .catch((err) => console.error('Wallet audit write failed (non-blocking):', err.message));

  socketService.emitWalletUpdated(cafeId, { customerId, balance: updated.balance });

  return { wallet: updated, transaction, idempotent: false };
};

const listTransactions = async (cafeId, customerId, { page = 1, limit = 25 } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const [transactions, total] = await Promise.all([
    WalletTransaction.find({ cafeId, customerId }).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    WalletTransaction.countDocuments({ cafeId, customerId }),
  ]);
  return { transactions, total };
};

module.exports = { getWallet, getOrCreateWallet, credit, debit, listTransactions, round2 };

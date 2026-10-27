const Wallet = require('../models/Wallet');
const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const walletService = require('../services/walletService');
const resolveGuestToken = require('../utils/resolveGuestToken');

/** Resolve the customer behind a guest session token (throws if unauthorised). */
const resolveGuestCustomerId = async (req, sessionId) => {
  const guestToken = resolveGuestToken(req);
  if (!guestToken) throw new AppError('Forbidden: Invalid or missing guest session token', 403);

  // The guest token alone identifies the dining session; sessionId is an optional hint.
  const session = sessionId
    ? await DiningSession.findById(sessionId)
    : await DiningSession.findOne({ guestToken });
  if (!session) throw new AppError('Dining session not found', 404);

  if (session.guestToken !== guestToken) {
    throw new AppError('Forbidden: Invalid or missing guest session token', 403);
  }

  const order = await Order.findOne({ sessionId: session._id, customerId: { $ne: null } })
    .sort({ createdAt: -1 })
    .select('customerId');

  return { cafeId: session.cafeId, customerId: order ? order.customerId : null };
};

// ─── Customer-facing (guest token scoped) ───────────────

// 1. Wallet balance + recent passbook for the current guest
const getMyWallet = asyncHandler(async (req, res) => {
  const { sessionId } = req.query;
  const { cafeId, customerId } = await resolveGuestCustomerId(req, sessionId);

  if (!customerId) {
    return res.status(200).json({ success: true, wallet: null, transactions: [] });
  }

  const [wallet, ledger] = await Promise.all([
    walletService.getWallet(cafeId, customerId),
    walletService.listTransactions(cafeId, customerId, { page: 1, limit: 20 }),
  ]);

  res.status(200).json({
    success: true,
    wallet: wallet || { balance: 0, currency: 'INR' },
    transactions: ledger.transactions,
  });
});

// 2. Pay for an order from the wallet (one-tap checkout, idempotent)
const payWithWallet = asyncHandler(async (req, res) => {
  const { sessionId, orderId, amount, clientRequestId } = req.body;
  const { cafeId, customerId } = await resolveGuestCustomerId(req, sessionId);

  if (!customerId) {
    throw new AppError('Link a phone number to your order to use the wallet', 400);
  }

  let debitAmount = Number(amount) || 0;
  if (orderId) {
    const order = await Order.findOne({ _id: orderId, cafeId });
    if (!order) throw new AppError('Order not found', 404);
    if (order.paymentStatus === 'paid') throw new AppError('Order is already paid', 400);
    debitAmount = Number(order.totalAmount) || debitAmount;
  }
  if (!(debitAmount > 0)) {
    throw new AppError('A positive amount is required', 400);
  }

  const { wallet, transaction, idempotent } = await walletService.debit({
    cafeId,
    customerId,
    amount: debitAmount,
    type: 'payment',
    orderId: orderId || null,
    reference: 'wallet-pay',
    clientRequestId: clientRequestId || null,
  });

  // Mark the linked order paid with a wallet tender
  if (orderId) {
    const order = await Order.findOne({ _id: orderId, cafeId });
    if (order && order.paymentStatus !== 'paid') {
      order.payments.push({
        method: 'wallet',
        amount: debitAmount,
        received: debitAmount,
        change: 0,
        reference: transaction._id.toString(),
        paidAt: new Date(),
      });
      order.paymentStatus = 'paid';
      await order.save();
    }
  }

  res.status(idempotent ? 200 : 201).json({
    success: true,
    message: idempotent ? 'Already paid (idempotent)' : 'Wallet payment successful',
    wallet: { balance: wallet.balance },
    transaction,
  });
});

// ─── Admin ─────────────────────────────────────────────

// 3. List wallets (with customer info)
const listWallets = asyncHandler(async (req, res) => {
  const { page = 1, limit = 25, search } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = { cafeId: req.cafeId };
  const [wallets, totalCount] = await Promise.all([
    Wallet.find(filter)
      .populate('customerId', 'name phone email visitCount lifetimeSpend')
      .sort({ balance: -1, updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Wallet.countDocuments(filter),
  ]);

  let filtered = wallets;
  if (search) {
    const term = String(search).toLowerCase();
    filtered = wallets.filter((w) => {
      const c = w.customerId;
      if (!c) return false;
      return (
        (c.name || '').toLowerCase().includes(term) ||
        (c.phone || '').toLowerCase().includes(term) ||
        (c.email || '').toLowerCase().includes(term)
      );
    });
  }

  res.status(200).json({
    success: true,
    page: Number(page),
    limit: Number(limit),
    totalCount,
    totalPages: Math.ceil(totalCount / Number(limit)),
    wallets: filtered,
  });
});

// 4. A customer's wallet + full passbook
const getWalletDetail = asyncHandler(async (req, res) => {
  const { customerId } = req.params;

  const [wallet, ledger] = await Promise.all([
    walletService.getWallet(req.cafeId, customerId),
    walletService.listTransactions(req.cafeId, customerId, { page: 1, limit: 50 }),
  ]);

  res.status(200).json({
    success: true,
    wallet: wallet || { balance: 0, currency: 'INR' },
    transactions: ledger.transactions,
  });
});

// 5. Admin top-up (cash/manual — no gateway). Creates the wallet if needed.
const topUpWallet = asyncHandler(async (req, res) => {
  const { customerId } = req.params;
  const { amount, bonus = 0, reference = '', note = '', clientRequestId } = req.body;

  const customer = await Customer.findOne({ _id: customerId, cafeId: req.cafeId });
  if (!customer) throw new AppError('Customer not found', 404);

  const { wallet, transaction } = await walletService.credit({
    cafeId: req.cafeId,
    customerId,
    amount,
    type: 'topup',
    reference: reference || 'counter-topup',
    note,
    staffId: req.user._id,
    staffName: req.user.name,
    clientRequestId: clientRequestId || null,
  });

  let bonusTransaction = null;
  if (Number(bonus) > 0) {
    const result = await walletService.credit({
      cafeId: req.cafeId,
      customerId,
      amount: bonus,
      type: 'bonus',
      reference: 'topup-bonus',
      note: 'Top-up bonus',
      staffId: req.user._id,
      staffName: req.user.name,
    });
    bonusTransaction = result.transaction;
  }

  res.status(201).json({
    success: true,
    message: 'Wallet topped up',
    wallet: { balance: wallet.balance + (Number(bonus) > 0 ? Number(bonus) : 0) },
    transaction,
    bonusTransaction,
  });
});

// 6. Admin refund to the wallet
const refundToWallet = asyncHandler(async (req, res) => {
  const { customerId } = req.params;
  const { amount, reference = '', note = '', orderId = null } = req.body;

  const { wallet, transaction } = await walletService.credit({
    cafeId: req.cafeId,
    customerId,
    amount,
    type: 'refund',
    reference: reference || 'refund',
    note,
    orderId,
    staffId: req.user._id,
    staffName: req.user.name,
  });

  res.status(201).json({ success: true, message: 'Refund credited', wallet, transaction });
});

module.exports = {
  getMyWallet,
  payWithWallet,
  listWallets,
  getWalletDetail,
  topUpWallet,
  refundToWallet,
};

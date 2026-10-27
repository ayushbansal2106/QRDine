const Order = require('../models/Order');
const DiningSession = require('../models/DiningSession');

/**
 * Module #08 — Shift / cash-drawer reconciliation service.
 *
 * Sales are gathered from two sources in the shift window:
 *   - POS / counter orders: `Order.payments[]` (cash, upi_manual, card_manual, wallet)
 *   - QR dining sessions settled at the counter: `DiningSession` closed with
 *     paymentMethod `paid_counter` (counted as cash) or `paid_online`.
 */

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const emptyBreakdown = () => ({
  cash: 0,
  upi_manual: 0,
  card_manual: 0,
  wallet: 0,
  online: 0,
});

/**
 * Aggregate all settled sales for a cafe within [from, to].
 *
 * @param {string} cafeId
 * @param {Date} from
 * @param {Date} to
 * @returns {Promise<{ breakdown, cashSales, totalSales, orderCount }>}
 */
const collectShiftSales = async (cafeId, from, to) => {
  const breakdown = emptyBreakdown();
  let orderCount = 0;

  // ── POS / counter orders paid during the window ──────────────
  const orders = await Order.find({
    cafeId,
    paymentStatus: 'paid',
    'payments.paidAt': { $gte: from, $lte: to },
  }).select('payments totalAmount');

  for (const order of orders) {
    let counted = false;
    for (const payment of order.payments || []) {
      const paidAt = payment.paidAt ? new Date(payment.paidAt) : null;
      if (!paidAt || paidAt < from || paidAt > to) continue;
      const method = payment.method;
      if (breakdown[method] === undefined) continue;
      breakdown[method] = round2(breakdown[method] + (Number(payment.amount) || 0));
      counted = true;
    }
    if (counted) orderCount += 1;
  }

  // ── QR dining sessions settled at the counter ────────────────
  const sessions = await DiningSession.find({
    cafeId,
    status: 'closed',
    endedAt: { $gte: from, $lte: to },
    paymentMethod: { $in: ['paid_counter', 'paid_online'] },
  }).select('paymentMethod totalAmount endedAt');

  for (const session of sessions) {
    const amount = Number(session.totalAmount) || 0;
    if (session.paymentMethod === 'paid_online') {
      breakdown.online = round2(breakdown.online + amount);
    } else {
      // "paid at counter" is treated as cash for drawer reconciliation
      breakdown.cash = round2(breakdown.cash + amount);
    }
    orderCount += 1;
  }

  const cashSales = breakdown.cash;
  const totalSales = round2(
    breakdown.cash + breakdown.upi_manual + breakdown.card_manual + breakdown.wallet + breakdown.online
  );

  return { breakdown, cashSales, totalSales, orderCount };
};

/** Live summary for an open shift (recomputed on read, never cached). */
const summarizeShift = async (shift) => {
  const from = shift.openedAt || shift.createdAt;
  const to = shift.status === 'closed' && shift.closedAt ? shift.closedAt : new Date();
  const { breakdown, cashSales, totalSales, orderCount } = await collectShiftSales(
    shift.cafeId,
    from,
    to
  );

  const expectedCash = round2((Number(shift.openingFloat) || 0) + cashSales);

  return {
    breakdown,
    cashSales,
    totalSales,
    orderCount,
    expectedCash,
    difference:
      shift.status === 'closed' && shift.closingFloat !== null
        ? round2((Number(shift.closingFloat) || 0) - expectedCash)
        : null,
  };
};

module.exports = { collectShiftSales, summarizeShift, round2, emptyBreakdown };

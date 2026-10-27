const DiningSession = require('../models/DiningSession');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const auditService = require('./auditService');
const socketService = require('./socketService');
const orderService = require('./orderService');

const round2 = orderService.round2;

/**
 * How long a table session may sit with nobody doing anything before it is
 * swept away.
 *
 * Ten minutes is the point where a stale session stops being a convenience and
 * starts being a bug: the table reads as occupied on the floor plan, the next
 * scan is told a session is already open, and a customer who never actually
 * ordered leaves a permanent trace in the session list. The table is physically
 * back in service long before this.
 */
const IDLE_SWEEP_MINUTES = 10;

/** Statuses a session can still be recovered from. */
const OPEN_STATUSES = ['active'];

/**
 * Sum a session's payable total from its live orders plus any adjustments.
 *
 * Deliberately the same shape as the payment pipeline's calculation: a bill the
 * manager force-closes and a bill the guest paid must agree to the rupee, or
 * the closed row and the invoice would disagree on what the table owed.
 */
const computeSessionTotals = (session, orders) => {
  const { subtotal, gst } = orderService.sumBillableItems(orders);

  let additions = 0;
  let discounts = 0;
  for (const adj of session.adjustments || []) {
    if (adj.type === 'addition') additions += adj.amount || 0;
    if (adj.type === 'discount') discounts += adj.amount || 0;
  }

  return {
    subtotal: round2(subtotal),
    gst: round2(gst),
    totalAmount: round2(Math.max(0, subtotal + additions - discounts + gst)),
  };
};

/**
 * Owner/manager manual close.
 *
 * Paying a bill (`markSessionPaid`) already closes the session, so this exists
 * for the cases payment cannot cover: a table cleared after a walkout, a
 * comped or re-billed table, a session stranded by a crashed till.
 *
 * The guard is the point. Closing a session that still has unpaid orders would
 * write the table out of sales history while the money is still owed, so unpaid
 * orders are refused outright unless the caller explicitly writes them off —
 * which is recorded in the immutable ledger rather than silently dropped.
 */
const closeSessionManually = async ({ sessionId, cafeId, user, reason, writeOff = false }) => {
  const session = await DiningSession.findOne({ _id: sessionId, cafeId });
  if (!session) {
    throw new AppError('Session not found', 404);
  }

  if (['paid', 'closed'].includes(session.status)) {
    throw new AppError(`Session is already ${session.status}`, 400);
  }

  const orders = await Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } });
  const unpaid = orders.filter((o) => o.paymentStatus !== 'paid');

  if (unpaid.length > 0 && !writeOff) {
    throw new AppError(
      `This table has ${unpaid.length} unpaid order(s) totalling ` +
        `₹${round2(unpaid.reduce((sum, o) => sum + (o.totalAmount || 0), 0)).toFixed(2)}. ` +
        'Settle them first, or close with a write-off.',
      400
    );
  }

  let writtenOff = 0;
  if (unpaid.length > 0 && writeOff) {
    writtenOff = unpaid.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    await Order.updateMany(
      { _id: { $in: unpaid.map((o) => o._id) } },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          // `cancelledBy` is a free-text staff name on this model, not a ref.
          cancelledBy: user.name,
          cancellationReason: 'Session closed without payment',
        },
      }
    );
    // Only settled orders count toward the closed bill.
    orders.splice(0, orders.length, ...orders.filter((o) => o.paymentStatus === 'paid'));
  }

  const totals = computeSessionTotals(session, orders);
  const now = new Date();

  session.status = 'closed';
  session.endedAt = now;
  session.subtotal = totals.subtotal;
  session.gst = totals.gst;
  session.totalAmount = totals.totalAmount;
  session.addActivity(
    'session_paid',
    `Session closed by ${user.name}${reason ? ` — ${reason}` : ''}`
  );
  await session.save();

  await auditService.recordEvent({
    cafeId,
    type: writtenOff > 0 ? 'session.closed_writeoff' : 'session.closed',
    entityType: 'DiningSession',
    entityId: session._id,
    amount: totals.totalAmount,
    staffId: user._id,
    staffName: user.name,
    metadata: {
      reason: reason || '',
      writtenOffAmount: round2(writtenOff),
      orderCount: orders.length,
      tableId: String(session.tableId),
    },
  });

  socketService.emitSessionActivity(session._id, {
    type: 'session_paid',
    message: `Session closed by ${user.name}`,
    timestamp: now,
  });
  socketService.emitMetricsUpdated(cafeId, { reason: 'session-closed', sessionId: session._id });

  return { session, writtenOffAmount: round2(writtenOff) };
};

/**
 * Sweep stale empty sessions.
 *
 * Two restrictions keep this safe:
 *
 *  1. **Empty sessions only.** A table with orders on it is a live table even
 *     if nobody has touched the app for ten minutes — guests are eating, not
 *     tapping. Closing those would strand a real bill, so they are left alone
 *     and must be closed by payment or by a manager.
 *  2. **Never `awaiting_payment` or `bill_requested`.** Those mean a guest has
 *     asked for the bill and is walking to the counter. The app being quiet is
 *     exactly what that looks like, and auto-closing would take the order off
 *     the bills board while they are standing in front of the cashier.
 *
 * @returns {Promise<{swept: number, sessionIds: string[]}>}
 */
const sweepIdleSessions = async ({ cafeId = null, idleMinutes = IDLE_SWEEP_MINUTES } = {}) => {
  const cutoff = new Date(Date.now() - idleMinutes * 60 * 1000);

  const filter = {
    status: { $in: OPEN_STATUSES },
    lastActivityAt: { $lt: cutoff },
  };
  if (cafeId) filter.cafeId = cafeId;

  const candidates = await DiningSession.find(filter).select('_id cafeId tableId');
  if (candidates.length === 0) {
    return { swept: 0, sessionIds: [] };
  }

  // Only sessions that never produced an order are eligible.
  const orderRows = await Order.aggregate([
    { $match: { sessionId: { $in: candidates.map((c) => c._id) }, status: { $ne: 'cancelled' } } },
    { $group: { _id: '$sessionId', count: { $sum: 1 } } },
  ]);
  const occupied = new Set(orderRows.map((r) => String(r._id)));

  const now = new Date();
  const sessionIds = candidates.filter((c) => !occupied.has(String(c._id))).map((c) => c._id);

  if (sessionIds.length === 0) {
    return { swept: 0, sessionIds: [] };
  }

  await DiningSession.updateMany(
    { _id: { $in: sessionIds }, status: { $in: OPEN_STATUSES } },
    { $set: { status: 'abandoned', abandonedAt: now, endedAt: now } }
  );

  for (const sessionId of sessionIds) {
    socketService.emitSessionActivity(sessionId, {
      type: 'session_paid',
      message: `Session closed automatically after ${idleMinutes} minutes with no orders`,
      timestamp: now,
    });
  }

  return { swept: sessionIds.length, sessionIds: sessionIds.map(String) };
};

/**
 * Run `sweepIdleSessions` on an interval for the whole deployment.
 *
 * `unref()` keeps the timer from holding the Node process open, and the sweep is
 * skipped under Jest so suites never race a background write against fixtures.
 */
const startIdleSessionSweeper = ({ intervalMs = 60 * 1000, idleMinutes = IDLE_SWEEP_MINUTES } = {}) => {
  if (process.env.NODE_ENV === 'test') return null;

  const timer = setInterval(() => {
    sweepIdleSessions({ idleMinutes })
      .then(({ swept }) => {
        if (swept > 0) console.log(`Session sweeper closed ${swept} idle session(s)`);
      })
      .catch((err) => console.error('Idle session sweep failed:', err.message));
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();
  return timer;
};

/**
 * How long a session may sit in `processing` before it is treated as orphaned.
 *
 * `executePaymentPipeline` flips a session to `processing` to take an atomic
 * lock — two clicks on "Mark Paid" must not settle the same bill twice. If the
 * process dies (deploy, crash, OOM) between that lock and the close, the lock
 * outlives it: the session is in no bills-dashboard filter and in no retry
 * filter, so the table silently disappears from the board and every later
 * attempt answers "already paid/closed/processing".
 *
 * Two minutes is comfortably longer than a real settlement (PDF generation is
 * the slow part and it is best-effort), so a live pipeline is never interrupted
 * by its own recovery sweep.
 */
const PROCESSING_STALE_MINUTES = 2;

/** Statuses the payment pipeline will accept a session back in. */
const RECOVERABLE_STATUSES = ['active', 'bill_requested', 'awaiting_payment'];

/**
 * Where an orphaned session should go back to.
 *
 * The lock does not record what it displaced, so it is inferred from the one
 * signal that survives: a guest who has already picked a payment method was on
 * the counter queue (`paymentMethod: 'pending'`), everyone else was mid-meal.
 */
const restoreStatusFor = (session) =>
  session.paymentMethod === 'pending' ? 'awaiting_payment' : 'active';

/**
 * Release sessions left in `processing` by a process that is no longer running.
 *
 * Each flip is conditional on the session still being `processing`, so a
 * settlement that completes normally while this sweep is reading cannot be
 * knocked back to `active` after its money has been taken.
 *
 * @returns {Promise<{released: number, sessionIds: string[]}>}
 */
const releaseStuckSessions = async ({
  staleMinutes = PROCESSING_STALE_MINUTES,
  cafeId = null,
} = {}) => {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const filter = { status: 'processing', updatedAt: { $lt: cutoff } };
  if (cafeId) filter.cafeId = cafeId;

  const stuck = await DiningSession.find(filter);
  if (stuck.length === 0) {
    return { released: 0, sessionIds: [] };
  }

  const now = new Date();
  const released = [];

  for (const session of stuck) {
    const status = restoreStatusFor(session);

    const reopened = await DiningSession.findOneAndUpdate(
      { _id: session._id, status: 'processing' },
      { $set: { status } },
      { new: true }
    );
    if (!reopened) continue; // it settled while we were looking — leave it alone

    reopened.addActivity(
      'session_recovered',
      `Payment attempt was interrupted — session reopened as ${status}`
    );
    await reopened.save();
    released.push(reopened._id);

    auditService
      .recordEvent({
        cafeId: reopened.cafeId,
        type: 'session.recovered',
        entityType: 'DiningSession',
        entityId: reopened._id,
        staffName: 'system',
        metadata: { restoredTo: status, stuckSince: session.updatedAt },
      })
      .catch((err) => console.error('Session recovery audit failed (non-blocking):', err.message));

    socketService.emitSessionActivity(reopened._id, {
      type: 'session_recovered',
      message: 'Payment attempt was interrupted — bill reopened',
      timestamp: now,
    });
  }

  return { released: released.length, sessionIds: released.map(String) };
};

/**
 * Run `releaseStuckSessions` at boot and then on an interval.
 *
 * At boot is the part that matters: those sessions were orphaned by a process
 * that has already exited, so there is nothing in flight to interrupt and the
 * tables come back on the first request. The interval afterwards is cheap
 * insurance for a lock dropped by some path that never unwound.
 */
const startSessionRecoverySweeper = ({
  intervalMs = 60 * 1000,
  staleMinutes = PROCESSING_STALE_MINUTES,
} = {}) => {
  if (process.env.NODE_ENV === 'test') return null;

  const run = () =>
    releaseStuckSessions({ staleMinutes })
      .then(({ released }) => {
        if (released > 0) {
          console.log(`Session recovery released ${released} stuck processing session(s)`);
        }
      })
      .catch((err) => console.error('Stuck session recovery failed:', err.message));

  run();

  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
};

module.exports = {
  IDLE_SWEEP_MINUTES,
  PROCESSING_STALE_MINUTES,
  RECOVERABLE_STATUSES,
  restoreStatusFor,
  releaseStuckSessions,
  startSessionRecoverySweeper,
  computeSessionTotals,
  closeSessionManually,
  sweepIdleSessions,
  startIdleSessionSweeper,
};

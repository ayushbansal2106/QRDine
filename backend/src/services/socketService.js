const { createLogger } = require('./logger');

const log = createLogger('socket');

let io = null;

const init = (socketIoInstance) => {
  io = socketIoInstance;
  log.info("Socket.io service initialized successfully");
};

const getIO = () => {
  return io;
};

const emitNewOrder = (cafeId, order, meta = {}) => {
  if (io) {
    // Module #03 — the payload carries presentation metadata (audio ding,
    // originating channel, geofence flag) so every listening surface behaves
    // the same without hardcoding the rules.
    io.to(`cafe-${cafeId}`).emit("new-order", {
      ...(order && order.toObject ? order.toObject() : order),
      meta: {
        sound: meta.sound !== false,
        channel: meta.channel || (order && order.channel) || 'qr',
        orderType: meta.orderType || (order && order.orderType) || 'dine_in',
        flagged: Boolean(meta.flagged),
        receivedAt: new Date().toISOString(),
      },
    });
    log.debug('socket emit new-order', { cafeId });
  }
};

// Module #10 — suspicious order alert for the manager geofence inbox
const emitGeofenceFlagged = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("geofence-flagged", payload);
  }
};

// Module #18 — new private feedback / AI draft ready
const emitReviewReceived = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("review-received", payload);
  }
};

// Module #11 — physical NFC sticker tapped in the cafe
const emitNfcTapped = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("nfc-tapped", payload);
  }
};

const emitStatusUpdate = (orderId, cafeId, status) => {
  if (io) {
    const uppercaseStatus = status.toUpperCase();
    const eventName = `order-${status.toLowerCase()}`; // e.g. order-accepted, order-preparing, order-ready, order-served
    
    // Emit specific event to cafe room (dashboard / kitchen boards)
    io.to(`cafe-${cafeId}`).emit(eventName, { orderId, status: uppercaseStatus });
    
    // Emit generic update event to cafe room
    io.to(`cafe-${cafeId}`).emit("order-updated");
    
    // Emit status-updated to the specific order room (customer tracking page)
    io.to(`order-${orderId}`).emit("status-updated", { orderId, status: uppercaseStatus });
    
    log.debug('socket status updates emitted', { orderId, status: uppercaseStatus });
  }
};

const emitWaiterRequestCreated = (cafeId, request) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("waiter-request-created", request);
    log.debug('socket emit waiter-request-created', { cafeId });
  }
};

const emitWaiterRequestResolved = (cafeId, requestId) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("waiter-request-resolved", { id: requestId });
    log.debug('socket emit waiter-request-resolved', { cafeId, requestId });
  }
};

// Sprint 7.5 Placeholder Table Status Events
const emitTableStatusChanged = (cafeId, tableId, status) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("table-status-changed", { tableId, status });
    log.debug('socket emit table-status-changed', { cafeId, tableId, status });
  }
};

// Sprint 7.5 Dining Session Events
const emitBillRequested = (cafeId, sessionData) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("bill-requested", sessionData);
    log.debug('socket emit bill-requested', { cafeId, sessionId: sessionData.sessionId });
  }
};

const emitPaymentAwaiting = (cafeId, sessionData) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("payment-awaiting", sessionData);
    log.debug('socket emit payment-awaiting', { cafeId, sessionId: sessionData.sessionId });
  }
};

const emitSessionPaid = (cafeId, sessionData) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("session-paid", sessionData);
    log.debug('socket emit session-paid', { cafeId, sessionId: sessionData.sessionId });
  }
};

const emitSessionClosed = (cafeId, sessionData) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("session-closed", sessionData);
    log.debug('socket emit session-closed', { cafeId, sessionId: sessionData.sessionId });
  }
};

const emitItemCancelled = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("item-cancelled", payload);
    io.to(`order-${payload.orderId}`).emit("item-cancelled", payload);
    log.debug('socket emit item-cancelled', { cafeId, orderId: payload.orderId, itemId: payload.itemId });
  }
};

const emitBillUpdated = (cafeId, sessionData) => {
  if (!io) return;

  // Staff watch the cafe room; the diners watching the bill modal are in the
  // *session* room (`SessionGate` joins `session-{id}`, never `cafe-{id}`).
  // Emitting only to the cafe room meant an adjustment raised at the counter
  // never reached the table's own modal, so the guest's total was stale until
  // they reopened it.
  io.to(`cafe-${cafeId}`).emit("bill-updated", sessionData);
  if (sessionData && sessionData.sessionId) {
    io.to(`session-${sessionData.sessionId}`).emit("bill-updated", sessionData);
  }
  log.debug('socket emit bill-updated', { cafeId, sessionId: sessionData && sessionData.sessionId });
};

// Sprint 8.9.1 Multi-participant Session Events
const emitParticipantJoined = (sessionId, participant) => {
  if (io) {
    io.to(`session-${sessionId}`).emit("participant-joined", participant);
  }
};

const emitParticipantLeft = (sessionId, participantId) => {
  if (io) {
    io.to(`session-${sessionId}`).emit("participant-left", { participantId });
  }
};

const emitOrderCreatedSession = (sessionId, orderData) => {
  if (io) {
    io.to(`session-${sessionId}`).emit("order-created", orderData);
  }
};

const emitSessionBillRequested = (sessionId) => {
  if (io) {
    io.to(`session-${sessionId}`).emit("bill-requested", { sessionId });
  }
};

const emitOwnershipTransferred = (sessionId, payload) => {
  if (io) {
    io.to(`session-${sessionId}`).emit("ownership-transferred", payload);
  }
};

const emitSessionActivity = (sessionId, activity) => {
  if (io) {
    io.to(`session-${sessionId}`).emit("session-activity", activity);
  }
};

const emitSessionBillCancelled = (sessionId) => {
  if (io) {
    io.to(`session-${sessionId}`).emit("bill-cancelled", { sessionId });
  }
};

// Module #05 — instant '86' availability toggle broadcast to POS + QR menus
const emitMenuAvailability = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("menu-item-availability", payload);
  }
};

// Module #01 — throttled live telemetry refresh signal
const emitMetricsUpdated = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("metrics-updated", payload);
  }
};

// Module #07 — KDS item-level prep status + ticket bump
const emitKdsItemUpdated = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("kds-item-updated", payload);
  }
};

const emitKdsTicketBumped = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("kds-ticket-bumped", payload);
  }
};

// Module #08 — shift/drawer lifecycle broadcasts (open, close, variance alerts)
const emitShiftUpdated = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("shift-updated", payload);
  }
};

// Module #15 — loyalty stamp / voucher changes
const emitLoyaltyUpdated = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("loyalty-updated", payload);
  }
};

// Module #17 — wallet balance changes
const emitWalletUpdated = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("wallet-updated", payload);
  }
};

// Module #16 — scratch card issued / revealed
const emitScratchIssued = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("scratch-issued", payload);
  }
};

const emitScratchRevealed = (cafeId, payload) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("scratch-revealed", payload);
  }
};

module.exports = {
  init,
  getIO,
  emitNewOrder,
  emitGeofenceFlagged,
  emitReviewReceived,
  emitNfcTapped,
  emitStatusUpdate,
  emitWaiterRequestCreated,
  emitWaiterRequestResolved,
  emitTableStatusChanged,
  emitBillRequested,
  emitPaymentAwaiting,
  emitSessionPaid,
  emitSessionClosed,
  emitItemCancelled,
  emitBillUpdated,
  emitParticipantJoined,
  emitParticipantLeft,
  emitOrderCreatedSession,
  emitSessionBillRequested,
  emitOwnershipTransferred,
  emitSessionActivity,
  emitSessionBillCancelled,
  emitMenuAvailability,
  emitMetricsUpdated,
  emitKdsItemUpdated,
  emitKdsTicketBumped,
  emitShiftUpdated,
  emitLoyaltyUpdated,
  emitWalletUpdated,
  emitScratchIssued,
  emitScratchRevealed,
};

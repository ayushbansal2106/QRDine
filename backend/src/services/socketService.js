let io = null;

const init = (socketIoInstance) => {
  io = socketIoInstance;
  console.log("Socket.io service initialized successfully.");
};

const getIO = () => {
  return io;
};

const emitNewOrder = (cafeId, order) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("new-order", order);
    console.log(`Socket emit new-order to cafe-${cafeId}`);
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
    
    console.log(`Socket status updates emitted for order ${orderId} (Status: ${uppercaseStatus})`);
  }
};

const emitWaiterRequestCreated = (cafeId, request) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("waiter-request-created", request);
    console.log(`Socket emit waiter-request-created to cafe-${cafeId}`);
  }
};

const emitWaiterRequestResolved = (cafeId, requestId) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("waiter-request-resolved", { id: requestId });
    console.log(`Socket emit waiter-request-resolved to cafe-${cafeId}`);
  }
};

// Sprint 7.5 Placeholder Table Status Events
const emitTableStatusChanged = (cafeId, tableId, status) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("table-status-changed", { tableId, status });
    console.log(`Socket emit table-status-changed to cafe-${cafeId} (Table: ${tableId}, Status: ${status})`);
  }
};

// Sprint 7.5 Dining Session Events
const emitBillRequested = (cafeId, sessionData) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("bill-requested", sessionData);
    console.log(`Socket emit bill-requested to cafe-${cafeId} (Session: ${sessionData.sessionId})`);
  }
};

const emitPaymentAwaiting = (cafeId, sessionData) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("payment-awaiting", sessionData);
    console.log(`Socket emit payment-awaiting to cafe-${cafeId} (Session: ${sessionData.sessionId})`);
  }
};

const emitSessionPaid = (cafeId, sessionData) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("session-paid", sessionData);
    console.log(`Socket emit session-paid to cafe-${cafeId} (Session: ${sessionData.sessionId})`);
  }
};

const emitSessionClosed = (cafeId, sessionData) => {
  if (io) {
    io.to(`cafe-${cafeId}`).emit("session-closed", sessionData);
    console.log(`Socket emit session-closed to cafe-${cafeId} (Session: ${sessionData.sessionId})`);
  }
};

module.exports = {
  init,
  getIO,
  emitNewOrder,
  emitStatusUpdate,
  emitWaiterRequestCreated,
  emitWaiterRequestResolved,
  emitTableStatusChanged,
  emitBillRequested,
  emitPaymentAwaiting,
  emitSessionPaid,
  emitSessionClosed,
};

/**
 * Module #12 — dining session host resolution.
 *
 * The bug this covers: when a waiter fires an order, `createWaiterOrder` opens a
 * DiningSession with NO participants. Every later join was hard-coded to
 * `role: 'member'`, so the session could never acquire a host, and
 * `submitPayment` rejected everyone with "Only the session owner can request the
 * bill". The table could order but could never settle.
 *
 * Rule under test: whoever first claims an unhosted table becomes its host.
 */

const { mockReq, mockRes, mockNext } = require("./setup");

const CAFE_ID = "507f1f77bcf86cd799439011";
const TABLE_ID = "507f1f77bcf86cd799439099";
const SESSION_ID = "507f1f77bcf86cd799439088";
const GUEST_TOKEN = "a".repeat(32);

const mockSessionFindOne = jest.fn();
const mockSessionFindById = jest.fn();
const mockSessionCreate = jest.fn();
const mockOrderFind = jest.fn();
const mockOrderCountDocuments = jest.fn();

jest.mock("../src/models/DiningSession", () => ({
  findOne: (...a) => Promise.resolve(mockSessionFindOne(...a)),
  findById: (...a) => {
    const q = Promise.resolve(mockSessionFindById(...a));
    q.populate = () => q;
    return q;
  },
  create: (...a) => mockSessionCreate(...a),
}));

jest.mock("../src/models/Order", () => ({
  find: (...a) => {
    const q = Promise.resolve(mockOrderFind(...a));
    q.populate = () => q;
    return q;
  },
  countDocuments: (...a) => mockOrderCountDocuments(...a),
}));

jest.mock("../src/models/Table", () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
}));

const mockEmitSessionActivity = jest.fn();
const mockEmitParticipantJoined = jest.fn();
const mockEmitOwnershipTransferred = jest.fn();
const mockEmitSessionBillRequested = jest.fn();

jest.mock("../src/services/socketService", () => ({
  emitSessionActivity: (...a) => mockEmitSessionActivity(...a),
  emitParticipantJoined: (...a) => mockEmitParticipantJoined(...a),
  emitOwnershipTransferred: (...a) => mockEmitOwnershipTransferred(...a),
  emitSessionBillRequested: (...a) => mockEmitSessionBillRequested(...a),
  emitNewOrder: jest.fn(),
  emitOrderUpdated: jest.fn(),
  emitMetricsUpdated: jest.fn(),
  emitPaymentAwaiting: jest.fn(),
  emitSessionPaid: jest.fn(),
  emitBillRequested: jest.fn(),
  emitBillUpdated: jest.fn(),
  emitStatusUpdate: jest.fn(),
  emitTableStatusChanged: jest.fn(),
  emitItemCancelled: jest.fn(),
  emitMenuAvailability: jest.fn(),
  emitOrderCreatedSession: jest.fn(),
}));

const { joinSession, submitPayment } = require("../src/controllers/sessionController");

/** Minimal stand-in for a Mongoose subdocument array. */
function makeSession(overrides = {}) {
  const participants = overrides.participants || [];
  return {
    _id: SESSION_ID,
    cafeId: CAFE_ID,
    tableId: TABLE_ID,
    customerName: "",
    customerEmail: "",
    guestToken: GUEST_TOKEN,
    status: "active",
    paymentMethod: "pending",
    participants,
    activityFeed: [],
    addActivity(type, message) {
      this.activityFeed.push({ type, message });
    },
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => {
  mockOrderFind.mockResolvedValue([]);
});

describe("joinSession — host resolution", () => {
  it("promotes the first joiner to owner when the session has no participants", async () => {
    // Exactly what createWaiterOrder produces: a session with an empty roster.
    const session = makeSession({ participants: [] });
    mockSessionFindOne.mockResolvedValue(session);
    const res = mockRes();

    const next = mockNext();
    await joinSession(
      mockReq({ body: { tableId: TABLE_ID, name: "Priya", deviceId: "dev-1" } }),
      res,
      next
    );

    expect(res._statusCode).toBe(200);
    expect(res._jsonData.session.role).toBe("owner");
    expect(session.participants).toHaveLength(1);
    expect(session.participants[0].role).toBe("owner");
  });

  it("adopts the joiner as customerName so the bill is not a placeholder", async () => {
    const session = makeSession({ participants: [], customerName: "" });
    mockSessionFindOne.mockResolvedValue(session);
    const res = mockRes();

    await joinSession(
      mockReq({ body: { tableId: TABLE_ID, name: "Priya", deviceId: "dev-1" } }),
      res,
      mockNext()
    );

    expect(session.customerName).toBe("Priya");
  });

  it("announces the new host on the activity feed and socket", async () => {
    const session = makeSession({ participants: [] });
    mockSessionFindOne.mockResolvedValue(session);
    const res = mockRes();

    await joinSession(
      mockReq({ body: { tableId: TABLE_ID, name: "Priya", deviceId: "dev-1" } }),
      res,
      mockNext()
    );

    expect(session.activityFeed.some((a) => a.type === "ownership_transferred")).toBe(true);
    expect(mockEmitOwnershipTransferred).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ newOwnerId: expect.any(String) })
    );
  });

  it("keeps later joiners as members when a host already exists", async () => {
    const session = makeSession({
      participants: [
        { participantId: "host-1", name: "Priya", role: "owner", status: "active", deviceId: "dev-1" },
      ],
    });
    mockSessionFindOne.mockResolvedValue(session);
    const res = mockRes();

    await joinSession(
      mockReq({ body: { tableId: TABLE_ID, name: "Rahul", deviceId: "dev-2" } }),
      res,
      mockNext()
    );

    expect(res._jsonData.session.role).toBe("member");
    expect(session.participants).toHaveLength(2);
    expect(session.participants[1].role).toBe("member");
  });

  it("promotes a new joiner when the previous host has left", async () => {
    const session = makeSession({
      participants: [
        { participantId: "host-1", name: "Priya", role: "owner", status: "left", deviceId: null },
      ],
    });
    mockSessionFindOne.mockResolvedValue(session);
    const res = mockRes();

    await joinSession(
      mockReq({ body: { tableId: TABLE_ID, name: "Rahul", deviceId: "dev-2" } }),
      res,
      mockNext()
    );

    expect(res._jsonData.session.role).toBe("owner");
  });

  it("is idempotent — re-scanning does not duplicate or demote the host", async () => {
    const session = makeSession({
      participants: [
        { participantId: "host-1", name: "Priya", role: "owner", status: "active", deviceId: "dev-1" },
      ],
    });
    mockSessionFindOne.mockResolvedValue(session);
    const res = mockRes();

    await joinSession(
      mockReq({ body: { tableId: TABLE_ID, name: "Priya", deviceId: "dev-1" } }),
      res,
      mockNext()
    );

    expect(session.participants).toHaveLength(1);
    expect(res._jsonData.session.role).toBe("owner");
  });
});

describe("submitPayment — a stranded table can always settle", () => {
  const paymentReq = (participantId) =>
    mockReq({
      params: { id: SESSION_ID },
      body: { paymentMethod: "paid_counter", participantId },
      cookies: { guest_token: GUEST_TOKEN },
      headers: {},
    });

  it("lets a member pay a waiter-opened session that never had a host", async () => {
    // The reported dead-end: waiter opened the table, customer joined as member,
    // and nobody could request the bill.
    const session = makeSession({
      participants: [{ participantId: "p1", name: "Priya", role: "member", status: "active" }],
    });
    mockSessionFindById.mockResolvedValue(session);
    const res = mockRes();
    const next = mockNext();

    await submitPayment(paymentReq("p1"), res, next);

    expect(next).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Only the session owner") })
    );
    expect(res._statusCode).toBe(200);
    expect(session.participants[0].role).toBe("owner");
    expect(session.status).toBe("awaiting_payment");
  });

  it("still blocks a member while a host is present", async () => {
    const session = makeSession({
      participants: [
        { participantId: "host", name: "Priya", role: "owner", status: "active" },
        { participantId: "p1", name: "Rahul", role: "member", status: "active" },
      ],
    });
    mockSessionFindById.mockResolvedValue(session);
    const res = mockRes();
    const next = mockNext();

    await submitPayment(paymentReq("p1"), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Only the session owner") })
    );
    expect(res._jsonData).toBeNull();
  });

  it("rejects a non-participant outright", async () => {
    const session = makeSession({
      participants: [{ participantId: "host", name: "Priya", role: "owner", status: "active" }],
    });
    mockSessionFindById.mockResolvedValue(session);
    const res = mockRes();
    const next = mockNext();

    await submitPayment(paymentReq("stranger"), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("not a participant") })
    );
  });

  it("refuses a guest token that does not match the session", async () => {
    const session = makeSession({
      participants: [{ participantId: "p1", name: "Priya", role: "owner", status: "active" }],
    });
    mockSessionFindById.mockResolvedValue(session);
    const res = mockRes();
    const next = mockNext();

    await submitPayment(
      mockReq({
        params: { id: SESSION_ID },
        body: { paymentMethod: "paid_counter", participantId: "p1" },
        cookies: {},
        headers: {},
      }),
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Invalid or missing guest") })
    );
  });
});
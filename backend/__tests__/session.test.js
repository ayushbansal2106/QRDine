/**
 * Session Management Flow Tests
 * Tests: createSession, joinSession, leaveSession, transferOwnership,
 *        submitPayment, cancelBillRequest, getActiveSessionForTable,
 *        getBillPreview, getSessions, getSessionDetails,
 *        addBillAdjustment, getActivityFeed
 */

const { mockReq, mockRes, mockNext } = require('./setup');

// ─── Module-level mock functions ─────────────────────────────────
const mockDiningSessionFind = jest.fn();
const mockDiningSessionFindOne = jest.fn();
const mockDiningSessionFindById = jest.fn();
const mockDiningSessionFindByIdAndUpdate = jest.fn();
const mockDiningSessionCreate = jest.fn();
const mockDiningSessionCountDocuments = jest.fn();

const mockTableFindById = jest.fn();
const mockTableFindOne = jest.fn();

const mockOrderFind = jest.fn();
const mockOrderCountDocuments = jest.fn();

const mockSocketEmitSessionActivity = jest.fn();
const mockSocketEmitParticipantJoined = jest.fn();
const mockSocketEmitParticipantLeft = jest.fn();
const mockSocketEmitSessionBillRequested = jest.fn();
const mockSocketEmitSessionBillCancelled = jest.fn();
const mockSocketEmitBillUpdated = jest.fn();
const mockSocketEmitPaymentAwaiting = jest.fn();
const mockSocketEmitOwnershipTransferred = jest.fn();

const mockResolveGuestToken = jest.fn();
const mockExecutePaymentPipeline = jest.fn();
const mockInvoiceCountDocuments = jest.fn();

// ─── Register mocks at top level ─────────────────────────────────
jest.mock('../src/models/DiningSession', () => {
  const DiningSession = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-session-id';
    this.save = jest.fn().mockResolvedValue(true);
    this.addActivity = jest.fn();
    this.activityFeed = data.activityFeed || [];
    this.adjustments = data.adjustments || [];
    this.participants = data.participants || [];
    this.toObject = jest.fn(() => ({ ...data, _id: this._id }));
  };
  DiningSession.find = (...a) => mockDiningSessionFind(...a);
  DiningSession.findOne = (...a) => mockDiningSessionFindOne(...a);
  DiningSession.findById = (...a) => mockDiningSessionFindById(...a);
  DiningSession.findByIdAndUpdate = (...a) => mockDiningSessionFindByIdAndUpdate(...a);
  DiningSession.create = (...a) => mockDiningSessionCreate(...a);
  DiningSession.countDocuments = (...a) => mockDiningSessionCountDocuments(...a);
  return DiningSession;
});

jest.mock('../src/models/Table', () => {
  const Table = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-table-id';
    this.save = jest.fn().mockResolvedValue(true);
  };
  Table.findById = (...a) => mockTableFindById(...a);
  Table.findOne = (...a) => mockTableFindOne(...a);
  return Table;
});

jest.mock('../src/models/Order', () => {
  const Order = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-order-id';
    this.save = jest.fn().mockResolvedValue(true);
  };
  Order.find = (...a) => mockOrderFind(...a);
  Order.countDocuments = (...a) => mockOrderCountDocuments(...a);
  return Order;
});

jest.mock('../src/services/socketService', () => ({
  emitSessionActivity: (...a) => mockSocketEmitSessionActivity(...a),
  emitParticipantJoined: (...a) => mockSocketEmitParticipantJoined(...a),
  emitParticipantLeft: (...a) => mockSocketEmitParticipantLeft(...a),
  emitSessionBillRequested: (...a) => mockSocketEmitSessionBillRequested(...a),
  emitSessionBillCancelled: (...a) => mockSocketEmitSessionBillCancelled(...a),
  emitBillUpdated: (...a) => mockSocketEmitBillUpdated(...a),
  emitPaymentAwaiting: (...a) => mockSocketEmitPaymentAwaiting(...a),
  emitOwnershipTransferred: (...a) => mockSocketEmitOwnershipTransferred(...a),
}));

jest.mock('../src/utils/resolveGuestToken', () => (...a) => mockResolveGuestToken(...a));

jest.mock('../src/services/paymentPipeline', () => ({
  executePaymentPipeline: (...a) => mockExecutePaymentPipeline(...a),
}));

jest.mock('../src/models/Invoice', () => {
  const Invoice = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-invoice-id';
    this.save = jest.fn().mockResolvedValue(true);
  };
  Invoice.countDocuments = (...a) => mockInvoiceCountDocuments(...a);
  Invoice.create = jest.fn().mockResolvedValue({ _id: 'mock-invoice-id', invoiceNumber: 'INV-20260719-0001' });
  return Invoice;
});

jest.mock('../src/models/Cafe', () => {
  const Cafe = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-cafe-id';
    this.save = jest.fn().mockResolvedValue(true);
  };
  Cafe.findById = jest.fn().mockResolvedValue({ _id: 'mock-cafe-id', name: 'Test Cafe' });
  return Cafe;
});

// Mock crypto for deterministic tokens
jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => ({
    toString: jest.fn(() => 'mock-token-value'),
  })),
}));

// ─── Load controller ONCE ────────────────────────────────────────
const {
  createSession,
  joinSession,
  leaveSession,
  transferOwnership,
  submitPayment,
  cancelBillRequest,
  getActiveSessionForTable,
  getBillPreview,
  getSessions,
  getSessionDetails,
  addBillAdjustment,
  getActivityFeed,
} = require('../src/controllers/sessionController');

// ─── Helpers ──────────────────────────────────────────────────────
function makeMockSession(overrides = {}) {
  const data = {
    _id: 'session-123',
    cafeId: 'cafe-123',
    tableId: 'table-123',
    customerName: 'Alice',
    customerEmail: 'alice@example.com',
    guestToken: 'valid-guest-token',
    status: 'active',
    participants: [
      {
        participantId: 'owner-001',
        name: 'Alice',
        email: 'alice@example.com',
        role: 'owner',
        deviceId: 'device-001',
        joinedAt: new Date(),
        status: 'active',
      },
    ],
    adjustments: [],
    activityFeed: [],
    billVersion: 1,
    paymentMethod: 'pending',
    lastActivityAt: new Date(),
    startedAt: new Date(),
    ...overrides,
  };

  const session = {
    ...data,
    save: jest.fn().mockResolvedValue(true),
    addActivity: jest.fn(),
    toObject: jest.fn(() => ({ ...data })),
  };

  return session;
}

// ─── Clear mocks between tests ────────────────────────────────────
afterEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════
// 1. CREATE SESSION
// ═══════════════════════════════════════════════════════════════════
describe('Session — createSession', () => {
  const validBody = {
    tableId: 'table-123',
    customerName: 'Alice',
    customerEmail: 'alice@example.com',
    deviceId: 'device-001',
  };

  it('should create a new session successfully', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    mockTableFindById.mockResolvedValue({ _id: 'table-123', cafeId: 'cafe-123', isActive: true });
    mockDiningSessionFindOne.mockResolvedValue(null);
    mockDiningSessionCreate.mockResolvedValue({
      _id: 'session-123',
      cafeId: 'cafe-123',
      tableId: 'table-123',
      customerName: 'Alice',
      customerEmail: 'alice@example.com',
      guestToken: 'mock-token-value',
      status: 'active',
      startedAt: new Date(),
    });

    await createSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.cookie).toHaveBeenCalledWith('guest_token', 'mock-token-value', expect.objectContaining({ httpOnly: true }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Dining session started',
      session: expect.objectContaining({ status: 'active' }),
    }));
  });

  it('should open a table for a guest who gives no email', async () => {
    // Email is optional since Module #09 — a guest signs in by phone OTP and may
    // attach an email later. Every test above supplies one, which hid a real
    // crash: the session was built with `customerEmail: (customerEmail || '')`
    // but the participant's email was `customerEmail.trim()`, so a guest who
    // skipped the field got a 500 and no table at all.
    const req = mockReq({ body: { tableId: 'table-123', customerName: 'Bob' } });
    const res = mockRes();
    const next = mockNext();

    mockTableFindById.mockResolvedValue({ _id: 'table-123', cafeId: 'cafe-123', isActive: true });
    mockDiningSessionFindOne.mockResolvedValue(null);
    mockDiningSessionCreate.mockResolvedValue({
      _id: 'session-123',
      cafeId: 'cafe-123',
      tableId: 'table-123',
      customerName: 'Bob',
      customerEmail: '',
      guestToken: 'mock-token-value',
      status: 'active',
      startedAt: new Date(),
    });

    await createSession(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    // The participant must be recorded with a safe value, not a crash.
    const created = mockDiningSessionCreate.mock.calls[0][0];
    expect(created.participants[0].email).toBe('');
  });

  it('should return 400 if required fields are missing', async () => {
    const req = mockReq({ body: { tableId: 'table-123' } }); // missing customerName, customerEmail
    const res = mockRes();
    const next = mockNext();

    await createSession(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should return 404 if table is not found', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    mockTableFindById.mockResolvedValue(null);

    await createSession(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Table not found', statusCode: 404 }));
  });

  it('should return 400 if table is inactive', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    mockTableFindById.mockResolvedValue({ _id: 'table-123', cafeId: 'cafe-123', isActive: false });

    await createSession(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Table is currently inactive', statusCode: 400 }));
  });

  it('should return 403 if session is locked (awaiting_payment)', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    mockTableFindById.mockResolvedValue({ _id: 'table-123', cafeId: 'cafe-123', isActive: true });
    mockDiningSessionFindOne.mockResolvedValue(makeMockSession({ status: 'awaiting_payment' }));

    await createSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sessionLocked: true }));
  });

  it('should return 409 if an active session exists for this table', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    mockTableFindById.mockResolvedValue({ _id: 'table-123', cafeId: 'cafe-123', isActive: true });
    mockDiningSessionFindOne.mockResolvedValue(makeMockSession({ status: 'active' }));
    mockOrderCountDocuments.mockResolvedValue(2); // has orders

    await createSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sessionExists: true }));
  });

  it('should abandon old inactive session with 0 orders and create new one', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    const oldSession = makeMockSession({
      status: 'active',
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
    });

    mockTableFindById.mockResolvedValue({ _id: 'table-123', cafeId: 'cafe-123', isActive: true });
    mockDiningSessionFindOne.mockResolvedValue(oldSession);
    mockOrderCountDocuments.mockResolvedValue(0); // no orders
    mockDiningSessionCreate.mockResolvedValue({
      _id: 'session-new',
      cafeId: 'cafe-123',
      tableId: 'table-123',
      status: 'active',
      guestToken: 'mock-token-value',
      startedAt: new Date(),
    });

    await createSession(req, res, next);

    expect(oldSession.save).toHaveBeenCalled(); // abandoned the old session
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should trim and lowercase customer email', async () => {
    const req = mockReq({ body: { ...validBody, customerEmail: '  ALICE@EXAMPLE.COM  ' } });
    const res = mockRes();
    const next = mockNext();

    mockTableFindById.mockResolvedValue({ _id: 'table-123', cafeId: 'cafe-123', isActive: true });
    mockDiningSessionFindOne.mockResolvedValue(null);
    mockDiningSessionCreate.mockResolvedValue({
      _id: 'session-123',
      cafeId: 'cafe-123',
      tableId: 'table-123',
      status: 'active',
      guestToken: 'mock-token-value',
      startedAt: new Date(),
    });

    await createSession(req, res, next);

    expect(mockDiningSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      customerEmail: 'alice@example.com',
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. JOIN SESSION
// ═══════════════════════════════════════════════════════════════════
describe('Session — joinSession', () => {
  it('should join an active session successfully', async () => {
    const req = mockReq({ body: { tableId: 'table-123', name: 'Bob', deviceId: 'device-002' } });
    const res = mockRes();
    const next = mockNext();

    const session = makeMockSession();
    mockDiningSessionFindOne.mockResolvedValue(session);

    await joinSession(req, res, next);

    expect(session.addActivity).toHaveBeenCalledWith('participant_joined', expect.stringContaining('Bob'));
    expect(session.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Joined dining session' }));
  });

  it('should return 400 if tableId or name is missing', async () => {
    const req = mockReq({ body: { tableId: 'table-123' } });
    const res = mockRes();
    const next = mockNext();

    await joinSession(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should return 404 if no active session exists', async () => {
    const req = mockReq({ body: { tableId: 'table-123', name: 'Bob' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(null);

    await joinSession(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'No active session found for this table', statusCode: 404 }));
  });

  it('should return 403 if session is locked (bill_requested)', async () => {
    const req = mockReq({ body: { tableId: 'table-123', name: 'Bob' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(makeMockSession({ status: 'bill_requested' }));

    await joinSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sessionLocked: true }));
  });

  it('should reuse existing participant if device matches', async () => {
    const session = makeMockSession({
      participants: [
        {
          participantId: 'existing-001',
          name: 'Bob',
          email: 'bob@example.com',
          role: 'member',
          deviceId: 'device-002',
          status: 'active',
        },
      ],
    });

    const req = mockReq({ body: { tableId: 'table-123', name: 'Bob', deviceId: 'device-002' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await joinSession(req, res, next);

    // Should NOT add a new participant
    expect(session.addActivity).not.toHaveBeenCalled();
    expect(session.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ participantId: 'existing-001', role: 'member' }),
    }));
  });

  it('should set guest token cookie when joining', async () => {
    const req = mockReq({ body: { tableId: 'table-123', name: 'Bob' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(makeMockSession({ guestToken: 'my-secret-token' }));

    await joinSession(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith('guest_token', 'my-secret-token', expect.objectContaining({ httpOnly: true }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. LEAVE SESSION
// ═══════════════════════════════════════════════════════════════════
describe('Session — leaveSession', () => {
  it('should mark participant as left', async () => {
    const session = makeMockSession();
    const req = mockReq({ params: { id: 'session-123' }, body: { participantId: 'owner-001' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockResolvedValue(session);
    mockResolveGuestToken.mockReturnValue('valid-guest-token');

    await leaveSession(req, res, next);

    expect(session.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Left session' }));
  });

  it('should return 404 if session not found', async () => {
    const req = mockReq({ params: { id: 'nonexistent' }, body: { participantId: 'owner-001' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockResolvedValue(null);
    mockResolveGuestToken.mockReturnValue('valid-guest-token');

    await leaveSession(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session not found', statusCode: 404 }));
  });

  it('should return 403 if guest token is invalid', async () => {
    const session = makeMockSession({ guestToken: 'correct-token' });
    const req = mockReq({ params: { id: 'session-123' }, body: { participantId: 'owner-001' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockResolvedValue(session);
    mockResolveGuestToken.mockReturnValue('wrong-token');

    await leaveSession(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(session.save).not.toHaveBeenCalled();
  });

  it('should handle participant not found gracefully', async () => {
    const session = makeMockSession();
    const req = mockReq({ params: { id: 'session-123' }, body: { participantId: 'nonexistent' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockResolvedValue(session);
    mockResolveGuestToken.mockReturnValue('valid-guest-token');

    await leaveSession(req, res, next);

    // Should still return success even if participant not found
    expect(res.status).toHaveBeenCalledWith(200);
    expect(session.save).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. TRANSFER OWNERSHIP
// ═══════════════════════════════════════════════════════════════════
describe('Session — transferOwnership', () => {
  it('should transfer ownership successfully', async () => {
    const session = makeMockSession({
      cafeId: 'cafe-123',
      participants: [
        { participantId: 'owner-001', name: 'Alice', email: 'alice@example.com', role: 'owner', status: 'active' },
        { participantId: 'member-001', name: 'Bob', email: 'bob@example.com', role: 'member', status: 'active' },
      ],
    });

    const req = mockReq({
      params: { id: 'session-123' },
      body: { newOwnerParticipantId: 'member-001', email: 'bob@example.com' },
      cafeId: 'cafe-123',
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await transferOwnership(req, res, next);

    expect(session.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Ownership transferred successfully' }));
  });

  it('should return 404 if session not found', async () => {
    const req = mockReq({ params: { id: 'nonexistent' }, body: { newOwnerParticipantId: 'member-001' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(null);

    await transferOwnership(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session not found', statusCode: 404 }));
  });

  it('should return 400 if session status is not active or bill_requested', async () => {
    const session = makeMockSession({ status: 'paid' });
    const req = mockReq({ params: { id: 'session-123' }, body: { newOwnerParticipantId: 'member-001' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await transferOwnership(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should return 404 if new owner is not a participant', async () => {
    const session = makeMockSession({
      participants: [
        { participantId: 'owner-001', name: 'Alice', role: 'owner', status: 'active' },
      ],
    });

    const req = mockReq({ params: { id: 'session-123' }, body: { newOwnerParticipantId: 'nonexistent' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await transferOwnership(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Participant not found in this session', statusCode: 404 }));
  });

  it('should return 400 if new owner has no email and old owner has no email', async () => {
    const session = makeMockSession({
      participants: [
        { participantId: 'owner-001', name: 'Alice', email: null, role: 'owner', status: 'active' },
        { participantId: 'member-001', name: 'Bob', email: null, role: 'member', status: 'active' },
      ],
    });

    const req = mockReq({ params: { id: 'session-123' }, body: { newOwnerParticipantId: 'member-001' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await transferOwnership(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should transfer ownership during bill_requested status', async () => {
    const session = makeMockSession({
      status: 'bill_requested',
      participants: [
        { participantId: 'owner-001', name: 'Alice', email: 'alice@example.com', role: 'owner', status: 'active' },
        { participantId: 'member-001', name: 'Bob', email: 'bob@example.com', role: 'member', status: 'active' },
      ],
    });

    const req = mockReq({ params: { id: 'session-123' }, body: { newOwnerParticipantId: 'member-001' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await transferOwnership(req, res, next);

    expect(session.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. SUBMIT PAYMENT
// ═══════════════════════════════════════════════════════════════════
describe('Session — submitPayment', () => {
  it('should submit payment with paid_counter successfully', async () => {
    const session = makeMockSession({
      tableId: { _id: 'table-123', tableNumber: 'T1' },
      participants: [
        { participantId: 'owner-001', name: 'Alice', role: 'owner', status: 'active' },
      ],
    });
    session.save = jest.fn().mockResolvedValue(true);

    const req = mockReq({
      params: { id: 'session-123' },
      body: { paymentMethod: 'paid_counter', participantId: 'owner-001' },
      headers: { 'x-guest-token': 'valid-guest-token' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('valid-guest-token');
    mockOrderFind.mockResolvedValue([]);

    await submitPayment(req, res, next);

    expect(session.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ status: 'awaiting_payment', paymentMethod: 'paid_counter' }),
    }));
  });

  it('should submit payment with paid_online successfully', async () => {
    const session = makeMockSession({
      tableId: { _id: 'table-123', tableNumber: 'T1' },
      participants: [
        { participantId: 'owner-001', name: 'Alice', role: 'owner', status: 'active' },
      ],
    });
    session.save = jest.fn().mockResolvedValue(true);

    const req = mockReq({
      params: { id: 'session-123' },
      body: { paymentMethod: 'paid_online', participantId: 'owner-001' },
      headers: { 'x-guest-token': 'valid-guest-token' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('valid-guest-token');
    mockOrderFind.mockResolvedValue([]);

    await submitPayment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ status: 'awaiting_payment', paymentMethod: 'paid_online' }),
    }));
  });

  it('should return 400 for invalid payment method', async () => {
    const req = mockReq({
      params: { id: 'session-123' },
      body: { paymentMethod: 'bitcoin', participantId: 'owner-001' },
    });
    const res = mockRes();
    const next = mockNext();

    await submitPayment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should return 404 if session not found', async () => {
    const req = mockReq({
      params: { id: 'nonexistent' },
      body: { paymentMethod: 'paid_counter', participantId: 'owner-001' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });

    await submitPayment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session not found', statusCode: 404 }));
  });

  it('should return 403 if guest token is invalid', async () => {
    const session = makeMockSession({ guestToken: 'correct-token' });

    const req = mockReq({
      params: { id: 'session-123' },
      body: { paymentMethod: 'paid_counter', participantId: 'owner-001' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('wrong-token');

    await submitPayment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('should return 403 if requestor is not the owner', async () => {
    const session = makeMockSession({
      participants: [
        { participantId: 'owner-001', name: 'Alice', role: 'owner', status: 'active' },
        { participantId: 'member-001', name: 'Bob', role: 'member', status: 'active' },
      ],
    });

    const req = mockReq({
      params: { id: 'session-123' },
      body: { paymentMethod: 'paid_counter', participantId: 'member-001' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('valid-guest-token');

    await submitPayment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('should return 400 if session is not active', async () => {
    const session = makeMockSession({ status: 'paid' });

    const req = mockReq({
      params: { id: 'session-123' },
      body: { paymentMethod: 'paid_counter', participantId: 'owner-001' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('valid-guest-token');

    await submitPayment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should emit paymentAwaiting socket event', async () => {
    const session = makeMockSession({
      cafeId: 'cafe-123',
      tableId: { _id: 'table-123', tableNumber: 'T1' },
      participants: [
        { participantId: 'owner-001', name: 'Alice', role: 'owner', status: 'active' },
      ],
    });
    session.save = jest.fn().mockResolvedValue(true);

    const req = mockReq({
      params: { id: 'session-123' },
      body: { paymentMethod: 'paid_counter', participantId: 'owner-001' },
      headers: { 'x-guest-token': 'valid-guest-token' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('valid-guest-token');
    mockOrderFind.mockResolvedValue([]);

    await submitPayment(req, res, next);

    expect(mockSocketEmitPaymentAwaiting).toHaveBeenCalledWith('cafe-123', expect.objectContaining({ sessionId: 'session-123' }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. CANCEL BILL REQUEST
// ═══════════════════════════════════════════════════════════════════
describe('Session — cancelBillRequest', () => {
  it('should cancel bill request successfully', async () => {
    const session = makeMockSession({ status: 'awaiting_payment' });

    const req = mockReq({ params: { id: 'session-123' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await cancelBillRequest(req, res, next);

    expect(session.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Bill request cancelled' }));
  });

  it('should return 404 if session not found', async () => {
    const req = mockReq({ params: { id: 'nonexistent' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(null);

    await cancelBillRequest(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session not found', statusCode: 404 }));
  });

  it('should return 400 if session is not awaiting_payment', async () => {
    const session = makeMockSession({ status: 'active' });

    const req = mockReq({ params: { id: 'session-123' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await cancelBillRequest(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should emit billCancelled and billUpdated socket events', async () => {
    const session = makeMockSession({ status: 'awaiting_payment' });

    const req = mockReq({ params: { id: 'session-123' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await cancelBillRequest(req, res, next);

    expect(mockSocketEmitSessionBillCancelled).toHaveBeenCalledWith('session-123');
    expect(mockSocketEmitBillUpdated).toHaveBeenCalledWith('cafe-123', expect.objectContaining({ sessionId: 'session-123' }));
  });

  it('should reset paymentMethod to pending', async () => {
    const session = makeMockSession({ status: 'awaiting_payment', paymentMethod: 'paid_online' });

    const req = mockReq({ params: { id: 'session-123' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await cancelBillRequest(req, res, next);

    expect(session.paymentMethod).toBe('pending');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. GET ACTIVE SESSION FOR TABLE
// ═══════════════════════════════════════════════════════════════════
describe('Session — getActiveSessionForTable', () => {
  it('should return active session for same device', async () => {
    const session = makeMockSession({ deviceId: 'device-001' });

    const req = mockReq({ params: { tableId: 'table-123' }, query: { deviceId: 'device-001' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);
    mockOrderCountDocuments.mockResolvedValue(3);

    await getActiveSessionForTable(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      sameDevice: true,
      activeSession: true,
    }));
    expect(res.cookie).toHaveBeenCalled();
  });

  it('should hide guest token for different device', async () => {
    const session = makeMockSession({ deviceId: 'device-001', guestToken: 'secret-token' });

    const req = mockReq({ params: { tableId: 'table-123' }, query: { deviceId: 'device-002' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);
    mockOrderCountDocuments.mockResolvedValue(3);

    await getActiveSessionForTable(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      sameDevice: false,
      session: expect.objectContaining({ guestToken: undefined }),
    }));
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('should return 404 if no active session', async () => {
    const req = mockReq({ params: { tableId: 'table-123' }, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(null);

    await getActiveSessionForTable(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return sessionLocked for bill_requested status', async () => {
    const session = makeMockSession({ status: 'bill_requested' });

    const req = mockReq({ params: { tableId: 'table-123' }, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);
    mockOrderCountDocuments.mockResolvedValue(3);

    await getActiveSessionForTable(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sessionLocked: true }));
  });

  it('should abandon session with 0 orders older than 15 minutes', async () => {
    const session = makeMockSession({
      status: 'active',
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000),
    });

    const req = mockReq({ params: { tableId: 'table-123' }, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);
    mockOrderCountDocuments.mockResolvedValue(0);

    await getActiveSessionForTable(req, res, next);

    expect(session.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should not abandon session with orders', async () => {
    const session = makeMockSession({
      status: 'active',
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000),
    });

    const req = mockReq({ params: { tableId: 'table-123' }, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);
    mockOrderCountDocuments.mockResolvedValue(5); // has orders

    await getActiveSessionForTable(req, res, next);

    expect(session.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. GET BILL PREVIEW
// ═══════════════════════════════════════════════════════════════════
describe('Session — getBillPreview', () => {
  it('should return bill preview with consolidated items', async () => {
    const session = makeMockSession({ tableId: { tableNumber: 'T1' } });

    const req = mockReq({ params: { id: 'session-123' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('valid-guest-token');
    mockOrderFind.mockResolvedValue([
      {
        status: 'served',
        items: [
          { menuItemId: 'item-1', itemName: 'Burger', price: 100, quantity: 2, gstAmount: 18, status: 'served' },
          { menuItemId: 'item-1', itemName: 'Burger', price: 100, quantity: 1, gstAmount: 18, status: 'served' },
        ],
      },
    ]);

    await getBillPreview(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      bill: expect.objectContaining({
        subtotal: 300, // (100 * 2) + (100 * 1)
        gst: 36, // gstAmount is summed per item entry, not per quantity (18 + 18)
        orderCount: 1,
      }),
    }));
  });

  it('should return 404 if session not found', async () => {
    const req = mockReq({ params: { id: 'nonexistent' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });

    await getBillPreview(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session not found', statusCode: 404 }));
  });

  it('should return 403 if guest token is invalid', async () => {
    const session = makeMockSession({ guestToken: 'correct-token' });

    const req = mockReq({ params: { id: 'session-123' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('wrong-token');

    await getBillPreview(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('should include adjustments in bill', async () => {
    const session = makeMockSession({
      tableId: { tableNumber: 'T1' },
      adjustments: [
        { type: 'addition', description: 'Extra sauce', amount: 50 },
        { type: 'discount', description: 'Coupon', amount: 30 },
      ],
    });

    const req = mockReq({ params: { id: 'session-123' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('valid-guest-token');
    mockOrderFind.mockResolvedValue([]);

    await getBillPreview(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      bill: expect.objectContaining({
        additions: 50,
        discounts: 30,
      }),
    }));
  });

  it('should not count cancelled items', async () => {
    const session = makeMockSession({ tableId: { tableNumber: 'T1' } });

    const req = mockReq({ params: { id: 'session-123' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockResolveGuestToken.mockReturnValue('valid-guest-token');
    mockOrderFind.mockResolvedValue([
      {
        status: 'served',
        items: [
          { menuItemId: 'item-1', itemName: 'Burger', price: 100, quantity: 1, gstAmount: 18, status: 'served' },
          { menuItemId: 'item-2', itemName: 'Fries', price: 50, quantity: 1, gstAmount: 9, status: 'cancelled' },
        ],
      },
    ]);

    await getBillPreview(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      bill: expect.objectContaining({
        subtotal: 100, // Only the burger counted
        gst: 18,
      }),
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. GET SESSIONS (Admin)
// ═══════════════════════════════════════════════════════════════════
describe('Session — getSessions', () => {
  it('should return paginated sessions', async () => {
    const sessions = [
      makeMockSession({ _id: 's1', cafeId: 'cafe-123' }),
      makeMockSession({ _id: 's2', cafeId: 'cafe-123' }),
    ];

    const chain = {
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(sessions),
    };

    const req = mockReq({ query: { page: 1, limit: 10 }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue(chain);
    mockDiningSessionCountDocuments.mockResolvedValue(2);
    mockOrderFind.mockResolvedValue([{ subtotal: 200, totalGST: 36 }]);

    await getSessions(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      totalCount: 2,
    }));
  });

  it('should filter by status', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };

    const req = mockReq({ query: { status: 'active' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue(chain);
    mockDiningSessionCountDocuments.mockResolvedValue(0);

    await getSessions(req, res, next);

    expect(mockDiningSessionFind).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. GET SESSION DETAILS (Admin)
// ═══════════════════════════════════════════════════════════════════
describe('Session — getSessionDetails', () => {
  it('should return session with orders', async () => {
    const session = makeMockSession({ cafeId: 'cafe-123' });
    session.toObject = jest.fn(() => ({ _id: 'session-123', status: 'active' }));

    const req = mockReq({ params: { id: 'session-123' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(session),
    });
    mockOrderFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([
          { _id: 'order-1', orderNumber: 'ORD-001', items: [] },
        ]),
      }),
    });

    await getSessionDetails(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      session: expect.objectContaining({ orders: expect.any(Array) }),
    }));
  });

  it('should return 404 if session not found', async () => {
    const req = mockReq({ params: { id: 'nonexistent' }, cafeId: 'cafe-123' });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });

    await getSessionDetails(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session not found', statusCode: 404 }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. ADD BILL ADJUSTMENT (Admin)
// ═══════════════════════════════════════════════════════════════════
describe('Session — addBillAdjustment', () => {
  it('should add an addition adjustment', async () => {
    const session = makeMockSession({ cafeId: 'cafe-123', adjustments: [] });

    const req = mockReq({
      params: { id: 'session-123' },
      body: { type: 'addition', description: 'Extra sauce', amount: 50 },
      cafeId: 'cafe-123',
      user: { _id: 'admin-001' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);
    mockOrderFind.mockResolvedValue([]);

    await addBillAdjustment(req, res, next);

    expect(session.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Bill adjustment added' }));
  });

  it('should add a discount adjustment', async () => {
    const session = makeMockSession({ cafeId: 'cafe-123', adjustments: [] });

    const req = mockReq({
      params: { id: 'session-123' },
      body: { type: 'discount', description: 'Loyalty discount', amount: 100 },
      cafeId: 'cafe-123',
      user: { _id: 'admin-001' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);
    mockOrderFind.mockResolvedValue([{
      status: 'served',
      items: [{ price: 500, quantity: 2, gstAmount: 90, status: 'served' }],
    }]);

    await addBillAdjustment(req, res, next);

    expect(session.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 400 for invalid adjustment type', async () => {
    const req = mockReq({
      params: { id: 'session-123' },
      body: { type: 'invalid', description: 'Test', amount: 50 },
      cafeId: 'cafe-123',
    });
    const res = mockRes();
    const next = mockNext();

    await addBillAdjustment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should return 400 if description or amount is missing', async () => {
    const req = mockReq({
      params: { id: 'session-123' },
      body: { type: 'addition', description: '', amount: 0 },
      cafeId: 'cafe-123',
    });
    const res = mockRes();
    const next = mockNext();

    await addBillAdjustment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should return 404 if session not found', async () => {
    const req = mockReq({
      params: { id: 'nonexistent' },
      body: { type: 'addition', description: 'Test', amount: 50 },
      cafeId: 'cafe-123',
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(null);

    await addBillAdjustment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session not found', statusCode: 404 }));
  });

  it('should return 400 if session is paid or closed', async () => {
    const session = makeMockSession({ cafeId: 'cafe-123', status: 'paid' });

    const req = mockReq({
      params: { id: 'session-123' },
      body: { type: 'addition', description: 'Test', amount: 50 },
      cafeId: 'cafe-123',
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);

    await addBillAdjustment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should return 400 if discount exceeds current payable', async () => {
    const session = makeMockSession({ cafeId: 'cafe-123', adjustments: [] });

    const req = mockReq({
      params: { id: 'session-123' },
      body: { type: 'discount', description: 'Huge discount', amount: 10000 },
      cafeId: 'cafe-123',
      user: { _id: 'admin-001' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);
    // Total payable: subtotal 100 + GST 18 = 118
    mockOrderFind.mockResolvedValue([{
      status: 'served',
      items: [{ price: 100, quantity: 1, gstAmount: 18, status: 'served' }],
    }]);

    await addBillAdjustment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('should emit billUpdated socket event', async () => {
    const session = makeMockSession({ cafeId: 'cafe-123', adjustments: [] });

    const req = mockReq({
      params: { id: 'session-123' },
      body: { type: 'addition', description: 'Extra sauce', amount: 50 },
      cafeId: 'cafe-123',
      user: { _id: 'admin-001' },
    });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindOne.mockResolvedValue(session);
    mockOrderFind.mockResolvedValue([]);

    await addBillAdjustment(req, res, next);

    expect(mockSocketEmitBillUpdated).toHaveBeenCalledWith('cafe-123', expect.objectContaining({ sessionId: 'session-123' }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. GET ACTIVITY FEED
// ═══════════════════════════════════════════════════════════════════
describe('Session — getActivityFeed', () => {
  it('should return activity feed', async () => {
    const session = makeMockSession({
      activityFeed: [
        { type: 'order_created', message: 'Alice added 2 Burger', timestamp: new Date() },
        { type: 'bill_requested', message: 'Bill requested by Alice', timestamp: new Date() },
      ],
    });

    const req = mockReq({ params: { id: 'session-123' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockResolvedValue(session);
    mockResolveGuestToken.mockReturnValue('valid-guest-token');

    await getActivityFeed(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      activityFeed: expect.arrayContaining([
        expect.objectContaining({ type: 'order_created' }),
      ]),
    }));
  });

  it('should return 404 if session not found', async () => {
    const req = mockReq({ params: { id: 'nonexistent' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockResolvedValue(null);

    await getActivityFeed(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session not found', statusCode: 404 }));
  });

  it('should return 403 if guest token is invalid', async () => {
    const session = makeMockSession({ guestToken: 'correct-token' });

    const req = mockReq({ params: { id: 'session-123' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockResolvedValue(session);
    mockResolveGuestToken.mockReturnValue('wrong-token');

    await getActivityFeed(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('should return empty array if no activity', async () => {
    const session = makeMockSession({ activityFeed: [] });

    const req = mockReq({ params: { id: 'session-123' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFindById.mockResolvedValue(session);
    mockResolveGuestToken.mockReturnValue('valid-guest-token');

    await getActivityFeed(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ activityFeed: [] }));
  });
});

/**
 * Module #08 — Shift / cash-drawer controller tests
 * Tests: getCurrentShift, openShift, closeShift, getShiftHistory
 */

const { mockReq, mockRes, mockNext } = require('./setup');

// ─── Module-level mock functions ────────────────────────────────
const mockShiftFindOne = jest.fn();
const mockShiftCreate = jest.fn();
const mockShiftCountDocuments = jest.fn();
const mockShiftFind = jest.fn();
const mockSummarizeShift = jest.fn();
const mockAuditRecord = jest.fn();
const mockEmitShiftUpdated = jest.fn();

// findOne() is awaited directly in some paths and chained with .sort() in others.
const makeQuery = (value) => {
  const query = Promise.resolve(value);
  query.sort = () => Promise.resolve(value);
  return query;
};

jest.mock('../src/models/Shift', () => ({
  findOne: (...a) => mockShiftFindOne(...a),
  create: (...a) => mockShiftCreate(...a),
  countDocuments: (...a) => mockShiftCountDocuments(...a),
  find: (...a) => mockShiftFind(...a),
}));

jest.mock('../src/services/shiftService', () => ({
  round2: (v) => Math.round((Number(v) || 0) * 100) / 100,
  collectShiftSales: jest.fn(),
  summarizeShift: (...a) => mockSummarizeShift(...a),
}));

jest.mock('../src/services/auditService', () => ({
  recordEvent: (...a) => mockAuditRecord(...a),
}));

jest.mock('../src/services/socketService', () => ({
  emitShiftUpdated: (...a) => mockEmitShiftUpdated(...a),
}));

const {
  getCurrentShift,
  openShift,
  closeShift,
  getShiftHistory,
} = require('../src/controllers/shiftController');

afterEach(() => {
  jest.clearAllMocks();
});

const baseShift = (overrides = {}) => ({
  _id: 'shift-1',
  cafeId: 'cafe-1',
  openedBy: 'user-1',
  openedByName: 'Asha',
  openedAt: new Date('2026-09-27T08:00:00Z'),
  openingFloat: 100,
  closedBy: null,
  closedByName: '',
  closedAt: null,
  closingFloat: null,
  status: 'open',
  notes: '',
  save: jest.fn().mockResolvedValue(true),
  ...overrides,
});

const summary = {
  breakdown: { cash: 250, upi_manual: 50, card_manual: 0, wallet: 0, online: 0 },
  cashSales: 250,
  totalSales: 300,
  orderCount: 5,
  expectedCash: 350,
  difference: null,
};

describe('Shift — getCurrentShift', () => {
  it('returns null when no shift is open', async () => {
    mockShiftFindOne.mockReturnValue(makeQuery(null));

    const req = mockReq({ cafeId: 'cafe-1' });
    const res = mockRes();
    const next = mockNext();

    await getCurrentShift(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, shift: null });
  });

  it('returns the open shift with a live summary', async () => {
    mockShiftFindOne.mockReturnValue(makeQuery(baseShift()));
    mockSummarizeShift.mockResolvedValue(summary);

    const req = mockReq({ cafeId: 'cafe-1' });
    const res = mockRes();
    const next = mockNext();

    await getCurrentShift(req, res, next);

    expect(mockSummarizeShift).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        shift: expect.objectContaining({ id: 'shift-1', status: 'open', expectedCash: 350 }),
      })
    );
  });
});

describe('Shift — openShift', () => {
  it('opens a shift and writes an audit entry', async () => {
    mockShiftFindOne.mockReturnValue(makeQuery(null));
    mockShiftCreate.mockResolvedValue(baseShift());
    mockSummarizeShift.mockResolvedValue(summary);

    const req = mockReq({
      cafeId: 'cafe-1',
      user: { _id: 'user-1', name: 'Asha' },
      body: { openingFloat: 100, notes: 'morning' },
    });
    const res = mockRes();
    const next = mockNext();

    await openShift(req, res, next);

    expect(mockShiftCreate).toHaveBeenCalledWith(
      expect.objectContaining({ cafeId: 'cafe-1', openedByName: 'Asha', openingFloat: 100, status: 'open' })
    );
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shift.opened', entityId: 'shift-1' })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects a second shift while one is open', async () => {
    mockShiftFindOne.mockReturnValue(makeQuery(baseShift()));

    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'user-1', name: 'Asha' }, body: {} });
    const res = mockRes();
    const next = mockNext();

    await openShift(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 })
    );
    expect(mockShiftCreate).not.toHaveBeenCalled();
  });

  it('rejects a negative opening float', async () => {
    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'user-1', name: 'Asha' }, body: { openingFloat: -5 } });
    const res = mockRes();
    const next = mockNext();

    await openShift(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('Shift — closeShift', () => {
  it('closes the shift and computes the cash variance', async () => {
    const shift = baseShift();
    mockShiftFindOne.mockReturnValue(makeQuery(shift));
    mockSummarizeShift.mockResolvedValue(summary);

    const req = mockReq({
      cafeId: 'cafe-1',
      user: { _id: 'user-2', name: 'Ravi' },
      params: { id: 'shift-1' },
      body: { closingFloat: 340, notes: 'handover' },
    });
    const res = mockRes();
    const next = mockNext();

    await closeShift(req, res, next);

    // expected cash 350, counted 340 -> -10 short
    expect(shift.status).toBe('closed');
    expect(shift.difference).toBe(-10);
    expect(shift.expectedCash).toBe(350);
    expect(shift.save).toHaveBeenCalled();
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shift.closed', amount: 340 })
    );
    expect(mockEmitShiftUpdated).toHaveBeenCalledWith('cafe-1', expect.objectContaining({ status: 'closed' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when there is no open shift to close', async () => {
    mockShiftFindOne.mockReturnValue(makeQuery(null));

    const req = mockReq({ cafeId: 'cafe-1', user: { _id: 'user-2', name: 'Ravi' }, params: {}, body: { closingFloat: 0 } });
    const res = mockRes();
    const next = mockNext();

    await closeShift(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('Shift — getShiftHistory', () => {
  it('returns paginated closed shifts', async () => {
    const closed = baseShift({
      status: 'closed',
      closingFloat: 340,
      expectedCash: 350,
      difference: -10,
      cashSales: 250,
      totalSales: 300,
      orderCount: 5,
      paymentsBreakdown: summary.breakdown,
    });

    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => Promise.resolve([closed]),
    };
    mockShiftFind.mockReturnValue(chain);
    mockShiftCountDocuments.mockResolvedValue(1);

    const req = mockReq({ cafeId: 'cafe-1', query: { page: 1, limit: 20 } });
    const res = mockRes();
    const next = mockNext();

    await getShiftHistory(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, totalCount: 1, shifts: [expect.objectContaining({ difference: -10 })] })
    );
  });
});

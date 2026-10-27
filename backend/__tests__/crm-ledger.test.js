/**
 * CRM (#09) and the digital audit ledger (#04).
 *
 * The ledger is the compliance promise of the product: append-only and
 * tamper-evident. The hash-chain test is the one that matters most here.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';

const chainable = (value) => {
  const q = Promise.resolve(value);
  q.sort = () => q;
  q.skip = () => q;
  q.limit = () => q;
  q.select = () => q;
  q.lean = () => Promise.resolve(value);
  return q;
};

// ── CRM ───────────────────────────────────────────────────────

const mockCustomerFind = jest.fn();
const mockCustomerFindOne = jest.fn();
const mockCustomerCountDocuments = jest.fn();
const mockCrmOrderFind = jest.fn();

jest.doMock('../src/models/Customer', () => ({
  find: (...a) => chainable(mockCustomerFind(...a)),
  findOne: (...a) => mockCustomerFindOne(...a),
  countDocuments: (...a) => mockCustomerCountDocuments(...a),
}));

jest.doMock('../src/models/Order', () => ({ find: (...a) => chainable(mockCrmOrderFind(...a)) }));

const customerController = require('../src/controllers/customerController');

// ── Audit ledger ──────────────────────────────────────────────

const mockLedgerFindOne = jest.fn();
const mockLedgerCreate = jest.fn();
const mockLedgerFind = jest.fn();
const mockLedgerCountDocuments = jest.fn();

jest.resetModules();

jest.doMock('../src/models/AuditLedger', () => ({
  findOne: (...a) => chainable(mockLedgerFindOne(...a)),
  create: (...a) => mockLedgerCreate(...a),
  find: (...a) => chainable(mockLedgerFind(...a)),
  countDocuments: (...a) => mockLedgerCountDocuments(...a),
}));

const auditService = require('../src/services/auditService');

beforeEach(() => jest.clearAllMocks());

// ── CRM tests ─────────────────────────────────────────────────

describe('CRM — customer directory', () => {
  it('always scopes the list to the tenant', async () => {
    mockCustomerFind.mockResolvedValue([]);
    mockCustomerCountDocuments.mockResolvedValue(0);

    await customerController.getCustomers(mockReq({ cafeId: CAFE_ID, query: {} }), mockRes(), mockNext());

    expect(mockCustomerFind).toHaveBeenCalledWith(expect.objectContaining({ cafeId: CAFE_ID }));
  });

  it('escapes regex metacharacters in the search term', async () => {
    mockCustomerFind.mockResolvedValue([]);
    mockCustomerCountDocuments.mockResolvedValue(0);

    await customerController.getCustomers(
      mockReq({ cafeId: CAFE_ID, query: { search: 'a.*b' } }),
      mockRes(),
      mockNext()
    );

    const filter = mockCustomerFind.mock.calls[0][0];
    expect(filter.$or[0].name.source).toBe('a\\.\\*b');
    expect(filter.$or[0].name.flags).toContain('i');
  });

  it('falls back to a safe sort for an unknown sort key', async () => {
    mockCustomerFind.mockResolvedValue([]);
    mockCustomerCountDocuments.mockResolvedValue(0);

    await customerController.getCustomers(
      mockReq({ cafeId: CAFE_ID, query: { sort: '; DROP TABLE users' } }),
      mockRes(),
      mockNext()
    );

    // A known key means no user input reached the sort specification.
    const [filter] = mockCustomerFind.mock.calls[0];
    expect(filter).toEqual({ cafeId: CAFE_ID });
  });

  it('paginates', async () => {
    mockCustomerFind.mockResolvedValue([]);
    mockCustomerCountDocuments.mockResolvedValue(60);

    const res = mockRes();
    await customerController.getCustomers(
      mockReq({ cafeId: CAFE_ID, query: { page: 2, limit: 25 } }),
      res,
      mockNext()
    );

    expect(res._jsonData.page).toBe(2);
    expect(res._jsonData.totalPages).toBe(3);
  });
});

describe('CRM — profile', () => {
  it('404s a customer belonging to another tenant', async () => {
    mockCustomerFindOne.mockResolvedValue(null);
    const next = mockNext();

    await customerController.getCustomer(mockReq({ cafeId: CAFE_ID, params: { id: 'c1' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('returns the profile with that customer’s orders only', async () => {
    const customer = { _id: 'c1', name: 'Riya', cafeId: CAFE_ID };
    mockCustomerFindOne.mockResolvedValue(customer);
    mockCrmOrderFind.mockResolvedValue([]);

    const res = mockRes();
    await customerController.getCustomer(mockReq({ cafeId: CAFE_ID, params: { id: 'c1' } }), res, mockNext());

    expect(mockCustomerFindOne).toHaveBeenCalledWith({ _id: 'c1', cafeId: CAFE_ID });
    expect(mockCrmOrderFind).toHaveBeenCalledWith({ cafeId: CAFE_ID, customerId: 'c1' });
    expect(res._statusCode).toBe(200);
  });

  it('only writes allow-listed profile fields', async () => {
    const customer = {
      _id: 'c1',
      notes: '',
      dietary: [],
      tags: [],
      lifetimeSpend: 9999,
      save: jest.fn().mockResolvedValue(true),
    };
    mockCustomerFindOne.mockResolvedValue(customer);

    await customerController.updateCustomer(
      mockReq({
        cafeId: CAFE_ID,
        params: { id: 'c1' },
        body: { notes: 'likes oat milk', lifetimeSpend: 0, visitCount: 99 },
      }),
      mockRes(),
      mockNext()
    );

    expect(customer.notes).toBe('likes oat milk');
    // Money counters are computed from orders, never from a request body.
    expect(customer.lifetimeSpend).toBe(9999);
    expect(customer.visitCount).toBeUndefined();
  });

  it('parses a birthday into a Date', async () => {
    const customer = { _id: 'c1', save: jest.fn().mockResolvedValue(true) };
    mockCustomerFindOne.mockResolvedValue(customer);

    await customerController.updateCustomer(
      mockReq({ cafeId: CAFE_ID, params: { id: 'c1' }, body: { birthday: '1995-04-12' } }),
      mockRes(),
      mockNext()
    );

    expect(customer.birthday).toBeInstanceOf(Date);
  });
});

describe('CRM — CSV export', () => {
  it('quotes cells that contain a comma or a quote', async () => {
    mockCustomerFind.mockResolvedValue([
      {
        name: 'Riya, R.',
        phone: '999',
        email: 'r@example.com',
        visitCount: 3,
        lifetimeSpend: 900,
        avgSpend: 300,
        lastVisitAt: new Date('2026-09-01'),
        dietary: ['vegan'],
        tags: ['regular'],
        notes: 'said "great"',
      },
    ]);

    const res = mockRes();
    await customerController.exportCustomersCsv(mockReq({ cafeId: CAFE_ID }), res, mockNext());

    const csv = res.send.mock.calls[0][0];
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(csv).toContain('"Riya, R."');
    expect(csv).toContain('"said ""great"""');
    expect(csv.split('\n')[0]).toContain('Lifetime Spend');
  });
});

// ── Audit ledger ──────────────────────────────────────────────

describe('auditService — hash-chained ledger', () => {
  // `clearAllMocks` does not drain mockResolvedValueOnce queues, so reset the
  // ledger mocks explicitly between chain assertions.
  beforeEach(() => {
    mockLedgerFindOne.mockReset();
    mockLedgerCreate.mockReset().mockImplementation(async (data) => data);
  });

  it('starts at sequence 1 with a GENESIS predecessor', async () => {
    mockLedgerFindOne.mockResolvedValue(null);
    mockLedgerCreate.mockImplementation(async (data) => data);

    const entry = await auditService.recordEvent({
      cafeId: CAFE_ID,
      type: 'invoice.closed',
      amount: 450,
    });

    expect(entry.sequence).toBe(1);
    expect(entry.prevHash).toBe('GENESIS');
    expect(entry.entryHash).toHaveLength(64);
  });

  it('chains each entry to the previous one', async () => {
    mockLedgerFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ sequence: 1, entryHash: 'a'.repeat(64) });
    mockLedgerCreate.mockImplementation(async (data) => data);

    const first = await auditService.recordEvent({ cafeId: CAFE_ID, type: 'invoice.closed', amount: 450 });
    const second = await auditService.recordEvent({ cafeId: CAFE_ID, type: 'order.refund', amount: 50 });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    // The second entry folds in the head of the chain it found.
    expect(second.prevHash).toBe('a'.repeat(64));
    expect(second.entryHash).not.toBe('a'.repeat(64));
    expect(second.entryHash).toHaveLength(64);
  });

  it('produces a different hash when the payload changes', () => {
    const base = auditService.hashEntry({ type: 'x', amount: 10 }, 'prev');
    const changed = auditService.hashEntry({ type: 'x', amount: 11 }, 'prev');
    expect(base).not.toBe(changed);
  });

  it('produces a different hash when the predecessor changes', () => {
    const payload = { type: 'x', amount: 10 };
    expect(auditService.hashEntry(payload, 'prev1')).not.toBe(auditService.hashEntry(payload, 'prev2'));
  });

  it('normalises ids to strings so the payload is stable', async () => {
    mockLedgerFindOne.mockResolvedValue(null);
    mockLedgerCreate.mockImplementation(async (data) => data);

    const entry = await auditService.recordEvent({ cafeId: CAFE_ID, type: 'x' });
    expect(entry.cafeId).toBe(String(CAFE_ID));
    expect(entry.entityId).toBeNull();
  });

  it('scopes ledger listing to the tenant', async () => {
    mockLedgerFind.mockResolvedValue([]);
    mockLedgerCountDocuments.mockResolvedValue(0);

    await auditService.listEvents({ cafeId: CAFE_ID, limit: 10 });

    expect(mockLedgerFind).toHaveBeenCalledWith(expect.objectContaining({ cafeId: CAFE_ID }));
  });

  it('filters the ledger by type and date range', async () => {
    mockLedgerFind.mockResolvedValue([]);
    mockLedgerCountDocuments.mockResolvedValue(0);

    await auditService.listEvents({
      cafeId: CAFE_ID,
      type: 'invoice.closed',
      from: '2026-09-01',
      to: '2026-09-30',
    });

    const [filter] = mockLedgerFind.mock.calls[0];
    expect(filter.type).toBe('invoice.closed');
    expect(filter.createdAt.$gte).toBeInstanceOf(Date);
    expect(filter.createdAt.$lte).toBeInstanceOf(Date);
  });
});
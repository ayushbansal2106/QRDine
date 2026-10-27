/**
 * Billing Flow Tests
 * Tests: getBills, getSalesHistory, getAnalytics
 */

const { mockReq, mockRes, mockNext } = require('./setup');
const mongoose = require('mongoose');

// ─── Module-level mock functions ────────────────────────────────
const mockDiningSessionFind = jest.fn();
const mockOrderFind = jest.fn();
const mockOrderCountDocuments = jest.fn();
const mockDailySummaryFind = jest.fn();
const mockInvoiceFindOne = jest.fn();
const mockInvoiceFind = jest.fn();
const mockDiningSessionCountDocuments = jest.fn();
const mockDiningSessionAggregate = jest.fn();
const mockOrderAggregate = jest.fn();

// ─── Register mocks ONCE at top level ───────────────────────────
jest.mock('../src/models/DiningSession', () => {
  const DiningSession = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'mock-session-id';
    this.toObject = jest.fn(function () {
      return { _id: this._id, cafeId: this.cafeId, tableId: this.tableId, status: this.status, customerName: this.customerName, totalAmount: this.totalAmount, gst: this.gst };
    });
  };
  DiningSession.find = (...a) => mockDiningSessionFind(...a);
  DiningSession.countDocuments = (...a) => mockDiningSessionCountDocuments(...a);
  DiningSession.aggregate = (...a) => mockDiningSessionAggregate(...a);
  return DiningSession;
});

jest.mock('../src/models/Order', () => {
  const Order = function (data) { Object.assign(this, data); this._id = data._id || 'mock-order-id'; };
  Order.find = (...a) => mockOrderFind(...a);
  Order.countDocuments = (...a) => mockOrderCountDocuments(...a);
  Order.aggregate = (...a) => mockOrderAggregate(...a);
  return Order;
});

jest.mock('../src/models/DailySummary', () => {
  const DailySummary = function (data) { Object.assign(this, data); this._id = data._id || 'mock-summary-id'; };
  DailySummary.find = (...a) => mockDailySummaryFind(...a);
  return DailySummary;
});

jest.mock('../src/models/Invoice', () => {
  const Invoice = function (data) { Object.assign(this, data); this._id = data._id || 'mock-invoice-id'; };
  Invoice.findOne = (...a) => mockInvoiceFindOne(...a);
  Invoice.find = (...a) => mockInvoiceFind(...a);
  return Invoice;
});

// ─── Load controller ONCE ───────────────────────────────────────
const { getBills, getSalesHistory, getAnalytics } = require('../src/controllers/billingController');

afterEach(() => { jest.clearAllMocks(); });

// ─── Helpers ────────────────────────────────────────────────────
// A real 24-character hex id. `tenantMiddleware` always supplies one, and
// `getSalesHistory` casts it for its aggregations, so a malformed fixture here
// would fail for a reason production never hits.
const cafeId = '507f1f77bcf86cd799439011';

function makeMockSession(overrides = {}) {
  return {
    _id: 'session-001', cafeId, tableId: 'table-001', status: 'active',
    customerName: 'Alice', totalAmount: 500, gst: 25, adjustments: [],
    toObject: jest.fn(function () {
      return { _id: this._id, cafeId: this.cafeId, tableId: this.tableId, status: this.status, customerName: this.customerName, totalAmount: this.totalAmount, gst: this.gst };
    }),
    ...overrides,
  };
}

function makeMockOrder(overrides = {}) {
  return {
    _id: 'order-001', sessionId: 'session-001', status: 'served',
    items: [{ _id: 'item-001', itemName: 'Espresso', quantity: 2, price: 120, gstAmount: 12, status: 'served' }],
    ...overrides,
  };
}

function makeMockDailySummary(overrides = {}) {
  return {
    _id: 'summary-001', cafeId, date: new Date(),
    totalRevenue: 5000, gstCollected: 250, orderCount: 15,
    sessionCount: 10, customerCount: 20,
    ...overrides,
  };
}

// ─── getBills ───────────────────────────────────────────────────
describe('Billing — getBills', () => {
  it('should return active sessions with order counts and running totals', async () => {
    const session = makeMockSession();
    const order = makeMockOrder();

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([session]),
      }),
    });
    mockOrderFind.mockResolvedValue([order]);

    await getBills(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, bills: expect.any(Array) }));
  });

  it('should filter active sessions with zero orders', async () => {
    const session = makeMockSession({ status: 'active' });

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([session]),
      }),
    });
    mockOrderFind.mockResolvedValue([]);

    await getBills(req, res, next);

    const responseData = res.json.mock.calls[0][0];
    expect(responseData.bills).toHaveLength(0);
  });

  it('should include sessions with orders even if active', async () => {
    const session = makeMockSession({ status: 'active' });
    const order = makeMockOrder();

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([session]),
      }),
    });
    mockOrderFind.mockResolvedValue([order]);

    await getBills(req, res, next);

    const responseData = res.json.mock.calls[0][0];
    expect(responseData.bills).toHaveLength(1);
    expect(responseData.bills[0].orderCount).toBe(1);
  });

  it('should bill for food that is still in the kitchen', async () => {
    const session = makeMockSession();
    // A bill is what the guest asked for. Food still being prepared is still
    // food they ordered — the old `served` gate showed this table a total of
    // ₹157.50 less than they were actually going to be charged.
    const order = makeMockOrder({
      status: 'preparing',
      items: [
        { _id: 'item-001', itemName: 'Espresso', quantity: 2, price: 120, gstAmount: 12, status: 'served' },
        { _id: 'item-002', itemName: 'Latte', quantity: 1, price: 150, gstAmount: 7.5, status: 'pending' },
      ],
    });

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([session]),
      }),
    });
    mockOrderFind.mockResolvedValue([order]);

    await getBills(req, res, next);

    const bill = res.json.mock.calls[0][0].bills[0];
    // Espresso 120*2 + 12 = 252, plus Latte 150 + 7.5 = 157.50
    expect(bill.runningTotal).toBe(409.5);
  });

  it('should not bill for items withdrawn mid-service', async () => {
    const session = makeMockSession();
    // The other half of the contract: money must never be taken for something
    // the guest removed or the kitchen could not deliver.
    const order = makeMockOrder({
      status: 'served',
      items: [
        { _id: 'item-001', itemName: 'Espresso', quantity: 1, price: 120, gstAmount: 12, status: 'served' },
        { _id: 'item-002', itemName: 'Latte', quantity: 1, price: 150, gstAmount: 7.5, status: 'cancelled' },
        { _id: 'item-003', itemName: 'Muffin', quantity: 1, price: 80, gstAmount: 4, status: 'partially_cancelled' },
      ],
    });

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([session]),
      }),
    });
    mockOrderFind.mockResolvedValue([order]);

    await getBills(req, res, next);

    // Only the Espresso line survives.
    expect(res.json.mock.calls[0][0].bills[0].runningTotal).toBe(132);
  });

  it('should apply bill adjustments to running total', async () => {
    const session = makeMockSession({
      adjustments: [
        { type: 'addition', description: 'Service fee', amount: 50 },
        { type: 'discount', description: 'Happy hour', amount: 30 },
      ],
    });
    const order = makeMockOrder();

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([session]),
      }),
    });
    mockOrderFind.mockResolvedValue([order]);

    await getBills(req, res, next);

    const bill = res.json.mock.calls[0][0].bills[0];
    expect(bill.runningTotal).toBe(272);
  });

  it('should not allow running total to go below zero', async () => {
    const session = makeMockSession({
      adjustments: [{ type: 'discount', description: 'Full comp', amount: 500 }],
    });
    const order = makeMockOrder();

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([session]),
      }),
    });
    mockOrderFind.mockResolvedValue([order]);

    await getBills(req, res, next);

    const bill = res.json.mock.calls[0][0].bills[0];
    expect(bill.runningTotal).toBe(0);
  });

  it('should exclude cancelled orders from bill calculation', async () => {
    // Use awaiting_payment status so the session isn't filtered out
    const session = makeMockSession({ status: 'awaiting_payment' });

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([session]),
      }),
    });
    // Controller filters: status: { $ne: 'cancelled' }
    // Mock returns empty array to simulate the filter excluding cancelled orders
    mockOrderFind.mockResolvedValue([]);

    await getBills(req, res, next);

    const bill = res.json.mock.calls[0][0].bills[0];
    expect(bill.runningTotal).toBe(0);
  });

  it('should support filtering by status query param', async () => {
    const req = mockReq({ cafeId, query: { status: 'awaiting_payment' } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([]),
      }),
    });
    mockOrderFind.mockResolvedValue([]);

    await getBills(req, res, next);

    expect(mockDiningSessionFind).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'awaiting_payment' })
    );
  });
});

// ─── getSalesHistory ────────────────────────────────────────────
describe('Billing — getSalesHistory', () => {
  /**
   * `getSalesHistory` reads two sources (closed sessions and settled counter
   * sales) and merges them, so its mocks have to answer both sides plus the
   * aggregate helpers. `lean()` terminates each query chain.
   */
  function mockSalesHistoryQueries({
    sessions = [],
    posOrders = [],
    invoices = [],
    orderCounts = [],
    sessionTotals = [],
    posTotals = [],
    sessionCount = 0,
    posCount = 0,
  } = {}) {
    // A permissive chain: each query builder method returns itself, so the
    // mock does not care how many `populate`s a query happens to use.
    const query = (result) => {
      const chain = {
        sort: () => chain,
        populate: () => chain,
        limit: () => chain,
        skip: () => chain,
        lean: jest.fn().mockResolvedValue(result),
      };
      return chain;
    };

    mockDiningSessionFind.mockReturnValue(query(sessions));
    mockOrderFind.mockReturnValue(query(posOrders));
    mockDiningSessionCountDocuments.mockResolvedValue(sessionCount);
    mockOrderCountDocuments.mockResolvedValue(posCount);
    // Three aggregations run: session revenue, POS revenue, per-session counts.
    mockDiningSessionAggregate.mockResolvedValue(sessionTotals);
    mockOrderAggregate
      .mockResolvedValueOnce(posTotals)
      .mockResolvedValue(orderCounts);
    mockInvoiceFind.mockResolvedValue(invoices);
  }

  it('should return closed sessions with pagination', async () => {
    const session = makeMockSession({ status: 'closed' });

    const req = mockReq({ cafeId, query: { page: 1, limit: 10 } });
    const res = mockRes();
    const next = mockNext();

    mockSalesHistoryQueries({ sessions: [session], sessionCount: 1 });

    await getSalesHistory(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: expect.any(Array),
        entries: expect.any(Array),
        summary: expect.objectContaining({ totalRevenue: expect.any(Number), sessionCount: expect.any(Number) }),
      })
    );
  });

  it('should calculate summary totals across closed sessions', async () => {
    const session1 = makeMockSession({ status: 'closed', totalAmount: 500, gst: 25 });
    const session2 = makeMockSession({ status: 'closed', totalAmount: 300, gst: 15, _id: 'session-002' });

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockSalesHistoryQueries({
      sessions: [session1, session2],
      sessionCount: 2,
      sessionTotals: [{ revenue: 800, gst: 40 }],
    });

    await getSalesHistory(req, res, next);

    const summary = res.json.mock.calls[0][0].summary;
    expect(summary.totalRevenue).toBe(800);
    expect(summary.totalGST).toBe(40);
    expect(summary.sessionCount).toBe(2);
    expect(summary.averageOrderValue).toBe(400);
  });

  it('should include settled counter sales alongside table sessions', async () => {
    // The regression this guards: takings read only from DiningSession reported a
    // cafe that rang up real counter money as having made none.
    const posOrder = {
      _id: 'order-pos-1',
      orderNumber: 'ORD-20260719-0007',
      channel: 'pos',
      sessionId: null,
      paymentStatus: 'paid',
      status: 'served',
      totalAmount: 450,
      subtotal: 400,
      totalGST: 50,
      createdAt: new Date('2026-07-19T12:00:00Z'),
      payments: [{ method: 'cash', amount: 450 }],
      tableId: null,
      customerId: { name: 'Ravi', email: 'ravi@example.com' },
    };

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockSalesHistoryQueries({
      posOrders: [posOrder],
      posCount: 1,
      posTotals: [{ revenue: 450, gst: 50 }],
    });

    await getSalesHistory(req, res, next);

    const body = res.json.mock.calls[0][0];
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toEqual(
      expect.objectContaining({
        kind: 'pos_order',
        orderNumber: 'ORD-20260719-0007',
        customerName: 'Ravi',
        totalAmount: 450,
        paymentMethod: 'cash',
        tableNumber: null,
      })
    );
    expect(body.summary.totalRevenue).toBe(450);
    expect(body.summary.totalGST).toBe(50);
    expect(body.summary.sessionCount).toBe(1);
  });

  it('should exclude counter orders that were never paid', async () => {
    // An abandoned payment popup used to leave a `pending` POS order behind. It
    // is money that was never taken, so it must not reach the sales figures.
    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockSalesHistoryQueries({ posOrders: [], posCount: 0, posTotals: [] });

    await getSalesHistory(req, res, next);

    expect(mockOrderFind).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'pos',
        sessionId: null,
        paymentStatus: 'paid',
        status: { $ne: 'cancelled' },
      })
    );
    const body = res.json.mock.calls[0][0];
    expect(body.entries).toHaveLength(0);
    expect(body.summary.totalRevenue).toBe(0);
  });

  it('should cast the tenant id before aggregating', async () => {
    // `aggregate()` hands the pipeline straight to the server and does NOT cast
    // its filter the way `find()` does. `tenantMiddleware` supplies `cafeId` as
    // a string, so an uncast id matches nothing: the rows render but the
    // summary silently reads ₹0. This assertion exists because it happened.
    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockSalesHistoryQueries({ posOrders: [], posCount: 0, posTotals: [] });

    await getSalesHistory(req, res, next);

    const sessionPipeline = mockDiningSessionAggregate.mock.calls[0][0];
    const posPipeline = mockOrderAggregate.mock.calls[0][0];

    for (const pipeline of [sessionPipeline, posPipeline]) {
      expect(pipeline[0].$match.cafeId).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(pipeline[0].$match.cafeId.toString()).toBe(cafeId);
    }
  });

  it('should include invoice data when available', async () => {
    const session = makeMockSession({ status: 'closed' });
    const mockInvoice = { _id: 'inv-001', sessionId: 'session-001', invoiceNumber: 'INV-20260719-0001', pdfUrl: '/invoices/inv-001.pdf' };

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockSalesHistoryQueries({
      sessions: [session],
      invoices: [mockInvoice],
      orderCounts: [{ _id: 'session-001', count: 1 }],
    });

    await getSalesHistory(req, res, next);

    const enriched = res.json.mock.calls[0][0].sessions[0];
    expect(enriched.invoice).toEqual({
      id: 'inv-001',
      invoiceNumber: 'INV-20260719-0001',
      pdfUrl: '/invoices/inv-001.pdf',
    });
    expect(enriched.orderCount).toBe(1);
  });

  it('should set invoice to null when no invoice exists', async () => {
    const session = makeMockSession({ status: 'closed' });

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockSalesHistoryQueries({ sessions: [session], invoices: [], orderCounts: [] });

    await getSalesHistory(req, res, next);

    const enriched = res.json.mock.calls[0][0].sessions[0];
    expect(enriched.invoice).toBeNull();
  });
});

// ─── getAnalytics ───────────────────────────────────────────────
describe('Billing — getAnalytics', () => {
  it('should return aggregated daily summaries', async () => {
    const summary = makeMockDailySummary();

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDailySummaryFind.mockReturnValue({ sort: jest.fn().mockResolvedValue([summary]) });

    await getAnalytics(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        totals: expect.objectContaining({ totalRevenue: expect.any(Number), gstCollected: expect.any(Number) }),
        dailySummaries: expect.any(Array),
      })
    );
  });

  it('should calculate correct aggregate totals', async () => {
    const summary1 = makeMockDailySummary({ totalRevenue: 5000, gstCollected: 250, orderCount: 15, sessionCount: 10, customerCount: 20 });
    const summary2 = makeMockDailySummary({ totalRevenue: 3000, gstCollected: 150, orderCount: 10, sessionCount: 8, customerCount: 15, _id: 'summary-002' });

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDailySummaryFind.mockReturnValue({ sort: jest.fn().mockResolvedValue([summary1, summary2]) });

    await getAnalytics(req, res, next);

    const totals = res.json.mock.calls[0][0].totals;
    expect(totals.totalRevenue).toBe(8000);
    expect(totals.gstCollected).toBe(400);
    expect(totals.orderCount).toBe(25);
    expect(totals.sessionCount).toBe(18);
    expect(totals.customerCount).toBe(35);
  });

  it('should calculate average order value', async () => {
    const summary = makeMockDailySummary({ totalRevenue: 1000, orderCount: 4 });

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDailySummaryFind.mockReturnValue({ sort: jest.fn().mockResolvedValue([summary]) });

    await getAnalytics(req, res, next);

    const totals = res.json.mock.calls[0][0].totals;
    expect(totals.averageOrderValue).toBe(250);
  });

  it('should return 0 for average order value when no orders', async () => {
    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDailySummaryFind.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

    await getAnalytics(req, res, next);

    const totals = res.json.mock.calls[0][0].totals;
    expect(totals.averageOrderValue).toBe(0);
  });
});

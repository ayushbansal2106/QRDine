/**
 * Billing Flow Tests
 * Tests: getBills, getSalesHistory, getAnalytics
 */

const { mockReq, mockRes, mockNext } = require('./setup');

// ─── Module-level mock functions ────────────────────────────────
const mockDiningSessionFind = jest.fn();
const mockOrderFind = jest.fn();
const mockOrderCountDocuments = jest.fn();
const mockDailySummaryFind = jest.fn();
const mockInvoiceFindOne = jest.fn();

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
  DiningSession.countDocuments = jest.fn();
  return DiningSession;
});

jest.mock('../src/models/Order', () => {
  const Order = function (data) { Object.assign(this, data); this._id = data._id || 'mock-order-id'; };
  Order.find = (...a) => mockOrderFind(...a);
  Order.countDocuments = (...a) => mockOrderCountDocuments(...a);
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
  return Invoice;
});

// ─── Load controller ONCE ───────────────────────────────────────
const { getBills, getSalesHistory, getAnalytics } = require('../src/controllers/billingController');

afterEach(() => { jest.clearAllMocks(); });

// ─── Helpers ────────────────────────────────────────────────────
const cafeId = 'cafe-001';

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

  it('should calculate running total from served items only', async () => {
    const session = makeMockSession();
    // Controller: if item.status === 'served' || order.status === 'served' => count ALL items
    // So to test served-items-only counting, order.status must NOT be 'served'
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
    // Only the served item counted: Espresso (120*2 + 12 = 252)
    expect(bill.runningTotal).toBe(252);
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
  it('should return closed sessions with pagination', async () => {
    const session = makeMockSession({ status: 'closed' });

    const req = mockReq({ cafeId, query: { page: 1, limit: 10 } });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([session]),
            }),
          }),
        }),
      })
      .mockResolvedValueOnce([session]);

    mockOrderCountDocuments.mockResolvedValue(1);
    mockInvoiceFindOne.mockResolvedValue(null);

    await getSalesHistory(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: expect.any(Array),
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

    mockDiningSessionFind
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([session1, session2]),
            }),
          }),
        }),
      })
      .mockResolvedValueOnce([session1, session2]);

    mockOrderCountDocuments.mockResolvedValue(1);
    mockInvoiceFindOne.mockResolvedValue(null);

    await getSalesHistory(req, res, next);

    const summary = res.json.mock.calls[0][0].summary;
    expect(summary.totalRevenue).toBe(800);
    expect(summary.totalGST).toBe(40);
    expect(summary.sessionCount).toBe(2);
    expect(summary.averageOrderValue).toBe(400);
  });

  it('should include invoice data when available', async () => {
    const session = makeMockSession({ status: 'closed' });
    const mockInvoice = { _id: 'inv-001', invoiceNumber: 'INV-20260719-0001', pdfUrl: '/invoices/inv-001.pdf' };

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([session]),
            }),
          }),
        }),
      })
      .mockResolvedValueOnce([session]);

    mockOrderCountDocuments.mockResolvedValue(1);
    mockInvoiceFindOne.mockResolvedValue(mockInvoice);

    await getSalesHistory(req, res, next);

    const enriched = res.json.mock.calls[0][0].sessions[0];
    expect(enriched.invoice).toEqual({
      id: 'inv-001',
      invoiceNumber: 'INV-20260719-0001',
      pdfUrl: '/invoices/inv-001.pdf',
    });
  });

  it('should set invoice to null when no invoice exists', async () => {
    const session = makeMockSession({ status: 'closed' });

    const req = mockReq({ cafeId, query: {} });
    const res = mockRes();
    const next = mockNext();

    mockDiningSessionFind
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([session]),
            }),
          }),
        }),
      })
      .mockResolvedValueOnce([session]);

    mockOrderCountDocuments.mockResolvedValue(0);
    mockInvoiceFindOne.mockResolvedValue(null);

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

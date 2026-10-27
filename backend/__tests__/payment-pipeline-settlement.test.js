/**
 * Regression guard — the payment pipeline must price a QR session and award the
 * loyalty stamp for it.
 *
 * `executePaymentPipeline` called `orderService.sumBillableItems(orders)` to
 * price the table but never required the module. CommonJS turned that into a
 * `ReferenceError` the instant a bill was settled, which:
 *   - 500'd every settle action (`POST /api/bills`, mark-paid, POS checkout), and
 *   - aborted before the loyalty/wallet/scratch steps, so QR visits that met the
 *     program rules still showed no stamp on the customer's card.
 */
jest.mock('../src/models/DiningSession', () => ({
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));
jest.mock('../src/models/Order', () => ({ find: jest.fn() }));
jest.mock('../src/models/Invoice', () => ({
  countDocuments: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../src/models/Cafe', () => ({ findById: jest.fn() }));
jest.mock('../src/models/Table', () => ({ findById: jest.fn() }));

jest.mock('../src/services/invoiceService', () => ({
  generateInvoicePDF: jest.fn(),
}));
jest.mock('../src/services/emailService', () => ({ sendInvoiceEmail: jest.fn() }));
jest.mock('../src/services/dailySummaryService', () => ({ updateDailySummary: jest.fn() }));
jest.mock('../src/services/socketService', () => ({
  emitSessionPaid: jest.fn(),
  emitSessionClosed: jest.fn(),
}));
jest.mock('../src/services/telemetryService', () => ({ emitRefresh: jest.fn() }));
jest.mock('../src/services/auditService', () => ({ recordEvent: jest.fn() }));
jest.mock('../src/services/customerService', () => ({ recordVisit: jest.fn() }));
jest.mock('../src/services/loyaltyService', () => ({ earnStamps: jest.fn() }));
jest.mock('../src/services/scratchService', () => ({ maybeIssueCard: jest.fn() }));

const DiningSession = require('../src/models/DiningSession');
const Order = require('../src/models/Order');
const Invoice = require('../src/models/Invoice');
const Cafe = require('../src/models/Cafe');
const Table = require('../src/models/Table');
const loyaltyService = require('../src/services/loyaltyService');
const { executePaymentPipeline } = require('../src/services/paymentPipeline');

const CUSTOMER_ID = '6ac0cabe7eb012096052d970';

const buildSession = () => ({
  _id: '6ac116d7b6e3a15afc39e87e',
  tableId: '6ac08fb2dc276e3c59831d62',
  customerName: 'Ayush',
  customerEmail: null,
  status: 'active',
  adjustments: [],
  save: jest.fn().mockResolvedValue(undefined),
});

// Food still in the kitchen — a pending line is still payable.
const buildOrder = () => ({
  _id: '6ac1aaaa7eb012096052d001',
  status: 'pending',
  customerId: CUSTOMER_ID,
  totalAmount: 142.76,
  items: [
    {
      menuItemId: '6ac0c9f07eb012096052d900',
      itemName: 'Curd Rice',
      price: 120,
      quantity: 1,
      gstAmount: 22.76,
      status: 'pending',
    },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  DiningSession.findOneAndUpdate.mockImplementation(async () => buildSession());
  Order.find.mockResolvedValue([buildOrder()]);
  Cafe.findById.mockResolvedValue({ name: 'My Cafe' });
  Table.findById.mockResolvedValue({ tableNumber: 1 });
  Invoice.countDocuments.mockResolvedValue(0);
  Invoice.create.mockResolvedValue({ _id: '6ac1bbbb7eb012096052d002' });

  // PDF generation is best-effort; failing it must not stop the pipeline.
  require('../src/services/invoiceService').generateInvoicePDF.mockRejectedValue(
    new Error('no pdf in tests')
  );
  require('../src/services/dailySummaryService').updateDailySummary.mockResolvedValue(undefined);
  require('../src/services/telemetryService').emitRefresh.mockReturnValue(undefined);
  require('../src/services/auditService').recordEvent.mockResolvedValue(undefined);
  require('../src/services/customerService').recordVisit.mockResolvedValue(undefined);
  require('../src/services/scratchService').maybeIssueCard.mockResolvedValue(null);
  loyaltyService.earnStamps.mockResolvedValue({ stampsEarned: 1, vouchersIssued: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('executePaymentPipeline — QR settlement', () => {
  it('prices a table from every non-cancelled line, not only served ones', async () => {
    const session = await executePaymentPipeline('6ac116d7b6e3a15afc39e87e', 'paid_counter', '6ac08f59dc276e3c59831d60')
      .then((result) => result.session);

    expect(session.totalAmount).toBe(142.76);
    expect(session.subtotal).toBe(120);
    expect(session.status).toBe('closed');
    expect(session.invoiceNumber).toEqual(expect.stringMatching(/^INV-\d{8}-\d{4}$/));
  });

  it('awards the loyalty stamp for the settled QR visit', async () => {
    await executePaymentPipeline('6ac116d7b6e3a15afc39e87e', 'paid_counter', '6ac08f59dc276e3c59831d60');

    expect(loyaltyService.earnStamps).toHaveBeenCalledWith(
      expect.objectContaining({ cafeId: '6ac08f59dc276e3c59831d60', customerId: CUSTOMER_ID })
    );
  });

  it('imports orderService, so the billable-sum helper cannot be a ReferenceError', () => {
    const source = require('fs').readFileSync(
      require.resolve('../src/services/paymentPipeline'),
      'utf8'
    );
    expect(source).toMatch(/require\('\.\/orderService'\)/);
    expect(source).toMatch(/orderService\.sumBillableItems/);
  });

  it('releases the processing lock when the pipeline fails, so the table is not stranded', async () => {
    Order.find.mockRejectedValue(new Error('mongo hiccup'));

    await expect(
      executePaymentPipeline('6ac116d7b6e3a15afc39e87e', 'paid_counter', '6ac08f59dc276e3c59831d60')
    ).rejects.toThrow('mongo hiccup');

    expect(DiningSession.findByIdAndUpdate).toHaveBeenCalledWith(
      '6ac116d7b6e3a15afc39e87e',
      { $set: { status: 'active' } }
    );
  });

  it('restores the status it displaced, not a hardcoded one', async () => {
    DiningSession.findOneAndUpdate.mockImplementation(async () => ({
      ...buildSession(),
      status: 'awaiting_payment',
    }));
    Order.find.mockRejectedValue(new Error('mongo hiccup'));

    await expect(
      executePaymentPipeline('6ac116d7b6e3a15afc39e87e', 'paid_counter', '6ac08f59dc276e3c59831d60')
    ).rejects.toThrow('mongo hiccup');

    expect(DiningSession.findByIdAndUpdate).toHaveBeenCalledWith(
      '6ac116d7b6e3a15afc39e87e',
      { $set: { status: 'awaiting_payment' } }
    );
  });
});


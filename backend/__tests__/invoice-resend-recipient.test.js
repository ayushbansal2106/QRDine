/**
 * ISSUE-37 — "Resend invoice" reported success without sending anything.
 *
 * `resendInvoiceEmail` addressed the mail to `session.customerEmail` and nothing
 * else. That field is only populated when a guest typed an email at the table,
 * so for a large share of bills it was empty — and `sendInvoiceEmail` was then
 * handed an empty `to:`, which some transports accept silently. The endpoint
 * returned `200 { emailSent: false }`, which the UI read as a completed resend.
 *
 * The staff experience was: press Resend, see a success message, no mail.
 *
 * Two things were wrong and both are fixed here:
 *
 *   1. **An empty recipient must be an error, not a silent no-op.** It is a 409
 *      so the caller can tell "sent" from "we had nobody to send it to" and
 *      prompt for an address instead of showing an error nobody can act on.
 *   2. **A verified profile email is a legitimate recipient.** A customer who
 *      gave their email to the cashier, or verified it at sign-in, can be
 *      reached even though the session never saw one.
 *
 * Unverified profile emails are deliberately *not* used — an invoice is a legal
 * document and must not go to an address nobody proved they own.
 */

const mockInvoiceFindOne = jest.fn();
const mockSessionFindById = jest.fn();
const mockSessionSave = jest.fn();
const mockOrderFindOne = jest.fn();
const mockCustomerFindOne = jest.fn();
const mockCustomerSave = jest.fn();
const mockSendInvoiceEmail = jest.fn();
const mockExistsSync = jest.fn();

jest.resetModules();

jest.doMock('../src/models/Invoice', () => ({ findOne: (...a) => mockInvoiceFindOne(...a) }));
jest.doMock('../src/models/DiningSession', () => ({
  findById: (...a) => mockSessionFindById(...a),
}));
jest.doMock('../src/models/Order', () => ({ findOne: (...a) => mockOrderFindOne(...a) }));
jest.doMock('../src/models/Customer', () => ({
  findOne: (...a) => mockCustomerFindOne(...a),
}));
jest.doMock('../src/models/Cafe', () => ({ findById: jest.fn().mockResolvedValue({ name: 'My Cafe' }) }));
jest.doMock('../src/services/emailService', () => ({
  sendInvoiceEmail: (...a) => mockSendInvoiceEmail(...a),
}));
jest.doMock('fs', () => ({ existsSync: (...a) => mockExistsSync(...a) }));

const { resendInvoiceEmail } = require('../src/controllers/invoiceController');

const CAFE = 'cafe-1';

const session = (overrides = {}) => ({
  _id: 'session-1',
  cafeId: CAFE,
  customerEmail: '',
  customerName: 'Ayush',
  save: (...a) => mockSessionSave(...a),
  ...overrides,
});

const linkedOrder = { _id: 'o1' };

const makeReq = (body = {}) => ({ params: { id: 'inv-1' }, body, cafeId: CAFE });

/**
 * A filter-aware stand-in for `Customer.findOne`.
 *
 * The controller uses the model for two different questions — "who is the
 * customer on this bill?" and "does anybody *else* already own this email?" —
 * and a single always-resolving mock cannot answer both, so the duplicate-email
 * guard would fire against the very profile being linked.
 */
const customerFixture = [];
const matchCustomer = (query = {}) => {
  return customerFixture.find((c) => {
    if (query.cafeId && c.cafeId !== query.cafeId) return false;
    if (query.phone && c.phone !== query.phone) return false;
    if (query.email && c.email !== query.email) return false;
    if (query._id?.$ne && String(c._id) === String(query._id.$ne)) return false;
    return true;
  }) || null;
};
const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(c) { res.statusCode = c; return res; },
    json(d) { res.body = d; return res; },
  };
  return res;
};
const next = () => {
  const err = new Error('next');
  err.captured = true;
  throw err;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInvoiceFindOne.mockResolvedValue({ _id: 'inv-1', sessionId: 'session-1', invoiceNumber: 'INV-001', pdfUrl: '/x.pdf' });
  mockSessionFindById.mockResolvedValue(session());
  mockSessionSave.mockResolvedValue(undefined);
  mockCustomerSave.mockResolvedValue(undefined);
  mockExistsSync.mockReturnValue(true);
  mockSendInvoiceEmail.mockResolvedValue({ sent: true });
  mockOrderFindOne.mockReturnValue({
    sort: jest.fn().mockResolvedValue(linkedOrder),
  });

  customerFixture.length = 0;
  mockCustomerFindOne.mockImplementation((query) => Promise.resolve(matchCustomer(query)));
});

describe('ISSUE-37 — resending an invoice', () => {
  it('sends to the address on the session when there is one', async () => {
    mockSessionFindById.mockResolvedValue(session({ customerEmail: 'ayush@example.com' }));
    const res = makeRes();

    await resendInvoiceEmail(makeReq(), res, next);

    expect(mockSendInvoiceEmail).toHaveBeenCalledWith(
      'ayush@example.com',
      'Ayush',
      expect.any(String),
      'My Cafe',
      'INV-001'
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.emailSent).toBe(true);
  });

  it('falls back to a verified email on the customer profile', async () => {
    customerFixture.push({
      _id: 'cust-1',
      cafeId: CAFE,
      email: 'ayush@example.com',
      emailVerifiedAt: new Date(),
      save: (...a) => mockCustomerSave(...a),
    });
    const res = makeRes();

    await resendInvoiceEmail(makeReq(), res, next);

    expect(mockSendInvoiceEmail).toHaveBeenCalledWith(
      'ayush@example.com',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
    expect(res.body.emailSent).toBe(true);
  });

  it('does NOT send to an unverified profile email', async () => {
    // The profile address was never proven to belong to the customer. An
    // invoice is a legal document; it does not go to an unclaimed inbox.
    customerFixture.push({
      _id: 'cust-1',
      cafeId: CAFE,
      email: 'maybe-not-theirs@example.com',
      emailVerifiedAt: null,
    });

    let caught = null;
    try {
      await resendInvoiceEmail(makeReq(), makeRes(), (e) => { caught = e; });
    } catch { /* asyncHandler funnels the error to next */ }

    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(409);
    expect(mockSendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('reports a 409 rather than a false success when nobody can be emailed', async () => {
    // The regression: this used to return 200 with emailSent:false.
    customerFixture.push({ _id: 'cust-1', cafeId: CAFE, email: '', emailVerifiedAt: null });

    let caught = null;
    try {
      await resendInvoiceEmail(makeReq(), makeRes(), (e) => { caught = e; });
    } catch {}

    expect(caught.statusCode).toBe(409);
    expect(caught.message).toMatch(/no email address is linked/i);
    expect(mockSendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('links a supplied address to the profile and then sends', async () => {
    const customer = {
      _id: 'cust-1',
      cafeId: CAFE,
      email: '',
      save: (...a) => mockCustomerSave(...a),
    };
    customerFixture.push(customer);

    const res = makeRes();
    await resendInvoiceEmail(
      makeReq({ email: '  Ayush@Example.com ' }),
      res,
      next
    );

    // Persisted, not just passed through — otherwise the prompt reappears on
    // every single resend.
    expect(customer.email).toBe('ayush@example.com');
    expect(mockCustomerSave).toHaveBeenCalled();
    expect(mockSendInvoiceEmail).toHaveBeenCalledWith(
      'ayush@example.com',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
  });

  it('rejects a malformed address without sending anything', async () => {
    let caught = null;
    try {
      await resendInvoiceEmail(makeReq({ email: 'not-an-email' }), makeRes(), (e) => { caught = e; });
    } catch {}

    expect(caught.statusCode).toBe(400);
    expect(mockSendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('reports honestly when SMTP is not configured', async () => {
    mockSessionFindById.mockResolvedValue(session({ customerEmail: 'ayush@example.com' }));
    mockSendInvoiceEmail.mockResolvedValue({ sent: false, reason: 'SMTP not configured' });
    const res = makeRes();

    await resendInvoiceEmail(makeReq(), res, next);

    // Still a 200 — the request was handled — but the body must not claim the
    // invoice went anywhere.
    expect(res.body.emailSent).toBe(false);
    expect(res.body.reason).toMatch(/SMTP/i);
  });

  it('will not send an invoice belonging to another cafe', async () => {
    mockInvoiceFindOne.mockResolvedValue(null);

    let caught = null;
    try {
      await resendInvoiceEmail(makeReq(), makeRes(), (e) => { caught = e; });
    } catch {}

    expect(caught.statusCode).toBe(404);
    expect(mockInvoiceFindOne).toHaveBeenCalledWith({ _id: 'inv-1', cafeId: CAFE });
    expect(mockSendInvoiceEmail).not.toHaveBeenCalled();
  });
});

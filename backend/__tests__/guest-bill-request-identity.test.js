/**
 * ISSUE-39 — the table host could not request the bill.
 *
 * Two independent faults, both on the path a guest takes when they want to pay.
 *
 * **1. The guest's identity was never sent.**
 *
 * `submitPaymentPreference(sessionId, method)` posted `{ paymentMethod }` and
 * nothing else. The backend needs `participantId` to answer the only question
 * that matters — *is this person the table host?* — so it looked for a
 * participant whose id was `undefined`, found none, and refused with a 403. The
 * guest who opened the table, and who the UI had been calling the host the whole
 * time, was told they were not a participant in their own dining session.
 *
 * Behind that was a second fault: `createSession` returns a *flat* session
 * summary (`participantId` and `role` at the top level), but the frontend read
 * `session.participants[].deviceId` — an array the response does not contain.
 * So on the create path the store was left with `participantId: undefined` and
 * there was nothing to send even once the action was fixed.
 *
 * **2. The bill showed ₹0 while food was still in the kitchen.**
 *
 * Seven copies of the same loop gated every line on
 * `item.status === 'served' || order.status === 'served'`. A table that had just
 * ordered ₹280 of food showed a running total of ₹0 on the bills board, and
 * then the payment pipeline charged the same ₹0. The gate is now one shared
 * helper, so the seven sites can no longer drift apart again.
 */

const orderService = require('../src/services/orderService');

const order = (overrides = {}) => ({
  _id: 'o1',
  status: 'served',
  paymentStatus: 'paid',
  totalAmount: 300,
  items: [],
  ...overrides,
});

const item = (overrides = {}) => ({
  price: 100,
  quantity: 1,
  gstAmount: 0,
  status: 'served',
  ...overrides,
});

describe('ISSUE-39a — a host can request their own bill', () => {
  const mockSessionFindById = jest.fn();

  const loadController = () => {
    jest.resetModules();
    // `submitPayment` resolves via `findById(...).populate(...)`, so the mock
    // has to be a thenable that also chains.
    const chainable = (value) => {
      const q = Promise.resolve(value);
      q.populate = () => q;
      return q;
    };
    jest.doMock('../src/models/DiningSession', () => ({
      findById: (...a) => chainable(mockSessionFindById(...a)),
    }));
    jest.doMock('../src/models/Order', () => ({
      find: jest.fn().mockResolvedValue([]),
      countDocuments: jest.fn().mockResolvedValue(0),
    }));
    jest.doMock('../src/models/Table', () => ({ findById: jest.fn().mockResolvedValue({}) }));
    jest.doMock('../src/services/socketService', () => ({
      emitSessionActivity: jest.fn(),
      emitSessionBillRequested: jest.fn(),
      emitPaymentAwaiting: jest.fn(),
      emitOwnershipTransferred: jest.fn(),
    }));
    return require('../src/controllers/sessionController');
  };

  const hostSession = () => ({
    _id: 'session-1',
    cafeId: 'cafe-1',
    status: 'active',
    customerName: 'Ayush',
    guestToken: 'tok',
    tableId: { _id: 't1', tableNumber: 1 },
    participants: [
      { participantId: 'host-1', name: 'Ayush', role: 'owner', status: 'active' },
      { participantId: 'member-1', name: 'Ravi', role: 'member', status: 'active' },
    ],
    addActivity: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
  });

  const call = async (body) => {
    const { submitPayment } = loadController();
    const session = hostSession();
    mockSessionFindById.mockResolvedValue(session);

    let error = null;
    const res = {
      statusCode: null,
      body: null,
      status(c) { res.statusCode = c; return res; },
      json(d) { res.body = d; return res; },
    };
    await submitPayment(
      {
        params: { id: 'session-1' },
        body,
        cookies: { guest_token: 'tok' },
        headers: {},
      },
      res,
      (e) => { error = e; }
    );
    return { error, res, session };
  };

  it('accepts the bill request from the table host', async () => {
    const { error, res } = await call({
      paymentMethod: 'paid_counter',
      participantId: 'host-1',
    });

    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.session.status).toBe('awaiting_payment');
  });

  it('refuses a non-host member', async () => {
    const { error } = await call({
      paymentMethod: 'paid_counter',
      participantId: 'member-1',
    });

    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });

  it('refuses a request with no participant identity at all', async () => {
    // This is what actually happened: the frontend had no id to send, so the
    // host was rejected as a stranger to their own table.
    const { error } = await call({ paymentMethod: 'paid_counter' });

    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
  });

  it('promotes the sole participant when the session somehow has no host', async () => {
    const { submitPayment } = loadController();
    const session = hostSession();
    session.participants = [
      { participantId: 'p1', name: 'Solo', role: 'member', status: 'active' },
    ];
    mockSessionFindById.mockResolvedValue(session);

    let error = null;
    const res = {
      statusCode: null,
      body: null,
      status(c) { res.statusCode = c; return res; },
      json(d) { res.body = d; return res; },
    };
    await submitPayment(
      {
        params: { id: 'session-1' },
        body: { paymentMethod: 'paid_counter', participantId: 'p1' },
        cookies: { guest_token: 'tok' },
        headers: {},
      },
      res,
      (e) => { error = e; }
    );

    // A table with nobody but one member must still be able to pay.
    expect(error).toBeNull();
    expect(session.participants[0].role).toBe('owner');
  });
});

describe('ISSUE-39b — a table bill is never zero while food is ordered', () => {
  it('bills items that are still pending in the kitchen', () => {
    const orders = [
      order({
        status: 'pending',
        items: [item({ price: 120, quantity: 1 }), item({ price: 160, quantity: 1, status: 'pending' })],
      }),
    ];

    // The regression: this returned 0, and the payment pipeline then charged 0.
    expect(orderService.sumBillableItems(orders).subtotal).toBe(280);
  });

  it('adds line GST once per line, not once per unit', () => {
    const orders = [
      order({
        items: [
          // `gstAmount` is stored for the whole line: price 100 × 2 units × 5%.
          item({ price: 100, quantity: 2, gstAmount: 10 }),
        ],
      }),
    ];

    expect(orderService.sumBillableItems(orders)).toEqual({ subtotal: 200, gst: 10 });
  });

  it('excludes withdrawn items', () => {
    const orders = [
      order({
        items: [
          item({ price: 120, status: 'served' }),
          item({ price: 150, status: 'cancelled' }),
          item({ price: 80, status: 'partially_cancelled' }),
        ],
      }),
    ];

    expect(orderService.sumBillableItems(orders).subtotal).toBe(120);
  });

  it('excludes cancelled orders entirely', () => {
    const orders = [
      order({ status: 'cancelled', items: [item({ price: 500 })] }),
      order({ status: 'served', items: [item({ price: 200 })] }),
    ];

    expect(orderService.sumBillableItems(orders).subtotal).toBe(200);
  });

  it('treats a missing item status as billable', () => {
    // Legacy rows predate the per-item status; defaulting to "not billable"
    // would silently zero out old tables.
    const orders = [order({ items: [{ price: 300, quantity: 1 }] })];
    expect(orderService.sumBillableItems(orders).subtotal).toBe(300);
  });

  it('isBillableItem matches the summation contract', () => {
    expect(orderService.isBillableItem({ status: 'served' })).toBe(true);
    expect(orderService.isBillableItem({ status: 'pending' })).toBe(true);
    expect(orderService.isBillableItem({ status: 'preparing' })).toBe(true);
    expect(orderService.isBillableItem({ status: undefined })).toBe(true);
    expect(orderService.isBillableItem({ status: 'cancelled' })).toBe(false);
    expect(orderService.isBillableItem({ status: 'partially_cancelled' })).toBe(false);
  });

  it('survives orders with no items at all', () => {
    expect(orderService.sumBillableItems([{ items: undefined }])).toEqual({
      subtotal: 0,
      gst: 0,
    });
    expect(orderService.sumBillableItems(undefined)).toEqual({ subtotal: 0, gst: 0 });
  });
});

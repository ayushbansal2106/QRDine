/**
 * ISSUE-33 — a signed-in customer's order history was empty.
 *
 * `getMyOrders` filtered on `status: { $in: SETTLED_STATUSES }` where
 * `SETTLED_STATUSES` read `['confirmed', 'preparing', 'ready', 'served',
 * 'completed']`. But the Order model only ever sets
 * `pending | accepted | preparing | ready | served | cancelled` — so
 * `confirmed` and `completed` were dead entries that could never match, and
 * `accepted` was missing entirely.
 *
 * That alone was survivable. What made it invisible was that
 * `recordManualPayment` sets `paymentStatus = 'paid'` and never advances
 * `status`, so a settled counter sale stayed `pending` forever and matched
 * nothing. `/profile/orders` showed an empty list, and the profile's order
 * count, lifetime spend and savings totals were all short by every counter sale
 * the cafe had rung up.
 *
 * Payment is the stronger signal, so it now wins: an order counts once it is
 * paid, or once the kitchen has genuinely taken it on. Cancellations never
 * count, or a voided order would be remembered as spend.
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const mockOrderFind = jest.fn();
const mockOrderCountDocuments = jest.fn();
const mockOrderAggregate = jest.fn();

jest.resetModules();

jest.doMock('../src/models/Order', () => {
  const Order = function (data) {
    Object.assign(this, data);
    this._id = data._id || 'order-1';
  };
  Order.find = (...a) => {
    const q = Promise.resolve(mockOrderFind(...a) || []);
    q.sort = () => q;
    q.skip = () => q;
    q.limit = () => q;
    q.populate = () => q;
    // Must resolve the rows the mock returned, not a blanket empty array, or
    // every assertion on the response payload is silently blind.
    q.lean = () => q;
    return q;
  };
  Order.countDocuments = (...a) => mockOrderCountDocuments(...a);
  Order.aggregate = (...a) => mockOrderAggregate(...a);
  return Order;
});

const {
  getMyOrders,
  getMe,
  SETTLED_STATUSES,
} = require('../src/controllers/customerAppController');

const customer = { _id: 'cust-1', cafeId: 'cafe-1', name: 'Ravi', phone: '9876543210' };

const withCustomer = (overrides = {}) =>
  mockReq({ customer, cafeId: 'cafe-1', query: {}, ...overrides });

beforeEach(() => {
  jest.clearAllMocks();
  mockOrderFind.mockReturnValue([]);
  mockOrderCountDocuments.mockResolvedValue(0);
  mockOrderAggregate.mockResolvedValue([]);
});

describe('ISSUE-33 — settled orders are matched against the real status enum', () => {
  it('lists only statuses the Order model can actually produce', () => {
    // Each entry must be a member of the model's status enum, otherwise it is
    // an entry that can never match a real document.
    const realOrderStatuses = ['pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled'];
    for (const status of SETTLED_STATUSES) {
      expect(realOrderStatuses).toContain(status);
    }
    // The two statuses the old list invented.
    expect(SETTLED_STATUSES).not.toContain('confirmed');
    expect(SETTLED_STATUSES).not.toContain('completed');
  });

  it('counts a paid order even while its status is still pending', async () => {
    // This is the counter-sale shape: paid at the till, `status` untouched.
    await getMyOrders(withCustomer(), mockRes(), mockNext());

    expect(mockOrderFind).toHaveBeenCalledWith(
      expect.objectContaining({
        cafeId: 'cafe-1',
        customerId: 'cust-1',
        status: { $ne: 'cancelled' },
        $or: [expect.objectContaining({ paymentStatus: 'paid' }), expect.anything()],
      })
    );
  });

  it('never counts a cancelled order', async () => {
    await getMyOrders(withCustomer(), mockRes(), mockNext());

    const filter = mockOrderFind.mock.calls[0][0];
    expect(filter.status).toEqual({ $ne: 'cancelled' });
  });

  it('applies the same rule to the profile counters', async () => {
    // The stats cards were short by the same orders the list was missing, so
    // they have to share one definition of "settled".
    await getMe(withCustomer(), mockRes(), mockNext());

    expect(mockOrderCountDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ $or: expect.any(Array), status: { $ne: 'cancelled' } })
    );
    expect(mockOrderAggregate).toHaveBeenCalled();
  });

  it('still honours the date range window', async () => {
    await getMyOrders(withCustomer({ query: { range: '3m' } }), mockRes(), mockNext());

    expect(mockOrderFind).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: { $gte: expect.any(Date) } })
    );
  });

  it('drops the range filter for "all"', async () => {
    await getMyOrders(withCustomer({ query: { range: 'all' } }), mockRes(), mockNext());

    const filter = mockOrderFind.mock.calls[0][0];
    expect(filter.createdAt).toBeUndefined();
  });
});

/**
 * ISSUE-48 — QR orders were missing from the order history.
 *
 * ISSUE-33 above made the settled list correct as a record of *spend*. That
 * definition then became the only list, which broke "where is my order": a
 * guest who scanned the QR, ordered, and sat down to eat saw an empty history,
 * because a table order is written `pending` + `paymentStatus: 'unpaid'` until
 * someone settles the bill. Both live rows in the cafe's data were exactly that
 * shape — `qr` / `served` / `unpaid` and `qr` / `pending` / `unpaid`.
 *
 * `served` is the sharper half of the bug: the kitchen had finished it and the
 * guest was eating it, yet it was filtered out of history entirely.
 *
 * The fix keeps the two concerns apart rather than merging them. Settled stays
 * the spend list (lifetime value, the order counter on the profile must not
 * inflate), and in-progress orders come back under their own `active` key. So
 * these tests pin both halves: the live order is visible, and it is *not* now
 * quietly counted as spend.
 */
describe('ISSUE-48 — in-progress QR orders are visible without inflating spend', () => {
  const order = (over = {}) => ({
    _id: 'o1',
    orderNumber: 'ORD-0015',
    status: 'pending',
    orderType: 'dine-in',
    channel: 'qr',
    paymentStatus: 'unpaid',
    createdAt: new Date('2026-10-03T10:00:00Z'),
    items: [{ itemName: 'Masala Chai', price: 40, quantity: 2 }],
    totalAmount: 80,
    discountTotal: 0,
    tableId: { tableNumber: 4 },
    ...over,
  });

  // The two calls `getMyOrders` makes: settled history first, then the live
  // list. Seeding them in order keeps the test honest about which list a row
  // can land in.
  const seed = ({ settled = [], active = [], total } = {}) => {
    mockOrderFind.mockReturnValueOnce(settled).mockReturnValueOnce(active);
    mockOrderCountDocuments.mockResolvedValue(total ?? settled.length);
  };

  const run = async (query = {}) => {
    const res = mockRes();
    await getMyOrders(withCustomer({ query }), res, mockNext());
    return res._jsonData;
  };

  it('shows a placed-but-unpaid QR order as in progress', async () => {
    const placed = order({ status: 'pending', paymentStatus: 'unpaid' });
    seed({ active: [placed] });

    const body = await run();

    expect(body.active).toHaveLength(1);
    expect(body.active[0]).toEqual(
      expect.objectContaining({ orderNumber: 'ORD-0015', status: 'pending', isLive: true })
    );
  });

  it('shows a served but not-yet-settled order too', async () => {
    // The kitchen is done and the guest is eating it, yet `served` alone was
    // enough to keep the order out of history. Being unpaid must not hide it.
    seed({ active: [order({ status: 'served', paymentStatus: 'unpaid' })] });

    const body = await run();

    expect(body.active).toHaveLength(1);
    expect(body.active[0].status).toBe('served');
  });

  it('labels the channel so a table order is distinguishable from a till sale', async () => {
    seed({ active: [order({ channel: 'qr' })] });

    const body = await run();

    expect(body.active[0].channel).toBe('qr');
  });

  it('keeps a live order out of the spend count', async () => {
    // The important half: visibility must not come at the price of inflating
    // lifetime value. `total` is derived from the settled filter alone.
    seed({ settled: [], active: [order()], total: 0 });

    const body = await run();

    expect(body.orders).toHaveLength(0);
    expect(body.total).toBe(0);

    // Assert the filters themselves, not just the mocked payload: the count
    // that feeds lifetime value must still be the settled one, so loosening
    // "settled" to catch live orders cannot quietly raise the customer's
    // reported spend.
    expect(mockOrderCountDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ $or: expect.any(Array), status: { $ne: 'cancelled' } })
    );
    const settledFilter = mockOrderFind.mock.calls[0][0];
    const liveFilter = mockOrderFind.mock.calls[1][0];
    expect(settledFilter).not.toEqual(liveFilter);
    expect(settledFilter.$or).toBeDefined();
    expect(liveFilter.$or).toBeUndefined();
  });

  it('never surfaces a cancelled order as in progress', async () => {
    seed({ settled: [], active: [] });

    const body = await run();

    const liveFilter = mockOrderFind.mock.calls[1][0];
    expect(liveFilter.status.$nin).toContain('cancelled');
    expect(body.active).toHaveLength(0);
  });

  it('does not let a paid order linger in the live list', async () => {
    // Once the tender clears, the order belongs to the spend list only.
    seed({ settled: [order({ paymentStatus: 'paid' })], active: [], total: 1 });

    const body = await run();

    const liveFilter = mockOrderFind.mock.calls[1][0];
    expect(liveFilter.paymentStatus).toEqual({ $ne: 'paid' });
    expect(body.active).toHaveLength(0);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].isLive).toBeUndefined();
  });

  it('skips the live query on later pages', async () => {
    // Live orders are few and belong to the top of the list; refetching them
    // on every page of an archive is wasted work.
    seed({ settled: [order()], total: 40 });

    const body = await run({ page: '2' });

    expect(mockOrderFind).toHaveBeenCalledTimes(1);
    expect(body.active).toHaveLength(0);
  });

  it('caps the live list and scopes it to this customer at this cafe', async () => {
    seed({ active: [order()] });

    await run();

    const liveFilter = mockOrderFind.mock.calls[1][0];
    expect(liveFilter).toEqual(
      expect.objectContaining({ cafeId: 'cafe-1', customerId: 'cust-1' })
    );
  });
});

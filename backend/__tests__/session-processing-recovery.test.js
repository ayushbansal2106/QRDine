/**
 * Regression guard — a session orphaned in `processing` must be reopened.
 *
 * `executePaymentPipeline` takes an atomic lock by setting the session to
 * `processing`. If the process dies while holding it, the session is in no
 * bills-dashboard filter and no retry filter: the table vanishes from the board
 * and every later attempt answers "already paid/closed/processing". A boot-time
 * sweep is the only thing that can undo a lock whose owner no longer exists.
 */
jest.mock('../src/models/DiningSession', () => ({
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../src/models/Order', () => ({ find: jest.fn() }));
jest.mock('../src/services/auditService', () => ({ recordEvent: jest.fn() }));
jest.mock('../src/services/socketService', () => ({
  emitSessionActivity: jest.fn(),
  emitMetricsUpdated: jest.fn(),
}));

const DiningSession = require('../src/models/DiningSession');
const auditService = require('../src/services/auditService');
const socketService = require('../src/services/socketService');
const {
  PROCESSING_STALE_MINUTES,
  RECOVERABLE_STATUSES,
  restoreStatusFor,
  releaseStuckSessions,
  startSessionRecoverySweeper,
} = require('../src/services/sessionLifecycleService');

const buildStuckSession = (overrides = {}) => ({
  _id: '6ac116d7b6e3a15afc39e87e',
  cafeId: '6ac08f59dc276e3c59831d60',
  tableId: '6ac08fb2dc276e3c59831d62',
  status: 'processing',
  paymentMethod: null,
  updatedAt: new Date(Date.now() - 60 * 60 * 1000),
  activities: [],
  addActivity(type, message) {
    this.activities.push({ type, message });
  },
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const buildReopened = (session) => ({
  ...session,
  save: jest.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  jest.clearAllMocks();
  auditService.recordEvent.mockResolvedValue(undefined);
  DiningSession.find.mockResolvedValue([]);
  DiningSession.findOneAndUpdate.mockImplementation(async (_filter, update) =>
    buildReopened({ ...buildStuckSession(), status: update.$set.status })
  );
});

describe('releaseStuckSessions', () => {
  it('reopens nothing when no session is holding a lock', async () => {
    const result = await releaseStuckSessions();

    expect(result.released).toBe(0);
    expect(DiningSession.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('only considers sessions stuck longer than the grace window', async () => {
    await releaseStuckSessions({ staleMinutes: PROCESSING_STALE_MINUTES });

    const [filter] = DiningSession.find.mock.calls[0];
    expect(filter.status).toBe('processing');
    expect(filter.updatedAt.$lt).toBeInstanceOf(Date);

    const windowMs = Date.now() - filter.updatedAt.$lt.getTime();
    expect(Math.round(windowMs / 60000)).toBe(PROCESSING_STALE_MINUTES);
  });

  it('returns a guest who already chose a payment method to the counter queue', async () => {
    DiningSession.find.mockResolvedValue([buildStuckSession({ paymentMethod: 'pending' })]);

    const result = await releaseStuckSessions();

    expect(result.released).toBe(1);
    expect(DiningSession.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { status: 'awaiting_payment' } },
      { new: true }
    );
  });

  it('reopens a mid-meal table as active', async () => {
    DiningSession.find.mockResolvedValue([buildStuckSession({ paymentMethod: null })]);

    const result = await releaseStuckSessions();

    expect(result.released).toBe(1);
    expect(DiningSession.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { status: 'active' } });
  });

  it('leaves a session alone if it settled while the sweep was reading', async () => {
    const settled = buildStuckSession();
    DiningSession.find.mockResolvedValue([settled]);
    DiningSession.findOneAndUpdate.mockResolvedValue(null); // another worker closed it

    const result = await releaseStuckSessions();

    expect(result.released).toBe(0);
    expect(settled.save).not.toHaveBeenCalled();
    expect(auditService.recordEvent).not.toHaveBeenCalled();
    expect(socketService.emitSessionActivity).not.toHaveBeenCalled();
  });

  it('records the recovery in the ledger and tells the room', async () => {
    DiningSession.find.mockResolvedValue([buildStuckSession()]);

    await releaseStuckSessions();
    await new Promise((resolve) => setImmediate(resolve));

    expect(auditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session.recovered', staffName: 'system' })
    );
    expect(socketService.emitSessionActivity).toHaveBeenCalledWith(
      '6ac116d7b6e3a15afc39e87e',
      expect.objectContaining({ type: 'session_recovered' })
    );
  });

  it('restores only to a status the payment pipeline will accept again', () => {
    expect(RECOVERABLE_STATUSES).toEqual(expect.arrayContaining(['active', 'awaiting_payment']));
    expect(RECOVERABLE_STATUSES).toContain(restoreStatusFor(buildStuckSession({ paymentMethod: 'pending' })));
    expect(RECOVERABLE_STATUSES).toContain(restoreStatusFor(buildStuckSession()));
  });
});

describe('startSessionRecoverySweeper', () => {
  it('never arms itself under test', () => {
    expect(startSessionRecoverySweeper()).toBeNull();
  });
});
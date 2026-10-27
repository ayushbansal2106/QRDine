/**
 * Pass-through mock of `services/entitlementService` for unit tests that have no
 * database.
 *
 * The real service reserves a metered unit with an atomic Mongo update plus a
 * ledger row — deliberate, and impossible to run against mocked models. Order-
 * engine unit tests (coupon/voucher handling, `clientRequestId` shape) are about
 * the engine itself, so the quota is stubbed out here and covered end-to-end
 * against mongodb-memory-server in `entitlement-enforcement.test.js`.
 *
 * `withUsage` still calls the wrapped function, so nothing about order creation
 * is skipped — only the metering is.
 */
module.exports = {
  METRICS: { ORDERS_PER_MONTH: 'orders.month', OUTLETS: 'outlets' },
  withUsage: async (options, fn) => ({ result: await fn(), reservation: {} }),
  reserveUsage: async () => ({ reservationId: 'mock-reservation', unlimited: true }),
  commitUsage: async () => true,
  releaseUsage: async () => true,
};

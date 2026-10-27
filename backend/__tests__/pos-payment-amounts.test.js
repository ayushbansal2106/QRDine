/**
 * ISSUE-30 — POS accepted payment greater than the order total.
 *
 * `recordManualPayment` only guarded the *underpaid* case. A cashier could
 * tender ₹100 against a ₹90 order and the surplus was swallowed into
 * `order.payments`, `change` computed as `received - amount` came out 0, and
 * the order was marked paid with no record of where the extra ₹10 went.
 *
 * A till is reconciled against recorded payments, so an unrecorded surplus is a
 * real hole: the drawer is out by that amount and nothing on the order explains
 * it. Exact and split payments must keep working — only the surplus is refused.
 */

const orderService = require('../src/services/orderService');

const makeOrder = (totalAmount, extra = {}) => ({
  totalAmount,
  payments: [],
  paymentStatus: 'unpaid',
  save: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

const cash = (amount) => ({ method: 'cash', amount });

describe('ISSUE-30 — a POS payment may not exceed the order total', () => {
  it('accepts an exact payment', async () => {
    const order = makeOrder(90);
    await expect(orderService.recordManualPayment(order, [cash(90)])).resolves.toBe(order);
    expect(order.paymentStatus).toBe('paid');
    expect(order.payments).toHaveLength(1);
  });

  it('rejects a payment greater than the total', async () => {
    const order = makeOrder(90);
    await expect(orderService.recordManualPayment(order, [cash(100)])).rejects.toThrow(
      /more than the ₹90\.00 total/i
    );
    // Crucially, nothing may be written on the rejected path.
    expect(order.payments).toHaveLength(0);
    expect(order.paymentStatus).toBe('unpaid');
    expect(order.save).not.toHaveBeenCalled();
  });

  it('names both amounts so the cashier can see the mistake', async () => {
    const order = makeOrder(90);
    await expect(orderService.recordManualPayment(order, [cash(140)])).rejects.toThrow(
      /₹140\.00.*₹90\.00/
    );
  });

  it('accepts a split payment that sums to exactly the total', async () => {
    const order = makeOrder(90);
    await orderService.recordManualPayment(order, [
      { method: 'cash', amount: 40 },
      { method: 'card_manual', amount: 50 },
    ]);
    expect(order.payments).toHaveLength(2);
    expect(order.paymentStatus).toBe('paid');
  });

  it('rejects a split payment whose parts overshoot the total', async () => {
    // The individual tenders look fine; only the sum is wrong, so the check has
    // to happen after summing rather than per tender.
    const order = makeOrder(90);
    await expect(
      orderService.recordManualPayment(order, [cash(50), cash(60)])
    ).rejects.toThrow(/more than/i);
    expect(order.payments).toHaveLength(0);
  });

  it('still rejects underpayment', async () => {
    const order = makeOrder(90);
    await expect(orderService.recordManualPayment(order, [cash(50)])).rejects.toThrow(
      /less than the order total/i
    );
  });

  it('tolerates floating-point noise rather than refusing a valid payment', async () => {
    // Splitting 90 across three tenders can produce 90.00000000000001.
    const order = makeOrder(90);
    await expect(
      orderService.recordManualPayment(order, [cash(30), cash(30), cash(30)])
    ).resolves.toBe(order);
  });

  it('does not refuse a payment that is a fraction of a paisa over', async () => {
    const order = makeOrder(90);
    await expect(orderService.recordManualPayment(order, [cash(90.001)])).resolves.toBe(order);
  });
});
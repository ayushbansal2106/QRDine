/**
 * ISSUE-38 — rewards existed only in the admin panel.
 *
 * Loyalty stamps, prepaid wallets, scratch cards and coupons were all built and
 * all reachable from `/admin/*`. None of it was reachable from the signed-in
 * customer, because the only customer-facing routes resolved identity through a
 * *dining session's* guest token and then looked for an order on that table.
 *
 * The gap was invisible: a customer who signed in with their phone number — the
 * profile the app actually builds — got an empty screen and no explanation,
 * while the same customer's loyalty card sat in the admin panel next to their
 * name. It looked like rewards were not being awarded at all.
 *
 * These endpoints are all `protectCustomer`, so identity comes from the signed
 * profile and the tenant comes from that document. Two properties matter most
 * and are pinned below:
 *
 *   1. **Tenant comes from the profile, not the caller.** Nothing here accepts a
 *      `cafeId` from the request.
 *   2. **An unrevealed scratch card never carries its prize.** Sending it in the
 *      list would hand every customer the answer in the network tab.
 */

const mockGetCardSummary = jest.fn();
const mockGetWallet = jest.fn();
const mockListTransactions = jest.fn();
const mockGetCampaign = jest.fn();
const mockRevealCard = jest.fn();
const mockScratchFind = jest.fn();
const mockCouponFind = jest.fn();

jest.resetModules();

jest.doMock('../src/services/loyaltyService', () => ({
  getCardSummary: (...a) => mockGetCardSummary(...a),
}));
jest.doMock('../src/services/walletService', () => ({
  getWallet: (...a) => mockGetWallet(...a),
  listTransactions: (...a) => mockListTransactions(...a),
}));
jest.doMock('../src/services/scratchService', () => ({
  getCampaign: (...a) => mockGetCampaign(...a),
  revealCard: (...a) => mockRevealCard(...a),
}));
jest.doMock('../src/models/ScratchCard', () => ({ find: (...a) => mockScratchFind(...a) }));
jest.doMock('../src/models/Coupon', () => ({ find: (...a) => mockCouponFind(...a) }));
// Personal offer codes are a separate collection; this suite covers the shared
// ones, so the grant list is simply empty.
jest.doMock('../src/services/couponGrantService', () => ({
  listForCustomer: jest.fn().mockResolvedValue([]),
  redeemGrant: jest.fn(),
  findGrant: jest.fn(),
  issueToCustomer: jest.fn(),
}));

const {
  getMyLoyalty,
  getMyWallet,
  getMyScratchCards,
  revealMyScratchCard,
  getMyCoupons,
} = require('../src/controllers/customerRewardsController');

const CUSTOMER = { _id: 'cust-1', cafeId: 'cafe-1', name: 'Ayush' };

const mkRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(c) { res.statusCode = c; return res; },
    json(d) { res.body = d; return res; },
  };
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListTransactions.mockResolvedValue({ transactions: [] });
  mockGetCampaign.mockResolvedValue(null);
  mockScratchFind.mockReturnValue({
    sort: () => ({ limit: async () => [] }),
  });
  mockCouponFind.mockReturnValue({
    sort: () => ({ limit: undefined, then: undefined, exec: async () => [] }),
  });
  // `Coupon.find(...).sort(...)` is awaited directly in the controller.
  mockCouponFind.mockReturnValue({ sort: async () => [] });
});

describe('ISSUE-38 — the customer can see their own rewards', () => {
  describe('loyalty', () => {
    it('reports stamps and progress to the next reward', async () => {
      mockGetCardSummary.mockResolvedValue({
        program: { name: 'Loyalty Card', isActive: true, stampsRequired: 5, stampsPerOrder: 1 },
        stamps: 3,
        lifetimeStamps: 9,
        lastStampAt: new Date(),
        activeVouchers: [{ code: 'RWD-ABC123', label: 'Free coffee', type: 'flat', value: 50 }],
      });

      const res = mkRes();
      await getMyLoyalty({ customer: CUSTOMER }, res, () => {});

      expect(res.body.loyalty.stamps).toBe(3);
      expect(res.body.loyalty.stampsToNextReward).toBe(2);
      expect(res.body.loyalty.isActive).toBe(true);
      expect(res.body.loyalty.vouchers[0].code).toBe('RWD-ABC123');
      // The profile, not the request, decides the tenant.
      expect(mockGetCardSummary).toHaveBeenCalledWith('cafe-1', 'cust-1');
    });

    it('says so when the programme is configured but switched off', async () => {
      // Zero stamps is NOT the same as a programme that is not running. Showing
      // a progress bar that will never move is how a customer concludes they
      // are being short-changed.
      mockGetCardSummary.mockResolvedValue({
        program: { name: 'Loyalty Card', isActive: false, stampsRequired: 5, stampsPerOrder: 1 },
        stamps: 0,
        lifetimeStamps: 0,
        activeVouchers: [],
      });

      const res = mkRes();
      await getMyLoyalty({ customer: CUSTOMER }, res, () => {});

      expect(res.body.loyalty.isActive).toBe(false);
      expect(res.body.loyalty).not.toBeNull();
    });

    it('returns null when the cafe has no programme at all', async () => {
      mockGetCardSummary.mockResolvedValue(null);

      const res = mkRes();
      await getMyLoyalty({ customer: CUSTOMER }, res, () => {});

      expect(res.body.loyalty).toBeNull();
      expect(res.statusCode).toBe(200);
    });
  });

  describe('wallet', () => {
    it('returns a zero balance rather than nothing for a never-topped-up wallet', async () => {
      mockGetWallet.mockResolvedValue(null);

      const res = mkRes();
      await getMyWallet({ customer: CUSTOMER }, res, () => {});

      // The customer cannot tell "no wallet" from "an empty wallet", and it does
      // not matter to them — so neither should the screen.
      expect(res.body.wallet.balance).toBe(0);
      expect(res.body.wallet.hasWallet).toBe(false);
      expect(res.body.transactions).toEqual([]);
    });

    it('returns the balance to the paisa', async () => {
      mockGetWallet.mockResolvedValue({ balance: 123.456, currency: 'INR' });

      const res = mkRes();
      await getMyWallet({ customer: CUSTOMER }, res, () => {});

      expect(res.body.wallet.balance).toBe(123.46);
    });
  });

  describe('scratch cards', () => {
    it('withholds the prize of an unrevealed card', async () => {
      mockScratchFind.mockReturnValue({
        sort: () => ({
          limit: async () => [
            { _id: 'card-1', status: 'issued', createdAt: new Date(), revealedAt: null, prize: { label: 'SECRET' } },
            { _id: 'card-2', status: 'revealed', createdAt: new Date(), revealedAt: new Date(), prize: { label: 'Free coffee' } },
          ],
        }),
      });

      const res = mkRes();
      await getMyScratchCards({ customer: CUSTOMER }, res, () => {});

      expect(res.body.cards[0].prize).toBeNull();
      expect(res.body.cards[1].prize.label).toBe('Free coffee');
      // Scoped to the signed-in customer, never a list of everyone's cards.
      expect(mockScratchFind).toHaveBeenCalledWith(
        expect.objectContaining({ cafeId: 'cafe-1', customerId: 'cust-1' })
      );
    });

    it('reveals a card as the signed-in customer, so ownership is enforced', async () => {
      mockRevealCard.mockResolvedValue({
        card: { prize: { label: 'Free coffee', type: 'flat', value: 50 } },
        voucher: { code: 'SCR-123456', label: 'Free coffee', type: 'flat', value: 50 },
      });

      const res = mkRes();
      await revealMyScratchCard({ customer: CUSTOMER, params: { id: 'card-1' } }, res, () => {});

      // `revealCard` re-checks ownership from this id, so guessing a card id
      // belonging to someone else fails.
      expect(mockRevealCard).toHaveBeenCalledWith(
        expect.objectContaining({ cafeId: 'cafe-1', customerId: 'cust-1', cardId: 'card-1' })
      );
      expect(res.body.voucher.code).toBe('SCR-123456');
    });
  });

  describe('coupons', () => {
    it('only lists coupons addressed to this customer', async () => {
      mockCouponFind.mockReturnValue({
        sort: async () => [
          {
            code: 'RAVI10',
            description: '10% off',
            type: 'percent',
            value: 10,
            minOrder: 200,
            appliesTo: { customerIds: ['cust-1'] },
            validFrom: null,
            validUntil: new Date(Date.now() + 86400000),
            usageCount: 1,
            usageLimit: 5,
          },
        ],
      });

      const res = mkRes();
      await getMyCoupons({ customer: CUSTOMER }, res, () => {});

      // The old assertion asked for `appliesTo.scope: 'customer'`, a value the
      // model enum never allowed — so the query could not match anything and the
      // list was always empty. Targeted means "names me", or "a segment I match".
      expect(mockCouponFind).toHaveBeenCalledWith(
        expect.objectContaining({
          cafeId: 'cafe-1',
          $or: [{ 'appliesTo.customerIds': 'cust-1' }, { 'audience.mode': 'segment' }],
        })
      );
      expect(res.body.coupons[0].code).toBe('RAVI10');
    });

    it('drops expired coupons rather than showing an unusable one', async () => {
      mockCouponFind.mockReturnValue({
        sort: async () => [
          {
            code: 'OLD',
            description: 'Expired',
            type: 'flat',
            value: 50,
            validFrom: null,
            // `validTo`, not `validUntil` — the model has no `validUntil`, which
            // is why the old reader never dropped anything.
            validTo: new Date(Date.now() - 86400000),
          },
        ],
      });

      const res = mkRes();
      await getMyCoupons({ customer: CUSTOMER }, res, () => {});

      expect(res.body.coupons).toEqual([]);
    });
  });
});

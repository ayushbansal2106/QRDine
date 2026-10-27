/**
 * Phase 4 — Module #14 (coupons), #15 (loyalty), #17 (wallet) service tests
 */

const mockCouponFindOne = jest.fn();
const mockOrderCountDocuments = jest.fn();

const mockWalletFindOne = jest.fn();
const mockWalletCreate = jest.fn();
const mockWalletFindOneAndUpdate = jest.fn();
const mockTxFindOne = jest.fn();
const mockTxCreate = jest.fn();
const mockTxFind = jest.fn();
const mockTxCountDocuments = jest.fn();

const mockProgramFindOne = jest.fn();
const mockCardFindOne = jest.fn();
const mockCardCreate = jest.fn();

const mockAuditRecord = jest.fn();
const mockEmitLoyalty = jest.fn();
const mockEmitWallet = jest.fn();

jest.mock('../src/models/Coupon', () => ({
  findOne: (...a) => mockCouponFindOne(...a),
  updateOne: jest.fn(),
}));

jest.mock('../src/models/Order', () => ({
  countDocuments: (...a) => mockOrderCountDocuments(...a),
}));

jest.mock('../src/models/Wallet', () => ({
  findOne: (...a) => mockWalletFindOne(...a),
  create: (...a) => mockWalletCreate(...a),
  findOneAndUpdate: (...a) => mockWalletFindOneAndUpdate(...a),
  findById: jest.fn(),
}));

jest.mock('../src/models/WalletTransaction', () => ({
  findOne: (...a) => mockTxFindOne(...a),
  create: (...a) => mockTxCreate(...a),
  find: (...a) => mockTxFind(...a),
  countDocuments: (...a) => mockTxCountDocuments(...a),
}));

jest.mock('../src/models/LoyaltyProgram', () => ({
  findOne: (...a) => mockProgramFindOne(...a),
}));

jest.mock('../src/models/LoyaltyCard', () => ({
  findOne: (...a) => mockCardFindOne(...a),
  create: (...a) => mockCardCreate(...a),
}));

jest.mock('../src/services/auditService', () => ({ recordEvent: (...a) => mockAuditRecord(...a) }));
jest.mock('../src/services/socketService', () => ({
  emitLoyaltyUpdated: (...a) => mockEmitLoyalty(...a),
  emitWalletUpdated: (...a) => mockEmitWallet(...a),
}));

const couponService = require('../src/services/couponService');
const loyaltyService = require('../src/services/loyaltyService');
const walletService = require('../src/services/walletService');

afterEach(() => {
  jest.clearAllMocks();
  mockAuditRecord.mockResolvedValue(true);
});

// ─── Module #14 — Coupons ───────────────────────────────

const baseCoupon = (overrides = {}) => ({
  code: 'SAVE10',
  isActive: true,
  type: 'percent',
  value: 10,
  maxDiscount: 0,
  minOrder: 0,
  usageCount: 0,
  usageLimit: 0,
  singleUse: false,
  perCustomerLimit: 0,
  validFrom: null,
  validTo: null,
  happyHour: { enabled: false },
  ...overrides,
});

describe('couponService.validate (#14)', () => {
  it('computes a percent discount', async () => {
    mockCouponFindOne.mockResolvedValue(baseCoupon());

    const result = await couponService.validate({ cafeId: 'cafe-1', code: 'save10', subtotal: 200 });

    expect(result.code).toBe('SAVE10');
    expect(result.discount).toBe(20);
  });

  it('caps a percent discount at maxDiscount', async () => {
    mockCouponFindOne.mockResolvedValue(baseCoupon({ maxDiscount: 15 }));

    const result = await couponService.validate({ cafeId: 'cafe-1', code: 'SAVE10', subtotal: 500 });

    expect(result.discount).toBe(15);
  });

  it('rejects an unknown code', async () => {
    mockCouponFindOne.mockResolvedValue(null);
    await expect(couponService.validate({ cafeId: 'cafe-1', code: 'NOPE', subtotal: 100 })).rejects.toThrow(
      'Invalid coupon code'
    );
  });

  it('rejects when the minimum order is not met', async () => {
    mockCouponFindOne.mockResolvedValue(baseCoupon({ minOrder: 500 }));
    await expect(couponService.validate({ cafeId: 'cafe-1', code: 'SAVE10', subtotal: 100 })).rejects.toThrow(
      /minimum order/i
    );
  });

  it('rejects a single-use coupon that has already been redeemed', async () => {
    mockCouponFindOne.mockResolvedValue(baseCoupon({ singleUse: true, usageCount: 1 }));
    await expect(couponService.validate({ cafeId: 'cafe-1', code: 'SAVE10', subtotal: 500 })).rejects.toThrow(
      /already been used/i
    );
  });

  it('rejects an expired coupon', async () => {
    mockCouponFindOne.mockResolvedValue(baseCoupon({ validTo: new Date('2020-01-01') }));
    await expect(couponService.validate({ cafeId: 'cafe-1', code: 'SAVE10', subtotal: 500 })).rejects.toThrow(
      /expired/i
    );
  });
});

// ─── Module #17 — Wallet ────────────────────────────────

describe('walletService.debit (#17)', () => {
  it('debits the balance atomically and writes a passbook row', async () => {
    mockTxFindOne.mockResolvedValue(null);
    mockWalletFindOne.mockResolvedValue({ _id: 'w1', balance: 500 });
    mockWalletFindOneAndUpdate.mockResolvedValue({ _id: 'w1', balance: 400 });
    mockTxCreate.mockResolvedValue({ _id: 'tx1', amount: -100, balanceAfter: 400 });

    const result = await walletService.debit({
      cafeId: 'cafe-1',
      customerId: 'cust-1',
      amount: 100,
      orderId: 'order-1',
    });

    expect(mockWalletFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'w1', balance: { $gte: 100 } }),
      expect.any(Object),
      { new: true }
    );
    expect(result.wallet.balance).toBe(400);
    expect(result.transaction.amount).toBe(-100);
    expect(mockEmitWallet).toHaveBeenCalledWith('cafe-1', expect.objectContaining({ balance: 400 }));
  });

  it('rejects when the balance is insufficient', async () => {
    mockTxFindOne.mockResolvedValue(null);
    mockWalletFindOne.mockResolvedValue({ _id: 'w1', balance: 50 });

    await expect(
      walletService.debit({ cafeId: 'cafe-1', customerId: 'cust-1', amount: 100 })
    ).rejects.toThrow(/insufficient wallet balance/i);
    expect(mockWalletFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns the existing transaction for a repeated clientRequestId', async () => {
    mockTxFindOne.mockResolvedValue({ _id: 'tx-existing', walletId: 'w1' });

    const result = await walletService.debit({
      cafeId: 'cafe-1',
      customerId: 'cust-1',
      amount: 100,
      clientRequestId: 'req-1',
    });

    expect(result.idempotent).toBe(true);
    expect(mockWalletFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('walletService.credit (#17)', () => {
  it('credits a wallet and tracks top-ups', async () => {
    mockTxFindOne.mockResolvedValue(null);
    const wallet = { _id: 'w1', balance: 100, totalTopups: 0, save: jest.fn().mockResolvedValue(true) };
    mockWalletFindOne.mockResolvedValue(wallet);
    mockTxCreate.mockResolvedValue({ _id: 'tx1', amount: 200, balanceAfter: 300 });

    const result = await walletService.credit({ cafeId: 'cafe-1', customerId: 'cust-1', amount: 200 });

    expect(wallet.balance).toBe(300);
    expect(wallet.totalTopups).toBe(200);
    expect(result.transaction.amount).toBe(200);
  });
});

// ─── Module #15 — Loyalty ───────────────────────────────

const makeCard = (overrides = {}) => {
  const card = {
    _id: 'card-1',
    cafeId: 'cafe-1',
    customerId: 'cust-1',
    programId: 'prog-1',
    stamps: 0,
    lifetimeStamps: 0,
    vouchers: [],
    lastStampAt: null,
    history: [],
    save: jest.fn().mockResolvedValue(true),
    addHistory(entry) {
      this.history.push(entry);
    },
    ...overrides,
  };
  return card;
};

describe('loyaltyService.earnStamps (#15)', () => {
  const program = {
    _id: 'prog-1',
    isActive: true,
    stampsRequired: 3,
    minSpend: 0,
    qualifyingScope: 'all',
    stampsPerOrder: 1,
    reward: { type: 'flat_off', value: 50, label: 'Free coffee', menuItemId: null },
    voucherValidDays: 30,
  };

  it('adds a stamp without issuing a voucher below the threshold', async () => {
    mockProgramFindOne.mockResolvedValue(program);
    const card = makeCard({ stamps: 0 });
    mockCardFindOne.mockResolvedValue(card);

    const result = await loyaltyService.earnStamps({ cafeId: 'cafe-1', customerId: 'cust-1', amount: 100 });

    expect(result.stampsEarned).toBe(1);
    expect(card.stamps).toBe(1);
    expect(result.vouchersIssued).toHaveLength(0);
    expect(card.save).toHaveBeenCalled();
  });

  it('issues a voucher when the threshold is reached', async () => {
    mockProgramFindOne.mockResolvedValue(program);
    const card = makeCard({ stamps: 2 });
    mockCardFindOne.mockResolvedValue(card);

    const result = await loyaltyService.earnStamps({ cafeId: 'cafe-1', customerId: 'cust-1', amount: 100 });

    expect(card.stamps).toBe(0);
    expect(result.vouchersIssued).toHaveLength(1);
    expect(result.vouchersIssued[0].code).toMatch(/^RWD-/);
    expect(card.vouchers).toHaveLength(1);
    expect(mockEmitLoyalty).toHaveBeenCalledWith('cafe-1', expect.objectContaining({ customerId: 'cust-1' }));
  });

  it('does nothing when there is no active program', async () => {
    mockProgramFindOne.mockResolvedValue(null);

    const result = await loyaltyService.earnStamps({ cafeId: 'cafe-1', customerId: 'cust-1', amount: 100 });

    expect(result).toBeNull();
    expect(mockCardCreate).not.toHaveBeenCalled();
  });

  it('skips orders below the minimum spend', async () => {
    mockProgramFindOne.mockResolvedValue({ ...program, minSpend: 500 });

    const result = await loyaltyService.earnStamps({ cafeId: 'cafe-1', customerId: 'cust-1', amount: 100 });

    expect(result).toBeNull();
  });
});

describe('loyaltyService.redeemVoucher (#15)', () => {
  it('marks an active voucher redeemed', async () => {
    const card = makeCard({
      vouchers: [{ code: 'RWD-ABC123', status: 'active', label: 'Free coffee', value: 50, expiresAt: null }],
    });
    mockCardFindOne.mockResolvedValue(card);

    const voucher = await loyaltyService.redeemVoucher({
      cafeId: 'cafe-1',
      code: 'rwd-abc123',
      orderId: 'order-1',
      staffName: 'Asha',
    });

    expect(voucher.status).toBe('redeemed');
    expect(card.save).toHaveBeenCalled();
  });

  it('rejects an already-redeemed voucher', async () => {
    const card = makeCard({
      vouchers: [{ code: 'RWD-DONE00', status: 'redeemed', label: 'Used', value: 50, expiresAt: null }],
    });
    mockCardFindOne.mockResolvedValue(card);

    await expect(
      loyaltyService.redeemVoucher({ cafeId: 'cafe-1', code: 'RWD-DONE00' })
    ).rejects.toThrow(/not active/i);
  });
});

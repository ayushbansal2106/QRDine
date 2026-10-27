/**
 * Customer sign-in by phone OTP, and targeted coupons (Module #09).
 *
 * The tenant-scoping cases are the important ones: customer profiles are keyed
 * `{cafeId, phone}`, so a code minted for one café must never resolve a
 * profile belonging to another.
 */

const mockOtpFindOne = jest.fn();
const mockOtpUpdateMany = jest.fn();
const mockOtpCreate = jest.fn();
const mockCustomerFindOne = jest.fn();
const mockCustomerCreate = jest.fn();
const mockCouponFindOne = jest.fn();
const mockOrderCountDocuments = jest.fn();
const mockSendOtp = jest.fn();

jest.mock('../src/models/OtpCode', () => ({
  findOne: (...a) => mockOtpFindOne(...a),
  updateMany: (...a) => mockOtpUpdateMany(...a),
  updateOne: jest.fn().mockResolvedValue({}),
  create: (...a) => mockOtpCreate(...a),
}));

jest.mock('../src/models/Customer', () => ({
  findOne: (...a) => mockCustomerFindOne(...a),
  create: (...a) => mockCustomerCreate(...a),
}));

jest.mock('../src/models/Coupon', () => ({
  findOne: (...a) => mockCouponFindOne(...a),
  updateOne: jest.fn(),
}));

jest.mock('../src/models/Order', () => ({
  countDocuments: (...a) => mockOrderCountDocuments(...a),
}));

jest.mock('../src/services/smsService', () => {
  const actual = jest.requireActual('../src/services/smsService');
  return { ...actual, sendOtp: (...a) => mockSendOtp(...a) };
});

const customerAuthService = require('../src/services/customerAuthService');
const couponService = require('../src/services/couponService');
const env = require('../src/config/env');

const CAFE_A = 'cafe-a';
const CAFE_B = 'cafe-b';

const record = (overrides = {}) => {
  const salt = 'salt123';
  const code = '123456';
  return {
    _id: 'otp-1',
    identifier: '919999999999',
    purpose: 'login',
    cafeId: CAFE_A,
    salt,
    codeHash: customerAuthService.hashCode(code, salt),
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 60000),
    consumedAt: null,
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
};

/** The service awaits `findOne(...).sort(...)`, so the mock must chain. */
const chain = (value) => ({ sort: jest.fn().mockResolvedValue(value) });

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockOtpFindOne.mockReturnValue(chain(null));
  mockOtpUpdateMany.mockResolvedValue({});
  mockCustomerFindOne.mockResolvedValue(null);
  mockCustomerCreate.mockImplementation(async (doc) => ({ _id: 'cust-1', ...doc }));
  mockSendOtp.mockResolvedValue({ sent: true, provider: 'console', devCode: '123456' });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('phone OTP sign-in', () => {
  it('never stores the code in plaintext', async () => {
    await customerAuthService.requestLoginOtp({ phone: '9999999999', cafeId: CAFE_A });

    const stored = mockOtpCreate.mock.calls[0][0];
    expect(stored.codeHash).not.toContain('123456');
    expect(stored.codeHash).toHaveLength(64);
    expect(stored.salt).toEqual(expect.any(String));
    expect(stored.cafeId).toBe(CAFE_A);
  });

  it('normalises an Indian number to E.164 before sending', async () => {
    await customerAuthService.requestLoginOtp({ phone: '099999 99999', cafeId: CAFE_A });
    expect(mockSendOtp).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '919999999999' })
    );
  });

  it('rejects a malformed number', async () => {
    await expect(
      customerAuthService.requestLoginOtp({ phone: '12345', cafeId: CAFE_A })
    ).rejects.toThrow(/valid 10-digit/i);
  });

  it('supersedes the previous live code so only the newest works', async () => {
    mockOtpFindOne.mockReturnValue(chain(null));
    await customerAuthService.requestLoginOtp({ phone: '9999999999', cafeId: CAFE_A });

    expect(mockOtpUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: '919999999999', purpose: 'login', cafeId: CAFE_A }),
      { $set: { consumedAt: expect.any(Date) } }
    );
  });

  it('issues a token and links the profile on a correct code', async () => {
    const otp = record();
    mockOtpFindOne.mockReturnValue(chain(otp));

    const { customer, token } = await customerAuthService.verifyLoginOtp({
      phone: '9999999999',
      code: '123456',
      cafeId: CAFE_A,
    });

    expect(mockCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ cafeId: CAFE_A, phone: '919999999999' })
    );
    expect(otp.consumedAt).toBeInstanceOf(Date);
    expect(typeof token).toBe('string');
    expect(customer._id).toBe('cust-1');
  });

  it('counts a wrong code against the attempt budget', async () => {
    const otp = record();
    mockOtpFindOne.mockReturnValue(chain(otp));

    await expect(
      customerAuthService.verifyLoginOtp({ phone: '9999999999', code: '000000', cafeId: CAFE_A })
    ).rejects.toThrow(/4 attempts left/i);

    expect(otp.attempts).toBe(1);
  });

  it('locks out once the attempt budget is spent', async () => {
    const otp = record({ attempts: 5 });
    mockOtpFindOne.mockReturnValue(chain(otp));

    await expect(
      customerAuthService.verifyLoginOtp({ phone: '9999999999', code: '000000', cafeId: CAFE_A })
    ).rejects.toThrow(/too many incorrect attempts/i);
  });

  it('rejects an expired code', async () => {
    const otp = record({ expiresAt: new Date(Date.now() - 1000) });
    mockOtpFindOne.mockReturnValue(chain(otp));

    await expect(
      customerAuthService.verifyLoginOtp({ phone: '9999999999', code: '123456', cafeId: CAFE_A })
    ).rejects.toThrow(/expired/i);
  });

  it('will not accept a code issued for a different cafe', async () => {
    // The lookup itself is cafe-scoped, so café B finds nothing to verify.
    mockOtpFindOne.mockReturnValue(chain(null));

    await expect(
      customerAuthService.verifyLoginOtp({ phone: '9999999999', code: '123456', cafeId: CAFE_B })
    ).rejects.toThrow(/invalid or has already been used/i);

    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it('requires a cafe so a profile can never be resolved tenant-blind', async () => {
    await expect(
      customerAuthService.verifyLoginOtp({ phone: '9999999999', code: '123456' })
    ).rejects.toThrow(/cafe is required/i);
  });

  it('refuses to consume a code twice', async () => {
    mockOtpFindOne.mockReturnValue(chain(null));
    await expect(
      customerAuthService.verifyLoginOtp({ phone: '9999999999', code: '123456', cafeId: CAFE_A })
    ).rejects.toThrow(/already been used/i);
  });
});

describe('OTP_FIXED_CODE (development escape hatch)', () => {
  const originalNodeEnv = env.nodeEnv;
  const originalFixed = env.otpFixedCode;

  afterEach(() => {
    env.nodeEnv = originalNodeEnv;
    env.otpFixedCode = originalFixed;
  });

  it('issues the pinned code when configured', async () => {
    env.otpFixedCode = '123456';
    mockOtpFindOne.mockReturnValue(chain(null));
    await customerAuthService.requestLoginOtp({ phone: '9999999999', cafeId: CAFE_A });

    // The stored hash must be the digest of the pinned code, not of a random one.
    const stored = mockOtpCreate.mock.calls[0][0];
    expect(customerAuthService.hashCode('123456', stored.salt)).toBe(stored.codeHash);
  });

  it('never echoes a pinned code back to the client', async () => {
    env.otpFixedCode = '123456';
    mockOtpFindOne.mockReturnValue(chain(null));

    const result = await customerAuthService.requestLoginOtp({
      phone: '9999999999',
      cafeId: CAFE_A,
    });

    // A fixed code is already known to the developer; returning it would put it
    // in HTTP logs and devtools for no benefit.
    expect(result.devCode).toBeUndefined();
    expect(result.fixedCode).toBe(true);
  });

  it('still enforces the attempt budget with a pinned code', async () => {
    env.otpFixedCode = '123456';
    const otp = record({ attempts: 5 });
    mockOtpFindOne.mockReturnValue(chain(otp));

    await expect(
      customerAuthService.verifyLoginOtp({ phone: '9999999999', code: '123456', cafeId: CAFE_A })
    ).rejects.toThrow(/too many incorrect attempts/i);
  });

  it('still refuses a production boot that would ship a shared code', () => {
    env.nodeEnv = 'production';
    env.otpFixedCode = '123456';

    expect(env.collectConfigProblems().join(' ')).toMatch(/OTP_FIXED_CODE/);
  });

  it('allows a production boot once the pinned code is removed', () => {
    env.nodeEnv = 'production';
    env.otpFixedCode = '';

    const problems = env.collectConfigProblems();
    // Other production rules may still fire (they depend on the machine), but
    // the shared-code rule must not.
    expect(problems.join(' ')).not.toMatch(/OTP_FIXED_CODE/);
  });

  it('allows a pinned code in development, where it is the point', () => {
    env.nodeEnv = 'development';
    env.otpFixedCode = '123456';

    expect(env.collectConfigProblems().join(' ')).not.toMatch(/OTP_FIXED_CODE/);
  });
});

describe('targeted coupons', () => {
  const targeted = (customerIds) => ({
    code: 'VIP20',
    isActive: true,
    type: 'percent',
    value: 20,
    maxDiscount: 0,
    minOrder: 0,
    usageCount: 0,
    usageLimit: 0,
    singleUse: false,
    perCustomerLimit: 0,
    validFrom: null,
    validTo: null,
    happyHour: { enabled: false },
    appliesTo: { scope: 'all', itemIds: [], categoryIds: [], customerIds },
  });

  it('rejects the offer for a customer it is not addressed to', async () => {
    mockCouponFindOne.mockResolvedValue(targeted(['cust-vip']));

    await expect(
      couponService.validate({ cafeId: CAFE_A, code: 'VIP20', subtotal: 500, customerId: 'cust-other' })
    ).rejects.toThrow(/not available for your account/i);
  });

  it('rejects the offer for an anonymous order', async () => {
    mockCouponFindOne.mockResolvedValue(targeted(['cust-vip']));

    await expect(
      couponService.validate({ cafeId: CAFE_A, code: 'VIP20', subtotal: 500, customerId: null })
    ).rejects.toThrow(/not available for your account/i);
  });

  it('honours the offer for the targeted customer', async () => {
    mockCouponFindOne.mockResolvedValue(targeted(['cust-vip']));

    const result = await couponService.validate({
      cafeId: CAFE_A,
      code: 'VIP20',
      subtotal: 500,
      customerId: 'cust-vip',
    });

    expect(result.discount).toBe(100);
  });

  it('leaves untargeted coupons open to everyone', async () => {
    mockCouponFindOne.mockResolvedValue(targeted([]));

    const result = await couponService.validate({
      cafeId: CAFE_A,
      code: 'VIP20',
      subtotal: 500,
      customerId: 'cust-other',
    });

    expect(result.discount).toBe(100);
  });
});
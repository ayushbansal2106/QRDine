/**
 * ISSUE-36 — one person, two customer profiles, and an invisible order history.
 *
 * Three code paths key a customer profile by phone, and they disagreed about
 * the *form* of that phone:
 *
 *     OTP sign-in -> smsService.normalizePhone() -> "919996696235"
 *     POS (CRM)   -> (phone || '').trim()        -> "9996696235"
 *     till lookup -> exact match on the raw string
 *
 * So a customer who paid at the counter and later signed in with the same
 * number resolved to two different profiles. The sale sat on the POS profile
 * and the sign-in created an empty one, which is exactly the "signed in, and my
 * order history is empty" report — with the order data sitting in the database
 * the whole time, correctly linked, to a row nobody was looking at.
 *
 * The fix is one canonical function every path goes through, so the three can
 * never drift apart again.
 */

const mockFindOne = jest.fn();
const mockCreate = jest.fn();
const mockUpdateOne = jest.fn();

jest.resetModules();

jest.doMock('../src/models/Customer', () => ({
  findOne: (...a) => mockFindOne(...a),
  create: (...a) => mockCreate(...a),
}));
jest.doMock('../src/models/Order', () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
}));

const customerService = require('../src/services/customerService');

const makeCustomer = (overrides = {}) => {
  const doc = {
    _id: 'cust-1',
    cafeId: 'cafe-1',
    phone: '919996696235',
    name: 'Ayush',
    email: '',
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return doc;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ISSUE-36 — every phone lookup agrees on one canonical form', () => {
  describe('canonicalPhone', () => {
    it('normalises a bare national number the way OTP sign-in does', () => {
      expect(customerService.canonicalPhone('9996696235')).toBe('919996696235');
    });

    it('leaves an already-canonical number alone', () => {
      expect(customerService.canonicalPhone('919996696235')).toBe('919996696235');
    });

    it('strips a leading trunk zero', () => {
      expect(customerService.canonicalPhone('09996696235')).toBe('919996696235');
    });

    it('ignores formatting the cashier might type', () => {
      expect(customerService.canonicalPhone('99966 96235')).toBe('919996696235');
      expect(customerService.canonicalPhone('+91 99966 96235')).toBe('919996696235');
    });

    it('falls back to the trimmed value rather than dropping the sale', () => {
      // A till entry that cannot be normalised still has to attach to *some*
      // profile rather than silently dropping the customer link.
      expect(customerService.canonicalPhone('  12345  ')).toBe('12345');
    });

    it('treats an empty number as absent', () => {
      expect(customerService.canonicalPhone('')).toBe('');
      expect(customerService.canonicalPhone(null)).toBe('');
      expect(customerService.canonicalPhone(undefined)).toBe('');
    });
  });

  describe('findByPhone', () => {
    it('finds a profile stored in the POS form, not just the OTP form', async () => {
      const counterCustomer = makeCustomer({ phone: '9996696235' });
      // First lookup (canonical) misses; the legacy fallback hits.
      mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(counterCustomer);

      const found = await customerService.findByPhone('cafe-1', '9996696235');

      expect(found).toBe(counterCustomer);
    });

    it('heals the stored form so the split cannot recur', async () => {
      const counterCustomer = makeCustomer({ phone: '9996696235' });
      mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(counterCustomer);

      await customerService.findByPhone('cafe-1', '919996696235');

      expect(counterCustomer.phone).toBe('919996696235');
      expect(counterCustomer.save).toHaveBeenCalled();
    });

    it('prefers the canonical profile when both forms exist', async () => {
      const canonical = makeCustomer({ phone: '919996696235', name: 'Empty shell' });
      mockFindOne.mockResolvedValue(canonical);

      const found = await customerService.findByPhone('cafe-1', '9996696235');

      // The legacy row is left alone — merging two real profiles is a
      // deliberate repair, not something a read path should do silently.
      expect(found).toBe(canonical);
      expect(mockFindOne).toHaveBeenCalledTimes(1);
    });

    it('returns null when the number is unknown', async () => {
      mockFindOne.mockResolvedValue(null);
      expect(await customerService.findByPhone('cafe-1', '9996696235')).toBeNull();
    });

    it('is tenant-scoped on every lookup', async () => {
      mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      await customerService.findByPhone('cafe-1', '9996696235');

      for (const call of mockFindOne.mock.calls) {
        expect(call[0].cafeId).toBe('cafe-1');
      }
    });
  });

  describe('upsertByPhone', () => {
    it('looks up the canonical form, so a POS sale cannot create a second profile', async () => {
      const existing = makeCustomer();
      mockFindOne.mockResolvedValue(existing);

      const result = await customerService.upsertByPhone({
        cafeId: 'cafe-1',
        phone: '9996696235',
        name: 'Ayush',
      });

      expect(result).toBe(existing);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockFindOne.mock.calls[0][0]).toEqual({ cafeId: 'cafe-1', phone: '919996696235' });
    });

    it('creates the profile under the canonical form', async () => {
      mockFindOne.mockResolvedValue(null);
      mockCreate.mockImplementation(async (doc) => ({ _id: 'new', ...doc }));

      await customerService.upsertByPhone({ cafeId: 'cafe-1', phone: '9996696235', name: 'New' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ cafeId: 'cafe-1', phone: '919996696235' })
      );
    });

    it('does nothing without a phone number', async () => {
      expect(await customerService.upsertByPhone({ cafeId: 'cafe-1', phone: '' })).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});

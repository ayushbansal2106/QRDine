/**
 * Guest preferences (Module #09).
 *
 * The toggles in the customer profile are the only place a guest's veg-only
 * choice is stored, and the value is read back by the live menu — so a silent
 * failure here means the setting appears to do nothing.
 */

const mockCustomerFindOne = jest.fn();

jest.mock('../src/models/Customer', () => ({
  findOne: (...a) => mockCustomerFindOne(...a),
}));

const { updatePreferences, updateProfile } = require('../src/controllers/customerAppController');

const makeCustomer = (overrides = {}) => ({
  _id: 'cust-1',
  name: 'Rahul',
  phone: '919999999999',
  email: '',
  emailVerifiedAt: null,
  preferences: { vegOnly: false, notifications: true, language: 'en' },
  save: jest.fn().mockImplementation(function () {
    return Promise.resolve(this);
  }),
  ...overrides,
});

const makeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe('updatePreferences', () => {
  it('turns veg-only on and persists it', async () => {
    const customer = makeCustomer();
    const req = { customer, body: { vegOnly: true } };
    const res = makeRes();

    await updatePreferences(req, res, jest.fn());

    expect(customer.preferences.vegOnly).toBe(true);
    expect(customer.save).toHaveBeenCalled();
    expect(res.body.customer.preferences.vegOnly).toBe(true);
  });

  it('turns notifications off and leaves veg-only alone', async () => {
    const customer = makeCustomer();
    const req = { customer, body: { notifications: false } };
    const res = makeRes();

    await updatePreferences(req, res, jest.fn());

    expect(customer.preferences.notifications).toBe(false);
    expect(customer.preferences.vegOnly).toBe(false);
  });

  it('coerces string values rather than storing them verbatim', async () => {
    const customer = makeCustomer();
    const req = { customer, body: { vegOnly: 'true', notifications: 0 } };
    const res = makeRes();

    await updatePreferences(req, res, jest.fn());

    expect(customer.preferences.vegOnly).toBe(true);
    expect(customer.preferences.notifications).toBe(false);
  });

  it('repairs a profile stored before the preferences field existed', async () => {
    // Such a document hydrates without the nested object; writing to it
    // unguarded throws and the toggle silently stops working.
    const customer = makeCustomer({ preferences: undefined });
    const req = { customer, body: { vegOnly: true } };
    const res = makeRes();
    const next = jest.fn();

    await updatePreferences(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(customer.preferences.vegOnly).toBe(true);
    expect(customer.save).toHaveBeenCalled();
  });

  it('ignores fields that were not sent', async () => {
    const customer = makeCustomer();
    const req = { customer, body: {} };
    const res = makeRes();

    await updatePreferences(req, res, jest.fn());

    expect(customer.preferences.vegOnly).toBe(false);
    expect(customer.preferences.notifications).toBe(true);
  });

  it('refuses an untranslated language rather than half-localising the UI', async () => {
    const customer = makeCustomer();
    const req = { customer, body: { language: 'hi' } };
    const res = makeRes();
    // asyncHandler forwards failures to next() instead of rejecting.
    const next = jest.fn();

    await updatePreferences(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/coming soon/i) })
    );
    expect(customer.save).not.toHaveBeenCalled();
  });

  it('accepts english', async () => {
    const customer = makeCustomer();
    const req = { customer, body: { language: 'en' } };
    const res = makeRes();

    await updatePreferences(req, res, jest.fn());

    expect(res.body.customer.preferences.language).toBe('en');
  });
});

describe('updateProfile', () => {
  it('saves a trimmed name', async () => {
    const customer = makeCustomer();
    const req = { customer, body: { name: '  Rahul Sharma  ' } };
    const res = makeRes();

    await updateProfile(req, res, jest.fn());

    expect(customer.name).toBe('Rahul Sharma');
    expect(customer.save).toHaveBeenCalled();
  });
});
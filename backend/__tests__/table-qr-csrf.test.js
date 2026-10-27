/**
 * Regression cover for two bugs that made /admin/tables and /admin/qr unusable:
 *
 *  1. `GET /api/tables/:id/qr` destructured `generateQrDataUrl()` as if it
 *     returned `{ qrDataUrl }`, but it resolves to the data URL string itself.
 *     The destructure silently yielded `undefined`, `res.json()` dropped the key
 *     (undefined is not serialised), and the UI rendered "Failed to load QR
 *     code" forever.
 *
 *  2. The CSRF cookie was only ever minted on the *backend* origin, so a Server
 *     Action running on the Next.js origin could never read it and every
 *     state-changing admin call came back 403 "CSRF token missing".
 */

const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = '507f1f77bcf86cd799439011';
const TABLE_ID = '507f1f77bcf86cd799439099';
const VALID_OBJECT_ID = TABLE_ID;

const mockTableFindOne = jest.fn();
const mockTableSave = jest.fn();

jest.mock('../src/models/Table', () => ({
  findOne: (...a) => {
    const query = Promise.resolve(mockTableFindOne(...a));
    query.select = () => query;
    query.save = (...args) => mockTableSave(...args);
    return query;
  },
}));

const { getTableQr } = require('../src/controllers/tableController');
const { validateCsrfToken } = require('../src/middlewares/csrfMiddleware');

const makeTable = (overrides = {}) => ({
  _id: TABLE_ID,
  cafeId: CAFE_ID,
  tableNumber: '7',
  publicId: 'tbl_abc123',
  guestUrl: 'http://localhost:3000/table/tbl_abc123',
  isActive: true,
  save: mockTableSave,
  ...overrides,
});

describe('GET /api/tables/:id/qr — QR payload', () => {
  beforeEach(() => {
    mockTableSave.mockResolvedValue(true);
  });

  it('returns qrDataUrl as a real PNG data URL string', async () => {
    mockTableFindOne.mockResolvedValue(makeTable());
    const res = mockRes();

    await getTableQr(mockReq({ params: { id: VALID_OBJECT_ID }, cafeId: CAFE_ID }), res, mockNext());

    expect(res._statusCode).toBe(200);
    expect(typeof res._jsonData.qrDataUrl).toBe('string');
    expect(res._jsonData.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    // A real QR payload is thousands of characters; `undefined` produced nothing.
    expect(res._jsonData.qrDataUrl.length).toBeGreaterThan(500);
  });

  it('encodes the table guest URL, not the table number', async () => {
    mockTableFindOne.mockResolvedValue(makeTable());
    const res = mockRes();

    await getTableQr(mockReq({ params: { id: VALID_OBJECT_ID }, cafeId: CAFE_ID }), res, mockNext());

    expect(res._jsonData.guestUrl).toBe('http://localhost:3000/table/tbl_abc123');
    expect(res._jsonData.tableId).toBe(TABLE_ID);
    expect(res._jsonData.tableNumber).toBe('7');
  });

  it('mints a public id and guest URL on first use before encoding the QR', async () => {
    const table = makeTable({ publicId: '', guestUrl: '' });
    mockTableFindOne.mockResolvedValue(table);
    const res = mockRes();

    await getTableQr(mockReq({ params: { id: VALID_OBJECT_ID }, cafeId: CAFE_ID }), res, mockNext());

    expect(mockTableSave).toHaveBeenCalled();
    expect(table.publicId).toMatch(/^tbl_[0-9a-f]{24}$/);
    expect(table.guestUrl).toBe(`http://localhost:3000/table/${table.publicId}`);
    expect(res._jsonData.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('rejects a non-ObjectId before touching the database', async () => {
    const res = mockRes();
    const next = mockNext();

    await getTableQr(mockReq({ params: { id: 'not-an-id' }, cafeId: CAFE_ID }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid table id' }));
    expect(mockTableFindOne).not.toHaveBeenCalled();
    expect(res._jsonData).toBeNull();
  });

  it('404s for a table outside the tenant', async () => {
    mockTableFindOne.mockResolvedValue(null);
    const res = mockRes();
    const next = mockNext();

    await getTableQr(mockReq({ params: { id: VALID_OBJECT_ID }, cafeId: CAFE_ID }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Table not found' }));
    expect(res._jsonData).toBeNull();
  });
});

describe('validateCsrfToken — double submit contract', () => {
  // The Next.js interceptor must send BOTH the header and the cookie; this
  // pins the backend half of that contract so the two cannot drift apart.
  const TOKEN = 'a'.repeat(64);

  it('rejects a state-changing request with no token at all', () => {
    const res = mockRes();
    const next = mockNext();

    validateCsrfToken(mockReq({ method: 'POST', headers: {}, cookies: {} }), res, next);

    expect(res._statusCode).toBe(403);
    expect(res._jsonData.message).toMatch(/CSRF token missing/);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when only the header is present (cookie never travelled)', () => {
    const res = mockRes();
    const next = mockNext();

    validateCsrfToken(
      mockReq({ method: 'POST', headers: { 'x-csrf-token': TOKEN }, cookies: {} }),
      res,
      next
    );

    expect(res._statusCode).toBe(403);
    expect(res._jsonData.message).toMatch(/CSRF token missing/);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a matching header + cookie pair', () => {
    const res = mockRes();
    const next = mockNext();

    validateCsrfToken(
      mockReq({
        method: 'POST',
        headers: { 'x-csrf-token': TOKEN },
        cookies: { csrf_token: TOKEN },
      }),
      res,
      next
    );

    expect(next).toHaveBeenCalledWith();
    expect(res._jsonData).toBeNull();
  });

  it('rejects a mismatched pair', () => {
    const res = mockRes();
    const next = mockNext();

    validateCsrfToken(
      mockReq({
        method: 'POST',
        headers: { 'x-csrf-token': TOKEN },
        cookies: { csrf_token: 'b'.repeat(64) },
      }),
      res,
      next
    );

    expect(res._statusCode).toBe(403);
    expect(res._jsonData.message).toMatch(/CSRF token mismatch/);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not require a token on safe methods', () => {
    const res = mockRes();
    const next = mockNext();

    validateCsrfToken(mockReq({ method: 'GET', headers: {}, cookies: {} }), res, next);

    expect(next).toHaveBeenCalled();
  });
});
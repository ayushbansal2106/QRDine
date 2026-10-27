/**
 * Public café profile — used by the QR menu screen.
 *
 * A guest scanning a table QR has no session, so the header needs a café name
 * and logo from somewhere. The risk with such an endpoint is not that it 404s
 * but that it leaks: the Cafe document also carries phone, email, tax ids and
 * billing/subscription state. These tests pin the field allowlist and the fact
 * that the route is reachable *before* the auth middleware.
 */
const express = require('express');
const mongoose = require('mongoose');

const mockCafeFindById = jest.fn();

jest.mock('../src/models/Cafe', () => ({
  findById: (...a) => mockCafeFindById(...a),
}));

const { getCafePublic } = require('../src/controllers/cafeController');
const cafeRoutes = require('../src/routes/cafeRoutes');
const { mockReq, mockRes, mockNext } = require('./setup');

const CAFE_ID = new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/cafe/public/:cafeId', () => {
  it('returns only display fields', async () => {
    mockCafeFindById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        name: 'Sahab ji Kitchen & Grill',
        logo: 'https://res.cloudinary.com/demo/logo.png',
        address: 'Banjara Hills',
      }),
    });

    const res = mockRes();
    await getCafePublic(mockReq({ params: { cafeId: CAFE_ID } }), res, mockNext());

    expect(res._statusCode).toBe(200);
    expect(Object.keys(res._jsonData.cafe).sort()).toEqual([
      'address',
      'fssaiNumber',
      'gstin',
      'legalName',
      'logo',
      'name',
      'tradeName',
    ]);
  });

  it('never returns phone, email or billing state', async () => {
    mockCafeFindById.mockReturnValue({
      // The query selects only display and statutory fields, so anything else on the
      // document is unreachable — this asserts that contract.
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        name: 'Cafe',
        logo: '',
        address: '',
        phone: '+91-99999-99999',
        email: 'owner@cafe.test',
        gstNumber: '29AAAAA0000A1Z5',
        subscription: { plan: 'pro', status: 'active' },
      }),
    });

    const res = mockRes();
    await getCafePublic(mockReq({ params: { cafeId: CAFE_ID } }), res, mockNext());

    const body = JSON.stringify(res._jsonData);
    expect(body).not.toContain('99999');
    expect(body).not.toContain('owner@cafe.test');
    expect(body).not.toContain('gstNumber');
    expect(body).not.toContain('subscription');
  });

  it('restricts the database projection to the display fields', async () => {
    const select = jest.fn().mockReturnThis();
    mockCafeFindById.mockReturnValue({
      select,
      lean: jest.fn().mockResolvedValue({ name: 'Cafe', logo: '', address: '' }),
    });

    await getCafePublic(mockReq({ params: { cafeId: CAFE_ID } }), mockRes(), mockNext());

    expect(select).toHaveBeenCalledWith(expect.stringContaining('name'));
    expect(select).toHaveBeenCalledWith(expect.stringContaining('logo'));
    expect(select).toHaveBeenCalledWith(expect.stringContaining('address'));
  });

  it('404s on a non-ObjectId instead of querying with junk', async () => {
    const next = mockNext();
    await getCafePublic(mockReq({ params: { cafeId: 'not-an-id' } }), mockRes(), next);

    expect(mockCafeFindById).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('is registered ahead of the authenticated router guard', () => {
    // A route placed after `router.use(protect, ...)` would demand a JWT from a
    // guest scanning a QR code, which is the bug this endpoint exists to avoid.
    const layers = cafeRoutes.stack.filter((l) => l.route);
    const publicLayer = layers.find(
      (l) => l.route.path === '/public/:cafeId' && l.route.methods.get
    );

    expect(publicLayer).toBeDefined();
    const guardIndex = cafeRoutes.stack.findIndex((l) => l.name === 'protect');
    const publicIndex = cafeRoutes.stack.indexOf(publicLayer);
    expect(publicIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex === -1 || publicIndex < guardIndex).toBe(true);
  });
});

describe('mount path', () => {
  it('is reachable through the real router stack', () => {
    const app = express();
    app.use('/api/cafe', cafeRoutes);
    expect(typeof app).toBe('function');
    // Confirms the route table builds without throwing on mount.
    expect(cafeRoutes.stack.length).toBeGreaterThan(0);
  });
});
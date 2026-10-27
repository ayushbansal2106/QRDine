/**
 * ISSUE-28 — sign-in appeared not to persist.
 *
 * Two independent defects produced the same symptom ("it asks me to sign in
 * again"), and neither was the cookie itself — the `customer_token` cookie was
 * correctly minted, mirrored onto the Next origin and accepted on every
 * subsequent request.
 *
 * 1. Sign-in never captured a name. An OTP proves *who* you are; it never asks
 *    what to call you, so a freshly created profile has `name: ""`. The session
 *    gate's fast path requires a name, so it fell through to the prompt on
 *    every single checkout — forever, because nothing ever wrote a name back.
 *
 * 2. Guests could not write a name even when asked. The backend enforces the
 *    CSRF double-submit check on `/api/customer/*`, but the Next middleware
 *    only minted the cookie under /admin and /staff. A guest who never opened
 *    the staff portal had no token to send, so `PATCH /customer/me` — and every
 *    preference toggle — returned 403 and the name was silently discarded.
 *
 * These tests pin both halves so the loop cannot come back.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

describe('ISSUE-28 — the guest sign-in CSRF cookie must exist', () => {
  const middleware = read('frontend', 'src', 'middleware.ts');

  it('mints the CSRF cookie for guest-facing routes, not just staff routes', () => {
    const start = middleware.indexOf('export const config');
    expect(start).toBeGreaterThan(-1);
    const config = middleware.slice(start);

    // A guest must never need to visit the staff portal to save their profile.
    ['/table/:path*', '/profile/:path*', '/signin', '/welcome'].forEach((route) => {
      expect(config).toContain(route);
    });
    // The original staff-only entries must survive.
    expect(config).toContain('/admin/:path*');
    expect(config).toContain('/staff/:path*');
  });

  it('still mints a CSRF token on the response for matched routes', () => {
    expect(middleware).toContain('response.cookies.set(CSRF_COOKIE');
  });
});

describe('ISSUE-28 — a signed-in guest must not be re-prompted at checkout', () => {
  const gate = read('frontend', 'src', 'components', 'menu', 'SessionGate.tsx');

  it('persists the name to the profile so the fast path can find it later', () => {
    // Without this write the prompt reappeared at every checkout, because the
    // profile name stayed empty for the life of the account.
    expect(gate).toContain('updateProfileName');
    expect(gate).toMatch(/await updateProfileName\(name\.trim\(\)\)/);
  });

  it('takes the silent fast path whenever the profile has a name', () => {
    expect(gate).toMatch(/const knownName = \(customer\?\.name \|\| savedCustomerName \|\| ""\)\.trim\(\)/);
    expect(gate).toMatch(/if \(knownName\)\s*\{\s*const session = await createDiningSession/);
  });

  it('hides the OTP field when the guest is already authenticated', () => {
    // Rendering it unconditionally re-asked for a code already used, while
    // Continue stayed disabled because verifiedIdentity was never set.
    expect(gate).toMatch(/\{needsOtp && \(\s*<PhoneOtpField/);
  });

  it('only requires a verified OTP when an OTP is actually needed', () => {
    expect(gate).toContain('(needsOtp && !verifiedIdentity)');
    // The old gate required an OTP unconditionally, deadlocking the
    // name-only prompt: the button could never enable.
    expect(gate).not.toMatch(/disabled=\{isSubmitting \|\| !name\.trim\(\) \|\| !verifiedIdentity\}/);
  });

  it('does not ask for an OTP from a guest who already holds a token', () => {
    expect(gate).toMatch(/setNeedsOtp\(false\)/);
  });
});

describe('ISSUE-28 — the profile can actually store a name', () => {
  const controller = read('backend', 'src', 'controllers', 'customerAppController.js');
  const routes = read('backend', 'src', 'routes', 'customerAppRoutes.js');

  it('exposes a name update on the authenticated profile route', () => {
    expect(routes).toContain("router.patch('/me', updateProfile)");
  });

  it('sanitises and trims the submitted name', () => {
    expect(controller).toMatch(/req\.customer\.name = String\(name\)\.trim\(\)\.slice\(0, 120\)/);
  });

  it('keeps CSRF enforcement on the customer routes it protects', () => {
    // The 403 was a missing cookie, not a missing check — the check must stay.
    expect(routes).toContain('router.use(protectCustomer, validateCsrfToken)');
  });
});
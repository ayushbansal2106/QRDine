/**
 * Observability — BLOCKER-04.
 *
 * The dangerous property here is not "does it log", it is "does it leak". This
 * app handles customer phone numbers, OTP codes, passwords and guest tokens, and
 * everything logged here is shipped to a third-party tracker. So the tests below
 * assert on *absence*: that a raw phone number, password or token cannot appear
 * in a log line or an outbound event.
 *
 * A logger test that only asserted "output is non-empty" would pass while
 * printing every customer's phone number to the internet.
 */

'use strict';

process.env.NODE_ENV = 'test';

const { createLogger, redact, maskIdentity } = require('../src/services/logger');
const errorTracking = require('../src/services/errorTracking');

const SENSITIVE_SAMPLES = [
  '9876543210',
  'password123',
  'correct-horse-battery',
  'guest-token-abc123',
];

describe('logger — redaction', () => {
  it('masks a password anywhere in the tree', () => {
    const out = redact({ user: { email: 'a@b.com', password: 'password123' } });

    expect(JSON.stringify(out)).not.toContain('password123');
    expect(out.user.password).toBe('[redacted]');
  });

  it('masks tokens, cookies, pins and OTPs by key name, case-insensitively', () => {
    const out = redact({
      Authorization: 'Bearer abc.def.ghi',
      Cookie: 'admin_token=xyz',
      guestToken: 'guest-token-abc123',
      pinHash: '$2a$10$hash',
      otp: '123456',
      apiKey: 'sk-live-123',
    });

    const serialised = JSON.stringify(out);
    for (const secret of SENSITIVE_SAMPLES) {
      expect(serialised).not.toContain(secret);
    }
    expect(serialised).not.toContain('Bearer abc.def.ghi');
    expect(serialised).not.toContain('admin_token=xyz');
  });

  it('keeps only the edges of a customer phone number', () => {
    const out = redact({ phone: '9876543210' });

    expect(out.phone).not.toBe('9876543210');
    expect(out.phone.startsWith('9')).toBe(true);
    expect(out.phone.endsWith('0')).toBe(true);
    expect(out.phone).toContain('*');
  });

  it('keeps the domain of an e-mail but not the local part', () => {
    const out = redact({ email: 'priya.sharma@example.com' });

    expect(out.email).not.toContain('priya.sharma');
    expect(out.email).toContain('@example.com');
  });

  it('recurses through arrays and nested objects', () => {
    const out = redact({
      orders: [
        { customer: { phone: '9876543210' }, auth: { password: 'password123' } },
        { customer: { phone: '9123456789' } },
      ],
    });

    expect(JSON.stringify(out)).not.toContain('9876543210');
    expect(JSON.stringify(out)).not.toContain('password123');
  });

  it('does not mutate the caller object', () => {
    const input = { password: 'password123', nested: { phone: '9876543210' } };
    redact(input);

    // The same object is frequently passed somewhere else afterwards.
    expect(input.password).toBe('password123');
    expect(input.nested.phone).toBe('9876543210');
  });

  it('survives a self-referential object instead of hanging', () => {
    const cyclic = { name: 'loop' };
    cyclic.self = cyclic;

    expect(() => redact(cyclic)).not.toThrow();
  });

  it('truncates an oversized string rather than writing a whole document to a log line', () => {
    const out = redact({ note: 'x'.repeat(5000) });
    expect(out.note.length).toBeLessThan(2200);
    expect(out.note).toContain('truncated');
  });

  it('handles primitives and null without throwing', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact('plain')).toBe('plain');
  });

  it('reduces an Error to a plain, loggable shape', () => {
    const out = redact(new Error('boom'));
    expect(out.name).toBe('Error');
    expect(out.message).toBe('boom');
    expect(out.stack).toContain('boom');
  });

  it('masks a two-character identity completely', () => {
    expect(maskIdentity('ab')).toBe('[redacted]');
  });
});

describe('logger — output', () => {
  let spy;

  beforeEach(() => {
    spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('emits one JSON object per line in production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    createLogger('test').info('server listening', { port: 5001, password: 'password123' });

    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.level).toBe('info');
    expect(line.namespace).toBe('test');
    expect(line.message).toBe('server listening');
    expect(line.port).toBe(5001);
    expect(line.password).toBe('[redacted]');
    expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    process.env.NODE_ENV = original;
  });

  it('respects LOG_LEVEL so debug noise can be turned off in production', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalLevel = process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'error';

    const log = createLogger('test');
    log.info('should not appear');
    log.error('should appear');

    const messages = spy.mock.calls.map((c) => c[0]);
    expect(messages.some((m) => String(m).includes('should not appear'))).toBe(false);
    expect(messages.some((m) => String(m).includes('should appear'))).toBe(true);

    process.env.NODE_ENV = originalEnv;
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  });
});

describe('errorTracking — PII never leaves the process', () => {
  it('strips auth headers and cookies from an outbound event', () => {
    const event = {
      request: {
        url: '/api/orders',
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'admin_token=abc; csrf_token=def',
          'x-csrf-token': 'def',
          'content-type': 'application/json',
        },
        data: { phone: '9876543210', password: 'password123' },
      },
    };

    const scrubbed = errorTracking.scrubEvent(event);
    const serialised = JSON.stringify(scrubbed);

    expect(serialised).not.toContain('secret-token');
    expect(serialised).not.toContain('admin_token=abc');
    expect(serialised).not.toContain('9876543210');
    expect(serialised).not.toContain('password123');
    // Non-sensitive headers survive, or the event loses all diagnostic value.
    expect(scrubbed.request.headers['content-type']).toBe('application/json');
  });

  it('keeps the user id but drops contact details', () => {
    const scrubbed = errorTracking.scrubEvent({
      user: { id: '507f1f77bcf86cd799439011', email: 'owner@example.com', ip_address: '1.2.3.4' },
    });

    expect(scrubbed.user.id).toBe('507f1f77bcf86cd799439011');
    expect(scrubbed.user.email).toBeUndefined();
    expect(scrubbed.user.ip_address).toBeUndefined();
  });

  it('scrubs extra context and breadcrumb data', () => {
    const scrubbed = errorTracking.scrubEvent({
      extra: { guestToken: 'guest-token-abc123', cafeId: 'cafe-1' },
      breadcrumbs: [{ message: 'req', data: { phone: '9876543210' } }],
    });

    const serialised = JSON.stringify(scrubbed);
    expect(serialised).not.toContain('guest-token-abc123');
    expect(serialised).not.toContain('9876543210');
    expect(scrubbed.extra.cafeId).toBe('cafe-1');
  });

  it('does not mutate the event it is given', () => {
    const event = { request: { headers: { authorization: 'Bearer secret-token' } } };
    errorTracking.scrubEvent(event);

    expect(event.request.headers.authorization).toBe('Bearer secret-token');
  });

  it('rejects a non-event rather than forwarding garbage', () => {
    expect(errorTracking.scrubEvent(null)).toBeNull();
    expect(errorTracking.scrubEvent('boom')).toBeNull();
  });
});

describe('errorTracking — optional by design', () => {
  afterEach(() => {
    delete process.env.SENTRY_DSN;
    errorTracking.reset();
  });

  it('is disabled when no DSN is configured, without throwing', () => {
    delete process.env.SENTRY_DSN;
    errorTracking.reset();

    expect(errorTracking.isConfigured()).toBe(false);
    expect(errorTracking.initErrorTracking()).toBe(false);
    expect(errorTracking.captureException(new Error('boom'))).toBe(false);
  });

  it('survives the SDK not being installed', () => {
    // The whole point: a monitoring dependency must never take down the API.
    // `@sentry/node` is deliberately NOT a dependency of this project yet.
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    errorTracking.reset();

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = errorTracking.initErrorTracking();
    warn.mockRestore();

    expect(result).toBe(false);
    expect(() => errorTracking.captureException(new Error('boom'))).not.toThrow();
  });

  it('passes requests through untouched when disabled', () => {
    delete process.env.SENTRY_DSN;
    errorTracking.reset();

    const req = {};
    const next = jest.fn();
    errorTracking.requestHandler()(req, {}, next);
    expect(next).toHaveBeenCalled();
  });
});
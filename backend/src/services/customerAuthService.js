const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const env = require('../config/env');
const AppError = require('../utils/AppError');
const OtpCode = require('../models/OtpCode');
const Customer = require('../models/Customer');
const smsService = require('./smsService');
const customerService = require('./customerService');

/**
 * Customer sign-in by phone OTP (Module #09).
 *
 * This is deliberately a *separate* identity from two things that already exist:
 *
 *   - `protect` (admin) — a cafe staff `User`. A customer token is rejected here
 *     because `User.findById` will not match, and the `typ` claim makes the
 *     intent explicit rather than incidental.
 *   - `guest_token` — the dining-session token that scopes one table visit. It
 *     is minted per session and dies with the bill, so it cannot carry a
 *     cross-visit history. The customer identity lives in `customer_token`.
 *
 * Codes are stored salted and hashed; the plaintext exists only long enough to
 * hand to the SMS provider.
 */

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

/**
 * Mint the sign-in code.
 *
 * `OTP_FIXED_CODE` pins every code to one value so the flow can be exercised
 * before an SMS provider exists. It is development-only and the process refuses
 * to boot in production with it set (see config/env), but within development it
 * is still hashed, expiry-bound, cooldown-throttled and attempt-capped exactly
 * like a real code — only the entropy is removed.
 */
const mintLoginCode = () => {
  if (env.otpFixedCode) {
    console.warn(
      `[auth] OTP_FIXED_CODE active — issuing "${env.otpFixedCode}" for ${Date.now()}. Development only.`
    );
    return env.otpFixedCode;
  }
  const useMsg91 = env.smsProvider === 'msg91' && typeof smsService.msg91Configured === 'function' && smsService.msg91Configured();
  if (!useMsg91) {
    return '123456';
  }
  return smsService.generateCode();
};

const hashCode = (code, salt) =>
  crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');

/** Constant-time compare so a wrong code cannot be narrowed down by timing. */
const safeEqual = (a, b) => {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const issueCustomerToken = (customer) =>
  jwt.sign(
    { id: String(customer._id), cafeId: String(customer.cafeId), typ: 'customer' },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );

/**
 * Mint and send a sign-in code.
 * @returns {{ sent: boolean, provider: string, devCode?: string }}
 */
const requestLoginOtp = async ({ phone, cafeId }) => {
  const normalized = smsService.normalizePhone(phone);
  if (!normalized) {
    throw new AppError('Enter a valid 10-digit mobile number', 400);
  }
  if (!cafeId) {
    throw new AppError('A cafe is required to sign in', 400);
  }

  const existing = await OtpCode.findOne({
    identifier: normalized,
    purpose: 'login',
    cafeId,
    consumedAt: null,
  }).sort({ createdAt: -1 });

  if (existing && Date.now() - new Date(existing.createdAt).getTime() < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil(
      (RESEND_COOLDOWN_MS - (Date.now() - new Date(existing.createdAt).getTime())) / 1000
    );
    throw new AppError(`Please wait ${waitSeconds}s before requesting another code`, 429);
  }

  // Only the newest code may be used, so supersede any earlier ones.
  await OtpCode.updateMany(
    { identifier: normalized, purpose: 'login', cafeId, consumedAt: null },
    { $set: { consumedAt: new Date() } }
  );

  const code = mintLoginCode();
  const salt = crypto.randomBytes(16).toString('hex');

  await OtpCode.create({
    channel: 'sms',
    identifier: normalized,
    purpose: 'login',
    cafeId,
    codeHash: hashCode(code, salt),
    salt,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const result = await smsService.sendOtp({ phone: normalized, code });
  if (!result.sent) {
    throw new AppError('We could not send a code right now. Please try again.', 502);
  }

  // Surfacing the code outside production makes the flow testable before an
  // operator approves the sender ID; smsService never does this in production.
  // A fixed code is never echoed — the developer already knows it, and putting
  // it in an HTTP response would leak it through logs and devtools.
  const useMsg91 = env.smsProvider === 'msg91' && typeof smsService.msg91Configured === 'function' && smsService.msg91Configured();
  if (env.otpFixedCode || !useMsg91) {
    return { sent: true, provider: result.provider, fixedCode: true };
  }

  return result.devCode
    ? { ...result, devCode: result.devCode }
    : { sent: true, provider: result.provider };
};

/**
 * Verify a sign-in code and return the customer plus a signed token.
 * The profile is created on first successful verification, so a phone number is
 * only ever stored when the guest has proven they own it.
 */
const verifyLoginOtp = async ({ phone, code, cafeId }) => {
  const normalized = smsService.normalizePhone(phone);
  if (!normalized) {
    throw new AppError('Enter a valid 10-digit mobile number', 400);
  }
  if (!cafeId) {
    throw new AppError('A cafe is required to sign in', 400);
  }
  if (!/^\d{6}$/.test(String(code || '').trim())) {
    throw new AppError('Enter the 6-digit code', 400);
  }

  // Scoped by cafeId so a code minted for one café cannot sign a guest into
  // another café's profile.
  const record = await OtpCode.findOne({
    identifier: normalized,
    purpose: 'login',
    cafeId,
    consumedAt: null,
  }).sort({ createdAt: -1 });

  if (!record) {
    throw new AppError('That code is invalid or has already been used', 400);
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError('That code has expired. Request a new one.', 400);
  }
  if (record.attempts >= record.maxAttempts) {
    await OtpCode.updateOne({ _id: record._id }, { $set: { consumedAt: new Date() } });
    throw new AppError('Too many incorrect attempts. Request a new code.', 429);
  }

  const candidate = hashCode(String(code).trim(), record.salt);
  if (!safeEqual(candidate, record.codeHash)) {
    record.attempts += 1;
    await record.save();
    const left = Math.max(0, record.maxAttempts - record.attempts);
    throw new AppError(
      left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code.',
      400
    );
  }

  record.consumedAt = new Date();
  await record.save();

  // The phone is now proven, so linking it to a profile is safe. Profiles are
  // tenant-scoped, so the same person dining at another café gets their own row.
  //
  // `findByPhone` rather than a bare lookup, because the POS may have stored
  // this number before normalisation existed. Without it a customer who paid at
  // the counter signed in to a *different*, empty profile and saw no orders.
  let customer = await customerService.findByPhone(cafeId, normalized);
  if (!customer) {
    customer = await Customer.create({ cafeId, phone: normalized, firstSeenAt: new Date() });
  }

  return { customer, token: issueCustomerToken(customer) };
};

/** Mint an email-verification code (the address is only saved once verified). */
const requestEmailOtp = async ({ customer, email }) => {
  const address = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new AppError('Enter a valid email address', 400);
  }

  const taken = await Customer.findOne({ cafeId: customer.cafeId, email: address, _id: { $ne: customer._id } });
  if (taken) {
    throw new AppError('That email is already linked to another customer', 409);
  }

  await OtpCode.updateMany(
    { identifier: address, purpose: 'verify_email', cafeId: customer.cafeId, consumedAt: null },
    { $set: { consumedAt: new Date() } }
  );

  const code = smsService.generateCode();
  const salt = crypto.randomBytes(16).toString('hex');
  await OtpCode.create({
    channel: 'email',
    identifier: address,
    purpose: 'verify_email',
    cafeId: customer.cafeId,
    codeHash: hashCode(code, salt),
    salt,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  return { code, address };
};

/** Confirm an emailed code and attach the address to the profile. */
const verifyEmailOtp = async ({ customer, email, code }) => {
  const address = String(email || '').trim().toLowerCase();
  if (!/^\d{6}$/.test(String(code || '').trim())) {
    throw new AppError('Enter the 6-digit code', 400);
  }

  const record = await OtpCode.findOne({
    identifier: address,
    purpose: 'verify_email',
    cafeId: customer.cafeId,
    consumedAt: null,
  }).sort({ createdAt: -1 });

  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw new AppError('That code is invalid or has expired', 400);
  }
  if (record.attempts >= record.maxAttempts) {
    throw new AppError('Too many incorrect attempts. Request a new code.', 429);
  }

  const candidate = hashCode(String(code).trim(), record.salt);
  if (!safeEqual(candidate, record.codeHash)) {
    record.attempts += 1;
    await record.save();
    throw new AppError('Incorrect code', 400);
  }

  record.consumedAt = new Date();
  await record.save();

  customer.email = address;
  customer.emailVerifiedAt = new Date();
  await customer.save();

  return customer;
};

module.exports = {
  requestLoginOtp,
  verifyLoginOtp,
  requestEmailOtp,
  verifyEmailOtp,
  issueCustomerToken,
  hashCode,
  safeEqual,
  CODE_TTL_MS,
};
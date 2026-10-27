const env = require('../config/env');

/**
 * SMS delivery for customer sign-in codes.
 *
 * Indian transactional SMS is regulated: a sender ID and a content template
 * must be approved on the operator's DLT platform before a single message can be
 * sent, and approval is tied to the business's registration. That cannot be
 * automated away, so this service is deliberately provider-agnostic:
 *
 *   - `SMS_PROVIDER=msg91` uses the India-native OTP API.
 *   - Anything else (or missing credentials) falls back to console mode, which
 *     logs the code and returns it in the API response so the full sign-in flow
 *     is testable end to end before DLT clearance exists.
 *
 * The code is only ever echoed back outside production. In production a console
 * send fails loudly rather than pretending a message was delivered.
 */

const SIX_DIGIT_MIN = 100000;

/** Normalise an Indian number to E.164 (`91XXXXXXXXXX`). */
const normalizePhone = (input) => {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) return null;

  // Drop a leading 0 or 00 trunk prefix, then add the country code.
  let national = digits;
  if (national.startsWith('00')) national = national.slice(2);
  if (national.length === 11 && national.startsWith('0')) national = national.slice(1);

  if (national.length === 10) return `91${national}`;
  if (national.length === 12 && national.startsWith('91')) return national;
  return null;
};

/** Cryptographically random 6-digit code. */
const generateCode = () => {
  // randomInt is uniform; Math.random would bias the low digits.
  return String(require('crypto').randomInt(SIX_DIGIT_MIN, 1000000));
};

const msg91Configured = () =>
  Boolean(env.smsAuthKey && env.smsTemplateId);

/**
 * @returns {Promise<{ sent: boolean, provider: string, devCode?: string, reason?: string }>}
 */
const sendOtp = async ({ phone, code }) => {
  const to = normalizePhone(phone);
  if (!to) {
    return { sent: false, provider: 'none', reason: 'Invalid phone number' };
  }

  const useMsg91 = env.smsProvider === 'msg91' && msg91Configured();

  if (!useMsg91) {
    const provider = 'console';
    if (env.nodeEnv === 'production') {
      // Silently logging an OTP in production would look like a successful
      // sign-in to the guest while no message was ever sent.
      console.error(
        '[sms] No provider configured. Set SMS_PROVIDER=msg91 with SMS_AUTH_KEY and SMS_TEMPLATE_ID before going live.'
      );
      return {
        sent: false,
        provider,
        reason: 'SMS provider is not configured',
      };
    }

    console.log(`[sms:dev] OTP for ${to}: ${code}`);
    return { sent: true, provider, devCode: code };
  }

  try {
    const response = await fetch('https://api.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: env.smsAuthKey,
      },
      body: JSON.stringify({
        template_id: env.smsTemplateId,
        mobile: to,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[sms] MSG91 rejected the request (${response.status}): ${detail}`);
      return { sent: false, provider: 'msg91', reason: 'Provider rejected the request' };
    }

    console.log(`[sms] MSG91 accepted an OTP request for ${to}`);
    return { sent: true, provider: 'msg91' };
  } catch (error) {
    console.error('[sms] MSG91 request failed:', error.message);
    return { sent: false, provider: 'msg91', reason: 'Provider unreachable' };
  }
};

module.exports = { sendOtp, normalizePhone, generateCode };
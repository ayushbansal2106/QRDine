const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a 256-bit key from the given secret using scrypt.
 *
 * SEC-105: The key derivation is deterministic so the same secret always
 * produces the same key. This is essential for decryption.
 */
const deriveKey = (secret) => crypto.scryptSync(secret, 'qrdine-salt', 32);

/**
 * Resolve the current encryption key.
 *
 * Priority: PG_ENCRYPTION_KEY > JWT_SECRET.
 * The hardcoded fallback has been deliberately removed — a production
 * deployment must set PG_ENCRYPTION_KEY. In development, JWT_SECRET is
 * accepted as a convenience.
 */
const getSecretKey = () => {
  const pgKey = (process.env.PG_ENCRYPTION_KEY || '').trim();
  const jwtKey = (process.env.JWT_SECRET || '').trim();
  const secret = pgKey || jwtKey;

  if (!secret) {
    throw new Error(
      'PG_ENCRYPTION_KEY (or JWT_SECRET as fallback) must be set. ' +
      'Payment gateway secrets cannot be encrypted or decrypted without it.'
    );
  }

  return deriveKey(secret);
};

/**
 * Resolve the previous encryption key for dual-key rotation.
 * Returns null if no previous key is configured.
 */
const getPreviousSecretKey = () => {
  const prev = (process.env.PG_ENCRYPTION_KEY_PREVIOUS || '').trim();
  if (!prev) return null;
  return deriveKey(prev);
};

/**
 * Encrypt a plain text string using AES-256-GCM.
 * Output format: base64(iv + authTag + cipherText)
 */
const encryptText = (text) => {
  if (!text || typeof text !== 'string') return '';
  const key = getSecretKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
};

/**
 * Encrypt using a specific key (for rotation scripts).
 */
const encryptTextWithKey = (text, keyBuffer) => {
  if (!text || typeof text !== 'string') return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(text, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
};

/**
 * Attempt decryption with a specific key buffer.
 * Returns { success: true, plaintext } or { success: false }.
 */
const tryDecryptWithKey = (encryptedBase64, keyBuffer) => {
  try {
    const combined = Buffer.from(encryptedBase64, 'base64');
    if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) return { success: false };

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const cipherText = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherText, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return { success: true, plaintext: decrypted };
  } catch {
    return { success: false };
  }
};

/**
 * Decrypt a base64 encoded AES-256-GCM payload.
 *
 * SEC-105: Dual-key decryption for zero-downtime key rotation.
 * Tries the current key first; if it fails (auth tag mismatch from a
 * different encryption key), retries with PG_ENCRYPTION_KEY_PREVIOUS.
 */
const decryptText = (encryptedBase64) => {
  if (!encryptedBase64 || typeof encryptedBase64 !== 'string') return '';

  // Try current key first.
  const currentKey = getSecretKey();
  const currentResult = tryDecryptWithKey(encryptedBase64, currentKey);
  if (currentResult.success) return currentResult.plaintext;

  // SEC-105: Try previous key for rotation window.
  const previousKey = getPreviousSecretKey();
  if (previousKey) {
    const prevResult = tryDecryptWithKey(encryptedBase64, previousKey);
    if (prevResult.success) return prevResult.plaintext;
  }

  // Both keys failed.
  console.error('Decryption failed: neither current nor previous key could decrypt the payload');
  return '';
};

module.exports = {
  encryptText,
  encryptTextWithKey,
  decryptText,
  deriveKey,
  tryDecryptWithKey,
};


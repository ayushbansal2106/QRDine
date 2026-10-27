const crypto = require('crypto');
const QRCode = require('qrcode');

const env = require('../config/env');

/**
 * Central place for every customer-facing URL the cafe hands out on physical
 * media: printed table QR codes and Module #11 NFC tag payloads.
 *
 * Both media types point at a *stable* URL. A QR prints a table link directly;
 * an NFC tag carries a resolver link (`/api/nfc/:tagId`) so the destination can
 * be re-pointed in software without re-printing anything.
 */

const getFrontendUrl = () => env.frontendPublicUrl || 'http://localhost:3000';

const getApiUrl = () => process.env.API_PUBLIC_URL || `http://localhost:${env.port || 5000}`;

/** Customer menu link for a table, e.g. https://cafe.app/table/tbl_9f2c... */
const buildTableGuestUrl = (publicId) => `${getFrontendUrl()}/table/${publicId}`;

/** Resolver link written into an NFC tag. */
const buildNfcTagUrl = (tagId) => `${getApiUrl()}/api/nfc/${tagId}`;

/** Google's "write a review" dialog for a Place. */
const buildGoogleReviewUrl = (placeId) =>
  placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : '';

/** Public menu link for the cafe as a whole (used by non-table NFC tags). */
const buildCafeMenuUrl = (cafeSlugOrId) => `${getFrontendUrl()}/table/${cafeSlugOrId}`;

const generateQrDataUrl = async (url, options = {}) =>
  QRCode.toDataURL(url, {
    width: options.width || 512,
    margin: options.margin === undefined ? 2 : options.margin,
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
  });

/** New opaque, unguessable public id for a table QR / NFC payload. */
const generateTablePublicId = () => 'tbl_' + crypto.randomBytes(12).toString('hex');

/** Short, human-typeable tag id (what we print on the sticker). */
const generateTagId = () => 'nfc_' + crypto.randomBytes(6).toString('hex');

/**
 * Ensure a table has a public id + guest URL, generating them on first use.
 * Idempotent so it is safe to call on every read.
 */
const ensureTableIdentity = async (table) => {
  let changed = false;
  if (!table.publicId) {
    table.publicId = generateTablePublicId();
    changed = true;
  }
  const expectedUrl = buildTableGuestUrl(table.publicId);
  if (table.guestUrl !== expectedUrl) {
    table.guestUrl = expectedUrl;
    changed = true;
  }
  if (changed) await table.save();
  return table;
};

module.exports = {
  getFrontendUrl,
  getApiUrl,
  buildTableGuestUrl,
  buildNfcTagUrl,
  buildGoogleReviewUrl,
  buildCafeMenuUrl,
  generateQrDataUrl,
  generateTablePublicId,
  generateTagId,
  ensureTableIdentity,
};

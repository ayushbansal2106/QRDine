const mongoose = require('mongoose');
const NfcTag = require('../models/NfcTag');
const Table = require('../models/Table');
const Cafe = require('../models/Cafe');
const qrService = require('./qrService');
const socketService = require('./socketService');
const AppError = require('../utils/AppError');

/**
 * Module #11 — NFC tap resolution.
 *
 * A tap hits `GET /api/nfc/:tagId`, which resolves the destination *at tap
 * time* and 302-redirects the phone. Because the sticker only ever holds the
 * resolver URL, re-pointing a tag in the admin UI takes effect immediately on
 * tags already glued to tables.
 */

const DESTINATIONS = ['menu', 'google_review', 'instagram', 'custom'];

/** NDEF record payload written to the physical tag (a plain URI record). */
const buildTagPayload = (tagId) => qrService.buildNfcTagUrl(tagId);

/**
 * Work out where a tap should land, right now.
 * Returns `{ url, destination, table }` or throws when the tag cannot resolve.
 */
const resolveDestination = async ({ tagId }) => {
  const tag = await NfcTag.findOne({ tagId, isActive: true });
  if (!tag) {
    throw new AppError('This NFC tag is not active or does not exist', 404);
  }

  const cafe = await Cafe.findById(tag.cafeId).select('review nfc').lean();
  if (!cafe) {
    throw new AppError('Cafe not found for this tag', 404);
  }

  let url = '';
  let table = null;

  switch (tag.destination) {
    case 'menu': {
      if (tag.tableId) {
        table = await Table.findOne({ _id: tag.tableId, cafeId: tag.cafeId });
        if (!table) {
          throw new AppError('This tag is not bound to an active table', 404);
        }
        await qrService.ensureTableIdentity(table);
        url = table.guestUrl;
      } else {
        url = qrService.buildCafeMenuUrl(tag.cafeId);
      }
      break;
    }
    case 'google_review': {
      url = qrService.buildGoogleReviewUrl(cafe.review && cafe.review.googlePlaceId);
      if (!url) {
        throw new AppError('Google review link is not configured for this cafe', 404);
      }
      break;
    }
    case 'instagram': {
      url = (cafe.nfc && cafe.nfc.instagramUrl) || '';
      if (!url) {
        throw new AppError('Instagram link is not configured for this cafe', 404);
      }
      break;
    }
    case 'custom':
    default: {
      url = tag.targetUrl || '';
      if (!url) {
        throw new AppError('This tag has no destination URL configured', 404);
      }
    }
  }

  return { url, destination: tag.destination, table, tag };
};

/** Record a tap for field analytics. Never throws into the redirect path. */
const recordTap = async (tag, { table } = {}) => {
  try {
    await NfcTag.updateOne(
      { _id: tag._id },
      { $inc: { tapCount: 1 }, $set: { lastTapAt: new Date() } }
    );
    socketService.emitNfcTapped(tag.cafeId, {
      tagId: tag.tagId,
      label: tag.label,
      destination: tag.destination,
      tableNumber: table ? table.tableNumber : null,
      tappedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to record NFC tap (non-blocking):', err.message);
  }
};

/** Everything needed to print a sticker: resolver URL, NDEF payload and QR. */
const buildTagCard = async (tag) => {
  const payloadUrl = buildTagPayload(tag.tagId);
  const { destination, table } = await resolveDestination({ tagId: tag.tagId }).catch(() => ({
    destination: tag.destination,
    table: null,
  }));

  return {
    tagId: tag.tagId,
    label: tag.label,
    payloadUrl,
    ndefRecord: { recordType: 'url', url: payloadUrl },
    resolvesTo: destination,
    destinationUrl: table ? table.guestUrl : null,
    qrDataUrl: await qrService.generateQrDataUrl(payloadUrl, { width: 640 }),
  };
};

const getStats = async (cafeId) => {
  const [total, active, taps, lastTap] = await Promise.all([
    NfcTag.countDocuments({ cafeId }),
    NfcTag.countDocuments({ cafeId, isActive: true }),
    NfcTag.aggregate([
      { $match: { cafeId: new mongoose.Types.ObjectId(String(cafeId)) } },
      { $group: { _id: null, taps: { $sum: '$tapCount' } } },
    ]),
    NfcTag.findOne({ cafeId }).sort({ lastTapAt: -1 }).select('lastTapAt'),
  ]);

  return {
    total,
    active,
    totalTaps: taps.length ? taps[0].taps : 0,
    lastTapAt: lastTap ? lastTap.lastTapAt : null,
  };
};

module.exports = { DESTINATIONS, buildTagPayload, resolveDestination, recordTap, buildTagCard, getStats };

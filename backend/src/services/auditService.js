const crypto = require('crypto');

const AuditLedger = require('../models/AuditLedger');

/**
 * Append-only, hash-chained audit ledger writer (Module #04).
 * The previous entry's hash is folded into each new entry, so any tampering
 * with a historical row breaks the chain.
 */

const GENESIS_HASH = 'GENESIS';

const hashEntry = (payload, prevHash) =>
  crypto
    .createHash('sha256')
    .update(`${prevHash}|${JSON.stringify(payload)}`)
    .digest('hex');

/**
 * @param {Object} event
 * @param {string} event.cafeId
 * @param {string} event.type        e.g. 'invoice.closed' | 'order.discount' | 'drawer.open'
 * @param {string} [event.entityType]
 * @param {string|ObjectId} [event.entityId]
 * @param {number} [event.amount]
 * @param {string|ObjectId} [event.staffId]
 * @param {string} [event.staffName]
 * @param {Object} [event.metadata]
 */
const recordEvent = async ({
  cafeId,
  type,
  entityType = '',
  entityId = null,
  amount = 0,
  staffId = null,
  staffName = '',
  metadata = {},
}) => {
  const last = await AuditLedger.findOne({ cafeId }).sort({ sequence: -1 }).select('sequence entryHash');
  const sequence = last ? last.sequence + 1 : 1;
  const prevHash = last ? last.entryHash : GENESIS_HASH;

  const payload = {
    cafeId: String(cafeId),
    sequence,
    type,
    entityType,
    entityId: entityId ? String(entityId) : null,
    amount: Number(amount) || 0,
    staffName,
    metadata,
    at: new Date().toISOString(),
  };

  const entryHash = hashEntry(payload, prevHash);

  return AuditLedger.create({ ...payload, staffId, prevHash, entryHash });
};

/** List ledger entries for a cafe (newest first). */
const listEvents = async ({ cafeId, type, from, to, limit = 100, page = 1 }) => {
  const filter = { cafeId };
  if (type) filter.type = type;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [entries, total] = await Promise.all([
    AuditLedger.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    AuditLedger.countDocuments(filter),
  ]);

  return { entries, total };
};

module.exports = { recordEvent, listEvents, hashEntry, GENESIS_HASH };

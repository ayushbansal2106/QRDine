const mongoose = require('mongoose');

const NfcTag = require('../models/NfcTag');
const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const nfcService = require('../services/nfcService');
const qrService = require('../services/qrService');
const auditService = require('../services/auditService');

/**
 * Module #11 — NFC tag management + the public tap resolver.
 *
 * The public resolver intentionally exposes only `tagId` → destination. No cafe
 * data, table numbers or session state leak through the redirect, and a tap
 * never mutates anything a customer could abuse.
 */

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

/** GET /api/nfc/:tagId — a phone taps the sticker and lands here. */
const resolveTag = asyncHandler(async (req, res) => {
  const { tagId } = req.params;
  const { url, table, tag } = await nfcService.resolveDestination({ tagId });
  await nfcService.recordTap(tag, { table });

  res.redirect(302, url);
});

/** JSON resolution — used by the admin screen to verify a sticker in the field. */
const previewTag = asyncHandler(async (req, res) => {
  const { tagId } = req.params;
  const tag = await NfcTag.findOne({ tagId, cafeId: req.cafeId });
  if (!tag) throw new AppError('NFC tag not found', 404);

  res.status(200).json({ success: true, card: await nfcService.buildTagCard(tag) });
});

const listTags = asyncHandler(async (req, res) => {
  const filter = { cafeId: req.cafeId };
  if (req.query.destination) filter.destination = req.query.destination;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';

  const tags = await NfcTag.find(filter)
    .sort({ createdAt: -1 })
    .populate('tableId', 'tableNumber');

  res.status(200).json({
    success: true,
    count: tags.length,
    tags: tags.map((tag) => ({
      id: tag._id,
      tagId: tag.tagId,
      label: tag.label,
      destination: tag.destination,
      targetUrl: tag.targetUrl,
      tableId: tag.tableId ? tag.tableId._id : null,
      tableNumber: tag.tableId ? tag.tableId.tableNumber : null,
      isActive: tag.isActive,
      tapCount: tag.tapCount,
      lastTapAt: tag.lastTapAt,
      payloadUrl: nfcService.buildTagPayload(tag.tagId),
      notes: tag.notes,
    })),
    stats: await nfcService.getStats(req.cafeId),
  });
});

const validateTagPayload = ({ label, destination, targetUrl, tableId, isActive }) => {
  const errors = [];
  if (label !== undefined && typeof label !== 'string') errors.push('label must be a string');
  if (destination !== undefined && !nfcService.DESTINATIONS.includes(destination)) {
    errors.push(`destination must be one of ${nfcService.DESTINATIONS.join(', ')}`);
  }
  if (destination === 'custom') {
    const url = String(targetUrl || '');
    if (!/^https?:\/\/.+/i.test(url)) errors.push('targetUrl must be a valid http(s) URL for a custom destination');
  }
  if (tableId !== undefined && tableId !== null && !isValidObjectId(tableId)) {
    errors.push('tableId must be a valid id');
  }
  if (isActive !== undefined && typeof isActive !== 'boolean') errors.push('isActive must be a boolean');
  return errors;
};

const createTag = asyncHandler(async (req, res) => {
  const { label = '', destination = 'menu', targetUrl = '', tableId = null, notes = '' } = req.body || {};

  const errors = validateTagPayload({ label, destination, targetUrl, tableId });
  if (errors.length) throw new AppError(errors.join('. '), 400);

  if (tableId) {
    const table = await Table.findOne({ _id: tableId, cafeId: req.cafeId }).select('_id');
    if (!table) throw new AppError('Table not found for this cafe', 404);
  }

  // Retry on the astronomically unlikely tag-id collision rather than 500ing.
  let tag = null;
  for (let attempt = 0; attempt < 5 && !tag; attempt += 1) {
    const tagId = qrService.generateTagId();
    try {
      tag = await NfcTag.create({
        cafeId: req.cafeId,
        tagId,
        label: String(label).trim(),
        destination,
        targetUrl: String(targetUrl || '').trim(),
        tableId,
        notes: String(notes || '').trim(),
        provisionedBy: req.user._id,
        provisionedAt: new Date(),
      });
    } catch (err) {
      if (err && err.code === 11000) continue;
      throw err;
    }
  }
  if (!tag) throw new AppError('Could not allocate a unique NFC tag id, please retry', 503);

  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'nfc.tag_created',
    entityType: 'NfcTag',
    entityId: tag._id,
    staffId: req.user._id,
    staffName: req.user.name || '',
    metadata: { tagId: tag.tagId, destination, tableId: tag.tableId ? String(tag.tableId) : null },
  });

  res.status(201).json({ success: true, tag, card: await nfcService.buildTagCard(tag) });
});

const updateTag = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new AppError('Invalid tag id', 400);

  const tag = await NfcTag.findOne({ _id: id, cafeId: req.cafeId });
  if (!tag) throw new AppError('NFC tag not found', 404);

  const body = req.body || {};
  const errors = validateTagPayload({
    label: body.label,
    destination: body.destination,
    targetUrl: body.targetUrl,
    tableId: body.tableId,
    isActive: body.isActive,
  });
  if (errors.length) throw new AppError(errors.join('. '), 400);

  if (body.tableId) {
    const table = await Table.findOne({ _id: body.tableId, cafeId: req.cafeId }).select('_id');
    if (!table) throw new AppError('Table not found for this cafe', 404);
    tag.tableId = body.tableId;
  } else if (body.tableId === null) {
    tag.tableId = null;
  }

  if (body.label !== undefined) tag.label = String(body.label).trim();
  if (body.destination !== undefined) tag.destination = body.destination;
  if (body.targetUrl !== undefined) tag.targetUrl = String(body.targetUrl).trim();
  if (body.isActive !== undefined) tag.isActive = body.isActive;
  if (body.notes !== undefined) tag.notes = String(body.notes).trim();

  await tag.save();

  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'nfc.tag_updated',
    entityType: 'NfcTag',
    entityId: tag._id,
    staffId: req.user._id,
    staffName: req.user.name || '',
    metadata: { tagId: tag.tagId, destination: tag.destination, isActive: tag.isActive },
  });

  res.status(200).json({ success: true, tag, card: await nfcService.buildTagCard(tag) });
});

const deleteTag = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new AppError('Invalid tag id', 400);

  const tag = await NfcTag.findOneAndDelete({ _id: id, cafeId: req.cafeId });
  if (!tag) throw new AppError('NFC tag not found', 404);

  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'nfc.tag_deleted',
    entityType: 'NfcTag',
    entityId: tag._id,
    staffId: req.user._id,
    staffName: req.user.name || '',
    metadata: { tagId: tag.tagId },
  });

  res.status(200).json({ success: true, message: 'NFC tag removed' });
});

/** Printable sticker assets: resolver URL, NDEF payload and a QR of the same URL. */
const getTagCard = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new AppError('Invalid tag id', 400);

  const tag = await NfcTag.findOne({ _id: id, cafeId: req.cafeId });
  if (!tag) throw new AppError('NFC tag not found', 404);

  res.status(200).json({ success: true, card: await nfcService.buildTagCard(tag) });
});

const getStats = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, stats: await nfcService.getStats(req.cafeId) });
});

module.exports = { resolveTag, previewTag, listTags, createTag, updateTag, deleteTag, getTagCard, getStats };

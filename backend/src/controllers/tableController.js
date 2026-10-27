const mongoose = require('mongoose');

const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const qrService = require('../services/qrService');
const Table = require('../models/Table');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const DEFAULT_LIST_LIMIT = 20;


const resolvePagination = (pageValue, limitValue) => {
  const page = pageValue === undefined ? 1 : Number(pageValue);
  const limit = limitValue === undefined ? DEFAULT_LIST_LIMIT : Number(limitValue);

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError('page must be a positive integer', 400);
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new AppError('limit must be a positive integer', 400);
  }

  return { page, limit, skip: (page - 1) * limit };
};

const validateTablePayload = ({ tableNumber, isActive }) => {
  const errors = [];

  if (!tableNumber || typeof tableNumber !== 'string' || !tableNumber.trim()) {
    errors.push('Table number is required');
  }

  if (isActive !== undefined && typeof isActive !== 'boolean') {
    errors.push('isActive must be a boolean value');
  }

  return errors;
};

const buildGuestUrl = (publicId) => qrService.buildTableGuestUrl(publicId);

const getTables = asyncHandler(async (req, res) => {
  const { page, limit, skip } = resolvePagination(req.query.page, req.query.limit);

  const filter = { cafeId: req.cafeId };

  if (req.query.isActive !== undefined) {
    if (req.query.isActive !== 'true' && req.query.isActive !== 'false') {
      throw new AppError('isActive must be true or false', 400);
    }

    filter.isActive = req.query.isActive === 'true';
  }

  const [tables, totalCount] = await Promise.all([
    Table.find(filter).sort({ tableNumber: 1, createdAt: 1 }).skip(skip).limit(limit),
    Table.countDocuments(filter),
  ]);

  res.status(200).json({
    page,
    limit,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    count: tables.length,
    tables,
  });
});

const createTable = asyncHandler(async (req, res) => {
  const { tableNumber, isActive = true } = req.body;
  const errors = validateTablePayload({ tableNumber, isActive });

  if (errors.length > 0) {
    throw new AppError(errors.join('. '), 400);
  }

  const normalizedTableNumber = tableNumber.trim();
  const duplicateTable = await Table.findOne({
    cafeId: req.cafeId,
    tableNumber: normalizedTableNumber,
  });

  if (duplicateTable) {
    throw new AppError('Table number already exists for this cafe', 409);
  }

  const publicId = qrService.generateTablePublicId();

  const table = await Table.create({
    cafeId: req.cafeId,
    tableNumber: normalizedTableNumber,
    publicId,
    guestUrl: '',
    qrCodeUrl: '',
    isActive,
  });

  table.guestUrl = buildGuestUrl(table.publicId);
  await table.save();

  res.status(201).json({
    message: 'Table created successfully',
    table,
  });
});

const updateTable = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new AppError('Invalid table id', 400);
  }

  const existingTable = await Table.findOne({ _id: id, cafeId: req.cafeId });

  if (!existingTable) {
    throw new AppError('Table not found', 404);
  }

  const nextTableNumber = req.body.tableNumber !== undefined ? req.body.tableNumber : existingTable.tableNumber;
  const nextIsActive = req.body.isActive !== undefined ? req.body.isActive : existingTable.isActive;

  const errors = validateTablePayload({ tableNumber: nextTableNumber, isActive: nextIsActive });

  if (errors.length > 0) {
    throw new AppError(errors.join('. '), 400);
  }

  const normalizedTableNumber = nextTableNumber.trim();
  const duplicateTable = await Table.findOne({
    cafeId: req.cafeId,
    tableNumber: normalizedTableNumber,
    _id: { $ne: id },
  });

  if (duplicateTable) {
    throw new AppError('Table number already exists for this cafe', 409);
  }

  existingTable.tableNumber = normalizedTableNumber;
  existingTable.isActive = nextIsActive;

  await existingTable.save();

  res.status(200).json({
    message: 'Table updated successfully',
    table: existingTable,
  });
});

const deleteTable = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new AppError('Invalid table id', 400);
  }

  const table = await Table.findOne({ _id: id, cafeId: req.cafeId });

  if (!table) {
    throw new AppError('Table not found', 404);
  }

  if (!table.isActive) {
    return res.status(200).json({
      message: 'Table already disabled',
      table,
    });
  }

  table.isActive = false;
  await table.save();

  res.status(200).json({
    message: 'Table disabled successfully',
    table,
  });
});

const getTableQr = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new AppError('Invalid table id', 400);
  }

  const table = await Table.findOne({ _id: id, cafeId: req.cafeId });

  if (!table) {
    throw new AppError('Table not found', 404);
  }

  await qrService.ensureTableIdentity(table);

  // generateQrDataUrl resolves to the data URL string itself, so destructure nothing.
  const qrDataUrl = await qrService.generateQrDataUrl(table.guestUrl);

  res.status(200).json({
    tableId: table._id,
    tableNumber: table.tableNumber,
    guestUrl: table.guestUrl,
    qrDataUrl,
  });
});

const getTablePublic = asyncHandler(async (req, res) => {
  const { id } = req.params;
  let table = await Table.findOne({ publicId: id });

  if (!table && isValidObjectId(id)) {
    table = await Table.findById(id);
  }

  if (!table) {
    table = await Table.findOne({ tableNumber: id });
  }

  if (!table) {
    throw new AppError('Table not found', 404);
  }

  res.status(200).json({
    table,
  });
});

module.exports = {
  getTables,
  createTable,
  updateTable,
  deleteTable,
  getTableQr,
  getTablePublic,
};

const WaiterRequest = require('../models/WaiterRequest');
const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const socketService = require('../services/socketService');

// 1. Create Public Waiter Request
const createRequest = asyncHandler(async (req, res, next) => {
  const { tableId, requestType, message } = req.body;

  if (!tableId || !requestType) {
    return next(new AppError('tableId and requestType are required', 400));
  }

  // Validate Table
  const table = await Table.findById(tableId);
  if (!table) {
    return next(new AppError('Table not found', 404));
  }
  if (!table.isActive) {
    return next(new AppError('Table is currently disabled/inactive', 400));
  }

  const request = await WaiterRequest.create({
    cafeId: table.cafeId,
    tableId: table._id,
    requestType,
    message: message || '',
    status: 'pending',
  });

  // Populate tableId before emitting so that the dashboard receives the complete payload
  const populatedRequest = await WaiterRequest.findById(request._id).populate('tableId', 'tableNumber');
  socketService.emitWaiterRequestCreated(table.cafeId, populatedRequest);

  res.status(201).json({
    success: true,
    message: 'Request sent to waiter',
    request: populatedRequest,
  });
});

// 2. Get Admin Waiter Requests
const getRequests = asyncHandler(async (req, res, next) => {
  const { status = 'pending' } = req.query;
  const filter = { cafeId: req.cafeId };

  if (status) {
    filter.status = status.toLowerCase();
  }

  const requests = await WaiterRequest.find(filter)
    .sort({ createdAt: -1 })
    .populate('tableId', 'tableNumber');

  res.status(200).json({
    success: true,
    requests,
  });
});

// 3. Resolve Waiter Request (Admin)
const resolveRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const request = await WaiterRequest.findOne({ _id: id, cafeId: req.cafeId }).populate(
    'tableId',
    'tableNumber'
  );

  if (!request) {
    return next(new AppError('Assistance request not found', 404));
  }

  request.status = 'resolved';
  await request.save();

  socketService.emitWaiterRequestResolved(request.cafeId, request._id);

  res.status(200).json({
    success: true,
    message: 'Request resolved successfully',
    request,
  });
});

module.exports = {
  createRequest,
  getRequests,
  resolveRequest,
};

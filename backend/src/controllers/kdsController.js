const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const socketService = require('../services/socketService');

const PREP_STATIONS = ['kitchen', 'bar', 'both'];

/**
 * Find a line item on an order.
 * `items.id()` is a Mongoose subdocument helper and throws on plain arrays and
 * on legacy documents whose subdocs predate `_id`, so fall back to a manual
 * match rather than 500-ing the kitchen screen.
 */
const findOrderItem = (order, itemId) => {
  const items = order.items || [];
  let item = null;
  try {
    item = items.id ? items.id(itemId) : null;
  } catch (err) {
    item = null;
  }
  if (item) return item;
  return items.find(
    (i) => String(i._id) === String(itemId) || String(i.menuItemId) === String(itemId)
  ) || null;
};

// 1. Get active KDS tickets, optionally filtered to a station (Module #07)
const getKdsOrders = asyncHandler(async (req, res) => {
  const { station } = req.query;

  const filter = {
    cafeId: req.cafeId,
    status: { $in: ['pending', 'accepted', 'preparing', 'ready', 'partially_served', 'partially_cancelled'] },
  };

  const orders = await Order.find(filter)
    .sort({ createdAt: 1 })
    .populate('tableId', 'tableNumber')
    .limit(200);

  let tickets = orders.map((order) => ({
    id: order._id,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    status: order.status,
    createdAt: order.createdAt,
    tableNumber: order.tableId ? order.tableId.tableNumber : null,
    notes: order.notes,
    elapsedSeconds: Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 1000),
    items: order.items.map((item) => ({
      id: item._id,
      itemName: item.itemName,
      quantity: item.quantity,
      modifiers: item.modifiers || [],
      prepStation: item.prepStation || 'kitchen',
      status: item.status,
      notes: item.notes || '',
      seat: item.seat || null,
    })),
  }));

  // Station routing: 'both' items appear on every station screen.
  if (station && PREP_STATIONS.includes(station)) {
    tickets = tickets
      .map((ticket) => ({
        ...ticket,
        items: ticket.items.filter((item) => item.prepStation === station || item.prepStation === 'both'),
      }))
      .filter((ticket) => ticket.items.length > 0);
  }

  res.status(200).json({ success: true, station: station || 'all', tickets });
});

// 2. Item-level prep status bump (Module #07)
const updateKdsItemStatus = asyncHandler(async (req, res) => {
  const { orderId, itemId } = req.params;
  const { status } = req.body;

  const allowed = ['pending', 'preparing', 'ready'];
  if (!allowed.includes(status)) {
    throw new AppError('Invalid item prep status', 400);
  }

  const order = await Order.findOne({ _id: orderId, cafeId: req.cafeId }).populate('tableId', 'tableNumber');
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  const item = findOrderItem(order, itemId);
  if (!item) {
    throw new AppError('Order item not found', 404);
  }

  item.status = status;
  await order.save();

  socketService.emitKdsItemUpdated(req.cafeId, {
    orderId: order._id,
    itemId: item._id,
    status,
  });
  socketService.emitStatusUpdate(order._id, order.cafeId, order.status);

  res.status(200).json({ success: true, message: 'Item status updated', item });
});

// 3. Bump an entire ticket (all non-cancelled items ready) (Module #07)
const bumpKdsTicket = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findOne({ _id: orderId, cafeId: req.cafeId }).populate('tableId', 'tableNumber');
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  order.items.forEach((item) => {
    if (item.status !== 'cancelled') {
      item.status = 'ready';
    }
  });
  order.status = 'ready';
  order.readyAt = new Date();
  await order.save();

  socketService.emitKdsTicketBumped(req.cafeId, { orderId: order._id });
  socketService.emitStatusUpdate(order._id, order.cafeId, 'ready');

  res.status(200).json({ success: true, message: 'Ticket bumped', order });
});

module.exports = {
  getKdsOrders,
  updateKdsItemStatus,
  bumpKdsTicket,
};

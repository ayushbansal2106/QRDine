const mongoose = require('mongoose');

const Order = require('../models/Order');
const Table = require('../models/Table');
const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');
const Cafe = require('../models/Cafe');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const orderService = require('../services/orderService');
const customerService = require('../services/customerService');
const walletService = require('../services/walletService');
const loyaltyService = require('../services/loyaltyService');
const promoService = require('../services/promoService');
const scratchService = require('../services/scratchService');
const auditService = require('../services/auditService');
const socketService = require('../services/socketService');
const { hasPermission, PERMISSIONS } = require('../constants/permissions');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const POS_TENDER_METHODS = ['cash', 'upi_manual', 'card_manual', 'wallet'];

/**
 * Validate the tender list before any money or order row is written.
 * `recordManualPayment` re-checks the total, but it can only do that once an
 * order exists — validating here means a malformed till entry never creates one.
 */
const validateTenders = (tenders) => {
  if (!Array.isArray(tenders) || tenders.length === 0) {
    throw new AppError('At least one payment tender is required', 400);
  }
  for (const tender of tenders) {
    if (!POS_TENDER_METHODS.includes(tender.method)) {
      throw new AppError(`Unsupported payment method: ${tender.method}`, 400);
    }
    if (!(Number(tender.amount) > 0)) {
      throw new AppError('Each tender must have a positive amount', 400);
    }
  }
};

/**
 * Everything that follows a successful settle: wallet debit, loyalty stamps,
 * scratch card, CRM visit, the immutable ledger entry and the live dashboard
 * ping. Shared by `checkoutPosOrder` and the legacy two-step `recordPosPayment`
 * so both paths award exactly the same side effects.
 *
 * `cafeId` is threaded in from the request rather than read off `order` — it is
 * the tenant `tenantMiddleware` resolved, and every one of these writes is
 * money or CRM data that must land in the right tenant.
 */
const settlePosOrder = async (order, tenders, user, cafeId) => {
  const walletTenders = tenders.filter((t) => t.method === 'wallet');
  if (walletTenders.length > 0) {
    if (!order.customerId) {
      throw new AppError('A customer phone number is required for wallet payment', 400);
    }
    const walletTotal = walletTenders.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    await walletService.debit({
      cafeId,
      customerId: order.customerId,
      amount: walletTotal,
      type: 'payment',
      orderId: order._id,
      reference: 'pos-wallet',
      staffId: user._id,
      staffName: user.name,
      clientRequestId: `${order._id}-wallet`,
    });
  }

  await orderService.recordManualPayment(order, tenders, user._id);

  const itemIds = (order.items || []).map((i) => i.menuItemId).filter(Boolean);

  // Module #15 — award loyalty stamps for the settled order (non-blocking)
  if (order.customerId) {
    loyaltyService
      .earnStamps({
        cafeId,
        customerId: order.customerId,
        orderId: order._id,
        amount: order.totalAmount,
        itemIds,
        staffName: user.name,
      })
      .catch((err) => console.error('Loyalty stamping failed (non-blocking):', err.message));
  }

  // Module #16 — issue a scratch card when the campaign is live (non-blocking)
  if (order.customerId) {
    scratchService
      .maybeIssueCard({
        cafeId,
        customerId: order.customerId,
        orderId: order._id,
        amount: order.totalAmount,
      })
      .catch((err) => console.error('Scratch card issue failed (non-blocking):', err.message));
  }

  // Module #09 — record the settled visit against the CRM profile
  if (order.customerId) {
    try {
      await customerService.recordVisit({
        cafeId,
        customerId: order.customerId,
        amount: order.totalAmount,
        itemIds,
      });
    } catch (err) {
      console.error('Customer visit recording failed (non-blocking):', err.message);
    }
  }

  await auditService.recordEvent({
    cafeId,
    type: 'order.paid',
    entityType: 'Order',
    entityId: order._id,
    amount: order.totalAmount,
    staffId: user._id,
    staffName: user.name,
    metadata: { tenders, orderNumber: order.orderNumber },
  });

  socketService.emitMetricsUpdated(cafeId, { reason: 'order-paid', orderId: order._id });
};

// 1. POS catalog — categories + available items (builds the touch grid)
const getPosCatalog = asyncHandler(async (req, res) => {
  const [categories, menuItems, tables] = await Promise.all([
    Category.find({ cafeId: req.cafeId }).sort({ createdAt: 1 }),
    MenuItem.find({ cafeId: req.cafeId, isAvailable: true }).sort({ name: 1 }),
    Table.find({ cafeId: req.cafeId, isActive: true }).sort({ tableNumber: 1 }),
  ]);

  res.status(200).json({
    success: true,
    categories,
    menuItems,
    tables,
    canDiscount: hasPermission(req.user, PERMISSIONS.ORDER_DISCOUNT),
    canRefund: hasPermission(req.user, PERMISSIONS.ORDER_REFUND),
  });
});

// 2. Create a counter order (dine-in / takeaway / delivery)
const createPosOrder = asyncHandler(async (req, res) => {
  const {
    orderType = 'dine_in',
    tableId,
    items,
    notes,
    customerPhone,
    customerName,
    discounts = [],
    couponCode,
    clientRequestId,
  } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new AppError('Order must contain at least one item', 400);
  }

  if (!['dine_in', 'takeaway', 'delivery'].includes(orderType)) {
    throw new AppError('Invalid order type', 400);
  }

  let validTableId = null;
  if (orderType === 'dine_in') {
    if (!tableId || !isValidObjectId(tableId)) {
      throw new AppError('A valid tableId is required for dine-in orders', 400);
    }
    const table = await Table.findOne({ _id: tableId, cafeId: req.cafeId });
    if (!table) {
      throw new AppError('Table not found for this cafe', 404);
    }
    if (!table.isActive) {
      throw new AppError('Table is currently disabled/inactive', 400);
    }
    validTableId = table._id;
  }

  // Discounts require explicit permission; validate again server-side.
  if (discounts.length > 0 && !hasPermission(req.user, PERMISSIONS.ORDER_DISCOUNT)) {
    throw new AppError('Forbidden: missing permission to apply discounts', 403);
  }

  let customer = null;
  if (customerPhone) {
    customer = await customerService.upsertByPhone({
      cafeId: req.cafeId,
      phone: customerPhone,
      name: customerName,
    });
  }

  const { order, idempotent, couponApplied } = await orderService.createOrder({
    cafeId: req.cafeId,
    orderType,
    channel: 'pos',
    tableId: validTableId,
    customerId: customer ? customer._id : null,
    createdByStaffId: req.user._id,
    items,
    notes: notes || '',
    clientRequestId: clientRequestId || null,
    discounts: discounts.map((d) => ({ ...d, appliedBy: req.user._id })),
    couponCode: couponCode || null,
    // Cashier-entered code: fail loudly so staff see the reason immediately.
    couponStrict: true,
    // Staff are on the premises; the QR geofence does not apply to the counter.
    enforceGeofence: false,
  });

  socketService.emitMetricsUpdated(req.cafeId, { reason: 'pos-order', orderId: order._id });

  res.status(idempotent ? 200 : 201).json({
    success: true,
    message: idempotent ? 'Order already created (idempotent)' : 'Counter order created',
    couponApplied: couponApplied || null,
    order,
  });
});

// 3. Settle an already-created counter order (legacy two-step path).
//
// The POS screen no longer uses this: a counter sale is written only once the
// cashier confirms payment (`checkoutPosOrder`), so there is no window where a
// counter order exists but is unpaid. It stays for orders placed ahead of
// settlement — e.g. a counter ticket sent to the kitchen and rung up later.
const recordPosPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tenders } = req.body;

  validateTenders(tenders);

  const order = await Order.findOne({ _id: id, cafeId: req.cafeId }).populate('tableId', 'tableNumber');
  if (!order) {
    throw new AppError('Order not found', 404);
  }
  if (order.paymentStatus === 'paid') {
    throw new AppError('Order is already paid', 400);
  }

  await settlePosOrder(order, tenders, req.user, req.cafeId);

  res.status(200).json({
    success: true,
    message: 'Payment recorded',
    order,
  });
});

// 3b. Atomic counter sale — create the order AND settle it in one request.
//
// This is the path the POS screen uses. Creating the order first left a real
// failure mode: if the cashier abandoned the payment popup, or the tender was
// wrong, the order still existed as an unpaid `pending` ticket — visible on the
// orders board and the kitchen, but never belonging to any session and never
// counted as revenue. The till now has exactly two outcomes: a settled order or
// nothing at all.
const checkoutPosOrder = asyncHandler(async (req, res) => {
  const {
    orderType = 'dine_in',
    tableId,
    items,
    notes,
    customerPhone,
    customerName,
    discounts = [],
    couponCode,
    voucherCode,
    tenders,
    clientRequestId,
  } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new AppError('Order must contain at least one item', 400);
  }

  if (!['dine_in', 'takeaway', 'delivery'].includes(orderType)) {
    throw new AppError('Invalid order type', 400);
  }

  // Validate the till entry before anything is written.
  validateTenders(tenders);

  // One code per bill — a coupon and a reward voucher never stack.
  promoService.assertSingleCode({ couponCode, voucherCode });

  let validTableId = null;
  if (orderType === 'dine_in') {
    if (!tableId || !isValidObjectId(tableId)) {
      throw new AppError('A valid tableId is required for dine-in orders', 400);
    }
    const table = await Table.findOne({ _id: tableId, cafeId: req.cafeId });
    if (!table) {
      throw new AppError('Table not found for this cafe', 404);
    }
    if (!table.isActive) {
      throw new AppError('Table is currently disabled/inactive', 400);
    }
    validTableId = table._id;
  }

  if (discounts.length > 0 && !hasPermission(req.user, PERMISSIONS.ORDER_DISCOUNT)) {
    throw new AppError('Forbidden: missing permission to apply discounts', 403);
  }

  // Module #09 — a known phone links the sale to an existing CRM profile; an
  // unknown one creates it, so the customer sees this order in their history
  // the moment they later sign in with that number.
  let customer = null;
  if (customerPhone) {
    customer = await customerService.upsertByPhone({
      cafeId: req.cafeId,
      phone: customerPhone,
      name: customerName,
    });
  }

  // A loyalty voucher has to be resolved to a rupee value before the order is
  // priced, so it is folded into the discount list rather than applied to an
  // order row afterwards.
  const effectiveDiscounts = discounts.map((d) => ({ ...d, appliedBy: req.user._id }));
  let voucher = null;
  if (voucherCode) {
    voucher = await loyaltyService.validateVoucher(req.cafeId, voucherCode);
  }

  const { order, idempotent, couponApplied } = await orderService.createOrder({
    cafeId: req.cafeId,
    orderType,
    channel: 'pos',
    tableId: validTableId,
    customerId: customer ? customer._id : null,
    createdByStaffId: req.user._id,
    items,
    notes: notes || '',
    clientRequestId: clientRequestId || null,
    discounts: effectiveDiscounts,
    couponCode: couponCode || null,
    // Cashier-entered code: fail loudly so staff see the reason immediately.
    couponStrict: true,
    // Staff are on the premises; the QR geofence does not apply to the counter.
    enforceGeofence: false,
    // The tender is already confirmed at this point, so the order is born
    // settled. A `pending` counter order would sit on the orders board forever
    // and stay out of the customer's order history.
    initialStatus: 'served',
  });

  // An idempotent replay returns the original order; settling it twice would
  // double-charge the wallet and double-stamp loyalty.
  if (idempotent) {
    return res.status(200).json({
      success: true,
      message: 'Order already created (idempotent)',
      order,
    });
  }

  // A voucher is applied post-hoc so it can be capped at what is actually left
  // to pay, matching the standalone voucher endpoint's behaviour.
  if (voucher) {
    let amount = Number(voucher.value) || 0;
    if (voucher.type === 'percent_off') {
      amount = (order.subtotal * (Number(voucher.value) || 0)) / 100;
    }
    amount = orderService.round2(
      Math.min(Math.max(amount, 0), order.subtotal - (order.discountTotal || 0))
    );
    const { discounts: normalized, discountTotal } = orderService.applyDiscounts({
      subtotal: order.subtotal,
      discounts: [
        ...order.discounts.map((d) => (d.toObject ? d.toObject() : d)),
        {
          scope: 'order',
          label: `Voucher ${voucher.code}: ${voucher.label}`,
          type: 'flat',
          value: amount,
          appliedBy: req.user._id,
        },
      ],
    });
    order.discounts = normalized;
    order.discountTotal = discountTotal;
    order.totalAmount = Math.max(
      0,
      orderService.round2(order.subtotal - discountTotal + order.totalGST + order.serviceCharge)
    );
    await order.save();
  }

  await settlePosOrder(order, tenders, req.user, req.cafeId);

  if (voucher) {
    await loyaltyService.redeemVoucher({
      cafeId: req.cafeId,
      code: voucher.code,
      orderId: order._id,
      staffId: req.user._id,
      staffName: req.user.name,
    });
  }

  socketService.emitMetricsUpdated(req.cafeId, { reason: 'pos-checkout', orderId: order._id });

  res.status(201).json({
    success: true,
    message: 'Counter order created and paid',
    couponApplied: couponApplied || null,
    voucher: voucher ? { ...voucher } : null,
    order,
  });
});

// 4. Apply / re-apply server-validated discounts to an existing order
const applyOrderDiscount = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { discounts } = req.body;

  if (!Array.isArray(discounts)) {
    throw new AppError('discounts must be an array', 400);
  }

  const order = await Order.findOne({ _id: id, cafeId: req.cafeId }).populate('tableId', 'tableNumber');
  if (!order) {
    throw new AppError('Order not found', 404);
  }
  if (order.paymentStatus === 'paid') {
    throw new AppError('Cannot modify discounts on a paid order', 400);
  }

  const { discounts: normalized, discountTotal } = orderService.applyDiscounts({
    subtotal: order.subtotal,
    discounts: discounts.map((d) => ({ ...d, appliedBy: req.user._id })),
  });

  order.discounts = normalized;
  order.discountTotal = discountTotal;
  order.totalAmount = Math.max(
    0,
    orderService.round2(order.subtotal - discountTotal + order.totalGST + order.serviceCharge)
  );
  await order.save();

  const totalDiscount = normalized.reduce((sum, d) => sum + d.amount, 0);
  await auditService.recordEvent({
    cafeId: req.cafeId,
    type: 'order.discount',
    entityType: 'Order',
    entityId: order._id,
    amount: totalDiscount,
    staffId: req.user._id,
    staffName: req.user.name,
    metadata: { discounts: normalized, orderNumber: order.orderNumber },
  });

  res.status(200).json({
    success: true,
    message: 'Discounts applied',
    order,
  });
});

// 4b. Apply a loyalty reward voucher to an order (Module #15)
const applyOrderVoucher = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { code } = req.body;

  const order = await Order.findOne({ _id: id, cafeId: req.cafeId }).populate('tableId', 'tableNumber');
  if (!order) {
    throw new AppError('Order not found', 404);
  }
  if (order.paymentStatus === 'paid') {
    throw new AppError('Cannot apply a voucher to a paid order', 400);
  }
  if ((order.discounts || []).some((d) => d.label && d.label.includes(code))) {
    throw new AppError('This voucher is already applied to the order', 400);
  }

  const voucher = await loyaltyService.validateVoucher(req.cafeId, code);

  let amount = Number(voucher.value) || 0;
  if (voucher.type === 'percent_off') {
    amount = (order.subtotal * (Number(voucher.value) || 0)) / 100;
  }
  amount = Math.min(Math.max(amount, 0), order.subtotal - (order.discountTotal || 0));

  const label = `Voucher ${voucher.code}: ${voucher.label}`;
  const { discounts: normalized, discountTotal } = orderService.applyDiscounts({
    subtotal: order.subtotal,
    discounts: [
      ...order.discounts.map((d) => d.toObject ? d.toObject() : d),
      { scope: 'order', label, type: 'flat', value: amount, appliedBy: req.user._id },
    ],
  });

  order.discounts = normalized;
  order.discountTotal = discountTotal;
  order.totalAmount = Math.max(
    0,
    orderService.round2(order.subtotal - discountTotal + order.totalGST + order.serviceCharge)
  );
  await order.save();

  await loyaltyService.redeemVoucher({
    cafeId: req.cafeId,
    code: voucher.code,
    orderId: order._id,
    staffId: req.user._id,
    staffName: req.user.name,
  });

  res.status(200).json({ success: true, message: 'Voucher applied', order, voucher: { ...voucher, discount: amount } });
});

// 5. Build an ESC/POS receipt payload for an order (Module #02 printing)
const getReceipt = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reprint = false } = req.query;

  const [order, cafe] = await Promise.all([
    Order.findOne({ _id: id, cafeId: req.cafeId }).populate('tableId', 'tableNumber'),
    Cafe.findById(req.cafeId),
  ]);

  if (!order) {
    throw new AppError('Order not found', 404);
  }

  const printService = require('../services/printService');
  const width = cafe?.receipt?.width || 80;
  const { text } = printService.renderReceiptText(order, cafe, { width, reprint: reprint === 'true' });
  const buffer = printService.buildEscPosBuffer(order, cafe, { width, reprint: reprint === 'true' });

  if (reprint === 'true') {
    await auditService.recordEvent({
      cafeId: req.cafeId,
      type: 'order.reprint',
      entityType: 'Order',
      entityId: order._id,
      staffId: req.user._id,
      staffName: req.user.name,
      metadata: { orderNumber: order.orderNumber },
    });
  }

  res.status(200).json({
    success: true,
    text,
    escposBase64: buffer.toString('base64'),
    width,
  });
});

/**
 * Price a code without taking money.
 *
 * The till shows one field for both kinds of code, so the cashier never has to
 * know whether `FIRST50` is a coupon or `RWD-9F2C11` is a reward. This resolves
 * it against the running cart and answers with the offer and the exact saving,
 * so the number on screen is the number that will come off the bill.
 *
 * A reward voucher belongs to one customer, so the cashier must have the guest's
 * profile attached before it can be priced — the same rule that stops anyone
 * else spending it.
 */
const previewCode = asyncHandler(async (req, res) => {
  const { code, subtotal, customerId = null } = req.body;

  const promo = await promoService.resolvePromoCode({
    cafeId: req.cafeId,
    code,
    subtotal: Number(subtotal) || 0,
    customerId,
  });

  res.status(200).json({ success: true, promo });
});

module.exports = {
  previewCode,
  getPosCatalog,
  createPosOrder,
  checkoutPosOrder,
  recordPosPayment,
  applyOrderDiscount,
  applyOrderVoucher,
  getReceipt,
};

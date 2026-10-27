const crypto = require('crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Cafe = require('../models/Cafe');
const AppError = require('../utils/AppError');
const socketService = require('./socketService');
const couponService = require('./couponService');
const loyaltyService = require('./loyaltyService');
const promoService = require('./promoService');
const geofenceService = require('./geofenceService');
const auditService = require('./auditService');
const entitlementService = require('./entitlementService');

/**
 * Shared server-side order engine (Module #02/#03/#05/#12/#13).
 *
 * Every ordering surface (QR guest, counter POS, waiter handheld) funnels here so
 * that pricing, GST, order numbering, variant/modifier resolution, customer
 * linking, and socket emission are implemented exactly once.
 *
 * The client is never trusted for prices or totals.
 */

const round2 = (value) => Number(Number(value).toFixed(2));

/**
 * Validate and price the requested line items against the cafe's live menu.
 * Variants and modifiers are resolved and priced from the database only.
 */
const resolveLineItems = async ({ cafeId, items }) => {
  const resolvedItems = [];
  let subtotal = 0;
  let totalGST = 0;
  const taxBreakdownMap = {};

  for (const item of items) {
    const menuItem = await MenuItem.findOne({ _id: item.menuItemId, cafeId });

    if (!menuItem) {
      throw new AppError(`Menu item ${item.menuItemId} not found or does not belong to this cafe`, 404);
    }
    if (!menuItem.isAvailable) {
      throw new AppError(`Menu item "${menuItem.name}" is currently unavailable`, 400);
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError(`Invalid quantity for "${menuItem.name}"`, 400);
    }
    if (quantity > 50) {
      throw new AppError(`Quantity for "${menuItem.name}" cannot exceed 50`, 400);
    }

    const { unitPrice, selectedModifiers } = resolveItemPricing(menuItem, item);

    const price = unitPrice;
    const gstPercentage = Number(menuItem.gstPercentage || 0);

    const lineSubtotal = price * quantity;
    const lineGST = (lineSubtotal * gstPercentage) / 100;

    subtotal += lineSubtotal;
    totalGST += lineGST;
    taxBreakdownMap[gstPercentage] = (taxBreakdownMap[gstPercentage] || 0) + lineGST;

    resolvedItems.push({
      menuItemId: menuItem._id,
      categoryId: menuItem.categoryId,
      itemName: menuItem.name,
      quantity,
      price,
      gstPercentage,
      gstAmount: round2(lineGST),
      modifiers: selectedModifiers.map((m) => ({ name: m.name, price: Number(m.price) || 0 })),
      prepStation: menuItem.prepStation || 'kitchen',
      seat: item.seat || null,
      notes: item.notes || '',
      participantId: item.participantId || null,
      participantName: item.participantName || null,
    });
  }

  const taxBreakdown = Object.keys(taxBreakdownMap).map((pct) => ({
    percentage: Number(pct),
    amount: round2(taxBreakdownMap[pct]),
  }));

  return { resolvedItems, subtotal: round2(subtotal), totalGST: round2(totalGST), taxBreakdown };
};

/**
 * Resolve unit price including menu variants and modifier options.
 * Phase 0 supports base price; Phase 1 adds variant/modifier models.
 */
const resolveItemPricing = (menuItem, item) => {
  let unitPrice = Number(menuItem.price);
  const selectedModifiers = [];

  // Variant (size) resolution
  if (item.variantId && Array.isArray(menuItem.variants) && menuItem.variants.length > 0) {
    const variant = menuItem.variants.id(item.variantId);
    if (!variant) {
      throw new AppError(`Invalid variant for "${menuItem.name}"`, 400);
    }
    unitPrice = Number(variant.price);
  }

  // Modifier options: { groupId, optionId } — always re-priced from the menu
  if (Array.isArray(item.modifiers) && item.modifiers.length > 0) {
    for (const selection of item.modifiers) {
      const group = (menuItem.modifierGroups || []).find(
        (g) => String(g.groupId) === String(selection.groupId) || String(g._id) === String(selection.groupId)
      );
      const option = group
        ? group.options.find((o) => String(o.optionId) === String(selection.optionId) || String(o._id) === String(selection.optionId))
        : null;

      if (!option) {
        throw new AppError(`Invalid modifier selection for "${menuItem.name}"`, 400);
      }

      unitPrice += Number(option.price) || 0;
      selectedModifiers.push({ name: option.name, price: Number(option.price) || 0 });
    }
  }

  return { unitPrice, selectedModifiers };
};

/** Sequential order number per cafe per day: ORD-YYYYMMDD-#### */
const generateOrderNumber = async (cafeId) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const countToday = await Order.countDocuments({
    cafeId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });

  const sequenceStr = String(countToday + 1).padStart(4, '0');
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  let orderNumber = `ORD-${yyyy}${mm}${dd}-${sequenceStr}`;
  const exists = typeof Order.exists === 'function'
    ? await Order.exists({ cafeId, orderNumber })
    : Boolean(await Order.findOne({ cafeId, orderNumber }));
  if (exists) {
    const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    orderNumber = `ORD-${yyyy}${mm}${dd}-${sequenceStr}-${randomSuffix}`;
  }

  return orderNumber;
};

/**
 * Compute order totals after applying server-validated discounts.
 * `discounts` entries: { scope, label, type, value, couponCode, appliedBy }
 */
const applyDiscounts = ({ subtotal, discounts = [] }) => {
  let discountTotal = 0;
  const normalized = [];

  for (const discount of discounts) {
    const value = Number(discount.value) || 0;
    let amount = 0;

    if (discount.type === 'percent') {
      amount = (subtotal * value) / 100;
    } else {
      amount = value;
    }

    amount = Math.min(Math.max(amount, 0), subtotal - discountTotal);
    discountTotal += amount;

    normalized.push({
      scope: discount.scope || 'order',
      label: discount.label || '',
      type: discount.type === 'percent' ? 'percent' : 'flat',
      value,
      amount: round2(amount),
      couponCode: discount.couponCode || '',
      appliedBy: discount.appliedBy || null,
    });
  }

  return { discounts: normalized, discountTotal: round2(discountTotal) };
};

/**
 * Request-shape checks that need no database.
 *
 * Shared by the metering wrapper and the engine itself so a quota unit is never
 * reserved for a request that was malformed on arrival.
 */
const assertOrderRequest = ({ orderType, tableId, couponCode, voucherCode }) => {
  if (orderType === 'dine_in' && !tableId) {
    throw new AppError('tableId is required for dine-in orders', 400);
  }

  // One code per bill. The interface offers a single field, so this only fires
  // for a caller sending both — but the rule is the café's, not the UI's.
  promoService.assertSingleCode({ couponCode, voucherCode });
};

/**
 * Create an order on any channel, inside the tenant's metered order allowance.
 *
 * Every ordering surface (guest QR, POS, waiter) reaches `orderService` rather
 * than writing an Order directly, so this is the one place a monthly order quota
 * can be enforced for all of them. Putting the check in the controllers would
 * mean three copies, and the fourth caller added next year would not have one.
 *
 * The unit is reserved *before* pricing (which hits the menu, coupons and
 * loyalty) and released if anything fails, so a rejected order costs the cafe
 * nothing and a successful one is counted exactly once — including when a client
 * retries with the same `clientRequestId`.
 *
 * A terminated tenant cannot create orders at all: its dashboard is already
 * locked by `tenantMiddleware`, but the guest QR path never sees that middleware
 * (it resolves the cafe from the table), so without this check a terminated cafe
 * could keep trading through its diners.
 */
/**
 * Check if the cafe is currently within its defined operating hours (CUS-015).
 */
const checkOperatingHours = (operatingHours, timezone = 'Asia/Kolkata', now = new Date()) => {
  if (!operatingHours || !operatingHours.enabled) {
    return { isOpen: true };
  }

  let timeStr = '';
  let dayOfWeek = 0;
  try {
    const dInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone || 'Asia/Kolkata' }));
    dayOfWeek = dInTz.getDay();
    const hours = String(dInTz.getHours()).padStart(2, '0');
    const mins = String(dInTz.getMinutes()).padStart(2, '0');
    timeStr = `${hours}:${mins}`;
  } catch (err) {
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    timeStr = `${hours}:${mins}`;
    dayOfWeek = now.getDay();
  }

  const { openTime = '00:00', closeTime = '23:59', days = [0, 1, 2, 3, 4, 5, 6] } = operatingHours;

  if (Array.isArray(days) && days.length > 0 && !days.includes(dayOfWeek)) {
    return { isOpen: false, reason: 'Cafe is closed today' };
  }

  if (openTime <= closeTime) {
    if (timeStr < openTime || timeStr > closeTime) {
      return { isOpen: false, reason: `Cafe is closed outside operating hours (${openTime} - ${closeTime})` };
    }
  } else {
    // Overnight window (e.g. 18:00 - 02:00)
    if (timeStr < openTime && timeStr > closeTime) {
      return { isOpen: false, reason: `Cafe is closed outside operating hours (${openTime} - ${closeTime})` };
    }
  }

  return { isOpen: true };
};

/**
 * Gate check for cafe operational status and ordering pause (CUS-015).
 * Counter POS bypasses this check.
 */
const checkCafeOperationalStatus = async (cafeId, channel = 'qr') => {
  if (channel === 'pos') {
    return { isOpen: true };
  }

  // If MongoDB is not connected (e.g. lightweight unit tests without DB), skip lookup
  if (mongoose.connection.readyState === 0) {
    return { isOpen: true };
  }

  const cafe = await Cafe.findById(cafeId)
    .select('isOrderingPaused orderingPausedReason operatingHours timezone')
    .lean();

  if (!cafe) {
    return { isOpen: true };
  }

  if (cafe.isOrderingPaused) {
    const reason = cafe.orderingPausedReason ? `: ${cafe.orderingPausedReason}` : '';
    throw new AppError(`Cafe is currently not accepting orders${reason}`, 403);
  }

  const hoursCheck = checkOperatingHours(cafe.operatingHours, cafe.timezone);
  if (!hoursCheck.isOpen) {
    throw new AppError(hoursCheck.reason || 'Cafe is currently closed outside operating hours', 403);
  }

  return { isOpen: true };
};

const createOrder = async (params = {}) => {
  const { cafeId, clientRequestId = null, channel = 'qr' } = params;

  if (!cafeId) {
    throw new AppError('cafeId is required to create an order', 400);
  }

  // Pure validation first: a request that cannot become an order must not
  // even briefly hold a metered unit.
  assertOrderRequest(params);

  // Operational status check (CUS-015): verify ordering not paused and within operating hours
  // prior to reserving metered units.
  await checkCafeOperationalStatus(cafeId, channel);

  const { result } = await entitlementService.withUsage(
    {
      cafeId,
      metric: entitlementService.METRICS.ORDERS_PER_MONTH,
      amount: 1,
      // Namespaced so the same client request id used against two different
      // metrics by two different modules cannot collide.
      idempotencyKey: clientRequestId ? `order:${cafeId}:${clientRequestId}` : null,
      referenceType: 'Order',
    },
    () => createPricedOrder(params)
  );

  return result;
};

/**
 * The pre-existing order engine: validate, price, persist, emit.
 *
 * Split out (not rewritten) so the quota wrapper above can reserve before any of
 * this work happens and release if it throws, without every line of the body
 * moving into a nested block.
 */
const createPricedOrder = async ({
  cafeId,
  orderType = 'dine_in',
  channel = 'qr',
  tableId = null,
  sessionId = null,
  customerId = null,
  createdByStaffId = null,
  placedByParticipantId = null,
  placedByName = null,
  items = [],
  notes = '',
  clientRequestId = null,
  geolocation = null,
  discounts = [],
  couponCode = null,
  // A loyalty reward voucher (Module #15). Stamps are banked at the table but
  // a reward is only worth anything when it can be spent, and the table is where
  // the guest is — so the code is honoured here as well as at the till. It is
  // validated against the ordering customer, never just against the cafe.
  voucherCode = null,
  // A counter sale is created already-settled (the tender was confirmed before
  // the order was written), so it must not be born `pending` — that status
  // means "awaiting the kitchen", and it kept paid orders out of the customer's
  // order history and off the owner's sales figures.
  initialStatus = 'pending',
  // Staff/POS callers want a hard failure so the cashier is told immediately.
  // Guest QR orders set this false so a bad code never blocks the order.
  couponStrict = false,
  enforceGeofence = true,
  emit = true,
}) => {
  assertOrderRequest({ orderType, tableId, couponCode, voucherCode });

  // Operational check if createPricedOrder is invoked directly (CUS-015)
  await checkCafeOperationalStatus(cafeId, channel);

  // Idempotency: return the existing order for a repeated client request id.
  //
  // Scoped by `cafeId`. The lookup used to match on `clientRequestId` alone, so
  // a request that presented another tenant's client request id was handed that
  // tenant's order document — a cross-tenant read disguised as a retry. The id
  // is an unguessable client-generated value, but "unguessable" is not an
  // authorization model.
  if (clientRequestId) {
    const existing = await Order.findOne({ cafeId, clientRequestId }).populate(
      'tableId',
      'tableNumber'
    );
    if (existing) {
      return { order: existing, idempotent: true };
    }
  }

  // Module #10 — server-side geofence decision. Staff-entered orders (POS /
  // waiter) are on-premise by definition, so enforcement is opt-out per call.
  let geoSnapshot = null;
  if (enforceGeofence) {
    geoSnapshot = await geofenceService.verifyOrderLocation({
      cafeId,
      tableId,
      location: geolocation,
    });
    if (geoSnapshot.decision === 'reject') {
      throw new AppError(
        'This order was placed outside the cafe\'s delivery zone. Please ask a staff member to place it for you.',
        403
      );
    }
  }

  const { resolvedItems, subtotal, totalGST, taxBreakdown } = await resolveLineItems({ cafeId, items });

  // A coupon code is validated server-side and folded into the discount list.
  // Guests get a soft failure: a typo'd or expired code must not cost them the
  // whole order, so the order goes through at full price with a notice instead.
  const effectiveDiscounts = Array.isArray(discounts) ? [...discounts] : [];
  let couponNotice = null;
  let couponApplied = null;
  if (couponCode) {
    try {
      const validated = await couponService.validate({
        cafeId,
        code: couponCode,
        subtotal,
        items: resolvedItems,
        customerId,
      });
      effectiveDiscounts.push(couponService.toDiscount(validated));
      couponApplied = {
        code: validated.code,
        // What the customer actually typed, which for a personal offer is a
        // grant code rather than the campaign's own.
        appliedCode: validated.grantCode || validated.code,
        personal: Boolean(validated.grantCode),
        label: validated.label,
        discount: validated.discount,
      };
    } catch (err) {
      if (couponStrict) throw err;
      couponNotice = err.message;
      console.warn(`Coupon "${couponCode}" not applied on ${channel} order: ${err.message}`);
    }
  }

  // A reward voucher resolves to money before it becomes a discount, and it is
  // checked against the customer placing the order so a code cannot be spent by
  // anyone but the guest who earned it. Same soft-fail contract as coupons: a
  // mistyped code costs the guest their discount, not their order.
  let voucherApplied = null;
  let voucherNotice = null;
  if (voucherCode) {
    try {
      const validated = await loyaltyService.validateVoucherForCustomer(
        cafeId,
        voucherCode,
        customerId
      );
      effectiveDiscounts.push({
        scope: 'order',
        label: `Voucher ${validated.code}: ${validated.label}`,
        type: validated.type === 'percent_off' ? 'percent' : 'flat',
        value: Number(validated.value) || 0,
        couponCode: validated.code,
      });
      voucherApplied = {
        code: validated.code,
        label: validated.label,
        type: validated.type,
        value: validated.value,
      };
    } catch (err) {
      if (couponStrict) throw err;
      voucherNotice = err.message;
      console.warn(`Voucher "${voucherCode}" not applied on ${channel} order: ${err.message}`);
    }
  }

  const { discounts: normalizedDiscounts, discountTotal } = applyDiscounts({
    subtotal,
    discounts: effectiveDiscounts,
  });

  const serviceCharge = 0;
  const totalAmount = Math.max(0, round2(subtotal - discountTotal + totalGST + serviceCharge));
  const orderNumber = await generateOrderNumber(cafeId);

  const orderPayload = {
    cafeId,
    orderType,
    channel,
    tableId,
    sessionId,
    customerId,
    createdByStaffId,
    placedByParticipantId,
    placedByName,
    orderNumber,
    ...(clientRequestId ? { clientRequestId } : {}),
    items: resolvedItems,
    subtotal,
    totalGST,
    serviceCharge,
    totalAmount,
    taxBreakdown,
    discounts: normalizedDiscounts,
    discountTotal,
    notes,
    geolocation: geoSnapshot || {},
    status: initialStatus,
  };

  let order;
  try {
    order = await Order.create(orderPayload);
  } catch (err) {
    if (err.code === 11000 && (!err.keyPattern || !err.keyPattern.clientRequestId)) {
      orderPayload.orderNumber = `${orderPayload.orderNumber}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      order = await Order.create(orderPayload);
    } else {
      throw err;
    }
  }

  const populatedOrder = await Order.findById(order._id).populate('tableId', 'tableNumber');

  // Consume the coupon now that the order exists (usage counters are
  // authoritative). The code that was *typed* is the one redeemed, because a
  // personal grant code is not the coupon's own code.
  if (couponCode && couponApplied) {
    await couponService
      .redeem(cafeId, couponCode, { orderId: order._id })
      .catch((err) => console.error('Coupon redemption failed (non-blocking):', err.message));
  }

  // Consume the voucher against the order it actually discounted, so a retry of
  // this same `clientRequestId` finds the voucher already spent.
  if (voucherCode && voucherApplied) {
    await loyaltyService
      .redeemVoucher({ cafeId, code: voucherApplied.code, orderId: order._id })
      .catch((err) => console.error('Voucher redemption failed (non-blocking):', err.message));
  }

  if (geoSnapshot && geoSnapshot.flagged) {
    // Module #10 — record the flag in the immutable ledger and alert managers.
    await auditService
      .recordEvent({
        cafeId,
        type: 'order.geofence_flagged',
        entityType: 'Order',
        entityId: order._id,
        staffId: createdByStaffId || null,
        metadata: {
          orderNumber: order.orderNumber,
          riskScore: geoSnapshot.riskScore,
          reasons: geoSnapshot.reasons,
          distanceMeters: geoSnapshot.distanceMeters,
          channel,
        },
      })
      .catch((err) => console.error('Geofence audit write failed (non-blocking):', err.message));

    socketService.emitGeofenceFlagged(cafeId, {
      orderId: order._id,
      orderNumber: order.orderNumber,
      riskScore: geoSnapshot.riskScore,
      reasons: geoSnapshot.reasons,
      distanceMeters: geoSnapshot.distanceMeters,
    });
  }

  if (emit) {
    // Module #03 — the payload carries audio metadata so every admin surface
    // can ding without hardcoding the behaviour.
    socketService.emitNewOrder(cafeId, populatedOrder, {
      sound: true,
      channel,
      orderType,
      flagged: Boolean(geoSnapshot && geoSnapshot.flagged),
    });
    if (sessionId) {
      socketService.emitOrderCreatedSession(sessionId, populatedOrder);
    }
  }

  return { order: populatedOrder, idempotent: false, couponApplied, couponNotice, voucherApplied, voucherNotice };
};

/**
 * Does this ordered line belong on the guest's bill?
 *
 * A bill is what the guest asked for, and food still in the kitchen is still
 * food they ordered. The old gate was `item.status === 'served' || order.status
 * === 'served'`, which meant a table that had just ordered ₹280 of food showed a
 * running total of **₹0** on the bills board — and then took payment for it.
 * A bill that reads zero while the kitchen is busy is not a conservative
 * estimate, it is a wrong number.
 *
 * The only lines that must not be charged are the ones actually withdrawn
 * mid-service: `cancelled`, and `partially_cancelled` for an item reduced after
 * the kitchen bumped it.
 */
const isBillableItem = (item) =>
  item.status !== 'cancelled' && item.status !== 'partially_cancelled';

/**
 * Sum a set of orders into a payable subtotal and GST.
 *
 * Shared by every place that shows or charges a table — the bills dashboard, the
 * guest's bill preview, the bill request, the adjustment guard, the payment
 * pipeline and the manual close. They were seven independent copies of the same
 * arithmetic, which is exactly how they drifted apart and let one of them bill
 * ₹0.
 *
 * `gstAmount` is stored per *line* (already `price × quantity × rate`), so it
 * is added once per line and never multiplied by quantity again.
 *
 * Discounts already written against an order — coupons, loyalty vouchers — are
 * subtracted here. Adding up the lines and ignoring them meant a guest could
 * see a discount accepted at checkout and then be charged the undiscounted sum
 * at the counter.
 */
const sumBillableItems = (orders) => {
  let subtotal = 0;
  let gst = 0;

  for (const order of orders || []) {
    if (order.status === 'cancelled') continue;

    let orderSubtotal = 0;
    for (const item of order.items || []) {
      if (!isBillableItem(item)) continue;
      orderSubtotal += item.price * item.quantity;
      gst += item.gstAmount || 0;
    }

    // A discount may only ever reduce the order to zero, never below it.
    subtotal += Math.max(0, orderSubtotal - (Number(order.discountTotal) || 0));
  }

  return { subtotal: round2(subtotal), gst: round2(gst) };
};

/**
 * Record manual tender(s) against an order (cash / UPI-manual / card-manual / wallet).
 * Online gateways plug in later without changing this contract.
 */
const recordManualPayment = async (order, tenders, staffId = null) => {
  const amountPaid = tenders.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const due = Number(order.totalAmount);
  // Compare at paisa precision. Summing split tenders accumulates float error
  // (three 30s can total 90.00000000000001), and a tolerance smaller than that
  // would refuse a payment that is exactly correct.
  const paidRounded = round2(amountPaid);
  const dueRounded = round2(due);

  if (paidRounded < dueRounded) {
    throw new AppError('Tendered amount is less than the order total', 400);
  }

  // Overpaying used to be accepted silently: the extra was swallowed into
  // `order.payments`, `change` came out as zero, and the cash drawer ended up
  // out by that amount with nothing on the order to explain it. A till is
  // reconciled against recorded payments, so an unrecorded surplus is a real
  // hole. Refuse it and tell the counter staff what happened.
  if (paidRounded > dueRounded) {
    throw new AppError(
      `Tendered ₹${paidRounded.toFixed(2)} is more than the ₹${dueRounded.toFixed(2)} total. ` +
        'Record the exact amount due.',
      400
    );
  }

  const payments = tenders.map((tender) => {
    const amount = Number(tender.amount) || 0;
    const received = tender.received !== undefined ? Number(tender.received) : amount;
    return {
      method: tender.method,
      amount,
      received,
      change: Math.max(0, round2(received - amount)),
      reference: tender.reference || '',
      staffId,
      paidAt: new Date(),
    };
  });

  order.payments.push(...payments);
  order.paymentStatus = 'paid';
  await order.save();
  return order;
};

module.exports = {
  resolveLineItems,
  resolveItemPricing,
  generateOrderNumber,
  applyDiscounts,
  createOrder,
  createPricedOrder,
  assertOrderRequest,
  recordManualPayment,
  round2,
  isBillableItem,
  sumBillableItems,
  checkOperatingHours,
  checkCafeOperationalStatus,
};

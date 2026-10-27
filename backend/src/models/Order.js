const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    menuItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: true,
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 50,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    gstPercentage: {
      type: Number,
      required: true,
      default: 0,
    },
    gstAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled'],
      default: 'pending',
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    // Module #05 — chosen modifiers (server-priced)
    modifiers: [
      {
        name: { type: String, default: '' },
        price: { type: Number, default: 0 },
      },
    ],
    // Module #07 — kitchen/bar station routing
    prepStation: {
      type: String,
      enum: ['kitchen', 'bar', 'both'],
      default: 'kitchen',
    },
    // Module #13 — waiter seat assignment
    seat: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: '',
    },
    participantId: {
      type: String,
      default: null,
    },
    participantName: {
      type: String,
      default: null,
    },
  }
);

const orderSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    // Module #03 — omnichannel: dine-in / takeaway / delivery
    orderType: {
      type: String,
      enum: ['dine_in', 'takeaway', 'delivery'],
      default: 'dine_in',
      required: true,
    },
    // Ordering surface this ticket originated from
    channel: {
      type: String,
      enum: ['qr', 'pos', 'waiter', 'online'],
      default: 'qr',
    },
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
      default: null,
      validate: {
        validator(value) {
          return this.orderType !== 'dine_in' || value != null;
        },
        message: 'tableId is required for dine-in orders',
      },
    },
    // Module #09 — Customer CRM link
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    // Module #02/#08 — staff attribution for POS / waiter orders
    createdByStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DiningSession',
      default: null,
    },
    placedByParticipantId: {
      type: String,
      default: null,
    },
    placedByName: {
      type: String,
      default: null,
    },
    orderNumber: {
      type: String,
      required: true,
      trim: true,
    },
    clientRequestId: {
      type: String,
      trim: true,
    },
    items: {
      type: [orderItemSchema],
      default: [],
      validate: {
        validator: (items) => items.length > 0,
        message: 'Order must contain at least one item',
      },
    },
    subtotal: {
      type: Number,
      required: true,
      default: 0,
    },
    totalGST: {
      type: Number,
      required: true,
      default: 0,
    },
    serviceCharge: {
      type: Number,
      required: true,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    taxBreakdown: [
      {
        percentage: { type: Number, required: true },
        amount: { type: Number, required: true },
      },
    ],
    // Module #02/#14 — discounts and promo application (server-computed)
    discounts: [
      {
        scope: { type: String, enum: ['order', 'item'], default: 'order' },
        label: { type: String, default: '' },
        type: { type: String, enum: ['percent', 'flat'], default: 'flat' },
        value: { type: Number, default: 0 },
        amount: { type: Number, default: 0 },
        couponCode: { type: String, default: '' },
        appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      },
    ],
    discountTotal: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded', 'partially_refunded'],
      default: 'unpaid',
    },
    // Module #03 — refunds / coin-credit reconciliation
    refunds: [
      {
        amount: { type: Number, required: true, min: 0 },
        method: {
          type: String,
          enum: ['cash', 'upi_manual', 'card_manual', 'wallet', 'online'],
          default: 'cash',
        },
        reason: { type: String, default: '' },
        destination: { type: String, enum: ['wallet_balance', 'external'], default: 'external' },
        staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        staffName: { type: String, default: '' },
        refundedAt: { type: Date, default: Date.now },
      },
    ],
    payments: [
      {
        method: {
          type: String,
          enum: ['cash', 'upi_manual', 'card_manual', 'wallet', 'online'],
          required: true,
        },
        amount: { type: Number, required: true, min: 0 },
        received: { type: Number, default: 0 },
        change: { type: Number, default: 0 },
        reference: { type: String, default: '' },
        staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        paidAt: { type: Date, default: Date.now },
      },
    ],
    // Module #10 — geo-location verification snapshot (computed server-side)
    geolocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      distanceMeters: { type: Number, default: null },
      radiusMeters: { type: Number, default: null },
      verified: { type: Boolean, default: false },
      flagged: { type: Boolean, default: false },
      riskScore: { type: Number, default: 0 },
      reasons: { type: [String], default: [] },
      decision: { type: String, enum: ['accept', 'flag', 'reject', 'unchecked'], default: 'unchecked' },
      velocity: {
        recentOrderCount: { type: Number, default: 0 },
        impliedSpeedMps: { type: Number, default: null },
      },
      checkedAt: { type: Date, default: null },
      reviewOutcome: {
        type: String,
        enum: ['pending', 'confirmed_legit', 'confirmed_fraud', null],
        default: 'pending',
      },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
      reviewNote: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'preparing', 'ready', 'partially_served', 'served', 'partially_cancelled', 'cancelled'],
      default: 'pending',
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    preparingAt: {
      type: Date,
      default: null,
    },
    readyAt: {
      type: Date,
      default: null,
    },
    servedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: String,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ cafeId: 1 });
orderSchema.index({ cafeId: 1, tableId: 1 });
orderSchema.index({ cafeId: 1, orderNumber: 1 }, { unique: true });
orderSchema.index({ cafeId: 1, status: 1, createdAt: -1 });
orderSchema.index({ cafeId: 1, orderType: 1, status: 1, createdAt: -1 });
orderSchema.index({ cafeId: 1, customerId: 1 });
orderSchema.index({ cafeId: 1, paymentStatus: 1 });
orderSchema.index({ cafeId: 1, 'geolocation.flagged': 1, createdAt: -1 });
orderSchema.index({ sessionId: 1 });
orderSchema.index(
  { cafeId: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientRequestId: { $type: 'string', $gt: '' } },
  }
);

module.exports = mongoose.model('Order', orderSchema);

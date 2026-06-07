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
  },
  {
    _id: false,
  }
);

const orderSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DiningSession',
      default: null,
    },
    orderNumber: {
      type: String,
      required: true,
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
    status: {
      type: String,
      enum: ['pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled'],
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
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ cafeId: 1 });
orderSchema.index({ cafeId: 1, tableId: 1 });
orderSchema.index({ cafeId: 1, orderNumber: 1 }, { unique: true });
orderSchema.index({ cafeId: 1, status: 1, createdAt: -1 });
orderSchema.index({ sessionId: 1 });

module.exports = mongoose.model('Order', orderSchema);

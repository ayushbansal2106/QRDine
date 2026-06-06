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
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'preparing', 'ready', 'served', 'cancelled'],
      default: 'pending',
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

module.exports = mongoose.model('Order', orderSchema);

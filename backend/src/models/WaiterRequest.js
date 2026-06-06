const mongoose = require('mongoose');

const waiterRequestSchema = new mongoose.Schema(
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
    requestType: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'resolved'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

waiterRequestSchema.index({ cafeId: 1 });
waiterRequestSchema.index({ cafeId: 1, tableId: 1 });
waiterRequestSchema.index({ cafeId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('WaiterRequest', waiterRequestSchema);

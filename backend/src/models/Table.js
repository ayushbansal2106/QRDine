const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    tableNumber: {
      type: String,
      required: true,
      trim: true,
    },
    guestUrl: {
      type: String,
      trim: true,
      default: '',
    },
    qrCodeUrl: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

tableSchema.index({ cafeId: 1 });
tableSchema.index({ cafeId: 1, tableNumber: 1 }, { unique: true });
tableSchema.index({ cafeId: 1, isActive: 1 });

module.exports = mongoose.model('Table', tableSchema);

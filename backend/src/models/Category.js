const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

categorySchema.index({ cafeId: 1 });
categorySchema.index({ cafeId: 1, name: 1 }, { unique: true });
categorySchema.index({ cafeId: 1, displayOrder: 1 });

module.exports = mongoose.model('Category', categorySchema);

const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    image: {
      type: String,
      trim: true,
      default: '',
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

menuItemSchema.index({ cafeId: 1 });
menuItemSchema.index({ cafeId: 1, categoryId: 1 });
menuItemSchema.index({ cafeId: 1, categoryId: 1, name: 1 }, { unique: true });
menuItemSchema.index({ cafeId: 1, isAvailable: 1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);

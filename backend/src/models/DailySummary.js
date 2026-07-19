const mongoose = require('mongoose');

const itemSoldSchema = new mongoose.Schema(
  {
    menuItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
    },
    itemName: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      default: 0,
    },
    revenue: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const peakHourSchema = new mongoose.Schema(
  {
    hour: {
      type: Number,
      required: true,
      min: 0,
      max: 23,
    },
    orderCount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const dailySummarySchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    totalRevenue: {
      type: Number,
      default: 0,
    },
    gstCollected: {
      type: Number,
      default: 0,
    },
    orderCount: {
      type: Number,
      default: 0,
    },
    sessionCount: {
      type: Number,
      default: 0,
    },
    averageOrderValue: {
      type: Number,
      default: 0,
    },
    customerCount: {
      type: Number,
      default: 0,
    },
    itemsSold: {
      type: [itemSoldSchema],
      default: [],
    },
    peakHours: {
      type: [peakHourSchema],
      default: [],
    },
    gstBreakdown: {
      type: [
        {
          percentage: { type: Number, required: true },
          amount: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    paymentMethods: {
      online: { type: Number, default: 0 },
      counter: { type: Number, default: 0 },
      onlineRevenue: { type: Number, default: 0 },
      counterRevenue: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

dailySummarySchema.index({ cafeId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailySummary', dailySummarySchema);

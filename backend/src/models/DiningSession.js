const crypto = require('crypto');
const mongoose = require('mongoose');

const diningSessionSchema = new mongoose.Schema(
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
    customerName: {
      type: String,
      trim: true,
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    participants: [
      {
        participantId: { type: String, required: true },
        name: { type: String, required: true, trim: true },
        email: { type: String, trim: true, lowercase: true, default: null },
        role: { type: String, enum: ['owner', 'member'], default: 'member' },
        deviceId: { type: String, default: null },
        joinedAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['active', 'left'], default: 'active' },
      }
    ],
    guestToken: {
      type: String,
      default: () => crypto.randomBytes(16).toString('hex'),
      required: true,
    },
    deviceId: {
      type: String,
      default: null,
    },
    source: {
      type: String,
      enum: ['new_scan', 'continue_existing', 'replaced_previous'],
      default: 'new_scan',
    },
    status: {
      type: String,
      enum: ['active', 'abandoned', 'bill_requested', 'awaiting_payment', 'paid', 'closed'],
      default: 'active',
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
    abandonedAt: {
      type: Date,
      default: null,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    gst: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    billVersion: {
      type: Number,
      default: 1,
    },
    invoiceNumber: {
      type: String,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ['pending', 'paid_counter', 'paid_online'],
      default: 'pending',
    },
    adjustments: [
      {
        type: { type: String, enum: ['addition', 'discount'], required: true },
        description: { type: String, required: true },
        amount: { type: Number, required: true },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date, default: Date.now },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        approvalReason: { type: String },
      }
    ],
    activityFeed: [
      {
        type: {
          type: String,
          enum: [
            'participant_joined',
            'participant_left',
            'order_created',
            'item_cancelled',
            'bill_requested',
            'bill_cancelled',
            'bill_adjusted',
            'ownership_transferred',
            'session_paid',
          ],
          required: true,
        },
        message: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      }
    ],
  },
  {
    timestamps: true,
  }
);

diningSessionSchema.index({ cafeId: 1, status: 1 });
diningSessionSchema.index({ tableId: 1, status: 1 });
diningSessionSchema.index({ cafeId: 1, tableId: 1, status: 1 });
diningSessionSchema.index({ cafeId: 1, createdAt: -1 });
diningSessionSchema.index({ guestToken: 1 });

diningSessionSchema.pre('save', function (next) {
  if (this.activityFeed && this.activityFeed.length > 50) {
    this.activityFeed = this.activityFeed.slice(-50);
  }
  if (typeof next === 'function') next();
});

diningSessionSchema.methods.addActivity = function(type, message) {
  this.activityFeed.push({ type, message });
  if (this.activityFeed.length > 50) {
    this.activityFeed = this.activityFeed.slice(-50);
  }
};

module.exports = mongoose.model('DiningSession', diningSessionSchema);

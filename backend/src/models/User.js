const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
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
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    role: {
      type: String,
      enum: ['owner', 'manager', 'cashier', 'waiter', 'barista', 'staff'],
      required: true,
    },
    // Module #08 — granular RBAC. When empty, role defaults apply.
    permissions: {
      type: [String],
      default: [],
    },
    // Module #08 — fast 4-digit PIN access for counter/tablet terminals
    pinHash: {
      type: String,
      default: null,
      select: false,
    },
    pinEnabled: {
      type: Boolean,
      default: false,
    },
    // Module #08 — PIN brute-force protection
    pinSetAt: {
      type: Date,
      default: null,
    },
    pinAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    pinLockedUntil: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ cafeId: 1 });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ cafeId: 1, role: 1 });

module.exports = mongoose.model('User', userSchema);

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
      enum: ['owner', 'manager', 'staff'],
      required: true,
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

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * QRDine staff — deliberately a separate collection from `User`.
 *
 * A cafe admin is scoped to one tenant (`User.cafeId`) and can only ever reach
 * their own cafe. A QRDine operator is scoped to none and can reach every cafe.
 * Keeping them in one collection would mean either a nullable `cafeId` that
 * every existing query has to remember to check, or a role string that a single
 * missing `tenantMiddleware` turns into a cross-tenant data leak.
 *
 * Two collections means the ordinary tenant middleware simply cannot address a
 * super admin: `User.findById()` will never match one, so a super-admin token
 * is rejected by `protect` and a cafe token is rejected by `protectSuperAdmin`.
 */
const SUPER_ADMIN_ROLES = {
  /** Full control, including terminate/reinstate and plan changes. */
  SUPERADMIN: 'superadmin',
  /** Can grant plans and extend trials, but cannot terminate an account. */
  SUPPORT: 'support',
  /** Read-only. For audits and investigations. */
  READONLY: 'readonly',
};

const superAdminSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      // Uniqueness here and ONLY here. A second `index({ email: 1 })` on the
      // same key pattern is an index-options conflict and Mongo silently ends up
      // with neither index — see the identical trap in Subscription.
      unique: true,
    },
    name: { type: String, trim: true, default: '' },
    password: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: Object.values(SUPER_ADMIN_ROLES),
      default: SUPER_ADMIN_ROLES.READONLY,
    },
    isActive: { type: Boolean, default: true },

    // Brute-force protection, mirroring the cafe-admin PIN policy: a slow lock
    // after repeated failures rather than an instant lock, so a fat-fingered
    // operator is not locked out of the console by one typo.
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Global staff directory. Unique comes from the field above.
superAdminSchema.index({ isActive: 1 });

superAdminSchema.methods.verifyPassword = function verifyPassword(candidate) {
  return bcrypt.compare(String(candidate || ''), this.password);
};

superAdminSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(String(plain), 12);
};

module.exports = mongoose.model('SuperAdmin', superAdminSchema);
module.exports.SUPER_ADMIN_ROLES = SUPER_ADMIN_ROLES;
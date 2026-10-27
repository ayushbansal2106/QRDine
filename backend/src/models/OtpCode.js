const mongoose = require('mongoose');

/**
 * One-time codes for customer identity (Module #09).
 *
 * Codes are never stored in plaintext — only a per-record salted SHA-256, so a
 * database leak cannot be replayed against the sign-in endpoint. A TTL index
 * expires spent codes without a sweeper job.
 */

const otpSchema = new mongoose.Schema(
  {
    /** `sms` for phone sign-in, `email` for verifying an email added later. */
    channel: {
      type: String,
      enum: ['sms', 'email'],
      required: true,
    },
    /** The phone number or email address the code was sent to. */
    identifier: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    /**
     * The café the code was minted for. Customer profiles are tenant-scoped
     * (`{cafeId, phone}` is unique), so a code issued for one café must not be
     * able to sign a guest into another café's profile.
     */
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      default: null,
    },
    /** `login` proves control of a phone; `verify_email` attaches an email. */
    purpose: {
      type: String,
      enum: ['login', 'verify_email'],
      required: true,
    },
    /** Hex SHA-256 of (salt + code). Never the code itself. */
    codeHash: {
      type: String,
      required: true,
    },
    /** Per-record salt so identical codes do not share a digest. */
    salt: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Serves both "most recent live code" and the resend throttle query.
otpSchema.index({ identifier: 1, purpose: 1, cafeId: 1, createdAt: -1 });
// Expired codes are removed by MongoDB rather than by application code.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpCode', otpSchema);
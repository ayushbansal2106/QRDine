const mongoose = require('mongoose');

const cafeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    logo: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    // Stage 4 / Task 4.1 & Stage 5 Statutory Compliance Fields
    legalName: {
      type: String,
      trim: true,
      default: '',
    },
    tradeName: {
      type: String,
      trim: true,
      default: '',
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    fssaiNumber: {
      type: String,
      trim: true,
      default: '',
    },
    taxMode: {
      type: String,
      enum: ['composite_5', 'regular_18', 'exempt_0', 'exempt'],
      default: 'composite_5',
    },
    tableCount: {
      type: Number,
      default: 10,
      min: 1,
    },
    // Stage 5 / Task 5.1 — Master SaaS Agreement & Data Processing Addendum (DPA)
    termsAccepted: {
      type: Boolean,
      default: true,
    },
    termsAcceptedAt: {
      type: Date,
      default: Date.now,
    },
    termsVersion: {
      type: String,
      default: '2026.1',
    },
    dpaAccepted: {
      type: Boolean,
      default: true,
    },
    dpaAcceptedAt: {
      type: Date,
      default: Date.now,
    },
    dpaVersion: {
      type: String,
      default: '2026.1',
    },
    // Stage 5 / Task 5.5 — Emergency Security Containment & Quarantine
    isQuarantined: {
      type: Boolean,
      default: false,
    },
    quarantineReason: {
      type: String,
      default: '',
    },
    quarantinedAt: {
      type: Date,
      default: null,
    },
    currency: {
      type: String,
      trim: true,
      default: 'INR',
    },
    // Module #01 — outlets of the same brand share a group key. Outlet
    // consolidation only ever aggregates over cafes the caller owns/manages.
    outletGroup: {
      type: String,
      trim: true,
      default: '',
    },
    outletLabel: {
      type: String,
      trim: true,
      default: '',
    },
    timezone: {
      type: String,
      trim: true,
      default: 'Asia/Kolkata',
    },
    // Module #10 — Geo-location fake-order prevention
    geofence: {
      enabled: { type: Boolean, default: false },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      radiusMeters: { type: Number, default: 50, min: 5, max: 5000 },
      // What to do when the customer's device gives no usable fix.
      fallback: { type: String, enum: ['flag', 'reject'], default: 'flag' },
      // Extra anti-abuse knobs (Module #10).
      flagThreshold: { type: Number, default: 1, min: 0, max: 100 },
      velocityLimit: { type: Number, default: 8, min: 1, max: 100 },
    },
    // Module #11 — social NFC tap tags are separate documents, but the cafe
    // records the default destination new tags inherit.
    nfc: {
      defaultDestination: { type: String, enum: ['menu', 'google_review', 'instagram', 'custom'], default: 'menu' },
      instagramUrl: { type: String, trim: true, default: '' },
    },
    // Module #18 — AI review engine settings
    review: {
      googlePlaceId: { type: String, trim: true, default: '' },
      googleReviewUrl: { type: String, trim: true, default: '' },
      aiEnabled: { type: Boolean, default: false },
      minRatingForGoogle: { type: Number, default: 4, min: 1, max: 5 },
      // Brand voice used for AI-generated owner replies and review drafts.
      brandVoice: { type: String, trim: true, default: 'warm, concise, appreciative', maxlength: 200 },
      // How long after settlement the customer is asked for a rating.
      promptDelayHours: { type: Number, default: 2, min: 0, max: 168 },
      // Ask every Nth settled order, so a busy cafe is not over-prompting.
      promptSampleRate: { type: Number, default: 100, min: 1, max: 100 },
      autoSendLowRatingAlerts: { type: Boolean, default: true },
    },
    // Module #15 — loyalty program defaults
    loyalty: {
      enabled: { type: Boolean, default: false },
      stampsRequired: { type: Number, default: 5, min: 1 },
      rewardType: { type: String, enum: ['free_item', 'percent_off', 'flat_off'], default: 'free_item' },
      rewardValue: { type: Number, default: 0 },
    },
    // Module #02 — thermal receipt printer settings
    receipt: {
      width: { type: Number, enum: [58, 80], default: 80 },
      header: { type: String, trim: true, default: '' },
      footer: { type: String, trim: true, default: 'Thank you for visiting!' },
    },
    // Readiness Gate 1 / CUS-015 — operational ordering control & hours
    isOrderingPaused: {
      type: Boolean,
      default: false,
    },
    orderingPausedReason: {
      type: String,
      trim: true,
      default: '',
      maxlength: 300,
    },
    operatingHours: {
      enabled: {
        type: Boolean,
        default: false,
      },
      openTime: {
        type: String,
        trim: true,
        default: '00:00', // HH:mm 24-hr format
      },
      closeTime: {
        type: String,
        trim: true,
        default: '23:59', // HH:mm 24-hr format
      },
      days: {
        type: [Number], // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        default: [0, 1, 2, 3, 4, 5, 6],
      },
    },
    // Readiness Gate 2 / Task 2.6 — Direct Merchant BYO-PG (Bring-Your-Own-PG)
    paymentGateway: {
      enabled: { type: Boolean, default: false },
      provider: { type: String, enum: ['razorpay', 'cashfree', 'phonepe'], default: 'razorpay' },
      keyId: { type: String, trim: true, default: '' },
      keySecretEncrypted: { type: String, default: '' },
      webhookSecretEncrypted: { type: String, default: '' },
    },
  },
  {
    timestamps: true,
  }
);

cafeSchema.index({ name: 1 });
cafeSchema.index({ email: 1 });
cafeSchema.index({ outletGroup: 1 });

module.exports = mongoose.model('Cafe', cafeSchema);

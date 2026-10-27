const mongoose = require('mongoose');

/**
 * 14-Day Controlled Physical Restaurant Pilot Model (Task 6.3 - Stage 6)
 *
 * Implements the 3-phase rollout and daily shift reconciliation protocol:
 * - Phase 1 (Days 1–3): Shadow mode — POS entry alongside paper tickets.
 * - Phase 2 (Days 4–7): Limited QR ordering on designated tables.
 * - Phase 3 (Days 8–14): Full-venue QR ordering active across all tables.
 */
const dailyShiftLogSchema = new mongoose.Schema(
  {
    dayNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 14,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    phase: {
      type: String,
      enum: ['phase_1_shadow', 'phase_2_limited_qr', 'phase_3_full_venue'],
      required: true,
    },
    totalOrders: {
      type: Number,
      default: 0,
    },
    totalSales: {
      type: Number,
      default: 0,
    },
    cashCollected: {
      type: Number,
      default: 0,
    },
    digitalCollected: {
      type: Number,
      default: 0,
    },
    discrepancyAmount: {
      type: Number,
      default: 0,
    },
    discrepancyRupees: {
      type: Number,
      default: 0,
    },
    droppedOrdersCount: {
      type: Number,
      default: 0,
    },
    droppedOrders: {
      type: Number,
      default: 0,
    },
    kitchenLatencyAvgMinutes: {
      type: Number,
      default: 0,
    },
    staffFeedbackNotes: {
      type: String,
      default: '',
    },
    passedDailyAudit: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true, timestamps: true }
);

const pilotRunSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'paused', 'completed', 'aborted'],
      default: 'active',
    },
    currentPhase: {
      type: String,
      enum: ['phase_1_shadow', 'phase_2_limited_qr', 'phase_3_full_venue', 'completed'],
      default: 'phase_1_shadow',
    },
    currentDay: {
      type: Number,
      default: 1,
      min: 1,
      max: 14,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    activeTables: {
      type: [String],
      default: [], // empty in phase 1 (customer QR off), tables 1-4 in phase 2, all tables in phase 3
    },
    dailyLogs: [dailyShiftLogSchema],
    metrics: {
      totalOrdersHandled: { type: Number, default: 0 },
      totalSalesRupees: { type: Number, default: 0 },
      cumulativeDiscrepancy: { type: Number, default: 0 },
      totalDroppedOrders: { type: Number, default: 0 },
      averageRating: { type: Number, default: 5.0 },
    },
    exitCriteria: {
      zeroBillingDiscrepancies: { type: Boolean, default: false },
      zeroCrossTenantLeaks: { type: Boolean, default: false },
      zeroDroppedOrders: { type: Boolean, default: false },
      ownerSignoff: { type: Boolean, default: false },
      ownerSignoffName: { type: String, default: '' },
      ownerSignoffDate: { type: Date, default: null },
      gaCertificateNumber: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

const PilotRun = mongoose.model('PilotRun', pilotRunSchema);
PilotRun.PilotRun = PilotRun;

module.exports = PilotRun;

const mongoose = require('mongoose');

/**
 * Production Incident Record & Triage Model (Form C - Task 4.3).
 *
 * Implements standard severity classifications and CERT-In / DPDP breach alerting.
 */
const incidentRecordSchema = new mongoose.Schema(
  {
    incidentId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    severity: {
      type: String,
      enum: ['SEV-1', 'SEV-2', 'SEV-3'],
      required: true,
      default: 'SEV-3',
    },
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      default: null,
    },
    affectedOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    category: {
      type: String,
      enum: ['billing', 'data_isolation', 'realtime_outage', 'security_breach', 'operational'],
      required: true,
      default: 'operational',
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    sanitizedLogs: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isPersonalDataInvolved: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['open', 'investigating', 'mitigated', 'resolved', 'closed'],
      default: 'open',
    },
    reportedBy: {
      type: String,
      trim: true,
      default: 'system',
    },
    remediationNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 5000,
    },
    certInReported: {
      type: Boolean,
      default: false,
    },
    certInReportedAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

incidentRecordSchema.index({ severity: 1, status: 1 });
incidentRecordSchema.index({ cafeId: 1, createdAt: -1 });
incidentRecordSchema.index({ isPersonalDataInvolved: 1, certInReported: 1 });

module.exports = mongoose.model('IncidentRecord', incidentRecordSchema);

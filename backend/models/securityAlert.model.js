const mongoose = require("mongoose");

const SECURITY_ALERT_SEVERITIES = ["medium", "high", "critical"];
const SECURITY_ALERT_STATUSES = ["open", "acknowledged", "resolved", "dismissed"];

const SecurityAlertStatusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: SECURITY_ALERT_STATUSES,
      required: true,
      trim: true,
      lowercase: true,
    },
    note: { type: String, default: "", trim: true },
    changed_by: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    changed_at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const SecurityAlertSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null, index: true },
    activity_log: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "security_activity_logs",
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: SECURITY_ALERT_SEVERITIES,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    score: { type: Number, required: true, min: 0, index: true },
    reasons: { type: [String], default: [] },
    status: {
      type: String,
      enum: SECURITY_ALERT_STATUSES,
      default: "open",
      trim: true,
      lowercase: true,
      index: true,
    },
    notes: { type: String, default: "", trim: true },
    status_history: { type: [SecurityAlertStatusHistorySchema], default: [] },
    resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    resolved_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now, index: true },
  },
  {
    collection: "security_alerts",
    timestamps: false,
  },
);

SecurityAlertSchema.index({ status: 1, severity: 1, created_at: -1 });
SecurityAlertSchema.index({ user: 1, created_at: -1 });

module.exports = {
  SecurityAlert: mongoose.model("security_alerts", SecurityAlertSchema),
  SECURITY_ALERT_SEVERITIES,
  SECURITY_ALERT_STATUSES,
};

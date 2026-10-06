const mongoose = require("mongoose");

const QC_UPDATE_FOLLOW_UP_STATES = Object.freeze([
  "pending",
  "running",
  "retrying",
  "completed",
  "failed",
]);

const QcUpdateFollowUpSchema = new mongoose.Schema(
  {
    qc: { type: mongoose.Schema.Types.ObjectId, ref: "qc", required: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "orders", default: null },
    inspection: { type: mongoose.Schema.Types.ObjectId, ref: "inspections", default: null },
    idempotency_key: { type: String, default: "", trim: true },
    state: { type: String, enum: QC_UPDATE_FOLLOW_UP_STATES, default: "pending", index: true },
    attempts: { type: Number, default: 0, min: 0 },
    next_attempt_at: { type: Date, default: Date.now, index: true },
    locked_until: { type: Date, default: null, index: true },
    completed_at: { type: Date, default: null },
    failed_at: { type: Date, default: null },
    failure_notified_at: { type: Date, default: null },
    last_error: { type: String, default: "", trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { collection: "qc_update_follow_ups", timestamps: true },
);

QcUpdateFollowUpSchema.index(
  { qc: 1, idempotency_key: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotency_key: { $type: "string", $gt: "" } },
  },
);
QcUpdateFollowUpSchema.index({ state: 1, next_attempt_at: 1, locked_until: 1 });

module.exports = {
  QC_UPDATE_FOLLOW_UP_STATES,
  QcUpdateFollowUp: mongoose.model("qc_update_follow_ups", QcUpdateFollowUpSchema),
};

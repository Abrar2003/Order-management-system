const mongoose = require("mongoose");

const labelSyncFailureSchema = new mongoose.Schema(
  {
    inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      required: true,
    },
    operation: { type: String, required: true, trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    error: {
      message: { type: String, required: true },
      stack: { type: String, default: "" },
    },
    attempts: { type: Number, default: 1, min: 1 },
    resolved: { type: Boolean, default: false },
    last_attempt_at: { type: Date, default: Date.now },
    resolved_at: { type: Date, default: null },
  },
  { timestamps: true },
);

labelSyncFailureSchema.index({ resolved: 1, createdAt: 1 });
labelSyncFailureSchema.index({ inspector: 1, resolved: 1, createdAt: -1 });

module.exports = mongoose.model("label_sync_failures", labelSyncFailureSchema);

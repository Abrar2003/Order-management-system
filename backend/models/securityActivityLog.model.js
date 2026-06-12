const mongoose = require("mongoose");

const SecurityActivityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null, index: true },
    username: { type: String, default: "", trim: true, index: true },
    action: { type: String, required: true, trim: true, lowercase: true, index: true },
    resource_type: { type: String, default: "", trim: true, lowercase: true, index: true },
    resource_id: { type: String, default: "", trim: true },
    ip: { type: String, default: "", trim: true, index: true },
    user_agent: { type: String, default: "", trim: true },
    device_hash: { type: String, default: "", trim: true, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    risk_score: { type: Number, default: 0, min: 0, index: true },
    risk_reasons: { type: [String], default: [] },
    created_at: { type: Date, default: Date.now, index: true },
  },
  {
    collection: "security_activity_logs",
    timestamps: false,
  },
);

SecurityActivityLogSchema.index({ user: 1, created_at: -1 });
SecurityActivityLogSchema.index({ action: 1, created_at: -1 });
SecurityActivityLogSchema.index({ resource_type: 1, created_at: -1 });
SecurityActivityLogSchema.index({ risk_score: -1, created_at: -1 });
SecurityActivityLogSchema.index({ ip: 1, device_hash: 1, created_at: -1 });

module.exports = mongoose.model("security_activity_logs", SecurityActivityLogSchema);

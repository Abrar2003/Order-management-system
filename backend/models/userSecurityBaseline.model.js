const mongoose = require("mongoose");

const SecurityBaselineEntrySchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true },
    count: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const UserSecurityBaselineSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      unique: true,
      index: true,
    },
    top_ips: { type: [SecurityBaselineEntrySchema], default: [] },
    top_devices: { type: [SecurityBaselineEntrySchema], default: [] },
    common_hours: { type: [Number], default: [] },
    avg_daily_exports: { type: Number, default: 0, min: 0 },
    avg_daily_views: { type: Number, default: 0, min: 0 },
    window_days: { type: Number, default: 30, min: 1 },
    calculated_from: { type: Date, default: null },
    calculated_to: { type: Date, default: null },
    last_recalculated_at: { type: Date, default: Date.now },
  },
  {
    collection: "user_security_baselines",
    timestamps: true,
  },
);

module.exports = mongoose.model("user_security_baselines", UserSecurityBaselineSchema);

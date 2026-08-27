const mongoose = require("mongoose");

const labelStorageStateSchema = new mongoose.Schema(
  {
    inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      required: true,
    },
    schema_version: { type: Number, default: 2, min: 1 },
    migration_status: {
      type: String,
      enum: [
        "legacy",
        "backfilling",
        "backfilled",
        "verifying",
        "verified",
        "modern",
        "failed",
      ],
      default: "legacy",
    },
    read_source: {
      type: String,
      enum: ["legacy", "modern"],
      default: "legacy",
    },
    write_mode: {
      type: String,
      enum: ["legacy", "dual", "modern"],
      default: "legacy",
    },
    legacy_fallback_enabled: { type: Boolean, default: true },
    backfilled_at: { type: Date, default: null },
    verified_at: { type: Date, default: null },
    modern_enabled_at: { type: Date, default: null },
    last_error: {
      message: { type: String, default: "" },
      at: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

labelStorageStateSchema.index({ inspector: 1 }, { unique: true });

module.exports = mongoose.model("label_storage_states", labelStorageStateSchema);

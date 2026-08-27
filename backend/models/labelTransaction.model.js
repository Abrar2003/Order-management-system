const mongoose = require("mongoose");

const labelHistoryActorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    name: { type: String, default: "" },
  },
  { _id: false },
);

const labelTransactionSchema = new mongoose.Schema(
  {
    inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      required: true,
    },
    action: {
      type: String,
      enum: [
        "allocate",
        "transfer_in",
        "transfer_out",
        "reject",
        "replace",
        "remove",
      ],
      required: true,
    },
    labels: [{ type: Number, min: 0 }],
    previous_labels: [{ type: Number, min: 0 }],
    next_labels: [{ type: Number, min: 0 }],
    from_inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      default: null,
    },
    to_inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      default: null,
    },
    actor: { type: labelHistoryActorSchema, default: () => ({}) },
    recorded_at: { type: Date, default: Date.now },
    remarks: { type: String, default: "" },
    migration: {
      migrated: { type: Boolean, default: false },
      source: { type: String, default: "", trim: true },
      migrated_at: { type: Date, default: null },
      legacy_inspector: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "inspectors",
        default: null,
      },
      legacy_history_id: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      legacy_key: { type: String, default: "", trim: true },
    },
  },
  { timestamps: true },
);

labelTransactionSchema.index({ inspector: 1, recorded_at: -1 });
labelTransactionSchema.index(
  {
    "migration.legacy_inspector": 1,
    "migration.legacy_history_id": 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      "migration.legacy_inspector": { $type: "objectId" },
      "migration.legacy_history_id": { $type: "objectId" },
    },
  },
);
labelTransactionSchema.index(
  {
    "migration.legacy_inspector": 1,
    "migration.legacy_key": 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      "migration.legacy_inspector": { $type: "objectId" },
      "migration.legacy_key": { $type: "string" },
    },
  },
);

module.exports = mongoose.model("label_transactions", labelTransactionSchema);

const mongoose = require("mongoose");

const PisUpdateChangeSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: ["PIS", "PD", "Master", "Item"],
      default: "PIS",
      trim: true,
    },
    field: { type: String, required: true, trim: true },
    before: { type: String, default: "", trim: true },
    after: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const PisUpdateMissingFieldSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: ["PIS", "PD", "Master", "Item"],
      default: "PIS",
      trim: true,
    },
    field: { type: String, required: true, trim: true },
    label: { type: String, default: "", trim: true },
    message: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const PisUpdateLogSchema = new mongoose.Schema(
  {
    edited_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    edited_by_name: { type: String, default: "", trim: true },
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "items",
      default: null,
    },
    item_code: { type: String, default: "", trim: true, index: true },
    item_name: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    brand: { type: String, default: "", trim: true },
    vendors: { type: [String], default: [] },
    page_name: { type: String, default: "", trim: true },
    source: { type: String, default: "", trim: true },
    operation_type: {
      type: String,
      enum: [
        "pis_update",
        "pis_diff_update",
        "product_database_update",
        "product_database_check",
        "product_database_approve",
        "master_update",
      ],
      default: "pis_update",
      trim: true,
      index: true,
    },
    data_scope: {
      type: [String],
      enum: ["PIS", "PD", "Master", "Item"],
      default: [],
      index: true,
    },
    changed_fields_count: { type: Number, default: 0, min: 0 },
    changed_fields: { type: [String], default: [] },
    changes: { type: [PisUpdateChangeSchema], default: [] },
    missing_fields_count: { type: Number, default: 0, min: 0 },
    missing_fields: { type: [PisUpdateMissingFieldSchema], default: [] },
    remarks: { type: [String], default: [] },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

PisUpdateLogSchema.index({ createdAt: -1 });
PisUpdateLogSchema.index({ item: 1, createdAt: -1 });
PisUpdateLogSchema.index({ edited_by: 1, createdAt: -1 });
PisUpdateLogSchema.index({ brand: 1, createdAt: -1 });
PisUpdateLogSchema.index({ operation_type: 1, createdAt: -1 });

module.exports = mongoose.model("pis_update_logs", PisUpdateLogSchema);

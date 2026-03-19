const mongoose = require("mongoose");

const QcEditChangeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    before: { type: String, default: "", trim: true },
    after: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const QcEditLogSchema = new mongoose.Schema(
  {
    edited_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    edited_by_name: { type: String, default: "", trim: true },
    qc: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "qc",
      default: null,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "orders",
      default: null,
    },
    order_id: { type: String, default: "", trim: true },
    brand: { type: String, default: "", trim: true },
    vendor: { type: String, default: "", trim: true },
    item_code: { type: String, default: "", trim: true },
    operation_type: {
      type: String,
      enum: [
        "qc_align",
        "qc_update",
        "qc_goods_not_ready",
        "qc_inspection_record_edit",
        "qc_inspection_record_delete",
      ],
      default: "qc_update",
      trim: true,
    },
    changed_fields_count: { type: Number, default: 0, min: 0 },
    changed_fields: { type: [String], default: [] },
    changes: { type: [QcEditChangeSchema], default: [] },
    remarks: { type: [String], default: [] },
  },
  { timestamps: true },
);

QcEditLogSchema.index({ createdAt: -1 });
QcEditLogSchema.index({ qc: 1, createdAt: -1 });
QcEditLogSchema.index({ order_id: 1, createdAt: -1 });
QcEditLogSchema.index({ edited_by: 1, createdAt: -1 });

module.exports = mongoose.model("qc_edit_logs", QcEditLogSchema);

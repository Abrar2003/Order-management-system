const mongoose = require("mongoose");

const OrderEditChangeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    before: { type: String, default: "", trim: true },
    after: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const OrderEditLogSchema = new mongoose.Schema(
  {
    edited_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    edited_by_name: { type: String, default: "", trim: true },
    order_id: { type: String, required: true, trim: true },
    brand: { type: String, default: "", trim: true },
    vendor: { type: String, default: "", trim: true },
    item_code: { type: String, default: "", trim: true },
    operation_type: {
      type: String,
      enum: ["order_edit", "order_edit_archive"],
      default: "order_edit",
      trim: true,
    },
    changed_fields_count: { type: Number, default: 0, min: 0 },
    changed_fields: { type: [String], default: [] },
    changes: { type: [OrderEditChangeSchema], default: [] },
    remarks: { type: [String], default: [] },
  },
  { timestamps: true },
);

OrderEditLogSchema.index({ createdAt: -1 });
OrderEditLogSchema.index({ order_id: 1, createdAt: -1 });
OrderEditLogSchema.index({ edited_by: 1, createdAt: -1 });
OrderEditLogSchema.index({ brand: 1, vendor: 1, createdAt: -1 });

module.exports = mongoose.model("order_edit_logs", OrderEditLogSchema);

const mongoose = require("mongoose");

const UploadedOrderSummarySchema = new mongoose.Schema(
  {
    order_id: { type: String, required: true, trim: true },
    items_count: { type: Number, default: 0, min: 0 },
    remark: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const VendorUploadSummarySchema = new mongoose.Schema(
  {
    brand: { type: String, required: true, trim: true },
    vendor: { type: String, required: true, trim: true },
    uploaded_order_ids: { type: [String], default: [] },
    uploaded_orders_count: { type: Number, default: 0, min: 0 },
    uploaded_items_count: { type: Number, default: 0, min: 0 },
    items_per_order: { type: [UploadedOrderSummarySchema], default: [] },
    missing_open_order_ids: { type: [String], default: [] },
    missing_open_orders_count: { type: Number, default: 0, min: 0 },
    remark: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const DuplicateEntrySchema = new mongoose.Schema(
  {
    order_id: { type: String, default: "", trim: true },
    item_code: { type: String, default: "", trim: true },
    reason: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const UploadConflictSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      default: "OPEN_ORDER_MISSING_IN_UPLOAD",
      enum: ["OPEN_ORDER_MISSING_IN_UPLOAD"],
    },
    brand: { type: String, required: true, trim: true },
    vendor: { type: String, required: true, trim: true },
    order_id: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const UploadLogSchema = new mongoose.Schema(
  {
    uploaded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    uploaded_by_name: { type: String, default: "", trim: true },
    source_filename: { type: String, default: "", trim: true },
    source_size_bytes: { type: Number, default: 0, min: 0 },

    total_rows_received: { type: Number, default: 0, min: 0 },
    total_rows_unique: { type: Number, default: 0, min: 0 },
    inserted_item_rows: { type: Number, default: 0, min: 0 },
    duplicate_count: { type: Number, default: 0, min: 0 },
    duplicate_entries: { type: [DuplicateEntrySchema], default: [] },

    uploaded_brands: { type: [String], default: [] },
    uploaded_vendors: { type: [String], default: [] },
    total_distinct_orders_uploaded: { type: Number, default: 0, min: 0 },

    vendor_summaries: { type: [VendorUploadSummarySchema], default: [] },
    conflicts: { type: [UploadConflictSchema], default: [] },
    remarks: { type: [String], default: [] },

    status: {
      type: String,
      enum: ["success", "success_with_conflicts", "failed"],
      default: "success",
    },
    error_message: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

UploadLogSchema.index({ createdAt: -1 });
UploadLogSchema.index({ uploaded_by: 1, createdAt: -1 });
UploadLogSchema.index({ uploaded_brands: 1, createdAt: -1 });
UploadLogSchema.index({ uploaded_vendors: 1, createdAt: -1 });
UploadLogSchema.index({ "vendor_summaries.brand": 1, createdAt: -1 });
UploadLogSchema.index({ "vendor_summaries.vendor": 1, createdAt: -1 });
UploadLogSchema.index({ "conflicts.brand": 1, "conflicts.vendor": 1, "conflicts.order_id": 1 });

module.exports = mongoose.model("upload_logs", UploadLogSchema);

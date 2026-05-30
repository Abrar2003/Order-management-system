const mongoose = require("mongoose");

const AUDIT_ACTOR_SCHEMA = {
  user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
  name: { type: String, default: "", trim: true },
};

const ComplaintCommentSchema = new mongoose.Schema(
  {
    comment: { type: String, required: true, trim: true },
    created_by: AUDIT_ACTOR_SCHEMA,
    created_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const ComplaintFileSchema = new mongoose.Schema(
  {
    original_name: { type: String, default: "", trim: true },
    file_name: { type: String, default: "", trim: true },
    mime_type: { type: String, default: "", trim: true },
    size: { type: Number, default: 0, min: 0 },
    key: { type: String, default: "", trim: true },
    url: { type: String, default: "", trim: true },
    uploaded_by: AUDIT_ACTOR_SCHEMA,
    uploaded_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const ComplaintUpdateHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    actor: AUDIT_ACTOR_SCHEMA,
    timestamp: { type: Date, default: Date.now },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true },
);

const ComplaintReadReceiptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },
    name: { type: String, default: "", trim: true },
    read_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const ComplaintSchema = new mongoose.Schema(
  {
    complaint_no: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    brand: { type: String, required: true, index: true, trim: true },
    vendor: { type: String, required: true, index: true, trim: true },
    item_code: { type: String, required: true, index: true, trim: true },
    po: { type: String, default: "", trim: true },
    category: { type: String, default: "", index: true, trim: true },
    first_comment: { type: String, required: true, trim: true },
    comments: { type: [ComplaintCommentSchema], default: [] },
    files: { type: [ComplaintFileSchema], default: [] },
    created_by: AUDIT_ACTOR_SCHEMA,
    updated_by: AUDIT_ACTOR_SCHEMA,
    read_receipts: { type: [ComplaintReadReceiptSchema], default: [] },
    update_history: { type: [ComplaintUpdateHistorySchema], default: [] },
    archived: { type: Boolean, default: false, index: true },
    archived_at: { type: Date, default: null },
    archived_by: AUDIT_ACTOR_SCHEMA,
    archived_reason: { type: String, default: "", trim: true },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    collection: "complaints",
  },
);

ComplaintSchema.index({ created_at: -1 });
ComplaintSchema.index({ brand: 1, vendor: 1, item_code: 1 });
ComplaintSchema.index({ item_code: 1, archived: 1, updated_at: -1 });

module.exports = {
  Complaint: mongoose.model("complaints", ComplaintSchema),
};

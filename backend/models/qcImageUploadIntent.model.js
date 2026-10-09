const mongoose = require("mongoose");

const AuditActorSchema = new mongoose.Schema(
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

const QcImageUploadIntentSchema = new mongoose.Schema(
  {
    qc: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "qc",
      required: true,
      index: true,
    },
    inspection: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspections",
      default: null,
    },
    request_history_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    operation: {
      type: String,
      enum: ["rejection", "goods_not_ready", "reject_all"],
      required: true,
      index: true,
    },
    image_type: {
      type: String,
      enum: ["rejected_images", "goods_not_ready_images"],
      required: true,
    },
    comment: { type: String, default: "", trim: true },
    images: { type: [mongoose.Schema.Types.Mixed], default: [] },
    state: {
      type: String,
      enum: ["open", "committed", "cancelled", "expired"],
      default: "open",
      index: true,
    },
    expires_at: { type: Date, required: true, index: true },
    committed_at: { type: Date, default: null },
    created_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { timestamps: true },
);

QcImageUploadIntentSchema.index({ qc: 1, state: 1, expires_at: 1 });
QcImageUploadIntentSchema.index({ "images.upload.upload_id": 1 }, { sparse: true });

module.exports = mongoose.model("qc_image_upload_intents", QcImageUploadIntentSchema);

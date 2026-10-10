const mongoose = require("mongoose");

const qcFormDraftSchema = new mongoose.Schema(
  {
    qc: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "qc",
      required: true,
      immutable: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      immutable: true,
    },
    mode: { type: String, required: true, trim: true, lowercase: true },
    record_id: { type: String, default: "", trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    updated_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true },
    discarded_at: { type: Date, default: null },
  },
  { collection: "qc_form_drafts", timestamps: true },
);

qcFormDraftSchema.index(
  { qc: 1, user: 1, mode: 1, record_id: 1 },
  { unique: true },
);
qcFormDraftSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.QcFormDraft
  || mongoose.model("QcFormDraft", qcFormDraftSchema);

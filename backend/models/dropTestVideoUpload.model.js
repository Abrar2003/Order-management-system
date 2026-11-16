const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  qc: { type: mongoose.Schema.Types.ObjectId, required: true },
  test: { type: mongoose.Schema.Types.ObjectId, required: true },
  test_version: { type: String, required: true },
  request_key: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
  fingerprint: { type: String, required: true },
  original_name: { type: String, required: true },
  content_type: { type: String, required: true },
  size: { type: Number, required: true },
  key: { type: String, required: true },
  wasabi_upload_id: { type: String, required: true },
  expires_at: { type: Date, required: true, expires: 0 },
});

schema.index({ qc: 1, test: 1, test_version: 1, request_key: 1, user: 1, fingerprint: 1 }, { unique: true });

module.exports = mongoose.model("DropTestVideoUpload", schema);

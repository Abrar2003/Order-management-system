const mongoose = require("mongoose");

const OrderReferenceUploadSchema = new mongoose.Schema({
  uploader: { type: mongoose.Schema.Types.ObjectId, required: true },
  group_key: { type: String, required: true },
  order_row: { type: mongoose.Schema.Types.ObjectId, default: null },
  files: [{
    name: { type: String, required: true },
    size: { type: Number, required: true },
    content_type: { type: String, required: true },
  }],
  state: {
    type: String,
    enum: ["open", "copying", "ready", "committed"],
    default: "open",
  },
  copy_id: mongoose.Schema.Types.ObjectId,
  copy_started_at: Date,
  copy_attempts: [mongoose.Schema.Types.ObjectId],
  expires_at: { type: Date, required: true, index: true },
});

module.exports = mongoose.model("order_reference_uploads", OrderReferenceUploadSchema);

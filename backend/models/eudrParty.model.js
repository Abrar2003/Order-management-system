const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  kind: { type: String, enum: ["sawmill", "transporter", "vehicle"], required: true },
  identity_key: { type: String, required: true },
  name: { type: String, required: true },
  parent_key: String,
  fields: { type: mongoose.Schema.Types.Mixed, required: true },
  evidence: [{ type: { type: String, required: true }, key: String, name: String, content_type: String, size: Number, sha256: String }],
}, { timestamps: true });
schema.index({ kind: 1, identity_key: 1 }, { unique: true });
schema.index({ kind: 1, parent_key: 1, name: 1 });
module.exports = mongoose.models.EudrParty || mongoose.model("EudrParty", schema, "eudr_parties");

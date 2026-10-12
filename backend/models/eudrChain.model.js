const mongoose = require("mongoose");

const stageSchema = new mongoose.Schema({
  kind: { type: String, required: true, enum: ["sawmill", "transport", "receiver", "declaration"] },
  fields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  documents: [{
    type: { type: String, required: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    content_type: String,
    size: Number,
    sha256: String,
    uploaded_at: { type: Date, default: Date.now },
  }],
  verified_at: { type: Date, default: null },
  verified_by: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
  verified_by_name: { type: String, default: "" },
  verification_method: { type: String, default: "manual" },
  verification_result: { type: String, enum: ["pending", "verified"], default: "pending" },
  vendor_signature: { type: String, default: "" },
  shipment_signature: { type: String, default: "" },
});

const schema = new mongoose.Schema({
  container: { type: String, required: true, trim: true },
  container_key: { type: String, required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
  declared_milli_cft: { type: Number, required: true, min: 0 },
  stages: { type: [stageSchema], default: () => [{ kind: "sawmill" }] },
  invoice_keys: { type: [String], default: [] },
  history: [{
    event: String,
    stage_id: String,
    at: { type: Date, default: Date.now },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
    actor_name: String,
    detail: mongoose.Schema.Types.Mixed,
  }],
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ container_key: 1, vendor: 1 }, { unique: true });
schema.index({ invoice_keys: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.EudrChain || mongoose.model("EudrChain", schema, "eudr_chains");

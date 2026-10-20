const mongoose = require("mongoose");

const stageSchema = new mongoose.Schema({
  kind: { type: String, required: true, enum: ["sawmill", "transport", "receiver", "declaration"] },
  workflow_version: { type: Number, default: 1 },
  incoming_invoice_stage_id: { type: String, default: "" },
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
  contribution_milli_cft: { type: Number, min: 1, default: null },
  stages: { type: [stageSchema], default: () => [{ kind: "sawmill" }] },
  invoice_keys: { type: [String], default: undefined },
  canonical_invoices: [{ type: mongoose.Schema.Types.ObjectId, ref: "EudrInvoice" }],
  inventory_backed: { type: Boolean, default: false },
  inventory_status: { type: String, enum: ["LEGACY", "RESERVED", "COMMITTED", "ON_HOLD"], default: "LEGACY" },
  inventory_commitment: { type: mongoose.Schema.Types.ObjectId, ref: "EudrTimberCommitment" },
  inventory_revision: Number,
  declaration_lines:{type:[{shipment_ref:{source:String,source_id:String,shipment_id:String},item_or_sample_code:String,qty:Number,declared_cft_per_unit_milli:Number,species_shares:[{species:{type:mongoose.Schema.Types.ObjectId,ref:"EudrSpecies"},share_bp:Number}]}],default:undefined},
  europe_reported_at:Date,europe_report_submission:{type:mongoose.Schema.Types.ObjectId,ref:"EudrReportSubmission"},review_signature:String,
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

schema.pre("validate", function () {
  // Sparse unique indexes skip absent fields, but not empty arrays shared by multiple drafts.
  if (this.invoice_keys?.length === 0) this.invoice_keys = undefined;
});

schema.index({ container_key: 1, vendor: 1, createdAt: 1 });
// The migration removes this exact index only after permanent invoice ownership is populated.
if (process.env.EUDR_CANONICAL_INVOICES !== "true") schema.index({ invoice_keys: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.EudrChain || mongoose.model("EudrChain", schema, "eudr_chains");

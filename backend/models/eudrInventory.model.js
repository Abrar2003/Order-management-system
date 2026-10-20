const mongoose = require("mongoose");
const { Schema } = mongoose;
const ref = name => ({ type: Schema.Types.ObjectId, ref: name });
const quantity = { type: Number, min: 0, validate: Number.isSafeInteger };
const states = ["DRAFT", "RESERVED", "COMMITTED", "ON_HOLD", "REJECTED", "CANCELLED", "SUPERSEDED"];
const verification = new Schema({
  status: { type: String, enum: ["PENDING", "VERIFIED", "ON_HOLD"], default: "PENDING" },
  evidence_revision: Number, actor: ref("users"), at: Date, method: String, note: String, same_day_reviewed: Boolean,
}, { _id: false });
const base = {
  status: { type: String, enum: states, default: "DRAFT", index: true },
  revision: { type: Number, default: 1 }, verification: { type: verification, default: () => ({}) },
  origin_status: { type: String, enum: ["PENDING", "REVIEW_REQUIRED", "VERIFIED", "ON_HOLD"], default: "PENDING" },
  documents: [ref("EudrDocument")], created_by: ref("users"), legacy: { type: Boolean, default: false },
};
const input = new Schema({ lot: { ...ref("EudrTimberLot"), required: true }, participation: { type: String, enum: ["CONFIRMED", "POSSIBLE"], default: "POSSIBLE" }, exact_milli: quantity, min_milli: quantity, max_milli: quantity, evidence_note: String }, { _id: false });
const model = (name, collection, fields, indexes = []) => {
  const schema = new Schema(fields, { timestamps: true, optimisticConcurrency: true });
  indexes.forEach(([keys, options]) => schema.index(keys, options || {}));
  return mongoose.models[name] || mongoose.model(name, schema, collection);
};
const Document = model("EudrDocument", "eudr_documents", {
  key: { type: String, required: true, unique: true }, name: { type: String, required: true },
  sha256: { type: String, index: true }, content_type: String, size: Number, purpose: String, created_by: ref("users"),
  legacy_reference: { chain: ref("EudrChain"), stage_id: String, document_id: String },
});
const Invoice = model("EudrInvoice", "eudr_invoices", {
  ...base, identity_key: { type: String, required: true, unique: true }, issuer: { type: String, required: true, index: true }, buyer: { type: String, required: true, index: true },
  issuer_snapshot: Schema.Types.Mixed, buyer_snapshot: Schema.Types.Mixed,
  number: { type: String, required: true, index: true }, date: { type: String, required: true }, financial_year: Number,
  invoice_type: { type: String, default: "TIMBER_SALE" }, total_milli: { ...quantity, required: true },
  lines: [{ line_id: { type: String, required: true }, quantity_milli: { ...quantity, required: true }, material: { type: String, enum: ["RAW", "PROCESSING_INPUT", "FINISHED"], required: true }, species: {type:Schema.Types.Mixed,ref:"EudrSpecies"}, legacy_species:String }],
  document_checks:Schema.Types.Mixed,einvoice_irn:String,
  chain_references: [ref("EudrChain")],
  invoice_documents:{type:[ref("EudrDocument")],default:undefined},
}, [[{ issuer: 1, date: 1 }],[{invoice_documents:1},{unique:true,sparse:true}]]);
const SourceBatch = model("EudrTimberSourceBatch", "eudr_source_batches", {
  ...base, identity_key: { type: String, required: true, unique: true }, owner: { type: String, required: true, index: true },
  quantity_milli: { ...quantity, required: true }, production_date: String, harvest_date: String, cutting_limit_milli: quantity,
  species:ref("EudrSpecies"), production_reference_key:String,
  origins: [{ plot: String, plot_ref:ref("EudrPlot"), latitude: Number, longitude: Number, species: String, permission: String }],
  output_lot: ref("EudrTimberLot"), material: { type: String, enum: ["RAW", "PROCESSING_INPUT"], default: "RAW" },
  production_documents:{type:[ref("EudrDocument")],default:undefined},
});
const Lot = model("EudrTimberLot", "eudr_timber_lots", {
  ...base, identity_key: { type: String, required: true, unique: true }, owner: { type: String, required: true, index: true },
  holder_snapshot: Schema.Types.Mixed, species:ref("EudrSpecies"), kind: { type: String, enum: ["SOURCE", "RECEIPT", "TRANSFORMED"], required: true },
  invoice: ref("EudrInvoice"), line_id: String, source_batch: ref("EudrTimberSourceBatch"), incoming_operation: ref("EudrTimberTransfer"),
  quantity_milli: { ...quantity, required: true }, documented_milli: quantity, available_date: { type: String, required: true, index: true },
  material: { type: String, enum: ["RAW", "PROCESSING_INPUT", "FINISHED"], required: true },
}, [[{ invoice: 1, line_id: 1 }], [{ incoming_operation: 1 }, { unique: true, sparse: true }], [{ source_batch: 1 }, { unique: true, sparse: true }], [{ owner: 1, status: 1, available_date: 1 }]]);
const Transfer = model("EudrTimberTransfer", "eudr_timber_transfers", {
  ...base, identity_key: { type: String, required: true, unique: true }, request_hash: String,
  kind: { type: String, enum: ["TRANSFER", "TRANSFORMATION"], default: "TRANSFER" }, species:ref("EudrSpecies"),
  transport:{eway_bill_no:String,bilty_no:String,vehicle_no:String,net_kg:{type:Number,min:0},driver_licence_no:String},document_checks:Schema.Types.Mixed,
  seller: { type: String, required: true, index: true }, buyer: { type: String, required: true, index: true },
  invoice: ref("EudrInvoice"), line_id: String, fulfillment: String, quantity_milli: { ...quantity, required: true },
  output_quantity_milli: { ...quantity, required: true }, loss_milli: quantity, discrepancy_note: String,
  date: { type: String, required: true, index: true }, dispatch_date: String, receipt_date: String,
  input_material: { type: String, enum: ["RAW", "PROCESSING_INPUT", "FINISHED"], required: true },
  output_material: { type: String, enum: ["RAW", "PROCESSING_INPUT", "FINISHED"], required: true },
  inputs: [input], mode: { type: String, enum: ["EXACT", "UNKNOWN", "PARTIAL"], default: "UNKNOWN" },
  output_lot: ref("EudrTimberLot"), chains: [ref("EudrChain")], transport_documents: [ref("EudrDocument")], receipt_documents: [ref("EudrDocument")],
}, [[{ "inputs.lot": 1 }], [{ invoice: 1, line_id: 1 }], [{ output_lot: 1 }], [{ chains: 1 }]]);
const Mix = model("EudrTimberMix", "eudr_timber_mixes", {
  ...base, identity_key: { type: String, required: true, unique: true }, owner: { type: String, required: true },
  inputs: [input], mode: { type: String, enum: ["EXACT", "UNKNOWN", "PARTIAL"], default: "UNKNOWN" },
  physical_mixing: { type: Boolean, default: false }, note: String,
  output_transfer: ref("EudrTimberTransfer"),
}, [[{ "inputs.lot": 1 }]]);
const Commitment = model("EudrTimberCommitment", "eudr_timber_commitments", {
  ...base, identity_key: { type: String, required: true, unique: true }, request_hash: String,
  seller: { type: String, required: true }, quantity_milli: { ...quantity, required: true }, inputs: [input],
  mode: { type: String, enum: ["EXACT", "UNKNOWN", "PARTIAL"], default: "EXACT" }, input_material: { type: String, default: "FINISHED" },
  date: { type: String, required: true }, container: String, container_key: { type: String, index: true },
  vendor: ref("Vendor"), chain: { ...ref("EudrChain"), unique: true, required: true }, shipment_signature: String,
  species_allocations:{type:[{species:ref("EudrSpecies"),quantity_milli:quantity,mode:String,inputs:[input]}],default:undefined},
  same_day_reviewed: { type: Boolean, default: false },
}, [[{ "inputs.lot": 1 }], [{ container_key: 1, vendor: 1 }]]);
const Audit = model("EudrInventoryAudit", "eudr_inventory_audit", {
  event: { type: String, required: true, index: true }, entity_type: String, entity: Schema.Types.ObjectId,
  actor: ref("users"), actor_name: String, revision: Number, reason: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed, details: Schema.Types.Mixed,
}, [[{ entity: 1, createdAt: -1 }], [{ createdAt: -1 }]]);
const Review = model("EudrMigrationReview", "eudr_migration_reviews", { identity_key: { type: String, unique: true }, chain: ref("EudrChain"), reasons: [String], snapshot: Schema.Types.Mixed, resolved: { type: Boolean, default: false } });
const State = model("EudrInventoryState", "eudr_inventory_state", { _id: String, revision: { type: Number, default: 0 }, registry_ready: { type: Boolean, default: false }, allocation_enabled: { type: Boolean, default: false }, invoice_index_transitioned: { type: Boolean, default: false },inventory_enforced:{type:Boolean,default:false},review_layer_ready:Boolean,production_proof_index_transitioned:Boolean });
module.exports = { Document, Invoice, SourceBatch, Lot, Transfer, Mix, Commitment, Audit, Review, State, states };

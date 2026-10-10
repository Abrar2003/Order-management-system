const mongoose = require("mongoose");

const actorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    name: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const shipmentReferenceSchema = new mongoose.Schema(
  {
    ref_key: { type: String, required: true, trim: true },
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "orders", required: true },
    order_number: { type: String, default: "", trim: true },
    item_code: { type: String, default: "", trim: true },
    shipment_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    container_number: { type: String, default: "", trim: true },
    stuffing_date: { type: Date, default: null },
    invoice_number: { type: String, default: "", trim: true },
    shipment_quantity: { type: Number, default: null },
  },
  { _id: false },
);

const manufacturerSnapshotSchema = new mongoose.Schema(
  {
    vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    name: { type: String, required: true, trim: true },
    country: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const timberContainerConsumptionSchema = new mongoose.Schema(
  {
    manufacturer_vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    manufacturer_snapshot: { type: manufacturerSnapshotSchema, required: true },
    container_number: { type: String, required: true, trim: true },
    container_number_normalized: { type: String, required: true, trim: true, index: true },
    shipment_group_id: { type: String, required: true, unique: true, trim: true },
    active_shipment_group_key: { type: String, required: true, trim: true },
    oms_shipment_refs: { type: [shipmentReferenceSchema], required: true, validate: [(value) => Array.isArray(value) && value.length > 0, "Select at least one OMS shipment row"] },
    oms_shipment_ref_keys: { type: [String], required: true },
    stuffing_date: { type: Date, default: null },
    invoice_numbers: { type: [String], default: [] },
    reported_cft_units: { type: Number, required: true, min: 1 },
    confirmed_cft_units: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["DRAFT", "CONFIRMED", "REVERSED"], default: "DRAFT", index: true },
    remarks: { type: String, default: "", trim: true, maxlength: 4000 },
    reported_by: { type: actorSchema, default: () => ({}) },
    reported_at: { type: Date, default: Date.now },
    confirmed_by: { type: actorSchema, default: null },
    confirmed_at: { type: Date, default: null },
    reversed_by: { type: actorSchema, default: null },
    reversed_at: { type: Date, default: null },
    reversal_reason: { type: String, default: "", trim: true, maxlength: 4000 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "timber_container_consumptions" },
);

timberContainerConsumptionSchema.index(
  { oms_shipment_ref_keys: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["DRAFT", "CONFIRMED"] } }, name: "timber_active_consumption_shipment_ref_unique" },
);
timberContainerConsumptionSchema.index(
  { active_shipment_group_key: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["DRAFT", "CONFIRMED"] } }, name: "timber_active_consumption_group_unique" },
);
timberContainerConsumptionSchema.index({ manufacturer_vendor_id: 1, stuffing_date: -1 });
timberContainerConsumptionSchema.index({ container_number_normalized: 1, stuffing_date: -1 });

module.exports = mongoose.models.TimberContainerConsumption
  || mongoose.model("TimberContainerConsumption", timberContainerConsumptionSchema);

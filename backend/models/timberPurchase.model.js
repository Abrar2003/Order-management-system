const mongoose = require("mongoose");
const { DOCUMENT_CATEGORIES, totalDeliveryMilliCft } = require("../helpers/eudrTimber");

const actorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    name: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const ManufacturerSnapshotSchema = new mongoose.Schema(
  {
    vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    name: { type: String, required: true, trim: true },
    country: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const DeliveryEntrySchema = new mongoose.Schema(
  {
    received_cft_milli: { type: Number, required: true, min: 1 },
    delivery_date: { type: Date, default: null },
    transporter_name: { type: String, default: "", trim: true },
    transporter_contact_number: { type: String, default: "", trim: true },
    vehicle_number: { type: String, default: "", trim: true },
    delivery_challan_number: { type: String, default: "", trim: true },
    e_way_bill_number: { type: String, default: "", trim: true },
    remarks: { type: String, default: "", trim: true, maxlength: 2000 },
    created_by: { type: actorSchema, default: () => ({}) },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const DocumentSchema = new mongoose.Schema(
  {
    category: { type: String, enum: DOCUMENT_CATEGORIES, required: true },
    storage_key: { type: String, required: true, trim: true },
    original_name: { type: String, required: true, trim: true },
    mime_type: { type: String, required: true, trim: true },
    size_bytes: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true, trim: true, lowercase: true },
    uploaded_by: { type: actorSchema, default: () => ({}) },
    uploaded_at: { type: Date, default: Date.now },
    replaced_document_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    replaced_at: { type: Date, default: null },
    replaced_by: { type: actorSchema, default: null },
  },
  { _id: true },
);

const ValidationFlagSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    severity: { type: String, enum: ["HARD", "WARNING", "INFO"], required: true },
    message: { type: String, required: true, trim: true },
    matched_purchase_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    state: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN" },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const AuditHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    actor: { type: actorSchema, default: () => ({}) },
    timestamp: { type: Date, default: Date.now },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true },
);

const TimberPurchaseSchema = new mongoose.Schema(
  {
    purchase_number: { type: String, required: true, unique: true, trim: true, index: true },
    manufacturer_vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null, index: true },
    manufacturer_snapshot: { type: ManufacturerSnapshotSchema, default: null },
    timber_supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: "TimberSupplier", default: null, index: true },
    supplier_snapshot: { name: { type: String, default: "", trim: true }, gstin: { type: String, default: "", trim: true } },
    invoice_number: { type: String, default: "", trim: true },
    normalized_invoice_number: { type: String, default: "", trim: true, index: true },
    financial_year: { type: String, default: "", trim: true, index: true },
    invoice_date: { type: Date, default: null, index: true },
    species: { type: String, default: "", trim: true, maxlength: 300 },
    purchased_cft_milli: { type: Number, default: 0, min: 0 },
    received_cft_milli: { type: Number, default: 0, min: 0 },
    delivery_entries: { type: [DeliveryEntrySchema], default: [] },
    transport_details: {
      transporter_name: { type: String, default: "", trim: true },
      transporter_contact_number: { type: String, default: "", trim: true },
      vehicle_number: { type: String, default: "", trim: true },
      transport_date: { type: Date, default: null },
      delivery_challan_number: { type: String, default: "", trim: true },
      e_way_bill_number: { type: String, default: "", trim: true },
      delivery_remarks: { type: String, default: "", trim: true, maxlength: 2000 },
    },
    purchase_remarks: { type: String, default: "", trim: true, maxlength: 4000 },
    documents: { type: [DocumentSchema], default: [] },
    origin_information: {
      harvesting_country: { type: String, default: "", trim: true },
      scientific_species_name: { type: String, default: "", trim: true },
      origin_document_reference: { type: String, default: "", trim: true },
      remarks: { type: String, default: "", trim: true, maxlength: 4000 },
    },
    document_check: {
      invoice_quantity_milli_cft: { type: Number, default: null, min: 0 },
      invoice_supplier_name: { type: String, default: "", trim: true },
      invoice_gstin: { type: String, default: "", trim: true },
      invoice_quantity_confirmed: { type: Boolean, default: false },
    },
    verification_status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "NEEDS_INFORMATION", "APPROVED", "REJECTED"],
      default: "DRAFT",
      index: true,
    },
    validation_flags: { type: [ValidationFlagSchema], default: [] },
    reviewer_notes: { type: String, default: "", trim: true, maxlength: 4000 },
    reviewed_by: { type: actorSchema, default: null },
    reviewed_at: { type: Date, default: null },
    created_by: { type: actorSchema, default: () => ({}) },
    updated_by: { type: actorSchema, default: () => ({}) },
    submitted_at: { type: Date, default: null },
    audit_history: { type: [AuditHistorySchema], default: [] },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "timber_purchases" },
);

TimberPurchaseSchema.index(
  { timber_supplier_id: 1, normalized_invoice_number: 1, financial_year: 1 },
  {
    unique: true,
    partialFilterExpression: { verification_status: "APPROVED" },
    name: "timber_purchase_approved_invoice_identity_unique",
  },
);
TimberPurchaseSchema.index({ manufacturer_vendor_id: 1, verification_status: 1, created_at: -1 });
TimberPurchaseSchema.index({ "documents.sha256": 1 });
TimberPurchaseSchema.index({ "transport_details.e_way_bill_number": 1 });

TimberPurchaseSchema.pre("validate", function validateReceivedQuantity() {
  const total = totalDeliveryMilliCft(this.delivery_entries);
  this.received_cft_milli = total;
  if (total > this.purchased_cft_milli && this.purchased_cft_milli > 0) {
    this.invalidate("delivery_entries", "Received CFT cannot exceed purchased CFT");
  }
});

module.exports = mongoose.models.TimberPurchase
  || mongoose.model("TimberPurchase", TimberPurchaseSchema);

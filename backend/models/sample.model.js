const mongoose = require("mongoose");
const {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
} = require("../helpers/boxMeasurement");

const SIZE_ENTRY_LIMIT = 4;

const SAMPLE_STATUSES = Object.freeze([
  "created",
  "cad_pending",
  "cad_ready",
  "sent_to_client",
  "client_revision_requested",
  "client_approved",
  "sent_to_vendor",
  "manufacturing",
  "inspection_requested",
  "inspected",
  "shipping_planned",
  "shipped",
  "completed",
  "cancelled",
  "on_hold",
]);

const MANUFACTURING_STATUSES = Object.freeze([
  "not_started",
  "manufacturing",
  "ready",
  "delayed",
  "cancelled",
]);
const INSPECTION_STATUSES = Object.freeze([
  "not_requested",
  "requested",
  "inspected",
  "failed",
  "cancelled",
]);

const AuditActorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    name: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const SampleFileSchema = new mongoose.Schema(
  {
    key: { type: String, default: "", trim: true },
    originalName: { type: String, default: "", trim: true },
    contentType: { type: String, default: "", trim: true },
    size: { type: Number, default: 0, min: 0 },
    link: { type: String, default: "", trim: true },
    public_id: { type: String, default: "", trim: true },
    uploadedAt: { type: Date, default: Date.now },
    uploaded_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { _id: true },
);

const ShipmentEntrySchema = new mongoose.Schema(
  {
    container: { type: String, trim: true, required: true },
    invoice_number: {
      type: String,
      trim: true,
      required: false,
      default: "",
    },
    stuffing_date: { type: Date },
    quantity: { type: Number, default: 1, min: 0 },
    pending: { type: Number, default: 0, min: 0 },
    cases: [{ type: Number, required: true }],
    remaining_remarks: { type: String, default: "", trim: true },
    stuffed_by: {
      name: { type: String, default: "", trim: true },
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    checked: {
      checked_by: { type: mongoose.Schema.Types.ObjectId, default: null },
      checked: { type: Boolean, required: true, default: false },
    },
    updated_at: { type: Date, default: Date.now },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { _id: true },
);

const createSizeEntrySchema = () =>
  new mongoose.Schema(
    {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
      remark: { type: String, default: "", trim: true },
      net_weight: { type: Number, default: 0, min: 0 },
      gross_weight: { type: Number, default: 0, min: 0 },
    },
    { _id: false },
  );

const itemSizeEntrySchema = createSizeEntrySchema();
const boxSizeEntrySchema = new mongoose.Schema(
  {
    L: { type: Number, default: 0, min: 0 },
    B: { type: Number, default: 0, min: 0 },
    H: { type: Number, default: 0, min: 0 },
    remark: { type: String, default: "", trim: true },
    net_weight: { type: Number, default: 0, min: 0 },
    gross_weight: { type: Number, default: 0, min: 0 },
    box_type: {
      type: String,
      enum: Object.values(BOX_ENTRY_TYPES),
      default: BOX_ENTRY_TYPES.INDIVIDUAL,
      trim: true,
    },
    item_count_in_inner: { type: Number, default: 0, min: 0 },
    box_count_in_master: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const VendorCommentSchema = new mongoose.Schema(
  {
    comment: { type: String, default: "", trim: true },
    created_by: { type: AuditActorSchema, default: () => ({}) },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const VendorEntrySchema = new mongoose.Schema(
  {
    vendor_name: { type: String, default: "", trim: true },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "vendors",
      default: null,
    },
    contact_name: { type: String, default: "", trim: true },
    expected_manufacturing_date: { type: Date, default: null },
    manufacturing_status: {
      type: String,
      enum: MANUFACTURING_STATUSES,
      default: "not_started",
      trim: true,
    },
    inspection_requested_at: { type: Date, default: null },
    inspection_status: {
      type: String,
      enum: INSPECTION_STATUSES,
      default: "not_requested",
      trim: true,
    },
    inspected_at: { type: Date, default: null },
    estimated_shipping_date: { type: Date, default: null },
    shipped_at: { type: Date, default: null },
    tracking: { type: String, default: "", trim: true },
    container: { type: String, default: "", trim: true },
    shipment_remarks: { type: String, default: "", trim: true },
    files: { type: [SampleFileSchema], default: [] },
    comments: { type: [VendorCommentSchema], default: [] },
  },
  { _id: true },
);

const TimelineEntrySchema = new mongoose.Schema(
  {
    stage: { type: String, default: "", trim: true },
    action: { type: String, default: "", trim: true },
    status_from: { type: String, default: "", trim: true },
    status_to: { type: String, default: "", trim: true },
    comment: { type: String, default: "", trim: true },
    files: { type: [SampleFileSchema], default: [] },
    vendor_name: { type: String, default: "", trim: true },
    changed_fields: {
      type: [
        {
          field: { type: String, default: "", trim: true },
          before: { type: mongoose.Schema.Types.Mixed, default: null },
          after: { type: mongoose.Schema.Types.Mixed, default: null },
        },
      ],
      default: [],
    },
    created_by: { type: AuditActorSchema, default: () => ({}) },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const normalizeShipmentInvoiceNumber = (value, fallback = "") => {
  const normalized = String(value ?? "").trim();
  return normalized || String(fallback ?? "").trim();
};

const sampleSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    name: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    brand: { type: String, default: "", trim: true },
    vendor: { type: [String], default: [] },
    vendor_entries: { type: [VendorEntrySchema], default: [] },
    item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `item_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
      },
    },
    box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `box_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
      },
    },
    box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
    },
    cbm: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    current_status: {
      type: String,
      enum: SAMPLE_STATUSES,
      default: "created",
      index: true,
      trim: true,
    },
    assigned_cad_artist: { type: String, default: "", trim: true },
    requested_by: { type: AuditActorSchema, default: () => ({}) },
    created_by: { type: AuditActorSchema, default: () => ({}) },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
    cad_completed_at: { type: Date, default: null },
    sent_to_client_at: { type: Date, default: null },
    client_approved_at: { type: Date, default: null },
    sent_to_vendor_at: { type: Date, default: null },
    expected_manufacturing_date: { type: Date, default: null },
    inspection_requested_at: { type: Date, default: null },
    inspected_at: { type: Date, default: null },
    estimated_shipping_date: { type: Date, default: null },
    shipped_at: { type: Date, default: null },
    image: {
      key: { type: String, default: "", trim: true },
      originalName: { type: String, default: "", trim: true },
      contentType: { type: String, default: "", trim: true },
      size: { type: Number, default: 0, min: 0 },
      link: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    },
    cad_file: {
      key: { type: String, default: "", trim: true },
      originalName: { type: String, default: "", trim: true },
      contentType: { type: String, default: "", trim: true },
      size: { type: Number, default: 0, min: 0 },
      link: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    },
    initial_sketch_files: { type: [SampleFileSchema], default: [] },
    cad_files: { type: [SampleFileSchema], default: [] },
    sample_images: { type: [SampleFileSchema], default: [] },
    other_files: { type: [SampleFileSchema], default: [] },
    qc_images: [
      {
        key: { type: String, default: "", trim: true },
        hash: { type: String, default: "", trim: true, lowercase: true },
        originalName: { type: String, default: "", trim: true },
        contentType: { type: String, default: "", trim: true },
        size: { type: Number, default: 0, min: 0 },
        comment: { type: String, default: "", trim: true },
        link: { type: String, default: "", trim: true },
        public_id: { type: String, default: "", trim: true },
        uploadedAt: { type: Date, default: Date.now },
        uploaded_by: { type: AuditActorSchema, default: () => ({}) },
      },
    ],
    timeline: { type: [TimelineEntrySchema], default: [] },
    shipment: { type: [ShipmentEntrySchema], default: [] },
    archived: { type: Boolean, default: false, index: true },
    archived_at: { type: Date, default: null },
    archived_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { timestamps: true },
);

sampleSchema.index(
  { "shipment.container": 1, brand: 1, updatedAt: -1, code: 1 },
  { name: "samples_shipment_container_brand_idx" },
);
sampleSchema.index({ current_status: 1, updatedAt: -1 }, { name: "samples_status_updated_idx" });
sampleSchema.index({ brand: 1, updatedAt: -1 }, { name: "samples_brand_updated_idx" });
sampleSchema.index({ "vendor_entries.vendor_name": 1, updatedAt: -1 }, { name: "samples_vendor_entries_updated_idx" });
sampleSchema.index({ archived: 1, updatedAt: -1 }, { name: "samples_archived_updated_idx" });

sampleSchema.pre("validate", function normalizeSampleCompatibility() {
  if (!Array.isArray(this.shipment)) return;

  this.shipment.forEach((entry) => {
    if (!entry) return;
    entry.invoice_number = normalizeShipmentInvoiceNumber(entry.invoice_number, "");

    if (!entry.stuffed_by || typeof entry.stuffed_by !== "object") {
      entry.stuffed_by = {};
    }

    if (!String(entry.stuffed_by.name || "").trim()) {
      entry.stuffed_by.name = String(entry.updated_by?.name || "").trim();
    }

    if (!entry.stuffed_by.id && entry.updated_by?.user) {
      entry.stuffed_by.id = entry.updated_by.user;
    }
  });

  const legacyVendors = Array.isArray(this.vendor)
    ? this.vendor.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const existingVendorNames = new Set(
    (Array.isArray(this.vendor_entries) ? this.vendor_entries : [])
      .map((entry) => String(entry?.vendor_name || "").trim().toLowerCase())
      .filter(Boolean),
  );

  legacyVendors.forEach((vendorName) => {
    if (existingVendorNames.has(vendorName.toLowerCase())) return;
    this.vendor_entries.push({ vendor_name: vendorName });
    existingVendorNames.add(vendorName.toLowerCase());
  });

  this.vendor = [
    ...new Set(
      [
        ...legacyVendors,
        ...(Array.isArray(this.vendor_entries)
          ? this.vendor_entries.map((entry) => String(entry?.vendor_name || "").trim())
          : []),
      ].filter(Boolean),
    ),
  ];
});

module.exports = mongoose.model("samples", sampleSchema);
module.exports.SAMPLE_STATUSES = SAMPLE_STATUSES;
module.exports.MANUFACTURING_STATUSES = MANUFACTURING_STATUSES;
module.exports.INSPECTION_STATUSES = INSPECTION_STATUSES;

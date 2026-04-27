const mongoose = require("mongoose");
const {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
  BOX_SIZE_REMARK_OPTIONS,
} = require("../helpers/boxMeasurement");

const SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARKS = [
  "",
  "item",
  "top",
  "base",
  "item1",
  "item2",
  "item3",
  "item4",
];
const BOX_SIZE_REMARKS = ["", ...BOX_SIZE_REMARK_OPTIONS];

const AuditActorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    name: { type: String, default: "" },
  },
  { _id: false },
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

const createSizeEntrySchema = (remarkEnum = []) =>
  new mongoose.Schema(
    {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
      remark: {
        type: String,
        enum: remarkEnum,
        default: "",
        trim: true,
      },
      net_weight: { type: Number, default: 0, min: 0 },
      gross_weight: { type: Number, default: 0, min: 0 },
    },
    { _id: false },
  );

const itemSizeEntrySchema = createSizeEntrySchema(ITEM_SIZE_REMARKS);
const boxSizeEntrySchema = new mongoose.Schema(
  {
    L: { type: Number, default: 0, min: 0 },
    B: { type: Number, default: 0, min: 0 },
    H: { type: Number, default: 0, min: 0 },
    remark: {
      type: String,
      enum: BOX_SIZE_REMARKS,
      default: "",
      trim: true,
    },
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
    qc_images: [
      {
        key: { type: String, default: "", trim: true },
        hash: { type: String, default: "", trim: true, lowercase: true },
        originalName: { type: String, default: "", trim: true },
        contentType: { type: String, default: "", trim: true },
        size: { type: Number, default: 0, min: 0 },
        comment: { type: String, default: "", trim: true },
        uploadedAt: { type: Date, default: Date.now },
        uploaded_by: { type: AuditActorSchema, default: () => ({}) },
      },
    ],
    shipment: { type: [ShipmentEntrySchema], default: [] },
    cbm: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { timestamps: true },
);

sampleSchema.index(
  { "shipment.container": 1, brand: 1, updatedAt: -1, code: 1 },
  { name: "samples_shipment_container_brand_idx" },
);

sampleSchema.pre("validate", function backfillLegacyShipmentInvoices() {
  if (!Array.isArray(this.shipment)) return;

  this.shipment.forEach((entry) => {
    if (!entry) return;
    entry.invoice_number = normalizeShipmentInvoiceNumber(
      entry.invoice_number,
      "",
    );

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
});

module.exports = mongoose.model("samples", sampleSchema);

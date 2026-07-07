const mongoose = require("mongoose");

const {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
} = require("../helpers/boxMeasurement");

const ITEM_SIZE_ENTRY_LIMIT = 5;
const BOX_SIZE_ENTRY_LIMIT = 4;

const createSizeEntrySchema = () =>
  new mongoose.Schema(
    {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
      remark: {
        type: String,
        default: "",
        trim: true,
      },
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
    remark: {
      type: String,
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

const createInspectionImageSchema = () =>
  new mongoose.Schema({
    key: { type: String, default: "", trim: true },
    hash: { type: String, default: "", trim: true, lowercase: true },
    idempotency_key: { type: String, default: "", trim: true, lowercase: true },
    originalName: { type: String, default: "", trim: true },
    contentType: { type: String, default: "", trim: true },
    size: { type: Number, default: 0, min: 0 },
    thumbnail_key: { type: String, default: null, trim: true },
    thumbnail_url: { type: String, default: null, trim: true },
    thumbnail_generated_at: { type: Date, default: null },
    thumbnail_status: { type: String, default: "pending", trim: true },
    thumbnail_error: { type: String, default: "", trim: true },
    thumbnail_attempts: { type: Number, default: 0, min: 0 },
    storage: {
      source_key: { type: String, default: "", trim: true },
      source_content_type: { type: String, default: "", trim: true },
      source_size_bytes: { type: Number, default: 0, min: 0 },
      source_etag: { type: String, default: "", trim: true },
      source_uploaded_at: { type: Date, default: null },
      source_deleted_at: { type: Date, default: null },
      source_cleanup_status: { type: String, default: "", trim: true },
    },
    preview: {
      key: { type: String, default: "", trim: true },
      content_type: { type: String, default: "", trim: true },
      size_bytes: { type: Number, default: 0, min: 0 },
      width: { type: Number, default: 0, min: 0 },
      height: { type: Number, default: 0, min: 0 },
      generated_at: { type: Date, default: null },
    },
    thumbnail: {
      key: { type: String, default: "", trim: true },
      content_type: { type: String, default: "", trim: true },
      size_bytes: { type: Number, default: 0, min: 0 },
      width: { type: Number, default: 0, min: 0 },
      height: { type: Number, default: 0, min: 0 },
      generated_at: { type: Date, default: null },
    },
    processing: {
      status: { type: String, default: "ready", trim: true },
      attempts: { type: Number, default: 0, min: 0 },
      error: { type: String, default: "", trim: true },
      started_at: { type: Date, default: null },
      completed_at: { type: Date, default: null },
      lock_until: { type: Date, default: null },
    },
    upload: {
      upload_id: { type: String, default: "", trim: true },
      idempotency_key: { type: String, default: "", trim: true, lowercase: true },
      uploaded_by: { type: AuditActorSchema, default: () => ({}) },
      expires_at: { type: Date, default: null },
    },
    comment: { type: String, default: "", trim: true },
    uploadedAt: { type: Date, default: Date.now },
    uploaded_by: { type: AuditActorSchema, default: () => ({}) },
  });

const inspectionImageSchema = createInspectionImageSchema();

const InspectionSchema = new mongoose.Schema(
  {
    qc: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "qc",
      required: true,
      index: true,
    },

    inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    inspection_date: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "Inspection Done",
        "goods not ready",
        "transfered",
        "rejected",
      ],
      default: "pending",
      index: true,
    },

    request_history_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    requested_date: {
      type: String,
      required: true,
    },

    // snapshot for that visit
    vendor_requested: { type: Number, required: true, min: 0 },
    vendor_offered: { type: Number, required: true, min: 0 },

    checked: { type: Number, required: true, min: 0 },
    passed: { type: Number, required: true, min: 0 },

    // store the "pending after visit" for easy history display
    pending_after: { type: Number, required: true, min: 0 },

    cbm: {
      box1: { type: String, default: "0" },
      box2: { type: String, default: "0" },
      box3: { type: String, default: "0" },
      total: { type: String, default: "0" },
    },
    barcode: {
      type: String,
      default: "",
    },
    master_barcode: {
      type: String,
      default: "",
    },
    inner_barcode: {
      type: String,
      default: "",
    },
    packed_size: {
      type: Boolean,
      default: false,
    },
    finishing: {
      type: Boolean,
      default: false,
    },
    branding: {
      type: Boolean,
      default: false,
    },
    inspected_item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= ITEM_SIZE_ENTRY_LIMIT,
        message: `inspected_item_sizes cannot exceed ${ITEM_SIZE_ENTRY_LIMIT} entries`,
      },
    },
    inspected_box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= BOX_SIZE_ENTRY_LIMIT,
        message: `inspected_box_sizes cannot exceed ${BOX_SIZE_ENTRY_LIMIT} entries`,
      },
    },
    inspected_box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
    },
    kd: { type: Boolean, default: false },
    // ranges selected during this visit (supports multiple ranges)
    label_ranges: [
      {
        start: { type: Number, min: 0, required: true },
        end: { type: Number, min: 0, required: true },
      },
    ],
    // final labels added in this visit
    labels_added: [{ type: Number, min: 0 }],

    goods_not_ready: {
      ready: { type: Boolean, default: false },
      reason: { type: String, default: "" },
    },

    qc_images: {
      type: [inspectionImageSchema],
      default: [],
      validate: {
        validator: (images) => !Array.isArray(images) || images.length <= 150,
        message: "qc_images cannot exceed 150 images",
      },
    },
    hardware_inspection: {
      type: [inspectionImageSchema],
      default: [],
      validate: {
        validator: (images) => !Array.isArray(images) || images.length <= 6,
        message: "hardware_inspection cannot exceed 6 images",
      },
    },
    goods_not_ready_images: {
      type: [inspectionImageSchema],
      default: [],
      validate: {
        validator: (images) => !Array.isArray(images) || images.length <= 10,
        message: "goods_not_ready_images cannot exceed 10 images",
      },
    },
    rejected_image: {
      type: inspectionImageSchema,
      default: null,
    },

    remarks: { type: String, default: "" },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { timestamps: true },
);

// Fast QC details page (history)
InspectionSchema.index({ qc: 1, createdAt: -1 });

// Inspector performance analytics
InspectionSchema.index({ inspector: 1, createdAt: -1 });
InspectionSchema.index({ qc: 1, request_history_id: 1, createdAt: -1 });

// Optional: prevent duplicate “same visit” accidental double-submit
// qcInspectionSchema.index({ qc: 1, inspector: 1, createdAt: 1 });

// Vendor Wise QA report scans inspection_date ranges before joining QC metadata.
InspectionSchema.index({ inspection_date: -1 });

// Vendor Wise QA detailed tab can narrow by inspector and still keep date scans ordered.
InspectionSchema.index({ inspector: 1, inspection_date: -1 });

module.exports = mongoose.model("inspections", InspectionSchema);

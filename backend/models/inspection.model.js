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
      index: true
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
    inspected_item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `inspected_item_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
      },
    },
    inspected_box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `inspected_box_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
      },
    },
    inspected_box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
    },
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

    remarks: { type: String, default: "" },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { timestamps: true }
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

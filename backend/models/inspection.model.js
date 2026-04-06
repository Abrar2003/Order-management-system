const mongoose = require("mongoose");

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
      enum: ["pending", "Inspection Done", "goods not ready", "transfered"],
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
      ready: {type: Boolean, default: false},
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

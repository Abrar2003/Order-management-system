const mongoose = require("mongoose");

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

    // snapshot for that visit
    vendor_requested: { type: Number, required: true, min: 0 },
    vendor_offered: { type: Number, required: true, min: 0 },

    checked: { type: Number, required: true, min: 0 },
    passed: { type: Number, required: true, min: 0 },

    // store the "pending after visit" for easy history display
    pending_after: { type: Number, required: true, min: 0 },

    cbm: {
      top: { type: String, default: "0" },
      bottom: { type: String, default: "0" },
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

    remarks: { type: String, default: "" },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
  },
  { timestamps: true }
);

// Fast QC details page (history)
InspectionSchema.index({ qc: 1, createdAt: -1 });

// Inspector performance analytics
InspectionSchema.index({ inspector: 1, createdAt: -1 });

// Optional: prevent duplicate “same visit” accidental double-submit
// qcInspectionSchema.index({ qc: 1, inspector: 1, createdAt: 1 });

module.exports = mongoose.model("inspections", InspectionSchema);

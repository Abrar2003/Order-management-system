const mongoose = require("mongoose");
const {
  coerceVendorValueForSchema,
  embeddedVendorSchema,
  isEmbeddedVendor,
  resolveVendorFromInput,
} = require("../helpers/vendorRef");

const labelUsageSchema = new mongoose.Schema(
  {
    inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      required: true,
    },
    labels: [{ type: Number, min: 0 }],
    inspection_record: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspections",
      required: true,
    },
    qc: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "qc",
      default: null,
    },
    request_history_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    qc_meta: {
      order_id: { type: String, default: "" },
      brand: { type: String, default: "" },
      vendor: {
        type: embeddedVendorSchema,
        default: undefined,
        set: coerceVendorValueForSchema,
      },
      item_code: { type: String, default: "" },
      description: { type: String, default: "" },
    },
    inspection_date: { type: String, default: "" },
    used_at: { type: Date, default: Date.now },
    source_updated_at: { type: Date, default: null },
    migration: {
      migrated: { type: Boolean, default: false },
      source: { type: String, default: "", trim: true },
      migrated_at: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

// The legacy rebuild creates at most one usage-history entry per Inspection.
labelUsageSchema.index({ inspection_record: 1 }, { unique: true });
labelUsageSchema.index({ inspector: 1, used_at: -1 });
labelUsageSchema.index({ labels: 1 });

labelUsageSchema.pre("validate", async function resolveVendorReference() {
  const vendor = this.qc_meta?.vendor;
  if (!vendor || isEmbeddedVendor(vendor)) return;
  this.qc_meta.vendor = await resolveVendorFromInput(vendor);
});

module.exports = mongoose.model("label_usages", labelUsageSchema);

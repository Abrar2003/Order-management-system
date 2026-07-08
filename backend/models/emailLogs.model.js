const mongoose = require("mongoose");
const {
  coerceVendorValueForSchema,
  embeddedVendorSchema,
  resolveDocumentVendorFields,
} = require("../helpers/vendorRef");

const emailLogsSchema = new mongoose.Schema({
  order_id: {
    type: String,
    required: true,
  },
  brand: {
    name: { type: String, required: true },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "brands",
      required: true,
    },
  },
  vendor: {
    type: embeddedVendorSchema,
    required: true,
    set: coerceVendorValueForSchema,
  },
  log: { type: String, trim: true, default: "" },
  creation_date: { type: Date, default: Date.now },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
  },
});

emailLogsSchema.index({ "vendor.vendor_id": 1, creation_date: -1 });

emailLogsSchema.pre("validate", async function resolveVendorReferences() {
  await resolveDocumentVendorFields(this, { single: ["vendor"] });
});

module.exports = mongoose.model("emailLogs", emailLogsSchema);

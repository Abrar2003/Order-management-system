const mongoose = require("mongoose");
const {
  coerceVendorValueForSchema,
  embeddedVendorSchema,
  resolveDocumentVendorFields,
} = require("../helpers/vendorRef");

const finishImageSchema = new mongoose.Schema(
  {
    key: { type: String, default: "", trim: true },
    originalName: { type: String, default: "", trim: true },
    contentType: { type: String, default: "", trim: true },
    size: { type: Number, default: 0, min: 0 },
    link: { type: String, default: "", trim: true },
    public_id: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const finishSchema = new mongoose.Schema(
  {
    color: { type: String, required: true, trim: true },
    color_code: { type: String, required: true, trim: true, uppercase: true },
    image: { type: finishImageSchema, default: () => ({}) },
    vendor: {
      type: embeddedVendorSchema,
      required: true,
      set: coerceVendorValueForSchema,
    },
    vendor_code: { type: String, required: true, trim: true, uppercase: true },
    item_codes: {
      type: [{ type: String, required: true, trim: true }],
      default: [],
    },
    unique_code: {
      type: String,
      unique: true,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
  }, 
  { timestamps: true },
);

finishSchema.pre("validate", async function resolveVendorReferences() {
  await resolveDocumentVendorFields(this, { single: ["vendor"] });
});

module.exports = mongoose.model("finish", finishSchema);

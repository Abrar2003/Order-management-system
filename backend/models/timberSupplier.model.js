const mongoose = require("mongoose");

const actorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    name: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const TimberSupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    normalized_name: { type: String, required: true, trim: true, index: true },
    gstin: { type: String, default: null, trim: true },
    normalized_gstin: { type: String, default: null, trim: true, index: true },
    contact_person: { type: String, default: "", trim: true, maxlength: 160 },
    mobile_number: { type: String, default: "", trim: true, maxlength: 40 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254 },
    address: { type: String, default: "", trim: true, maxlength: 2000 },
    city: { type: String, default: "", trim: true, maxlength: 120 },
    state: { type: String, default: "", trim: true, maxlength: 120 },
    country: { type: String, default: "India", trim: true, maxlength: 120 },
    supplier_type: {
      type: String,
      enum: ["TIMBER_TRADER", "SAWMILL", "DIRECT_PRODUCER", "OTHER"],
      default: "TIMBER_TRADER",
    },
    remarks: { type: String, default: "", trim: true, maxlength: 4000 },
    is_active: { type: Boolean, default: true, index: true },
    created_by: { type: actorSchema, default: () => ({}) },
    updated_by: { type: actorSchema, default: () => ({}) },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "timber_suppliers" },
);

TimberSupplierSchema.index({ normalized_gstin: 1 }, { unique: true, sparse: true, name: "timber_supplier_gstin_unique" });
TimberSupplierSchema.index(
  { normalized_name: 1, country: 1 },
  { unique: true, partialFilterExpression: { is_active: true }, name: "timber_supplier_active_name_country_unique" },
);
TimberSupplierSchema.index({ is_active: 1, name: 1 });

module.exports = mongoose.models.TimberSupplier
  || mongoose.model("TimberSupplier", TimberSupplierSchema);

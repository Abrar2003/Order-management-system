const mongoose = require("mongoose");

const vendorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  owner_name: {
    type: String,
  },
  email: {
    type: String,
  },
  phone: {
    type: String,
  },
  address: {
    type: String,
  },
  country: {
    type: String,
    trim: true,
    default: "India",
    enum: ["India", "China", "Vietnam"],
  },
  vendor_code: [
    {
      _id: false,
      brand: { type: String, trim: true, default: "" },
      code: { type: String, trim: true, default: "" },
    },
  ],
  contact_person: [
    {
      name: { type: String },
      email: { type: String },
      phone: { type: String },
      type: { type: String, enum: ["merchant", "shipment"] },
    },
  ],
  brands: [
    {
      brand_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "brands",
      },
      brand_name: {
        type: String,
      },
    },
  ],
  is_active: {
    type: Boolean,
    default: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
  deleted_at: {
    type: Date,
  },
});

module.exports =
  mongoose.models.Vendor || mongoose.model("Vendor", vendorSchema, "vendors");

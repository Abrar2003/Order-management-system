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
    default: "",
  },
  vendor_code: [{
    _id: false,
    brand: { type: String, trim: true, default: "" },
    code: { type: String, trim: true, default: "" },
  }],
  contact_person: [{
    name: { type: String },
    email: { type: String },
    phone: { type: String },
    type: { type: String, enum: ['merchant', 'shipment'] },
  }],
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

module.exports = mongoose.model("vendors", vendorSchema);

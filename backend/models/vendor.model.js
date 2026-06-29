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
  vendor_code: {
    type: String,
    required: true,
  },
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

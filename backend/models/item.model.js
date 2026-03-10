const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    name: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    brand: { type: String, default: "", trim: true },
    brand_name: { type: String, default: "", trim: true },
    brands: { type: [String], default: [] },
    vendors: { type: [String], default: [] },
    inspected_weight: {
      net: { type: Number, default: 0, min: 0 },
      gross: { type: Number, default: 0, min: 0 },
    },
    pis_weight: {
      net: { type: Number, default: 0, min: 0 },
      gross: { type: Number, default: 0, min: 0 },
    },
    cbm: {
      top: { type: String, default: "0", trim: true },
      bottom: { type: String, default: "0", trim: true },
      total: { type: String, default: "0", trim: true },
      qc_top: { type: String, default: "0", trim: true },
      qc_bottom: { type: String, default: "0", trim: true },
      qc_total: { type: String, default: "0", trim: true },
      inspected_top: { type: String, default: "0", trim: true },
      inspected_bottom: { type: String, default: "0", trim: true },
      inspected_total: { type: String, default: "0", trim: true },
      calculated_inspected_total: { type: String, default: "0", trim: true },
      calculated_pis_total: { type: String, default: "0", trim: true },
      calculated_total: { type: String, default: "0", trim: true },
    },
    inspected_item_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    inspected_item_top_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    inspected_item_bottom_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    inspected_box_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    inspected_box_top_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    inspected_box_bottom_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    inspected_top_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    inspected_bottom_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    pis_item_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    pis_item_top_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    pis_item_bottom_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    pis_box_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    pis_box_top_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    pis_box_bottom_LBH: {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
    },
    pis_barcode: { type: String, default: "", trim: true },
    qc: {
      packed_size: { type: Boolean, default: false },
      finishing: { type: Boolean, default: false },
      branding: { type: Boolean, default: false },
      barcode: { type: Number, default: 0, min: 0 },
      last_inspected_date: { type: String, default: "", trim: true },
      quantities: {
        checked: { type: Number, default: 0, min: 0 },
        passed: { type: Number, default: 0, min: 0 },
        pending: { type: Number, default: 0, min: 0 },
      },
    },
    source: {
      from_orders: { type: Boolean, default: false },
      from_qc: { type: Boolean, default: false },
    },
    image: {
      link: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    }
  },
  { timestamps: true },
);

itemSchema.index({ name: 1 });
itemSchema.index({ description: 1 });
itemSchema.index({ brand: 1 });
itemSchema.index({ brand_name: 1 });
itemSchema.index({ brands: 1 });
itemSchema.index({ vendors: 1 });

module.exports = mongoose.model("items", itemSchema);

const mongoose = require("mongoose");
const {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
  BOX_SIZE_REMARK_OPTIONS,
} = require("../helpers/boxMeasurement");

const SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARKS = [
  "",
  "item",
  "top",
  "base",
  "item1",
  "item2",
  "item3",
  "item4",
];
const BOX_SIZE_REMARKS = ["", ...BOX_SIZE_REMARK_OPTIONS];

const createSizeEntrySchema = (remarkEnum = []) =>
  new mongoose.Schema(
    {
      L: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      H: { type: Number, default: 0, min: 0 },
      remark: {
        type: String,
        enum: remarkEnum,
        default: "",
        trim: true,
      },
      net_weight: { type: Number, default: 0, min: 0 },
      gross_weight: { type: Number, default: 0, min: 0 },
    },
    { _id: false },
  );

const itemSizeEntrySchema = createSizeEntrySchema(ITEM_SIZE_REMARKS);
const boxSizeEntrySchema = new mongoose.Schema(
  {
    L: { type: Number, default: 0, min: 0 },
    B: { type: Number, default: 0, min: 0 },
    H: { type: Number, default: 0, min: 0 },
    remark: {
      type: String,
      enum: BOX_SIZE_REMARKS,
      default: "",
      trim: true,
    },
    net_weight: { type: Number, default: 0, min: 0 },
    gross_weight: { type: Number, default: 0, min: 0 },
    box_type: {
      type: String,
      enum: Object.values(BOX_ENTRY_TYPES),
      default: BOX_ENTRY_TYPES.INDIVIDUAL,
      trim: true,
    },
    item_count_in_inner: { type: Number, default: 0, min: 0 },
    box_count_in_master: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);
const finishAssignmentSchema = new mongoose.Schema(
  {
    finish_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "finish",
      default: null,
    },
    unique_code: { type: String, default: "", trim: true, uppercase: true },
    vendor: { type: String, default: "", trim: true },
    vendor_code: { type: String, default: "", trim: true, uppercase: true },
    color: { type: String, default: "", trim: true },
    color_code: { type: String, default: "", trim: true, uppercase: true },
  },
  { _id: false },
);

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
      top_net: { type: Number, default: 0, min: 0 },
      top_gross: { type: Number, default: 0, min: 0 },
      bottom_net: { type: Number, default: 0, min: 0 },
      bottom_gross: { type: Number, default: 0, min: 0 },
      total_net: { type: Number, default: 0, min: 0 },
      total_gross: { type: Number, default: 0, min: 0 },
    },
    pis_weight: {
      top_net: { type: Number, default: 0, min: 0 },
      top_gross: { type: Number, default: 0, min: 0 },
      bottom_net: { type: Number, default: 0, min: 0 },
      bottom_gross: { type: Number, default: 0, min: 0 },
      total_net: { type: Number, default: 0, min: 0 },
      total_gross: { type: Number, default: 0, min: 0 },
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
    inspected_item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `inspected_item_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
      },
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
    inspected_box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `inspected_box_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
      },
    },
    inspected_box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
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
    pis_item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `pis_item_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
      },
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
    pis_box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `pis_box_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
      },
    },
    pis_box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
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
    pis_master_barcode: { type: String, default: "", trim: true },
    pis_inner_barcode: { type: String, default: "", trim: true },
    qc: {
      packed_size: { type: Boolean, default: false },
      finishing: { type: Boolean, default: false },
      branding: { type: Boolean, default: false },
      barcode: { type: Number, default: 0, min: 0 },
      master_barcode: { type: Number, default: 0, min: 0 },
      inner_barcode: { type: Number, default: 0, min: 0 },
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
      key: { type: String, default: "", trim: true },
      originalName: { type: String, default: "", trim: true },
      contentType: { type: String, default: "", trim: true },
      size: { type: Number, default: 0, min: 0 },
      link: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    },
    cad_file: {
      key: { type: String, default: "", trim: true },
      originalName: { type: String, default: "", trim: true },
      contentType: { type: String, default: "", trim: true },
      size: { type: Number, default: 0, min: 0 },
      link: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    },
    pis_file: {
      key: { type: String, default: "", trim: true },
      originalName: { type: String, default: "", trim: true },
      contentType: { type: String, default: "", trim: true },
      size: { type: Number, default: 0, min: 0 },
      link: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    },
    assembly_file: {
      key: { type: String, default: "", trim: true },
      originalName: { type: String, default: "", trim: true },
      contentType: { type: String, default: "", trim: true },
      size: { type: Number, default: 0, min: 0 },
      link: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    },
    pis_checked_flag: { type: Boolean, default: false },
    finish: {
      type: [finishAssignmentSchema],
      default: [],
    },
  },
  { timestamps: true },
);

itemSchema.index({ name: 1 });
itemSchema.index({ description: 1 });
itemSchema.index({ brand: 1 });
itemSchema.index({ brand_name: 1 });
itemSchema.index({ brands: 1 });
itemSchema.index({ vendors: 1 });
itemSchema.index({ pis_checked_flag: 1 });

itemSchema.pre("validate", function syncBarcodeAliases() {
  const normalizedPisMasterBarcode = String(
    this.pis_master_barcode || this.pis_barcode || "",
  ).trim();
  this.pis_master_barcode = normalizedPisMasterBarcode;
  this.pis_barcode = normalizedPisMasterBarcode;
  this.pis_inner_barcode = String(this.pis_inner_barcode || "").trim();

  if (!this.qc || typeof this.qc !== "object") {
    this.qc = {};
  }

  const resolvedQcMasterBarcode = Number(
    this.qc.master_barcode || this.qc.barcode || 0,
  );
  this.qc.master_barcode =
    Number.isFinite(resolvedQcMasterBarcode) && resolvedQcMasterBarcode > 0
      ? resolvedQcMasterBarcode
      : 0;
  this.qc.barcode = this.qc.master_barcode;

  const resolvedQcInnerBarcode = Number(this.qc.inner_barcode || 0);
  this.qc.inner_barcode =
    Number.isFinite(resolvedQcInnerBarcode) && resolvedQcInnerBarcode > 0
      ? resolvedQcInnerBarcode
      : 0;
});

module.exports = mongoose.model("items", itemSchema);

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
const productDatabaseActorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    name: { type: String, default: "", trim: true },
    created_at: { type: Date, default: null },
    updated_at: { type: Date, default: null },
    checked_at: { type: Date, default: null },
    approved_at: { type: Date, default: null },
    changed_at: { type: Date, default: null },
  },
  { _id: false },
);
const productDatabaseHistorySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["create", "update", "check", "approve", "reset_to_created"],
      required: true,
    },
    previous_status: { type: String, default: "not_set", trim: true },
    next_status: { type: String, default: "not_set", trim: true },
    actor: { type: productDatabaseActorSchema, default: () => ({}) },
    changed_fields: { type: [String], default: [] },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);
const productTypeSnapshotSchema = new mongoose.Schema(
  {
    template: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "product_type_templates",
      default: null,
    },
    key: { type: String, default: "", trim: true, lowercase: true },
    label: { type: String, default: "", trim: true },
    version: { type: Number, default: 1, min: 1 },
  },
  { _id: false },
);
const productSpecFieldValueSchema = new mongoose.Schema(
  {
    field_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    key: { type: String, default: "", trim: true, lowercase: true },
    label: { type: String, default: "", trim: true },
    group_key: { type: String, default: "", trim: true, lowercase: true },
    group_label: { type: String, default: "", trim: true },
    input_type: { type: String, default: "text", trim: true, lowercase: true },
    value_type: { type: String, default: "string", trim: true, lowercase: true },
    unit: { type: String, default: "", trim: true },
    value_text: { type: String, default: "", trim: true },
    value_number: { type: Number, default: null },
    value_boolean: { type: Boolean, default: null },
    value_date: { type: Date, default: null },
    value_array: { type: [mongoose.Schema.Types.Mixed], default: [] },
    raw_value: { type: mongoose.Schema.Types.Mixed, default: null },
    source_header: { type: String, default: "", trim: true },
  },
  { _id: false },
);
const productSpecsSchema = new mongoose.Schema(
  {
    fields: { type: [productSpecFieldValueSchema], default: [] },
    item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
    },
    box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
    },
    box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
    },
    raw_values: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
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
    product_type: {
      type: productTypeSnapshotSchema,
      default: undefined,
    },
    product_specs: {
      type: productSpecsSchema,
      default: () => ({
        fields: [],
        item_sizes: [],
        box_sizes: [],
        box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
        raw_values: {},
      }),
    },
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
    pd_item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `pd_item_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
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
    pd_box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= SIZE_ENTRY_LIMIT,
        message: `pd_box_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
      },
    },
    pd_box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
    },
    pd_checked: {
      type: String,
      enum: ["created", "checked", "approved", "not set"],
      default: undefined,
      trim: true,
    },
    pd_created_by: { type: productDatabaseActorSchema, default: undefined },
    pd_checked_by: { type: productDatabaseActorSchema, default: undefined },
    pd_approved_by: { type: productDatabaseActorSchema, default: undefined },
    pd_last_changed_by: { type: productDatabaseActorSchema, default: undefined },
    pd_history: { type: [productDatabaseHistorySchema], default: [] },
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
    packeging_ppt: {
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
itemSchema.index({ pd_checked: 1 });
itemSchema.index({ "product_type.key": 1 });
itemSchema.index({ "product_type.template": 1 });
itemSchema.index({ "product_specs.fields.key": 1 });
itemSchema.index({ "product_specs.fields.value_text": 1 });
itemSchema.index({ "product_specs.fields.value_number": 1 });
itemSchema.index({ "product_specs.fields.value_boolean": 1 });

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

  if (this.product_type && typeof this.product_type === "object") {
    this.product_type.key = String(this.product_type.key || "").trim().toLowerCase();
    this.product_type.label = String(this.product_type.label || "").trim();
    this.product_type.version = Math.max(
      1,
      Number.parseInt(String(this.product_type.version || 1), 10) || 1,
    );
  }

  if (this.product_specs && typeof this.product_specs === "object") {
    this.product_specs.box_mode =
      Object.values(BOX_PACKAGING_MODES).includes(this.product_specs.box_mode)
        ? this.product_specs.box_mode
        : BOX_PACKAGING_MODES.INDIVIDUAL;

    if (Array.isArray(this.product_specs.fields)) {
      this.product_specs.fields = this.product_specs.fields.map((entry) => ({
        ...entry,
        key: String(entry?.key || "").trim().toLowerCase(),
        label: String(entry?.label || "").trim(),
        group_key: String(entry?.group_key || "").trim().toLowerCase(),
        group_label: String(entry?.group_label || "").trim(),
        input_type: String(entry?.input_type || "text").trim().toLowerCase(),
        value_type: String(entry?.value_type || "string").trim().toLowerCase(),
        unit: String(entry?.unit || "").trim(),
        value_text: String(entry?.value_text || "").trim(),
        source_header: String(entry?.source_header || "").trim(),
      }));
    }
  }
});

const Item = mongoose.model("items", itemSchema);

Item.createSizeEntrySchema = createSizeEntrySchema;
Item.itemSizeEntrySchema = itemSizeEntrySchema;
Item.boxSizeEntrySchema = boxSizeEntrySchema;
Item.SIZE_ENTRY_LIMIT = SIZE_ENTRY_LIMIT;

module.exports = Item;

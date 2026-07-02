const mongoose = require("mongoose");
const {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
} = require("../helpers/boxMeasurement");
const { formDraftSchema } = require("../helpers/formDrafts");
const {
  formatSizeArrayToReference,
  pickReferenceSizeArray,
} = require("../helpers/sizeDimensionFormatter");

const ITEM_SIZE_ENTRY_LIMIT = 5;
const BOX_SIZE_ENTRY_LIMIT = 4;

const createSizeEntrySchema = () =>
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

const itemSizeEntrySchema = createSizeEntrySchema();
const boxSizeEntrySchema = new mongoose.Schema(
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
const createOptionalSizeNumberField = () => ({ type: Number, min: 0 });
const legacyLbhSchema = new mongoose.Schema(
  {
    L: createOptionalSizeNumberField(),
    B: createOptionalSizeNumberField(),
    H: createOptionalSizeNumberField(),
  },
  { _id: false },
);
const productSpecItemSizeEntrySchema = new mongoose.Schema(
  {
    L: createOptionalSizeNumberField(),
    B: createOptionalSizeNumberField(),
    H: createOptionalSizeNumberField(),
    remark: {
      type: String,
      default: "",
      trim: true,
    },
    net_weight: createOptionalSizeNumberField(),
    gross_weight: createOptionalSizeNumberField(),
  },
  { _id: false },
);
const productSpecBoxSizeEntrySchema = new mongoose.Schema(
  {
    L: createOptionalSizeNumberField(),
    B: createOptionalSizeNumberField(),
    H: createOptionalSizeNumberField(),
    remark: {
      type: String,
      default: "",
      trim: true,
    },
    net_weight: createOptionalSizeNumberField(),
    gross_weight: createOptionalSizeNumberField(),
    box_type: {
      type: String,
      enum: Object.values(BOX_ENTRY_TYPES),
      trim: true,
    },
    item_count_in_inner: createOptionalSizeNumberField(),
    box_count_in_master: createOptionalSizeNumberField(),
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
const itemUpdateHistoryActorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    name: { type: String, default: "", trim: true },
    role: { type: String, default: "", trim: true },
  },
  { _id: false },
);
const itemUpdateHistorySchema = new mongoose.Schema(
  {
    action: { type: String, default: "update", trim: true },
    source: { type: String, default: "", trim: true },
    route: { type: String, default: "", trim: true },
    actor: { type: itemUpdateHistoryActorSchema, default: () => ({}) },
    timestamp: { type: Date, default: Date.now },
    changed_fields: { type: [String], default: [] },
    before: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    after: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { _id: false },
);
const pisUpdateCommentSchema = new mongoose.Schema(
  {
    comment: { type: String, required: true, trim: true },
    item_code: { type: String, default: "", trim: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    created_by_name: { type: String, default: "", trim: true },
    created_by_role: { type: String, default: "", trim: true },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true },
);
const qcMismatchCommentSchema = new mongoose.Schema(
  {
    comment: { type: String, required: true, trim: true },
    item_code: { type: String, default: "", trim: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    created_by_name: { type: String, default: "", trim: true },
    created_by_role: { type: String, default: "", trim: true },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true },
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
      type: [productSpecItemSizeEntrySchema],
      default: [],
    },
    box_sizes: {
      type: [productSpecBoxSizeEntrySchema],
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

const fileSubSchema = new mongoose.Schema(
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

const shippingMarksSchema = new mongoose.Schema(
  {
    files: { type: [fileSubSchema], default: [] },
    flat_carton: { type: [fileSubSchema], default: [] },
    shipping_marks_1: { type: fileSubSchema, default: () => ({}) },
    shipping_marks_2: { type: fileSubSchema, default: () => ({}) },
    ean: { type: fileSubSchema, default: () => ({}) },
    flat_carton_1: { type: fileSubSchema, default: () => ({}) },
    flat_carton_2: { type: fileSubSchema, default: () => ({}) },
    three_d_carton: { type: fileSubSchema, default: () => ({}) },
  },
  { _id: false },
);

const itemSchema = new mongoose.Schema(
  {
    shipping_marks: {
      type: shippingMarksSchema,
      default: () => ({}),
    },
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
    country_of_origin: { type: String, default: "", trim: true },
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
      calculated_master_total: { type: String, default: "0", trim: true },
      calculated_total: { type: String, default: "0", trim: true },
    },
    inspected_item_LBH: legacyLbhSchema,
    inspected_item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= ITEM_SIZE_ENTRY_LIMIT,
        message: `inspected_item_sizes cannot exceed ${ITEM_SIZE_ENTRY_LIMIT} entries`,
      },
    },
    inspected_item_top_LBH: legacyLbhSchema,
    inspected_item_bottom_LBH: legacyLbhSchema,
    inspected_box_LBH: legacyLbhSchema,
    inspected_box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= BOX_SIZE_ENTRY_LIMIT,
        message: `inspected_box_sizes cannot exceed ${BOX_SIZE_ENTRY_LIMIT} entries`,
      },
    },
    inspected_box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
    },
    inspected_box_top_LBH: legacyLbhSchema,
    inspected_box_bottom_LBH: legacyLbhSchema,
    inspected_top_LBH: legacyLbhSchema,
    inspected_bottom_LBH: legacyLbhSchema,
    pis_item_LBH: legacyLbhSchema,
    pis_item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= ITEM_SIZE_ENTRY_LIMIT,
        message: `pis_item_sizes cannot exceed ${ITEM_SIZE_ENTRY_LIMIT} entries`,
      },
    },
    pd_item_sizes: {
      type: [productSpecItemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= ITEM_SIZE_ENTRY_LIMIT,
        message: `pd_item_sizes cannot exceed ${ITEM_SIZE_ENTRY_LIMIT} entries`,
      },
    },
    pis_item_top_LBH: legacyLbhSchema,
    pis_item_bottom_LBH: legacyLbhSchema,
    pis_box_LBH: legacyLbhSchema,
    pis_box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= BOX_SIZE_ENTRY_LIMIT,
        message: `pis_box_sizes cannot exceed ${BOX_SIZE_ENTRY_LIMIT} entries`,
      },
    },
    pis_box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
    },
    master_item_sizes: {
      type: [itemSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= ITEM_SIZE_ENTRY_LIMIT,
        message: `master_item_sizes cannot exceed ${ITEM_SIZE_ENTRY_LIMIT} entries`,
      },
    },
    master_box_sizes: {
      type: [boxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= BOX_SIZE_ENTRY_LIMIT,
        message: `master_box_sizes cannot exceed ${BOX_SIZE_ENTRY_LIMIT} entries`,
      },
    },
    master_box_mode: {
      type: String,
      enum: Object.values(BOX_PACKAGING_MODES),
      default: BOX_PACKAGING_MODES.INDIVIDUAL,
      trim: true,
    },
    master_country_of_origin: { type: String, default: "", trim: true },
    master_barcode: { type: String, default: "", trim: true },
    master_master_barcode: { type: String, default: "", trim: true },
    master_inner_barcode: { type: String, default: "", trim: true },
    kd: { type: Boolean, default: false },
    pd_box_sizes: {
      type: [productSpecBoxSizeEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          !Array.isArray(entries) || entries.length <= BOX_SIZE_ENTRY_LIMIT,
        message: `pd_box_sizes cannot exceed ${BOX_SIZE_ENTRY_LIMIT} entries`,
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
    pd_barcode: { type: String, default: "", trim: true },
    pd_master_barcode: { type: String, default: "", trim: true },
    pd_inner_barcode: { type: String, default: "", trim: true },
    pd_history: { type: [productDatabaseHistorySchema], default: [] },
    update_history: { type: [itemUpdateHistorySchema], default: [] },
    pis_update_comments: { type: [pisUpdateCommentSchema], default: [] },
    qc_mismatch_comments: { type: [qcMismatchCommentSchema], default: [] },
    pis_box_top_LBH: legacyLbhSchema,
    pis_box_bottom_LBH: legacyLbhSchema,
    pis_barcode: { type: String, default: "", trim: true },
    pis_master_barcode: { type: String, default: "", trim: true },
    pis_inner_barcode: { type: String, default: "", trim: true },
    pis_product_database_synced_at: { type: Date, default: undefined },
    pis_product_database_synced_by: { type: productDatabaseActorSchema, default: undefined },
    qc: {
      packed_size: { type: Boolean, default: false },
      finishing: { type: Boolean, default: false },
      branding: { type: Boolean, default: false },
      barcode: { type: String, default: "", trim: true },
      master_barcode: { type: String, default: "", trim: true },
      inner_barcode: { type: String, default: "", trim: true },
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
    mounting_file: {
      key: { type: String, default: "", trim: true },
      originalName: { type: String, default: "", trim: true },
      contentType: { type: String, default: "", trim: true },
      size: { type: Number, default: 0, min: 0 },
      link: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    },
    mounting_file_needed: { type: Boolean, default: false },
    packeging_ppt: {
      key: { type: String, default: "", trim: true },
      originalName: { type: String, default: "", trim: true },
      contentType: { type: String, default: "", trim: true },
      size: { type: Number, default: 0, min: 0 },
      link: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    },
    pis_checked_flag: { type: Boolean, default: false },
    barcode_exempted: { type: Boolean, default: false },
    finish: {
      type: [finishAssignmentSchema],
      default: [],
    },
    form_drafts: {
      type: [formDraftSchema],
      default: [],
    },
    claim_percentage: { type: Number, default: 0, min: 0, max: 100 },
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

  const normalizedMasterBarcode = String(
    this.master_master_barcode || this.master_barcode || "",
  ).trim();
  this.master_master_barcode = normalizedMasterBarcode;
  this.master_barcode = normalizedMasterBarcode;
  this.master_inner_barcode = String(this.master_inner_barcode || "").trim();
  this.master_country_of_origin = String(this.master_country_of_origin || "").trim();

  if (!this.qc || typeof this.qc !== "object") {
    this.qc = {};
  }

  const resolvedQcMasterBarcode = String(
    this.qc.master_barcode || this.qc.barcode || "",
  ).trim();
  this.qc.master_barcode = resolvedQcMasterBarcode;
  this.qc.barcode = this.qc.master_barcode;

  this.qc.inner_barcode = String(this.qc.inner_barcode || "").trim();

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

itemSchema.pre("validate", function formatInspectedSizesToReference() {
  const itemReference = pickReferenceSizeArray(this, "item");
  const boxReference = pickReferenceSizeArray(this, "box");

  if (itemReference.length > 0 && Array.isArray(this.inspected_item_sizes)) {
    this.inspected_item_sizes = formatSizeArrayToReference(
      this.inspected_item_sizes,
      itemReference,
      { type: "item" },
    );
  }

  if (boxReference.length > 0 && Array.isArray(this.inspected_box_sizes)) {
    this.inspected_box_sizes = formatSizeArrayToReference(
      this.inspected_box_sizes,
      boxReference,
      { type: "box" },
    );
  }
});

const Item = mongoose.model("items", itemSchema);

Item.createSizeEntrySchema = createSizeEntrySchema;
Item.itemSizeEntrySchema = itemSizeEntrySchema;
Item.boxSizeEntrySchema = boxSizeEntrySchema;
Item.SIZE_ENTRY_LIMIT = BOX_SIZE_ENTRY_LIMIT;
Item.ITEM_SIZE_ENTRY_LIMIT = ITEM_SIZE_ENTRY_LIMIT;
Item.BOX_SIZE_ENTRY_LIMIT = BOX_SIZE_ENTRY_LIMIT;

module.exports = Item;

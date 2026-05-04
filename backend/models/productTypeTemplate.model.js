const mongoose = require("mongoose");
const { BOX_ENTRY_TYPES } = require("../helpers/boxMeasurement");
const {
  PRODUCT_TYPE_TEMPLATE_INPUT_TYPES,
  PRODUCT_TYPE_TEMPLATE_STATUSES,
  PRODUCT_TYPE_TEMPLATE_VALUE_TYPES,
  normalizeTemplateKey,
} = require("../helpers/productTypeTemplates");

const templateFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    input_type: {
      type: String,
      enum: PRODUCT_TYPE_TEMPLATE_INPUT_TYPES,
      required: true,
      trim: true,
    },
    value_type: {
      type: String,
      enum: PRODUCT_TYPE_TEMPLATE_VALUE_TYPES,
      required: true,
      trim: true,
    },
    unit: { type: String, default: "", trim: true },
    required: { type: Boolean, default: false },
    searchable: { type: Boolean, default: false },
    filterable: { type: Boolean, default: false },
    show_in_table: { type: Boolean, default: false },
    order: { type: Number, default: 0, min: 0 },
    options: { type: [String], default: [] },
    default_value: { type: mongoose.Schema.Types.Mixed, default: null },
    validation: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    source_headers: { type: [String], default: [] },
    size_source_headers: {
      L: { type: [String], default: [] },
      B: { type: [String], default: [] },
      H: { type: [String], default: [] },
      net_weight: { type: [String], default: [] },
      gross_weight: { type: [String], default: [] },
      item_count_in_inner: { type: [String], default: [] },
      box_count_in_master: { type: [String], default: [] },
    },
    size_remark: { type: String, default: "", trim: true },
    box_type: {
      type: String,
      enum: Object.values(BOX_ENTRY_TYPES),
      default: BOX_ENTRY_TYPES.INDIVIDUAL,
      trim: true,
    },
    is_active: { type: Boolean, default: true },
  },
  { _id: true },
);

const templateGroupSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    order: { type: Number, default: 0, min: 0 },
    is_active: { type: Boolean, default: true },
    fields: { type: [templateFieldSchema], default: [] },
  },
  { _id: true },
);

const productTypeTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    version: { type: Number, default: 1, min: 1 },
    status: {
      type: String,
      enum: PRODUCT_TYPE_TEMPLATE_STATUSES,
      default: "draft",
      trim: true,
    },
    groups: { type: [templateGroupSchema], default: [] },
  },
  {
    collection: "product_type_templates",
    timestamps: true,
  },
);

productTypeTemplateSchema.index({ key: 1, version: 1 }, { unique: true });
productTypeTemplateSchema.index({ key: 1 });
productTypeTemplateSchema.index({ status: 1 });

productTypeTemplateSchema.pre("validate", function normalizeTemplateDocument() {
  this.key = normalizeTemplateKey(this.key || this.label);
  this.label = String(this.label || "").trim();
  this.description = String(this.description || "").trim();

  if (!Array.isArray(this.groups)) return;
  this.groups.forEach((group, groupIndex) => {
    group.key = normalizeTemplateKey(group?.key || group?.label || `group_${groupIndex + 1}`);
    group.label = String(group?.label || "").trim();
    group.description = String(group?.description || "").trim();

    if (!Array.isArray(group.fields)) return;
    group.fields.forEach((field, fieldIndex) => {
      field.key = normalizeTemplateKey(field?.key || field?.label || `field_${fieldIndex + 1}`);
      field.label = String(field?.label || "").trim();
      field.description = String(field?.description || "").trim();
      field.unit = String(field?.unit || "").trim();
      field.size_remark = normalizeTemplateKey(field?.size_remark || "");
      field.source_headers = Array.isArray(field?.source_headers)
        ? field.source_headers.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
    });
  });
});

module.exports = mongoose.model(
  "product_type_templates",
  productTypeTemplateSchema,
);

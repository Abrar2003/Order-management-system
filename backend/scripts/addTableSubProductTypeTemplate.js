const mongoose = require("mongoose");
const path = require("path");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");
const { prepareTemplatePayload } = require("../helpers/productTypeTemplates");

const SUB_PRODUCT_TYPES = [
  "Dining Table",
  "Bar Table",
  "Coffee Table",
  "Console Table",
  "Side Table",
];

const ensureTableSubProductType = (template = {}) => {
  const basicInfo = (template.groups || []).find((group) => group.key === "basic_info");
  if (!basicInfo) throw new Error("Table template has no Basic Info group");

  const fields = basicInfo.fields || (basicInfo.fields = []);
  const existingField = fields.find((field) => field.key === "sub_product_type");
  if (existingField) {
    const optionsChanged = JSON.stringify(existingField.options) !== JSON.stringify(SUB_PRODUCT_TYPES);
    if (!optionsChanged) return false;
    existingField.options = SUB_PRODUCT_TYPES;
    return true;
  }

  fields.push({
    key: "sub_product_type",
    label: "Sub Product Type",
    input_type: "select",
    value_type: "string",
    options: SUB_PRODUCT_TYPES,
    required: false,
    order: Math.max(0, ...fields.map((field) => Number(field.order) || 0)) + 10,
  });
  return true;
};

const buildTableTemplate = (existing = null) =>
  prepareTemplatePayload({
    key: "table",
    label: "Table",
    description: existing?.description || "Table product details.",
    version: Number(existing?.version || 0) + 1,
    status: "active",
    groups:
      existing?.groups?.map((group) => ({ ...group, fields: [...(group.fields || [])] })) ||
      [{ key: "basic_info", label: "Basic Info", order: 10, fields: [] }],
  });

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  await connectDB();

  let tableV2 = await ProductTypeTemplate.findOne({ key: "table", version: 2 });
  if (!tableV2) {
    const latest = await ProductTypeTemplate.findOne({ key: "table" })
      .sort({ version: -1, updatedAt: -1 })
      .lean();
    tableV2 = await ProductTypeTemplate.create(buildTableTemplate(latest));
  }

  const changed = ensureTableSubProductType(tableV2);
  if (tableV2.status !== "active") tableV2.status = "active";
  if (changed || tableV2.isModified()) await tableV2.save();
  await ProductTypeTemplate.updateMany(
    { key: "table", status: "active", _id: { $ne: tableV2._id } },
    { $set: { status: "inactive" } },
  );

  console.log("Table V2 sub product types are configured.");
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Table subtype update failed:", error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.connection.close(false).catch(() => {}));
}

module.exports = { SUB_PRODUCT_TYPES, buildTableTemplate, ensureTableSubProductType };

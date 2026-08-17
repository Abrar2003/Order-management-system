const mongoose = require("mongoose");
const path = require("path");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");
const { prepareTemplatePayload } = require("../helpers/productTypeTemplates");

const SUB_PRODUCT_TYPES = ["TV Cabinet", "Bookself", "Sideboard", "Wall Console"];

const hasSubProductType = (template = {}) =>
  (template.groups || []).some((group) =>
    (group.fields || []).some(
      (field) =>
        field.key === "sub_product_type" &&
        SUB_PRODUCT_TYPES.every((option) => field.options?.includes(option)),
    ),
  );

const buildCabinetTemplate = (existing = null) => {
  const groups = existing?.groups?.map((group) => ({
    ...group,
    fields: [...(group.fields || [])],
  })) || [{ key: "basic_info", label: "Basic Info", order: 10, fields: [] }];
  const group = groups.find((entry) =>
    entry.fields.some((field) => field.key === "sub_product_type"),
  ) || groups[0];
  const existingField = group.fields.find((field) => field.key === "sub_product_type");
  if (existingField) {
    existingField.input_type = "select";
    existingField.value_type = "string";
    existingField.options = [...new Set([...(existingField.options || []), ...SUB_PRODUCT_TYPES])];
  } else {
    group.fields.push({
      key: "sub_product_type",
      label: "Sub Product Type",
      input_type: "select",
      value_type: "string",
      options: SUB_PRODUCT_TYPES,
      order: Math.max(0, ...group.fields.map((field) => Number(field.order) || 0)) + 10,
      required: false,
    });
  }

  return prepareTemplatePayload({
    key: "cabinet",
    label: "Cabinet",
    description: existing?.description || "Cabinet product details.",
    version: Number(existing?.version || 0) + 1,
    status: "active",
    groups,
  });
};

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  await connectDB();

  const latest = await ProductTypeTemplate.findOne({ key: "cabinet" })
    .sort({ version: -1, updatedAt: -1 })
    .lean();
  if (hasSubProductType(latest)) {
    console.log("Cabinet sub product type is already configured.");
    return;
  }

  const created = await ProductTypeTemplate.create(buildCabinetTemplate(latest));
  await ProductTypeTemplate.updateMany(
    { key: "cabinet", status: "active", _id: { $ne: created._id } },
    { $set: { status: "inactive" } },
  );
  console.log(`Created cabinet v${created.version} with sub product type options.`);
};

main()
  .catch((error) => {
    console.error("Cabinet sub product type seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close(false).catch(() => {}));

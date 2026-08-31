const mongoose = require("mongoose");
const path = require("path");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");
const { prepareTemplatePayload } = require("../helpers/productTypeTemplates");

const SUB_PRODUCT_TYPES = ["TV Cabinet", "Bookself", "Sideboard", "Wall Console"];
const HINGE_FIELDS = [
  {
    key: "hinges_type",
    label: "Hinges Type",
    input_type: "select",
    value_type: "string",
    options: ["Butt Hinge", "Cupboard Hinge"],
    order: 11,
    required: false,
  },
  {
    key: "hinge_mounting_type",
    label: "Hinge Mounting Type",
    input_type: "select",
    value_type: "string",
    options: ["Clip On", "Normal"],
    order: 12,
    required: false,
    validation: {
      visible_when: { hinges_type: ["Cupboard Hinge"] },
    },
  },
  {
    key: "hinge_sub_type",
    label: "Hinge Sub Type",
    input_type: "select",
    value_type: "string",
    options: ["Self Closing", "Normal"],
    order: 13,
    required: false,
    validation: {
      visible_when: {
        hinges_type: ["Cupboard Hinge"],
        hinge_mounting_type: ["Clip On", "Normal"],
      },
    },
  },
];

const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const applyFieldConfig = (field, config) => {
  let changed = false;
  Object.entries(config).forEach(([key, value]) => {
    if (sameValue(field[key], value)) return;
    field[key] = value;
    changed = true;
  });
  return changed;
};

const ensureSubProductType = (template = {}) => {
  const groups = template.groups || [];
  const group = groups.find((entry) =>
    (entry.fields || []).some((field) => field.key === "sub_product_type"),
  ) || groups[0];
  if (!group) throw new Error("Cabinet template has no groups");

  const fields = group.fields || (group.fields = []);
  const existingField = fields.find((field) => field.key === "sub_product_type");
  const config = {
    key: "sub_product_type",
    label: "Sub Product Type",
    input_type: "select",
    value_type: "string",
    options: SUB_PRODUCT_TYPES,
    required: false,
  };

  if (existingField) return applyFieldConfig(existingField, config);
  fields.push({
    ...config,
    order: Math.max(0, ...fields.map((field) => Number(field.order) || 0)) + 10,
  });
  return true;
};

const ensureCabinetHingeFields = (template = {}) => {
  const hardware = (template.groups || []).find((group) => group.key === "hardware");
  if (!hardware) throw new Error(`Cabinet v${template.version || "?"} has no Hardware group`);

  const fields = hardware.fields || (hardware.fields = []);
  const hingesIndex = fields.findIndex((field) => field.key === "hinges");
  if (hingesIndex < 0) {
    throw new Error(`Cabinet v${template.version || "?"} has no legacy Hinges field`);
  }

  let changed = false;
  HINGE_FIELDS.forEach((config, index) => {
    const existingField = fields.find((field) => field.key === config.key);
    if (existingField) {
      changed = applyFieldConfig(existingField, config) || changed;
      return;
    }
    fields.splice(hingesIndex + index + 1, 0, { ...config });
    changed = true;
  });
  return changed;
};

const buildCabinetTemplate = (existing = null) => {
  const groups = existing?.groups?.map((group) => ({
    ...group,
    fields: [...(group.fields || [])],
  })) || [{ key: "basic_info", label: "Basic Info", order: 10, fields: [] }];
  ensureSubProductType({ groups });

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

  let cabinetV2 = await ProductTypeTemplate.findOne({ key: "cabinet", version: 2 });
  if (!cabinetV2) {
    const latest = await ProductTypeTemplate.findOne({ key: "cabinet" })
      .sort({ version: -1, updatedAt: -1 })
      .lean();
    cabinetV2 = await ProductTypeTemplate.create(buildCabinetTemplate(latest));
    await ProductTypeTemplate.updateMany(
      { key: "cabinet", status: "active", _id: { $ne: cabinetV2._id } },
      { $set: { status: "inactive" } },
    );
  }

  const templates = await ProductTypeTemplate.find({
    key: "cabinet",
    version: { $in: [1, 2] },
  }).sort({ version: 1 });
  if (templates.length !== 2) throw new Error("Cabinet V1 and V2 templates are required");

  const updatedVersions = [];
  for (const template of templates) {
    const changed = [
      template.version === 2 && ensureSubProductType(template),
      ensureCabinetHingeFields(template),
    ].some(Boolean);
    if (!changed) continue;
    await template.save();
    updatedVersions.push(template.version);
  }

  console.log(
    updatedVersions.length
      ? `Updated Cabinet ${updatedVersions.map((version) => `V${version}`).join(" and ")} in place.`
      : "Cabinet V1 and V2 hinge fields are already configured.",
  );
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Cabinet template update failed:", error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.connection.close(false).catch(() => {}));
}

module.exports = {
  HINGE_FIELDS,
  buildCabinetTemplate,
  ensureCabinetHingeFields,
  ensureSubProductType,
};

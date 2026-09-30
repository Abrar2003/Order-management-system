const mongoose = require("mongoose");
const path = require("path");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");
const { prepareTemplatePayload } = require("../helpers/productTypeTemplates");

const MATERIAL_TYPES = ["Wood", "Stone", "Metal"];
const COATING_TYPES = ["Powder Coating", "Plating", "Other"];
const COMPONENTS = Object.freeze({
  table: ["top", "top_backing", "legs", "frame"],
  cabinet: ["top", "legs", "body", "back", "doors", "drawers", "frame", "base", "shelves"],
});
const COMPONENT_LABELS = Object.freeze({
  top: "Top",
  top_backing: "Top Backing",
  legs: "Legs",
  frame: "Frame",
  body: "Body",
  back: "Back",
  doors: "Doors",
  drawers: "Drawers",
  base: "Base",
  shelves: "Shelves",
});

const field = (key, label, inputType = "text", extra = {}) => ({
  key,
  label,
  input_type: inputType,
  value_type: inputType === "number" ? "number" : inputType === "boolean" ? "boolean" : "string",
  required: false,
  ...extra,
});

const componentMaterialFields = (component) => {
  const prefix = `${component}_`;
  const enabledWhen = () => ({ visible_when: { [`${prefix}material_enabled`]: [true] } });
  const visibleWhen = (value) => ({
    visible_when: {
      [`${prefix}material_enabled`]: [true],
      [`${prefix}material_type`]: [value],
    },
  });
  return [
    field(`${prefix}material_enabled`, "Material Enabled", "boolean", { default_value: false }),
    field(`${prefix}material_type`, "Material Type", "select", {
      options: MATERIAL_TYPES,
      validation: enabledWhen(),
    }),
    field(`${prefix}wood_type`, "Type of Wood", "text", {
      required: true,
      validation: { ...visibleWhen("Wood"), suggestion_scope: "wood" },
    }),
    field(`${prefix}stone_type`, "Type of Stone", "text", {
      required: true,
      validation: { ...visibleWhen("Stone"), suggestion_scope: "stone" },
    }),
    field(`${prefix}metal_type`, "Type of Metal", "text", {
      required: true,
      validation: { ...visibleWhen("Metal"), suggestion_scope: "metal" },
    }),
    field(`${prefix}has_color`, "Color", "boolean", {
      default_value: false,
      validation: enabledWhen(),
    }),
    field(`${prefix}color_name`, "Color Name", "text", {
      required: true,
      validation: {
        visible_when: { [`${prefix}material_enabled`]: [true], [`${prefix}has_color`]: [true] },
        suggestion_scope: "color",
      },
    }),
    field(`${prefix}coating_type`, "Type of Coating", "select", {
      required: true,
      options: COATING_TYPES,
      validation: visibleWhen("Metal"),
    }),
    field(`${prefix}coating_other`, "Specify Other Coating", "text", {
      required: true,
      validation: { visible_when: { [`${prefix}material_enabled`]: [true], [`${prefix}coating_type`]: ["Other"] } },
    }),
    field(`${prefix}wire_brush`, "Wire Brush", "boolean", { default_value: false, validation: enabledWhen() }),
    field(`${prefix}sandblasting`, "Sandblasting", "boolean", { default_value: false, validation: enabledWhen() }),
    field(`${prefix}sealer`, "Sealer", "boolean", { default_value: false, validation: enabledWhen() }),
  ];
};

const componentSpecificFields = (component) => {
  const visibleWhenEnabled = { visible_when: { [`${component}_material_enabled`]: [true] } };
  if (component === "top") {
    return [
      field("wood_pattern", "Pattern in Top", "text", { validation: visibleWhenEnabled }),
      field("top_inlay", "Inlay in Top", "boolean", { default_value: false, validation: visibleWhenEnabled }),
    ];
  }
  if (component === "legs") {
    return [
      field("leg_shape", "Shape of Legs", "text", { validation: visibleWhenEnabled }),
      field("number_of_legs", "Number of Legs", "number", { validation: visibleWhenEnabled }),
    ];
  }
  if (component === "base") {
    return [field("pattern_in_base", "Pattern in Base", "text", { validation: visibleWhenEnabled })];
  }
  return [];
};

const buildComponentGroup = (component, order) => ({
  key: component,
  label: COMPONENT_LABELS[component],
  order,
  is_active: true,
  fields: [...componentMaterialFields(component), ...componentSpecificFields(component)].map(
    (entry, index) => ({ ...entry, order: index + 1 }),
  ),
});

const legacyMaterialFieldKeys = new Set([
  "top_has_backing",
  "backing_material",
  "leg_shape",
  "number_of_legs",
]);

const buildComponentMaterialV3Template = (template = {}) => {
  const key = String(template?.key || "").trim().toLowerCase();
  if (!COMPONENTS[key]) throw new Error(`Unsupported component material template: ${key}`);

  const baseGroups = (Array.isArray(template?.groups) ? template.groups : [])
    .filter((group) => !["materials", "colors"].includes(String(group?.key || "").trim().toLowerCase()))
    .map((group) => ({
      key: group.key,
      label: group.label,
      description: group.description || "",
      order: Number(group.order || 0),
      is_active: group.is_active !== false,
      fields: (Array.isArray(group?.fields) ? group.fields : [])
        .filter((entry) => !legacyMaterialFieldKeys.has(String(entry?.key || "").trim().toLowerCase()))
        .map(({ _id, ...entry }) => entry),
    }));
  const components = COMPONENTS[key].map((component, index) =>
    buildComponentGroup(component, 30 + index),
  );

  return prepareTemplatePayload({
    key,
    label: template.label,
    description: template.description || "",
    version: 3,
    status: "active",
    groups: [
      ...baseGroups.filter((group) => Number(group.order || 0) < 30),
      ...components,
      ...baseGroups.filter((group) => Number(group.order || 0) >= 30),
    ],
  });
};

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  await connectDB();

  for (const key of Object.keys(COMPONENTS)) {
    const source = await ProductTypeTemplate.findOne({ key, version: 2 }).lean();
    if (!source) throw new Error(`${key} v2 template is required before creating v3`);

    const payload = buildComponentMaterialV3Template(source);
    const target = await ProductTypeTemplate.findOneAndUpdate(
      { key, version: 3 },
      { $set: payload },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    await ProductTypeTemplate.updateMany(
      { key, status: "active", _id: { $ne: target._id } },
      { $set: { status: "inactive" } },
    );
    console.log(`${key} v3 component material template is active.`);
  }
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Component material v3 setup failed:", error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.connection.close(false).catch(() => {}));
}

module.exports = {
  COMPONENTS,
  COMPONENT_LABELS,
  COATING_TYPES,
  MATERIAL_TYPES,
  buildComponentMaterialV3Template,
};

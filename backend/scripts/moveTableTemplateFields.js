const mongoose = require("mongoose");
const path = require("path");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");

const TABLE_FIELD_GROUPS = Object.freeze({
  seating_capacity: "table_details",
  table_top_thickness: "sizes",
  distances_between_legs: "table_details",
});
const MISSING_TABLE_FIELDS = Object.freeze({
  table_top_thickness: {
    key: "table_top_thickness",
    label: "Table Top Thickness",
    input_type: "number",
    value_type: "number",
    order: 55,
    source_headers: ["Table Top Thickness", "Table Top Thikness"],
  },
  distances_between_legs: {
    key: "distances_between_legs",
    label: "Distances Between Legs",
    input_type: "number_list",
    value_type: "array",
    unit: "cm",
    order: 75,
    validation: { max_entries: 4 },
    source_headers: [
      "Distances Between Legs",
      "Distance Between Legs",
      "Distance Between Table Legs",
    ],
  },
});

const moveTableTemplateFields = (template = {}) => {
  const groups = Array.isArray(template.groups) ? template.groups : [];
  let changed = false;

  Object.entries(TABLE_FIELD_GROUPS).forEach(([fieldKey, targetGroupKey]) => {
    const targetGroup = groups.find((group) => group.key === targetGroupKey);
    const sourceGroup = groups.find((group) =>
      (group.fields || []).some((field) => field.key === fieldKey),
    );
    if (!targetGroup) return;
    if (!sourceGroup) {
      if (MISSING_TABLE_FIELDS[fieldKey]) {
        targetGroup.fields.push({ ...MISSING_TABLE_FIELDS[fieldKey] });
        changed = true;
      }
      return;
    }
    if (sourceGroup === targetGroup) return;

    const fieldIndex = sourceGroup.fields.findIndex((field) => field.key === fieldKey);
    targetGroup.fields.push(sourceGroup.fields.splice(fieldIndex, 1)[0]);
    changed = true;
  });

  return changed;
};

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  await connectDB();

  const templates = await ProductTypeTemplate.find({ key: "table" });
  const updatedVersions = [];
  for (const template of templates) {
    if (!moveTableTemplateFields(template)) continue;
    await template.save();
    updatedVersions.push(template.version);
  }

  console.log(
    updatedVersions.length
      ? `Moved table fields in template version(s): ${updatedVersions.join(", ")}.`
      : "Table template fields are already in the requested groups.",
  );
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Table template field update failed:", error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.connection.close(false).catch(() => {}));
}

module.exports = { moveTableTemplateFields };

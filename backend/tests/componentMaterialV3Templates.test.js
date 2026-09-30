const test = require("node:test");
const assert = require("node:assert/strict");
const { buildComponentMaterialV3Template } = require("../scripts/createComponentMaterialV3Templates");

const sourceTemplate = (key) => ({
  key,
  label: key === "table" ? "Table" : "Cabinet",
  version: 2,
  groups: [
    { key: "basic_info", label: "Basic Info", order: 10, fields: [{ key: "item_number", label: "Item Number", input_type: "text", value_type: "string" }] },
    { key: "materials", label: "Materials & Finish", order: 30, fields: [{ key: "material_top", label: "Material Top", input_type: "text", value_type: "string" }] },
    { key: "colors", label: "Colors", order: 50, fields: [{ key: "top_color", label: "Top Color", input_type: "text", value_type: "string" }] },
    { key: "details", label: "Details", order: 60, fields: [{ key: "backing_material", label: "Backing Material", input_type: "text", value_type: "string" }] },
  ],
});

test("component material v3 templates replace material groups with component sections", () => {
  const table = buildComponentMaterialV3Template(sourceTemplate("table"));
  const cabinet = buildComponentMaterialV3Template(sourceTemplate("cabinet"));

  assert.deepEqual(table.groups.map((group) => group.key), ["basic_info", "top", "top_backing", "legs", "frame", "details"]);
  assert.deepEqual(cabinet.groups.slice(1, 10).map((group) => group.key), ["top", "legs", "body", "back", "doors", "drawers", "frame", "base", "shelves"]);
  const top = table.groups.find((group) => group.key === "top");
  const cabinetBase = cabinet.groups.find((group) => group.key === "base");
  const cabinetLegs = cabinet.groups.find((group) => group.key === "legs");
  assert.equal(top.fields.find((entry) => entry.key === "top_material_enabled").default_value, false);
  assert.equal(top.fields.find((entry) => entry.key === "top_wood_type").required, true);
  assert.deepEqual(top.fields.find((entry) => entry.key === "top_wood_type").validation.visible_when, {
    top_material_enabled: [true],
    top_material_type: ["Wood"],
  });
  assert.deepEqual(top.fields.find((entry) => entry.key === "top_material_type").options, ["Wood", "Stone", "Metal"]);
  assert.equal(top.fields.find((entry) => entry.key === "top_inlay").default_value, false);
  assert.deepEqual(top.fields.find((entry) => entry.key === "top_coating_type").options, ["Powder Coating", "Plating", "Other"]);
  assert.equal(top.fields.find((entry) => entry.key === "top_wire_brush").default_value, false);
  assert.ok(cabinetBase.fields.some((entry) => entry.key === "pattern_in_base"));
  assert.ok(cabinetLegs.fields.some((entry) => entry.key === "leg_shape"));
  assert.ok(cabinetLegs.fields.some((entry) => entry.key === "number_of_legs"));
});

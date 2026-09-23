const assert = require("node:assert/strict");
const test = require("node:test");
const { applyCommonProductDatabaseFields } = require("../helpers/productTypeTemplateCommonFields");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");

const field = (template, key) =>
  template.groups.flatMap((group) => group.fields).find((entry) => entry.key === key);

test("common product fields are moved, conditional, and idempotent", () => {
  const template = {
    groups: [
      { key: "tests_usage", label: "Tests & Usage", fields: [{ key: "treated" }, { key: "coffee_test" }] },
      { key: "details", label: "Details", fields: [{ key: "adjustable_feet" }] },
      {
        key: "storage",
        label: "Storage",
        fields: [
          { key: "drawer_count" },
          { key: "shelf_count" },
          { key: "compartment_count" },
        ],
      },
    ],
  };

  applyCommonProductDatabaseFields(template);
  assert.equal(template.groups.find((group) => group.key === "tests")?.label, "Tests");
  assert.equal(field(template, "treated").input_type, "select");
  assert.deepEqual(field(template, "treated").options, ["Lacquered", "Non Lacquered"]);
  assert.deepEqual(field(template, "lacquer_type").validation.visible_when, { treated: ["Lacquered"] });
  assert.deepEqual(field(template, "storage_type").options, ["Drawer", "Shelf", "Both"]);
  assert.deepEqual(field(template, "drawer_count").validation.visible_when, {
    storage_enabled: [true], storage_type: ["Drawer", "Both"],
  });
  assert.deepEqual(field(template, "shelf_count").validation.visible_when, {
    storage_enabled: [true], storage_type: ["Shelf", "Both"],
  });
  assert.deepEqual(field(template, "compartment_count").validation.visible_when, {
    storage_enabled: [true], storage_type: ["Both"],
  });
  assert.equal(field(template, "adjustable_feet").validation.visible_when.hardware_enabled[0], true);
  assert.deepEqual(field(template, "allen_bolts_size").validation.visible_when, {
    hardware_enabled: [true], allen_bolts: [true],
  });

  applyCommonProductDatabaseFields(template);
  assert.equal(template.groups.flatMap((group) => group.fields).filter((entry) => entry.key === "treated").length, 1);
  assert.equal(template.groups.flatMap((group) => group.fields).filter((entry) => entry.key === "adjustable_feet").length, 1);
});

test("new groups retain their fields on Mongoose documents", () => {
  const template = new ProductTypeTemplate({
    key: "chair",
    label: "Chair",
    groups: [{ key: "basic", label: "Basic", fields: [] }],
  });

  applyCommonProductDatabaseFields(template);
  assert.equal(template.groups.find((group) => group.key === "tests").fields.length, 7);
  assert.equal(template.groups.find((group) => group.key === "hardware").fields.length, 12);
});

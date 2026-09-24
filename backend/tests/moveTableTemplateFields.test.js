const assert = require("node:assert/strict");
const test = require("node:test");
const { moveTableTemplateFields } = require("../scripts/moveTableTemplateFields");

test("table seating and thickness fields move to their requested groups", () => {
  const template = {
    groups: [
      { key: "sizes", fields: [{ key: "seating_capacity", label: "Seating Capacity" }] },
      {
        key: "table_details",
        fields: [
          { key: "table_top_thickness", label: "Table Top Thickness" },
          { key: "distances_between_legs", label: "Distances Between Legs" },
        ],
      },
    ],
  };

  assert.equal(moveTableTemplateFields(template), true);
  assert.deepEqual(template.groups[0].fields.map((field) => field.key), ["table_top_thickness"]);
  assert.deepEqual(template.groups[1].fields.map((field) => field.key), [
    "distances_between_legs",
    "seating_capacity",
  ]);
  assert.equal(moveTableTemplateFields(template), false);
});

test("table thickness is added to Sizes when the legacy template omitted it", () => {
  const template = {
    groups: [
      { key: "sizes", fields: [] },
      { key: "table_details", fields: [{ key: "seating_capacity" }] },
    ],
  };

  assert.equal(moveTableTemplateFields(template), true);
  assert.deepEqual(template.groups[0].fields.map((field) => field.key), ["table_top_thickness"]);
  assert.deepEqual(template.groups[1].fields.map((field) => field.key), [
    "seating_capacity",
    "distances_between_legs",
  ]);
  assert.equal(moveTableTemplateFields(template), false);
});

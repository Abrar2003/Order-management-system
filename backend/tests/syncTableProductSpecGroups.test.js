const assert = require("node:assert/strict");
const test = require("node:test");
const { TABLE_FIELD_GROUPS } = require("../scripts/syncTableProductSpecGroups");

test("table product-spec fields use their requested display groups", () => {
  assert.deepEqual(TABLE_FIELD_GROUPS.seating_capacity, {
    key: "table_details",
    label: "Table Details",
  });
  assert.deepEqual(TABLE_FIELD_GROUPS.table_top_thickness, {
    key: "sizes",
    label: "Sizes",
  });
});

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SUB_PRODUCT_TYPES,
  ensureTableSubProductType,
} = require("../scripts/addTableSubProductTypeTemplate");

test("Table subtype is additive and idempotent", () => {
  const template = {
    groups: [{ key: "basic_info", fields: [{ key: "table_type", order: 30 }] }],
  };

  assert.equal(ensureTableSubProductType(template), true);
  assert.deepEqual(template.groups[0].fields[1], {
    key: "sub_product_type",
    label: "Sub Product Type",
    input_type: "select",
    value_type: "string",
    options: SUB_PRODUCT_TYPES,
    required: false,
    order: 40,
  });
  assert.equal(ensureTableSubProductType(template), false);
});

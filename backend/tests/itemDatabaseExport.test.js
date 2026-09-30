const test = require("node:test");
const assert = require("node:assert/strict");
const {
  __test__: { buildItemDatabaseExport },
} = require("../controllers/item.controller");

test("Item Database export uses v3 component names as main headers and fields as subheads", () => {
  const { columns, exportRows } = buildItemDatabaseExport([{
    item_code: "SKU-1",
    product_database: {
      country_of_origin: "India",
      pd_item_sizes: [{ remark: "item", L: 10, B: 20, H: 30, net_weight: 2 }],
      product_specs: {
        fields: [
          { group_key: "top", group_label: "Top", key: "top_material_type", label: "Material Type", value_type: "string", value_text: "Wood" },
          { group_key: "top", group_label: "Top", key: "top_wood_type", label: "Type of Wood", value_type: "string", value_text: "Oak" },
          { group_key: "legs", group_label: "Legs", key: "leg_shape", label: "Shape of Legs", value_type: "string", value_text: "Tapered" },
        ],
      },
    },
  }]);

  assert.deepEqual(
    columns.filter((column) => ["Top", "Legs"].includes(column.group)).map((column) => [column.group, column.header]),
    [["Legs", "Shape of Legs"], ["Top", "Material Type"], ["Top", "Type of Wood"]],
  );
  assert.equal(exportRows[0]["spec:top:top_wood_type"], "Oak");
  assert.equal(exportRows[0]["spec:legs:leg_shape"], "Tapered");
  assert.equal(exportRows[0].pd_item_sizes, "item | 10 x 20 x 30 | Net 2");
});

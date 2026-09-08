const test = require("node:test");
const assert = require("node:assert/strict");
const {
  __test__: {
    buildProductDatabaseSubTypeFilterOptions,
    buildProductDatabaseTypeFilterOptions,
    itemMatchesProductDatabaseTypeFilters,
  },
} = require("../controllers/item.controller");

const cabinet = {
  product_type: { key: "cabinet", label: "Cabinet" },
  product_specs: {
    fields: [{ key: "sub_product_type", value_text: "TV Cabinet" }],
  },
};

test("Product Database type and subtype filters use saved product specs", () => {
  assert.equal(
    itemMatchesProductDatabaseTypeFilters(cabinet, {
      productType: "cabinet",
      subProductType: "tv cabinet",
    }),
    true,
  );
  assert.equal(
    itemMatchesProductDatabaseTypeFilters(cabinet, { subProductType: "Sideboard" }),
    false,
  );
  assert.deepEqual(buildProductDatabaseTypeFilterOptions([cabinet]), [
    { value: "cabinet", label: "Cabinet" },
  ]);
  assert.deepEqual(buildProductDatabaseSubTypeFilterOptions([cabinet]), ["TV Cabinet"]);
});

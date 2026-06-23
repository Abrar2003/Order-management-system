const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeProductDatabaseInput,
} = require("../helpers/productDatabase");

test("Product Database accepts Base 2 and Pedestal item-size remarks", () => {
  const result = normalizeProductDatabaseInput({
    pd_item_sizes: [
      { remark: "base2", L: 10, B: 20, H: 30, net_weight: 1 },
      { remark: "pedestal", L: 11, B: 21, H: 31, net_weight: 2 },
    ],
  });

  assert.deepEqual(
    result.data.pd_item_sizes.map((entry) => entry.remark),
    ["base2", "pedestal"],
  );
});

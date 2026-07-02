const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeProductDatabaseInput,
} = require("../helpers/productDatabase");

test("Product Database accepts Base 2, Pedestal, and Stretcher item-size remarks", () => {
  const result = normalizeProductDatabaseInput({
    pd_item_sizes: [
      { remark: "base2", L: 10, B: 20, H: 30, net_weight: 1 },
      { remark: "pedestal", L: 11, B: 21, H: 31, net_weight: 2 },
      { remark: "stretcher", L: 12, B: 22, H: 32, net_weight: 3 },
    ],
  });

  assert.deepEqual(
    result.data.pd_item_sizes.map((entry) => entry.remark),
    ["base2", "pedestal", "stretcher"],
  );
});

test("Product Database accepts five item-size entries", () => {
  const result = normalizeProductDatabaseInput({
    pd_item_sizes: [
      { remark: "item", L: 10, B: 20, H: 30, net_weight: 1 },
      { remark: "top", L: 11, B: 21, H: 31, net_weight: 2 },
      { remark: "base", L: 12, B: 22, H: 32, net_weight: 3 },
      { remark: "pedestal", L: 13, B: 23, H: 33, net_weight: 4 },
      { remark: "stretcher", L: 14, B: 24, H: 34, net_weight: 5 },
    ],
  });

  assert.equal(result.data.pd_item_sizes.length, 5);
});

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductDatabaseCompletion,
  buildProductDatabaseCompletionRangeSummary,
  buildProductDatabaseCompletionSummary,
  getProductDatabaseCompletionRange,
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

test("Product Database completion buckets count filled Table fields", () => {
  const templateFields = [
    { key: "item_number", input_type: "text", value_type: "string" },
    { key: "description", input_type: "textarea", value_type: "string" },
    { key: "dropship", input_type: "boolean", value_type: "boolean" },
    { key: "article_size", input_type: "item_size", value_type: "array", size_remark: "article" },
  ];
  const items = [
    {
      product_specs: {
        fields: [
          { key: "item_number", value_type: "string", value_text: "T-1" },
          { key: "description", value_type: "string", value_text: "Dining table" },
          { key: "dropship", value_type: "boolean", value_boolean: false },
        ],
        item_sizes: [{ remark: "article", L: 120, B: 80, H: 76 }],
      },
    },
    {
      product_specs: {
        fields: [
          { key: "item_number", value_type: "string", value_text: "T-2" },
          { key: "description", value_type: "string", value_text: "Coffee table" },
        ],
      },
    },
    {
      product_specs: {
        fields: [
          { key: "item_number", value_type: "string", value_text: "T-3" },
        ],
      },
    },
  ].map((item) => ({
    ...item,
    pd_completion: buildProductDatabaseCompletion(item, templateFields),
  }));

  assert.deepEqual(
    items.map((item) => item.pd_completion),
    [
      { filled: 4, total: 4, percentage: 100, bucket: 100 },
      { filled: 2, total: 4, percentage: 50, bucket: 50 },
      { filled: 1, total: 4, percentage: 25, bucket: 25 },
    ],
  );

  assert.deepEqual(
    buildProductDatabaseCompletionSummary(items, templateFields).buckets,
    { 25: 1, 50: 1, 75: 0, 100: 1 },
  );
});

test("Product Database completion range buckets use Item Database ranges", () => {
  assert.equal(getProductDatabaseCompletionRange(0), "0-25");
  assert.equal(getProductDatabaseCompletionRange(25), "0-25");
  assert.equal(getProductDatabaseCompletionRange(26), "26-50");
  assert.equal(getProductDatabaseCompletionRange(50), "26-50");
  assert.equal(getProductDatabaseCompletionRange(51), "51-75");
  assert.equal(getProductDatabaseCompletionRange(75), "51-75");
  assert.equal(getProductDatabaseCompletionRange(76), "76-100");
  assert.equal(getProductDatabaseCompletionRange(100), "76-100");

  const summary = buildProductDatabaseCompletionRangeSummary([
    { pd_completion: { percentage: 0 } },
    { pd_completion: { percentage: 25 } },
    { pd_completion: { percentage: 26 } },
    { pd_completion: { percentage: 51 } },
    { pd_completion: { percentage: 76 } },
  ]);

  assert.deepEqual(summary.buckets, {
    "0-25": 2,
    "26-50": 1,
    "51-75": 1,
    "76-100": 1,
  });
});

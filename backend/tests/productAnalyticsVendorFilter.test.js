const assert = require("node:assert/strict");
const test = require("node:test");

const Order = require("../models/order.model");
const { getProductAnalytics } = require("../controllers/product.controller");

const response = () => ({
  statusCode: 200,
  body: null,
  status(statusCode) { this.statusCode = statusCode; return this; },
  json(body) { this.body = body; return this; },
});

test("product analytics selected vendor matches embedded and legacy vendor records", async (t) => {
  let pipeline = [];
  t.mock.method(Order, "distinct", async () => []);
  t.mock.method(Order, "aggregate", async (value) => {
    pipeline = value;
    return [];
  });

  const res = response();
  await getProductAnalytics({
    query: { search: "ITEM-1", vendor: "Vendor A" },
    user: { role: "admin", allowed_brands: [], allowed_vendors: ["Allowed Vendor"] },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);

  const serializedMatch = JSON.stringify(pipeline[0].$match);
  assert.match(serializedMatch, /Vendor A/);
  assert.match(serializedMatch, /Allowed Vendor/);
  assert.match(serializedMatch, /item\.item_code/);
  assert.match(serializedMatch, /vendor\.name/);
  assert.match(serializedMatch, /\$vendor/);
});

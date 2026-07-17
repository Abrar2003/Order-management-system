const assert = require("node:assert/strict");
const test = require("node:test");

const Order = require("../models/order.model");
const Item = require("../models/item.model");
const { getOrdersByFiltersDb } = require("../controllers/order.controller");

const asQuery = (value) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  lean: async () => value,
});

const response = () => ({
  statusCode: 200,
  body: null,
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("item-code filters retain the matched PO's combined status", async (t) => {
  const matchedLine = {
    order_id: "PO-1",
    brand: "Giga",
    vendor: "Vendor",
    quantity: 10,
    item: { item_code: "ITEM-1" },
    shipment: [],
    qc_record: { quantities: { qc_passed: 10 } },
  };
  const allPoLines = [
    matchedLine,
    {
      ...matchedLine,
      item: { item_code: "ITEM-2" },
      qc_record: { quantities: { qc_passed: 0 } },
    },
  ];
  const findResults = [[matchedLine], allPoLines];

  t.mock.method(Order, "find", () => asQuery(findResults.shift() || []));
  t.mock.method(Item, "find", () => asQuery([]));

  const res = response();
  await getOrdersByFiltersDb({
    query: { po_bucket: "all", item_code: "ITEM-1" },
    user: { role: "admin", allowed_brands: [], allowed_vendors: ["all"] },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].items, 2);
  assert.equal(res.body.data[0].totalStatus, "Pending");
});

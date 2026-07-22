const assert = require("node:assert/strict");
const test = require("node:test");

const Order = require("../models/order.model");
const {
  getDelayedPoReport,
  getShippingDelayReport,
} = require("../controllers/order.controller");

const asQuery = (value) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  lean: async () => value,
});

const response = () => ({
  statusCode: 200,
  body: null,
  status(statusCode) { this.statusCode = statusCode; return this; },
  json(body) { this.body = body; return this; },
});

test("delayed PO report excludes POs fully inspected before their ETD", async (t) => {
  t.mock.method(Order, "find", () => asQuery([
    {
      _id: "excluded-po",
      order_id: "PO-EXCLUDED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-1" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-01-31",
      },
    },
    {
      _id: "included-po",
      order_id: "PO-INCLUDED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-2" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-02-02",
      },
    },
  ]));

  const res = response();
  await getDelayedPoReport({ query: {}, user: { role: "admin" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.rows.map((row) => row.order_id), ["PO-INCLUDED"]);
});

test("shipping delay report includes only fully packed, unshipped POs past ETD", async (t) => {
  t.mock.method(Order, "find", () => asQuery([
    {
      _id: "included-po",
      order_id: "PO-PACKED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-1" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-01-31",
      },
    },
    {
      _id: "partially-packed-po",
      order_id: "PO-PARTIAL",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-2" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 5 },
        last_inspected_date: "2020-01-31",
      },
    },
    {
      _id: "shipped-po",
      order_id: "PO-SHIPPED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-3" },
      ETD: "2020-02-01",
      shipment: [{ quantity: 10 }],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-01-31",
      },
    },
    {
      _id: "late-packed-po",
      order_id: "PO-LATE-PACKED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-4" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-02-02",
      },
    },
  ]));

  const res = response();
  await getShippingDelayReport({ query: {}, user: { role: "admin" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.rows.map((row) => row.order_id), ["PO-PACKED"]);
  assert.equal(res.body.rows[0].delay_days > 0, true);
});

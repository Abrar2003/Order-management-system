const assert = require("node:assert/strict");
const test = require("node:test");

const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const {
  getOrdersByBrandAndStatus,
  getVendorSummaryByBrand,
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
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("vendor summary packed count includes fully inspected POs that are not fully shipped", async (t) => {
  const poOneItem = {
    order_id: "PO-1",
    brand: "Brand",
    vendor: "Vendor",
    quantity: 10,
    item: { item_code: "ITEM-1" },
    shipment: [],
    qc_record: { quantities: { qc_passed: 10 } },
  };
  const orders = [
    poOneItem,
    {
      ...poOneItem,
      item: { item_code: "ITEM-2" },
      quantity: 5,
      qc_record: { quantities: { qc_passed: 5 } },
    },
    {
      ...poOneItem,
      order_id: "PO-2",
      item: { item_code: "ITEM-3" },
      qc_record: { quantities: { qc_passed: 9 } },
    },
    {
      ...poOneItem,
      order_id: "PO-3",
      item: { item_code: "ITEM-4" },
      shipment: [{ quantity: 1 }],
    },
    {
      ...poOneItem,
      order_id: "PO-4",
      item: { item_code: "ITEM-5" },
      shipment: [{ quantity: 10 }],
    },
  ];

  t.mock.method(Order, "find", () => asQuery(orders));
  t.mock.method(Item, "find", () => asQuery([]));
  t.mock.method(QC, "find", () => asQuery([]));

  const res = response();
  await getVendorSummaryByBrand({
    params: { brand: "Brand" },
    user: { role: "admin", allowed_brands: [], allowed_vendors: ["all"] },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].totalPacked, 2);
});

test("packed order filter includes partially shipped, fully inspected POs", async (t) => {
  const order = {
    brand: "Brand",
    vendor: "Vendor",
    quantity: 10,
    shipment: [],
    qc_record: { quantities: { qc_passed: 10 } },
  };
  const orders = [
    { ...order, order_id: "PO-INSPECTED", item: { item_code: "ITEM-1" } },
    {
      ...order,
      order_id: "PO-PARTIAL-SHIPPED",
      item: { item_code: "ITEM-2" },
      shipment: [{ quantity: 1 }],
    },
    {
      ...order,
      order_id: "PO-SHIPPED",
      item: { item_code: "ITEM-3" },
      shipment: [{ quantity: 10 }],
    },
  ];

  t.mock.method(Order, "find", () => asQuery(orders));
  t.mock.method(Item, "find", () => asQuery([]));
  t.mock.method(QC, "find", () => asQuery([]));

  const res = response();
  await getOrdersByBrandAndStatus({
    params: { brand: "Brand", vendor: "Vendor", status: "Packed" },
    query: {},
    user: { role: "admin", allowed_brands: [], allowed_vendors: ["all"] },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.data.map((row) => row.order_id),
    ["PO-INSPECTED", "PO-PARTIAL-SHIPPED"],
  );
});

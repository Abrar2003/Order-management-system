const assert = require("node:assert/strict");
const test = require("node:test");

const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const { getVendorSummaryByBrand } = require("../controllers/order.controller");

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

test("vendor summary counts only POs whose every item quantity passed QC", async (t) => {
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
  assert.equal(res.body.data[0].totalPacked, 1);
});

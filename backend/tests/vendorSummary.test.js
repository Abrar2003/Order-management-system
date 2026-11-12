const assert = require("node:assert/strict");
const test = require("node:test");

const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const Vendor = require("../models/vendor.model");
const {
  getEtdCalendarOrders,
  getOrdersByBrandAndStatus,
  getTodayEtdOrdersByBrand,
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

test("vendor summary packed count includes only fully inspected POs with no shipments", async (t) => {
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
  assert.equal(res.body.data[0].totalPacked, 1);
});

test("all home order queries match the selected country, including legacy vendor records", async (t) => {
  const vendor = { _id: "vendor-1", name: "Vendor (India)" };
  const countryPattern = /^\s*India\s*$/i;
  t.mock.method(Vendor, "find", (match) => {
    assert.deepEqual(match, { country: countryPattern, deleted_at: null });
    return asQuery([vendor]);
  });

  const matches = [];
  t.mock.method(Order, "find", (match) => {
    matches.push(match);
    return asQuery(matches.length === 3 ? [{ order_id: "PO-1" }] : []);
  });
  const req = {
    params: { brand: "Brand" },
    query: { country: " India ", brand: "Brand", start: "2026-11-01", end: "2026-12-01" },
    user: { role: "admin", allowed_brands: [], allowed_vendors: ["all"] },
  };

  for (const handler of [getVendorSummaryByBrand, getTodayEtdOrdersByBrand, getEtdCalendarOrders]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, []);
  }

  assert.equal(matches.length, 4);
  const [brandMatch, countryMatch] = matches[0].$and;
  assert.equal(brandMatch.brand, "Brand");
  assert.deepEqual(countryMatch.$or[0], { "vendor.country": countryPattern });
  assert.deepEqual(countryMatch.$or[1]["vendor.country"], { $in: [null, /^\s*$/] });
  assert.deepEqual(countryMatch.$or[1].$or, [
    { "vendor.vendor_id": { $in: [vendor._id] } },
    { "vendor.vendor_id": null, "vendor.name": { $in: [/^\s*Vendor \(India\)\s*$/i] } },
    { vendor: { $in: [/^\s*Vendor \(India\)\s*$/i] } },
  ]);
  assert.deepEqual(matches[1], matches[0]);
  assert.deepEqual(matches[2].$and[0], matches[0]);
  assert.deepEqual(matches[3].$and[0], matches[0]);
});

test("packed order filter excludes partially shipped POs", async (t) => {
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
    ["PO-INSPECTED"],
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDailyShipmentReport } = require("../services/dailyShipmentReport.service");
const Order = require("../models/order.model");
const Sample = require("../models/sample.model");
const Item = require("../models/item.model");
const { getDailyShipmentReport } = require("../controllers/order.controller");

const order = (overrides = {}) => ({
  _id: "o1", order_id: "PO-1", brand: "Brand A", vendor: { name: "Vendor A" },
  quantity: 100, item: { item_code: "ITEM-1" },
  shipment: [{ _id: "s1", container: "CONT-1", quantity: 40, stuffing_date: "2026-10-16", shipping_ETD: "2026-10-18", shipping_ETA: "2026-11-18" }],
  ...overrides,
});
const shipmentRows = (orders) => orders.flatMap((entry) => entry.shipment.map((shipment) => ({
  ...entry, ...shipment, _id: entry._id, shipment_id: shipment._id,
  item_code: entry.item.item_code, order_quantity: entry.quantity, shipment_cbm: shipment.quantity * 0.1,
})));
const report = (orders, query = {}) => buildDailyShipmentReport({ orders, rows: shipmentRows(orders), query });

test("container totals and item quantities combine repeated entries without repeating order quantity", () => {
  const base = order();
  const orders = [order({ shipment: [...base.shipment, { ...base.shipment[0], _id: "s2", container: " cont-1 ", quantity: 20 }] })];
  const row = report(orders).data[0];
  assert.equal(row.container, "CONT-1");
  assert.equal(row.brand, "Brand A");
  assert.equal(row.vendor, "Vendor A");
  assert.equal(row.stuffed_cbm, 6);
  assert.deepEqual(row.stuffing_dates, ["2026-10-16"]);
  assert.deepEqual(row.shipping_etds, ["2026-10-18"]);
  assert.deepEqual(row.shipping_etas, ["2026-11-18"]);
  assert.equal(row.items.length, 1);
  assert.equal(row.items[0].order_quantity, 100);
  assert.equal(row.items[0].stuffed_quantity, 60);
  assert.equal(row.items[0].remaining_quantity, 40);
});

test("remaining quantity includes other containers even when only one container is in the report", () => {
  const base = order();
  const orders = [order({ shipment: [...base.shipment, { _id: "s2", container: "CONT-2", quantity: 30 }] })];
  const result = buildDailyShipmentReport({ orders, rows: shipmentRows(orders).slice(0, 1) });
  assert.equal(result.data[0].items[0].stuffed_quantity, 40);
  assert.equal(result.data[0].items[0].remaining_quantity, 30);
});

test("fully shipped PO becomes one summary per container; incomplete POs retain item rows", () => {
  const orders = [
    order({ quantity: 40 }),
    order({ _id: "o2", quantity: 40, item: { item_code: "ITEM-2" } }),
    order({ _id: "o3", order_id: "PO-2" }),
  ];
  const items = report(orders).data[0].items;
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { id: '["po-1","brand a","vendor a"]', order_id: "PO-1", fully_shipped: true });
  assert.equal(items[1].order_id, "PO-2");
  assert.equal(items[1].remaining_quantity, 60);
});

test("an unshipped sibling prevents a completed item from collapsing the PO", () => {
  const orders = [order({ quantity: 40 }), order({ _id: "o2", item: { item_code: "ITEM-2" }, shipment: [] })];
  assert.equal(report(orders).data[0].items[0].fully_shipped, undefined);
  assert.equal(report(orders).data[0].items[0].remaining_quantity, 0);
});

test("PO completion is separate for different brands and vendors", () => {
  const orders = [order({ quantity: 40 }), order({ _id: "o2", vendor: "Vendor B", shipment: [] }), order({ _id: "o3", brand: "Brand B", shipment: [] })];
  assert.equal(report(orders).data[0].items[0].fully_shipped, true);
});

test("search retains the whole container, while paging sorts by newest stuffing date", () => {
  const orders = [order(), order({ _id: "o2", order_id: "PO-2", item: { item_code: "ITEM-2" } }), order({ _id: "o3", shipment: [{ _id: "s3", quantity: 10, container: "CONT-2", stuffing_date: "2026-10-17" }] })];
  const searchResult = report(orders, { search: "item-2" });
  assert.equal(searchResult.data.length, 1);
  assert.equal(searchResult.data[0].items.length, 2);
  assert.equal(searchResult.data[0].stuffed_cbm, 8);
  const pageResult = report(orders, { limit: 1, page: 99 });
  assert.equal(pageResult.pagination.page, 2);
  assert.equal(pageResult.pagination.totalRecords, 2);
  assert.equal(pageResult.data[0].container, "CONT-1");
  assert.equal(report(orders, { limit: 1 }).data[0].container, "CONT-2");
  assert.equal(report(orders, { search: "missing" }).pagination.totalRecords, 0);
});

test("sample shipments and blank containers are excluded; missing dates remain blank", () => {
  const base = order();
  const rows = shipmentRows([base]);
  const result = buildDailyShipmentReport({ orders: [base], rows: [
    { ...rows[0], stuffing_date: null, shipping_ETD: null, shipping_ETA: null },
    { ...rows[0], container: " " }, { ...rows[0], container: "SAMPLE", line_type: "sample" },
  ] });
  assert.equal(result.data.length, 1);
  assert.deepEqual(result.data[0].stuffing_dates, []);
  assert.deepEqual(result.data[0].shipping_etas, []);
});

const queryResult = (rows) => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, lean: async () => rows });
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test("report handler applies data access on both queries, preserves pending siblings, and uses shared CBM", async (t) => {
  const shipped = order({ quantity: 40, status: "Shipped", total_po_cbm: 8 });
  const sibling = order({ _id: "o2", status: "Pending", item: { item_code: "ITEM-2" }, shipment: [] });
  const matches = [];
  t.mock.method(Order, "find", (match) => { matches.push(match); return queryResult([shipped, sibling]); });
  t.mock.method(Sample, "find", () => queryResult([]));
  t.mock.method(Item, "find", () => queryResult([]));
  const res = response();
  await getDailyShipmentReport({ query: { stuffing_date: "2026-10-16" }, user: { role: "viewer", allowed_brands: [{ name: "Brand A" }] } }, res);
  assert.equal(res.body.data[0].stuffed_cbm, 8);
  assert.equal(res.body.data[0].items[0].fully_shipped, undefined);
  assert.equal(matches.length, 2);
  for (const match of matches) assert.match(JSON.stringify(match), /Brand A/);
});

test("missing or invalid stuffing dates return 400 before querying orders", async (t) => {
  t.mock.method(Order, "find", () => { throw new Error("Should not query"); });
  for (const query of [{}, { stuffing_date: "" }, { stuffing_date: "invalid" }, { stuffing_date: "2026-02-30" }]) {
    const res = response();
    await getDailyShipmentReport({ query }, res);
    assert.equal(res.code, 400);
  }
});

test("single stuffing date excludes other days and undated containers", async (t) => {
  const orders = ["2026-10-15", "2026-10-16", "2026-10-17", null].map((date, index) => order({
    _id: `o${index}`, order_id: `PO-${index}`, status: "Partial Shipped",
    shipment: [{ _id: `s${index}`, container: `CONT-${index}`, quantity: 40, stuffing_date: date }],
  }));
  t.mock.method(Order, "find", () => queryResult(orders));
  t.mock.method(Sample, "find", () => queryResult([]));
  t.mock.method(Item, "find", () => queryResult([]));
  const res = response();
  await getDailyShipmentReport({ query: { stuffing_date: "2026-10-16" }, user: { role: "admin" } }, res);
  assert.deepEqual(res.body.data.map((row) => row.container), ["CONT-1"]);
  assert.deepEqual(res.body.data[0].stuffing_dates, ["2026-10-16"]);
});

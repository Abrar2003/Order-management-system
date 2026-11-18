const assert = require("node:assert/strict");
const test = require("node:test");

const Order = require("../models/order.model");
const { getVendorReports } = require("../controllers/qc.controller");

const asQuery = (value) => ({
  select() { return this; },
  populate() { return this; },
  lean: async () => value,
});

const response = () => ({
  statusCode: 200,
  body: null,
  status(statusCode) { this.statusCode = statusCode; return this; },
  json(body) { this.body = body; return this; },
});

test("vendor report filters by original ETD and uses it for packed and shipping delays", async (t) => {
  const find = t.mock.method(Order, "find", () => asQuery([
    {
      order_id: "PO-1", brand: "Brand", vendor: "Vendor", status: "Shipped",
      order_date: "2026-01-01", ETD: "2026-01-15", revised_ETD: "2026-02-15", quantity: 5,
      item: { item_code: "ITEM-1" }, qc_record: { last_inspected_date: "2026-01-08" },
      shipment: [{ stuffing_date: "2026-01-09", quantity: 4 }],
    },
    {
      order_id: "PO-1", brand: "Brand", vendor: "Vendor", status: "Shipped",
      order_date: "2026-01-01", ETD: "2026-01-15", revised_ETD: "2026-02-20", quantity: 5,
      item: { item_code: "ITEM-2" }, qc_record: { last_inspected_date: "2026-01-11" },
      shipment: [{ stuffing_date: "2026-01-10", quantity: 6 }],
    },
  ]));

  const res = response();
  await getVendorReports({
    query: { timeline: "custom", from_date: "2026-01-01", to_date: "2026-01-31" },
    user: { role: "admin", allowed_brands: [], allowed_vendors: ["all"] },
  }, res);

  assert.equal(res.statusCode, 200);
  const queryJson = JSON.stringify(find.mock.calls[0].arguments[0]);
  assert.match(queryJson, /"ETD":\{"\$gte":"2025-12-31T18:30:00.000Z","\$lt":"2026-01-31T18:30:00.000Z"\}/);
  assert.doesNotMatch(queryJson, /revised_ETD/);
  assert.deepEqual(res.body.vendors[0].orders[0], {
    order_id: "PO-1", brand: "Brand", vendor: "Vendor", status: "Shipped",
    order_date: "2026-01-01", etd: "2026-01-15", last_inspection_date: "2026-01-11",
    latest_shipment_date: "2026-01-10", complete_shipping_date: "2026-01-10",
    packed_delay_days: 4, shipping_delay_days: 5, delay_days: -4,
    delay_reference: "packed_date", item_count: 2, quantity_total: 10,
  });
  assert.equal(res.body.vendors[0].average_delay_days, -4);
  assert.equal(res.body.summary.average_delay_days, -4);
});

test("vendor report uses the detailed report's packed PO population", async (t) => {
  t.mock.method(Order, "find", () => asQuery([
    {
      order_id: "PO-LATE", brand: "Brand", vendor: "Vendor", status: "Inspection Done",
      order_date: "2026-01-01", ETD: "2026-01-10", quantity: 5,
      item: { item_code: "ITEM-1" }, qc_record: { last_inspected_date: "2026-01-15" }, shipment: [],
    },
    {
      order_id: "PO-EARLY", brand: "Brand", vendor: "Vendor", status: "Shipped",
      order_date: "2026-01-01", ETD: "2026-01-10", quantity: 5,
      item: { item_code: "ITEM-2" }, qc_record: { last_inspected_date: "2026-01-08" },
      shipment: [{ stuffing_date: "2026-01-09", quantity: 5 }],
    },
  ]));

  const res = response();
  await getVendorReports({
    query: { timeline: "custom", from_date: "2026-01-01", to_date: "2026-01-31" },
    user: { role: "admin", allowed_brands: [], allowed_vendors: ["all"] },
  }, res);

  assert.equal(res.body.summary.orders_count, 2);
  assert.equal(res.body.summary.delayed_orders_count, 1);
  assert.equal(res.body.summary.average_delay_days, 1.5);
});

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

test("vendor report calculates delays from the final inspection and complete shipment", async (t) => {
  t.mock.method(Order, "find", () => asQuery([
    {
      order_id: "PO-1", brand: "Brand", vendor: "Vendor", status: "Shipped",
      order_date: "2026-01-01", ETD: "2026-01-15", quantity: 5,
      item: { item_code: "ITEM-1" }, qc_record: { last_inspected_date: "2026-01-08" },
      shipment: [{ stuffing_date: "2026-01-09", quantity: 4 }],
    },
    {
      order_id: "PO-1", brand: "Brand", vendor: "Vendor", status: "Shipped",
      order_date: "2026-01-01", ETD: "2026-01-15", quantity: 5,
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
  assert.deepEqual(res.body.vendors[0].orders[0], {
    order_id: "PO-1", brand: "Brand", vendor: "Vendor", status: "Shipped",
    order_date: "2026-01-01", etd: "2026-01-15", last_inspection_date: "2026-01-11",
    latest_shipment_date: "2026-01-10", complete_shipping_date: "2026-01-10",
    packed_delay_days: 4, shipping_delay_days: 5, delay_days: 0,
    delay_reference: "latest_shipment_date", item_count: 2, quantity_total: 10,
  });
});

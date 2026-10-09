const assert = require("node:assert/strict");
const test = require("node:test");

const Inspection = require("../models/inspection.model");
const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const User = require("../models/user.model");
const { getWeeklyOrderSummary } = require("../controllers/qc.controller");

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

test("weekly summary includes pending PO lines that have no QC record", async (t) => {
  const qcId = "6ac3688044fb06c6590dc4b6";
  const inspectedOrder = {
    _id: "6a4e11300480f438b98163bb",
    order_id: "PO-1",
    vendor: "Vendor",
    brand: "Brand",
    quantity: 10,
    status: "Inspection Done",
    shipment: [],
    item: { item_code: "INSPECTED" },
  };
  const pendingOrder = {
    _id: "6a4e11300480f438b98163cd",
    order_id: "PO-1",
    vendor: "Vendor",
    brand: "Brand",
    quantity: 5,
    status: "Pending",
    shipment: [],
    item: { item_code: "PENDING" },
  };
  const inspectedQc = {
    _id: qcId,
    order: inspectedOrder,
    order_meta: { order_id: "PO-1", vendor: "Vendor", brand: "Brand" },
    item: { item_code: "INSPECTED" },
    quantities: { client_demand: 10, qc_passed: 10, pending: 0 },
  };
  let aggregateCalls = 0;

  t.mock.method(Inspection, "aggregate", () => {
    aggregateCalls += 1;
    return Promise.resolve(aggregateCalls === 1
      ? [{ _id: qcId, inspection_date: "2026-10-07", inspector: null }]
      : [{ _id: qcId, inspection_date: "2026-10-07", inspector: null }]);
  });
  t.mock.method(QC, "find", () => asQuery([inspectedQc]));
  t.mock.method(Order, "find", () => asQuery([inspectedOrder, pendingOrder]));
  t.mock.method(Item, "find", () => asQuery([]));
  t.mock.method(User, "find", () => asQuery([]));

  const res = response();
  await getWeeklyOrderSummary({
    query: { from_date: "2026-10-07", to_date: "2026-10-07" },
    user: { role: "admin", allowed_brands: [], allowed_vendors: ["all"] },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.items_count, 2);
  assert.deepEqual(
    res.body.vendors[0].items.map((item) => ({
      item_code: item.item_code,
      order_status: item.order_status,
      pending: item.pending,
    })),
    [
      { item_code: "INSPECTED", order_status: "Inspection Done", pending: 0 },
      { item_code: "PENDING", order_status: "Pending", pending: 5 },
    ],
  );
});

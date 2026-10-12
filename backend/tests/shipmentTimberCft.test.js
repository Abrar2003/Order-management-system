const test = require("node:test");
const assert = require("node:assert/strict");
const Order = require("../models/order.model");
const Sample = require("../models/sample.model");
const Item = require("../models/item.model");
const { getShipmentsDb, exportShipmentsDb } = require("../controllers/order.controller");

const query = (rows) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  lean: async () => rows,
});

test("shipment rows and filtered total use rounded item and sample CFT, excluding missing values", async (t) => {
  t.mock.method(Order, "find", () => query([
    { _id: "o1", order_id: "PO-1", item: { item_code: "A" }, status: "Shipped", quantity: 3, shipment: [{ _id: "s1", quantity: 3, container: "C1" }] },
    { _id: "o2", order_id: "PO-2", item: { item_code: "B" }, status: "Shipped", quantity: 2, shipment: [{ _id: "s2", quantity: 2, container: "C1" }] },
  ]));
  t.mock.method(Sample, "find", () => query([
    { _id: "p1", code: "S", timber_cft: 0.333, shipment: [{ _id: "s3", quantity: 0.5, container: "C1" }] },
  ]));
  t.mock.method(Item, "find", () => query([
    { code: "A", timber_cft: 1.234 },
    { code: "B", timber_cft: null },
  ]));

  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await getShipmentsDb({ query: { container: "C1" }, user: { role: "admin" } }, res);

  assert.equal(res.code, 200);
  assert.deepEqual(res.body.data.map((row) => row.shipment_cft).sort(), [null, 0.167, 3.702].sort());
  assert.equal(res.body.summary.filteredStuffedCft, 3.869);
  assert.equal(res.body.summary.missingTimberCftLines, 1);

  const exportRes = {
    setHeader() {},
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; return this; },
  };
  await exportShipmentsDb({ query: { container: "C1", format: "csv" }, user: { role: "admin" } }, exportRes);
  assert.equal(exportRes.code, 200);
  assert.match(exportRes.body, /Stuffed CFT/);
  assert.match(exportRes.body, /3\.702/);
  assert.match(exportRes.body, /Missing/);
});

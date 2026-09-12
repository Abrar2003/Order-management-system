const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getVendorPerformanceReport,
  __test__: { buildClaimRows, buildPoSections },
} = require("../controllers/vendorPerformanceReport.controller");
const Order = require("../models/order.model");
const Item = require("../models/item.model");

const query = (rows) => ({
  select() { return this; },
  populate() { return this; },
  lean: async () => rows,
});

test("vendor performance keeps packed and shipping ETD comparisons separate", () => {
  const sections = buildPoSections([
    {
      order_id: "PO-1", brand: "Brand", vendor: { name: "Vendor" }, quantity: 5,
      status: "Inspection Done", ETD: "2026-01-10",
      qc_record: { last_inspected_date: "2026-01-12", quantities: { qc_passed: 5 } },
      shipment: [{ stuffing_date: "2026-01-15", quantity: 5 }],
    },
  ]);
  assert.equal(sections.po_delay[0].difference_days, 2);
  assert.equal(sections.shipping_delay[0].difference_days, 5);
});

test("vendor performance flags a lower latest claim percentage as positive", () => {
  const [row] = buildClaimRows([{
    _id: "item-1", code: "ITEM-1", vendors: ["Vendor"],
    claim_tenures: [
      { from_date: "2026-01-01", to_date: "2026-01-31", delivered_quantity: 100, rejected_quantity: 10 },
      { from_date: "2026-02-01", to_date: "2026-02-28", delivered_quantity: 100, rejected_quantity: 5 },
    ],
  }]);
  assert.equal(row.current_claim_percentage, 5);
  assert.equal(row.remark, "positive");
});

test("vendor performance includes incomplete POs and flags only overdue ones as overdue", () => {
  const { po_delay: rows } = buildPoSections([{
    order_id: "PO-PENDING", brand: "Brand", vendor: "Vendor", quantity: 5,
    status: "Under Inspection", ETD: "2020-01-10",
    qc_record: { quantities: { qc_passed: 3 } }, shipment: [],
  }, {
    order_id: "PO-UPCOMING", brand: "Brand", vendor: "Vendor", quantity: 5,
    status: "Pending", ETD: "2099-01-10", qc_record: {}, shipment: [],
  }]);
  assert.equal(rows[0].status, "Inspection pending — delayed");
  assert.equal(rows[0].is_overdue_inspection_pending, true);
  const upcoming = rows.find((row) => row.po === "PO-UPCOMING");
  assert.equal(upcoming.status, "Inspection pending");
  assert.equal(upcoming.is_inspection_pending, true);
  assert.equal(upcoming.is_overdue_inspection_pending, false);
});

test("vendor performance scopes both selected vendor data sources", async (t) => {
  const orderMatches = [];
  const itemMatches = [];
  let orderCall = 0;
  t.mock.method(Order, "find", (match) => {
    orderMatches.push(match);
    orderCall += 1;
    return query(orderCall === 1 ? [{ vendor: { name: "Vendor A" } }] : []);
  });
  t.mock.method(Item, "find", (match) => {
    itemMatches.push(match);
    return query([]);
  });
  const res = { body: null, json(body) { this.body = body; return this; }, status() { return this; } };

  await getVendorPerformanceReport({
    query: { vendor: "Vendor B" },
    user: { role: "admin", allowed_brands: [{ name: "Brand A" }], allowed_vendors: ["Vendor A"] },
  }, res);

  assert.deepEqual(res.body.sections.po_delay.rows, []);
  assert.match(JSON.stringify(orderMatches[1]), /Brand A/);
  assert.match(JSON.stringify(orderMatches[1]), /Vendor A/);
  assert.match(JSON.stringify(orderMatches[1]), /Vendor B/);
  assert.match(JSON.stringify(orderMatches[2]), /Vendor B/);
  assert.match(JSON.stringify(itemMatches[0]), /Vendor A/);
  assert.match(JSON.stringify(itemMatches[0]), /Vendor B/);
});

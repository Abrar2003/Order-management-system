const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { buildClaimRows, buildTenureClaimAverageRows, buildVendorPerformanceSummaries },
} = require("../controllers/vendorPerformanceReport.controller");
const reportsController = require("../controllers/reports.controller");
const Tenure = require("../models/tenure.model");
const Item = require("../models/item.model");

test("vendor claims resolve their shared tenure dates", () => {
  const [row] = buildClaimRows([{
    _id: "item-1",
    code: "ITEM-1",
    claim_tenures: [
      { tenure_id: "tenure-1", delivered_quantity: 100, rejected_quantity: 10 },
      { tenure_id: "tenure-2", delivered_quantity: 100, rejected_quantity: 5 },
    ],
  }], new Map([
    ["tenure-1", { _id: "tenure-1", from_date: "2026-01-01", to_date: "2026-01-31" }],
    ["tenure-2", { _id: "tenure-2", from_date: "2026-02-01", to_date: "2026-02-28" }],
  ]));

  assert.equal(row.current_claim_percentage, 5);
  assert.equal(row.remark, "positive");
});

test("vendor claim chart totals each brand tenure before calculating its rate", () => {
  const rows = buildTenureClaimAverageRows([
    { brand: "By Boo", tenures: [{ tenure_id: "tenure-1", from_date: "2026-01-01", to_date: "2026-01-31", delivered_quantity: 100, rejected_quantity: 10 }] },
    { brand: "By Boo", tenures: [{ tenure_id: "tenure-1", from_date: "2026-01-01", to_date: "2026-01-31", delivered_quantity: 10, rejected_quantity: 5 }] },
    { brand: "Eleonora", tenures: [{ tenure_id: "tenure-2", from_date: "2026-01-01", to_date: "2026-01-31", delivered_quantity: 50, rejected_quantity: 5 }] },
  ]);

  assert.deepEqual(rows.map(({ label, item_count, average_claim_percentage }) => ({ label, item_count, average_claim_percentage })), [
    { label: "By Boo · 2026-01-01 to 2026-01-31", item_count: 2, average_claim_percentage: 13.64 },
    { label: "Eleonora · 2026-01-01 to 2026-01-31", item_count: 1, average_claim_percentage: 10 },
  ]);
});

test("claim tenure deletion refuses tenures that are used by an item", async (t) => {
  const tenure = { _id: "507f1f77bcf86cd799439011", brand: "Brand" };
  let deleted = false;
  t.mock.method(Tenure, "findOne", () => ({ lean: async () => tenure }));
  t.mock.method(Item, "exists", async () => ({ _id: "item-1" }));
  t.mock.method(Tenure, "deleteOne", async () => { deleted = true; });
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };

  await reportsController.deleteClaimTenure({ params: { tenureId: tenure._id }, user: { role: "admin" } }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, "This tenure has claim entries and cannot be deleted.");
  assert.equal(deleted, false);
});

test("claim tenure deletion removes an unused tenure", async (t) => {
  const tenure = { _id: "507f1f77bcf86cd799439011", brand: "Brand" };
  let deletedId = "";
  t.mock.method(Tenure, "findOne", () => ({ lean: async () => tenure }));
  t.mock.method(Item, "exists", async () => null);
  t.mock.method(Tenure, "deleteOne", async ({ _id }) => { deletedId = String(_id); });
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };

  await reportsController.deleteClaimTenure({ params: { tenureId: tenure._id }, user: { role: "admin" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true });
  assert.equal(deletedId, tenure._id);
});

test("legacy date-range claims do not block unrelated item saves", () => {
  const legacyItem = new Item({ claim_tenures: [{ from_date: "2026-01-01", to_date: "2026-01-31", delivered_quantity: 100, rejected_quantity: 5 }] });
  const incompleteNewItem = new Item({ claim_tenures: [{ delivered_quantity: 100, rejected_quantity: 5 }] });

  assert.equal(legacyItem.validateSync()?.errors["claim_tenures.0.tenure_id"], undefined);
  assert.ok(incompleteNewItem.validateSync()?.errors["claim_tenures.0.tenure_id"]);
});

test("vendor performance summaries retain PO brands and combine claim totals", () => {
  const summaries = buildVendorPerformanceSummaries({
    brands: ["By Boo", "Eleonora"],
    poRows: [{ brand: "By Boo", difference_days: 2 }, { brand: "By Boo", difference_days: -4 }],
    claimRows: [{ delivered_quantity: 100, rejected_quantity: 10 }, { delivered_quantity: 20, rejected_quantity: 4 }],
    totalItemCount: 5,
    shippingRows: [
      { packed_difference_days: 3, etd_difference_days: 4 },
      { packed_difference_days: -1, etd_difference_days: -2 },
      { packed_difference_days: 2, etd_difference_days: 1 },
    ],
  });

  assert.deepEqual(summaries.po_delay.brands, [
    { brand: "By Boo", po_count: 2, delayed_po_count: 1, early_po_count: 1, average_delay_days: -1 },
    { brand: "Eleonora", po_count: 0, delayed_po_count: 0, early_po_count: 0, average_delay_days: null },
  ]);
  assert.deepEqual(summaries.po_delay.combined, { po_count: 2, delayed_po_count: 1, early_po_count: 1, average_delay_days: -1 });
  assert.deepEqual(summaries.product_complaints, {
    total_item_count: 5,
    claimed_item_count: 2,
    claimed_item_percentage: 40,
    average_claim_percentage: 11.67,
  });
  assert.deepEqual(summaries.shipping_delay, {
    po_count: 3,
    delayed_by_etd_po_count: 2,
    early_by_etd_po_count: 1,
    average_stuffing_time_days: 1.33,
  });
});

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  __test__: { buildClaimComparisonRows, isCurrentClaimSystemItem, buildClaimsReportRow, matchesInspectedItemsReportFilters },
} = require("../controllers/reports.controller");

test("Claims report includes tenure-based claims and calculates their totals", () => {
  assert.equal(isCurrentClaimSystemItem({ claim_percentage: 20 }), false);
  assert.equal(isCurrentClaimSystemItem({ claim_tenures: [] }), false);
  assert.equal(isCurrentClaimSystemItem({ claim_tenures: [{}] }), false);
  assert.equal(isCurrentClaimSystemItem({ claim_tenures: [{ tenure_id: "tenure-1" }] }), true);

  const row = buildClaimsReportRow({
    _id: "claim-1",
    code: "ITEM-1",
    vendors: ["Vendor A"],
    claim_tenures: [
      { tenure_id: "tenure-1", delivered_quantity: 100, rejected_quantity: 5 },
      { tenure_id: "tenure-2", delivered_quantity: 50, rejected_quantity: 10 },
    ],
  }, new Map([
    ["tenure-1", { _id: "tenure-1", from_date: "2026-01-01", to_date: "2026-01-31" }],
    ["tenure-2", { _id: "tenure-2", from_date: "2026-02-01", to_date: "2026-02-28" }],
  ]));

  assert.equal(row.delivered_quantity, 150);
  assert.equal(row.rejected_quantity, 15);
  assert.equal(row.claim_percentage, 10);
  assert.equal(matchesInspectedItemsReportFilters(row, { search: "ITEM-1", vendor: "Vendor A" }), true);
  assert.equal(matchesInspectedItemsReportFilters(row, { vendor: "Other Vendor" }), false);

  const zeroClaimRow = buildClaimsReportRow({ code: "ITEM-2", claim_tenures: [] }, new Map(), "tenure-1");
  assert.equal(zeroClaimRow.delivered_quantity, 0);
  assert.equal(zeroClaimRow.rejected_quantity, 0);
  assert.equal(zeroClaimRow.claim_percentage, 0);
});

test("claim comparison classifies missing, new, and retained claim items", () => {
  const rows = buildClaimComparisonRows([
    { _id: "missing", code: "OLD", claim_tenures: [{ tenure_id: "previous", delivered_quantity: 10, rejected_quantity: 1 }] },
    { _id: "new", code: "NEW", claim_tenures: [{ tenure_id: "current", delivered_quantity: 20, rejected_quantity: 4 }] },
    { _id: "same", code: "SAME", claim_tenures: [
      { tenure_id: "previous", delivered_quantity: 10, rejected_quantity: 1 },
      { tenure_id: "current", delivered_quantity: 20, rejected_quantity: 3 },
    ] },
    { _id: "improved", code: "IMPROVED", claim_tenures: [
      { tenure_id: "previous", delivered_quantity: 10, rejected_quantity: 2 },
      { tenure_id: "current", delivered_quantity: 20, rejected_quantity: 2 },
    ] },
  ], "previous", "current");

  assert.deepEqual(rows.map(({ code, status }) => ({ code, status })), [
    { code: "OLD", status: "missing" },
    { code: "NEW", status: "new" },
    { code: "SAME", status: "same" },
    { code: "IMPROVED", status: "same" },
  ]);
  assert.equal(rows[0].current, null);
  assert.equal(rows[2].trend, "increased");
  assert.equal(rows[3].trend, "improved");
});

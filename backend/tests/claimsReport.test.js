const test = require("node:test");
const assert = require("node:assert/strict");

const {
  __test__: { isCurrentClaimSystemItem, buildClaimsReportRow, matchesInspectedItemsReportFilters },
} = require("../controllers/reports.controller");

test("Claims report includes only tenure-based claims and calculates their totals", () => {
  assert.equal(isCurrentClaimSystemItem({ claim_percentage: 20 }), false);
  assert.equal(isCurrentClaimSystemItem({ claim_tenures: [] }), false);
  assert.equal(isCurrentClaimSystemItem({ claim_tenures: [{}] }), true);

  const row = buildClaimsReportRow({
    _id: "claim-1",
    code: "ITEM-1",
    vendors: ["Vendor A"],
    claim_tenures: [
      { from_date: "2026-01-01", to_date: "2026-01-31", delivered_quantity: 100, rejected_quantity: 5 },
      { from_date: "2026-02-01", to_date: "2026-02-28", delivered_quantity: 50, rejected_quantity: 10 },
    ],
  });

  assert.equal(row.delivered_quantity, 150);
  assert.equal(row.rejected_quantity, 15);
  assert.equal(row.claim_percentage, 10);
  assert.equal(matchesInspectedItemsReportFilters(row, { search: "ITEM-1", vendor: "Vendor A" }), true);
  assert.equal(matchesInspectedItemsReportFilters(row, { vendor: "Other Vendor" }), false);
});

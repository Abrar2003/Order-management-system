const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeClaimTenures } = require("../helpers/claimPercentage");

test("claim percentage is weighted across every tenure", () => {
  const claim = normalizeClaimTenures([
    {
      from_date: "2025-01-01",
      to_date: "2025-03-31",
      delivered_quantity: 100,
      rejected_quantity: 10,
    },
    {
      from_date: "2025-04-01",
      to_date: "2025-07-31",
      delivered_quantity: 10,
      rejected_quantity: 5,
    },
  ]);

  assert.equal(claim.delivered_quantity, 110);
  assert.equal(claim.rejected_quantity, 15);
  assert.equal(claim.claim_percentage, 13.64);
});

test("claim tenures reject overlapping dates and rejected quantities above delivery", () => {
  assert.throws(
    () => normalizeClaimTenures([
      { from_date: "2025-01-01", to_date: "2025-03-31", delivered_quantity: 10, rejected_quantity: 1 },
      { from_date: "2025-03-31", to_date: "2025-04-30", delivered_quantity: 10, rejected_quantity: 1 },
    ]),
    /cannot overlap/,
  );
  assert.throws(
    () => normalizeClaimTenures([
      { from_date: "2025-01-01", to_date: "2025-03-31", delivered_quantity: 10, rejected_quantity: 11 },
    ]),
    /cannot exceed/,
  );
});

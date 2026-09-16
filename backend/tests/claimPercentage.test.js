const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeClaimTenures } = require("../helpers/claimPercentage");

test("claim percentage is weighted across every tenure", () => {
  const claim = normalizeClaimTenures([
    {
      tenure_id: "tenure-1",
      delivered_quantity: 100,
      rejected_quantity: 10,
    },
    {
      tenure_id: "tenure-2",
      delivered_quantity: 10,
      rejected_quantity: 5,
    },
  ]);

  assert.equal(claim.delivered_quantity, 110);
  assert.equal(claim.rejected_quantity, 15);
  assert.equal(claim.claim_percentage, 13.64);
});

test("claim tenures reject duplicate tenures and rejected quantities above delivery", () => {
  assert.throws(
    () => normalizeClaimTenures([
      { tenure_id: "tenure-1", delivered_quantity: 10, rejected_quantity: 1 },
      { tenure_id: "tenure-1", delivered_quantity: 10, rejected_quantity: 1 },
    ]),
    /only one claim/,
  );
  assert.throws(
    () => normalizeClaimTenures([
      { tenure_id: "tenure-1", delivered_quantity: 10, rejected_quantity: 11 },
    ]),
    /cannot exceed/,
  );
});

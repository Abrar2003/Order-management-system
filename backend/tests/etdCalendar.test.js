const assert = require("node:assert/strict");
const test = require("node:test");
const {
  __test__: {
    buildEtdCalendarRows,
    buildEffectiveEtdCalendarMatch,
    resolveEtdCalendarRange,
  },
} = require("../controllers/order.controller");

test("ETD calendar uses each PO's current revised ETD once", () => {
  const range = resolveEtdCalendarRange("2026-09-01", "2026-10-01");
  const match = buildEffectiveEtdCalendarMatch(range);
  const rows = buildEtdCalendarRows(
    [
      {
        _id: "first-item",
        order_id: "PO-234",
        brand: "Brand",
        vendor: { name: "ABC Furniture", country: "China" },
        ETD: "2026-09-10",
        revised_ETD: "2026-09-28",
        status: "Inspection Done",
      },
      {
        _id: "second-item",
        order_id: "PO-234",
        brand: "Brand",
        vendor: { name: "ABC Furniture", country: "China" },
        ETD: "2026-09-10",
        revised_ETD: "2026-09-28",
        status: "Shipped",
      },
    ],
    {
      candidateGroupKeys: new Set(["PO-234__brand__abc furniture"]),
      range,
    },
  );

  assert.equal(match.$or[0].revised_ETD.$gte.toISOString(), "2026-08-31T18:30:00.000Z");
  assert.deepEqual(rows, [
    {
      id: "first-item",
      order_id: "PO-234",
      vendor: "ABC Furniture",
      etd: "2026-09-28",
      status: "Partial Shipped",
      brand: "Brand",
      country: "China",
    },
  ]);
});

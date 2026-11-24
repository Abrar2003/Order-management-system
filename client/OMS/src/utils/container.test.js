import assert from "node:assert/strict";
import test from "node:test";
import { getContainerEtaRowsForBrand, getWeeklyContainerArrivals } from "./container.js";
import { toISODateString } from "./date.js";

test("calendar matches exact brands and includes containers shared by multiple brands", () => {
  const eta = "2026-12-28";
  const containers = [
    { container: "GIGA", brands: ["Giga"], shipping_ETA: eta },
    { container: "SHARED", brands: ["By Boo", "Giga"], shipping_ETA: eta },
    { container: "OTHER", brands: ["Gigantic"], shipping_ETA: eta },
    { container: "NO-ETA", brands: ["Giga"], shipping_ETA: null },
    { container: "CACHED", brand: "By Boo, Giga", shipping_ETA: eta },
    { container: "COMMA", brands: ["Home, Inc."], shipping_ETA: eta },
  ];
  const containersFor = (brand) => getContainerEtaRowsForBrand(containers, brand).map((row) => row.container);

  assert.deepEqual(containersFor("giga"), ["GIGA", "SHARED", "CACHED"]);
  assert.deepEqual(containersFor("By Boo"), ["SHARED", "CACHED"]);
  assert.deepEqual(containersFor("Home, Inc."), ["COMMA"]);
  assert.deepEqual(containersFor("Home"), []);
  assert.deepEqual(containersFor(""), []);
});

test("weekly arrivals include Monday and Sunday across the year boundary", () => {
  const containers = [
    { container: "SUNDAY", shipping_ETA: "2027-01-03" },
    { container: "NEXT-WEEK", shipping_ETA: "2027-01-04", shipping_date: "2027-01-02" },
    { container: "PREVIOUS-WEEK", shipping_ETA: "2026-12-27" },
    { container: "MONDAY", shipping_ETA: "2026-12-28", shipping_date: "2026-12-25" },
    { container: "NO-ETA", shipping_ETA: null },
  ];

  const today = toISODateString(new Date("2026-12-27T18:30:00Z"));
  for (const day of [today, "2027-01-01", "2027-01-03"]) {
    const { start, end, rows } = getWeeklyContainerArrivals(containers, day);
    assert.equal(start, "2026-12-28");
    assert.equal(end, "2027-01-03");
    assert.deepEqual(rows.map((row) => row.container), ["MONDAY", "SUNDAY"]);
  }
});

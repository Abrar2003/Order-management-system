import assert from "node:assert/strict";
import test from "node:test";
import { getWeeklyContainerArrivals } from "./container.js";
import { toISODateString } from "./date.js";

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

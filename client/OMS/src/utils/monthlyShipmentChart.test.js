import assert from "node:assert/strict";
import test from "node:test";
import { packMonthlySeries } from "./monthlyShipmentChart.js";

test("packs only positive monthly series and keeps each bar's own metadata", () => {
  const chart = packMonthlySeries({
    series: ["Alpha", "Beta", "Never shipped"],
    seriesField: "vendor",
    rows: [
      {
        month: "2026-01",
        month_label: "Jan 2026",
        totals: [
          { vendor: "Alpha", unique_container_count: 2, total_allocated_cbm: 20 },
          { vendor: "Beta", unique_container_count: 0, total_allocated_cbm: 0 },
        ],
      },
      {
        month: "2026-02",
        month_label: "Feb 2026",
        totals: [
          { vendor: "Alpha", unique_container_count: 1, total_allocated_cbm: 10 },
          { vendor: "Beta", unique_container_count: 3, total_allocated_cbm: 30 },
        ],
      },
    ],
  });

  assert.deepEqual(chart.slots, ["slot_0", "slot_1"]);
  assert.deepEqual(chart.series.map(({ label }) => label), ["Alpha", "Beta"]);
  assert.equal(chart.rows[0].__active_count, 1);
  assert.equal(chart.rows[0].slot_1, undefined);
  assert.equal(chart.rows[0].__meta.slot_0.vendor, "Alpha");
  assert.equal(chart.rows[0].month_label, "Jan 2026");
  assert.equal(chart.rows[1].__meta.slot_1.vendor, "Beta");
  assert.equal(chart.rows[1].__meta.slot_1.total_allocated_cbm, 30);
});

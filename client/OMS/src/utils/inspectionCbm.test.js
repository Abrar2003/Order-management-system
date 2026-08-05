import assert from "node:assert/strict";
import test from "node:test";
import { resolveInspectionRecordCbm } from "./inspectionCbm.js";

test("uses inspection dimensions when its CBM snapshot is empty", () => {
  assert.equal(
    resolveInspectionRecordCbm({
      cbm: { total: "0" },
      inspected_box_sizes: [{ L: 100, B: 100, H: 100 }],
    }),
    1,
  );
});

test("keeps the saved inspection CBM before later item changes", () => {
  assert.equal(
    resolveInspectionRecordCbm(
      { cbm: { total: "0.5" } },
      { item_master: { cbm: { calculated_inspected_total: "1" } } },
    ),
    0.5,
  );
});

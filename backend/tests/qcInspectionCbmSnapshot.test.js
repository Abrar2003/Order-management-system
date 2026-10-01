const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { buildInspectionCbmSnapshot },
} = require("../controllers/qc.controller");

test("inspection CBM is recalculated from its saved box dimensions", () => {
  const cbm = buildInspectionCbmSnapshot({
    inspectionSizeSnapshot: {
      inspected_box_sizes: [{ L: 186, B: 24.5, H: 91 }],
      inspected_box_mode: "Individual Packing",
    },
    fallbackCbm: { total: "0.25" },
  });

  assert.deepEqual(cbm, {
    box1: "0.414687",
    box2: "0",
    box3: "0",
    total: "0.414687",
  });
});

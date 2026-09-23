const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { buildInspectorUsedLabelState, recalculateInspectorUsedLabels },
} = require("../controllers/qc.controller");
const Inspection = require("../models/inspection.model");
const Inspector = require("../models/inspector.model");

test("label cache state preserves vendor references and skips empty inspections", () => {
  const vendor = { name: "Acme", vendor_id: "vendor-1", country: "India" };
  const result = buildInspectorUsedLabelState([
    {
      _id: "older",
      qc: { _id: "qc-1", order_meta: { vendor }, item: { item_code: "A" } },
      labels_added: [3, 2, 3],
      createdAt: new Date("2026-09-01"),
    },
    { _id: "empty", labels_added: [] },
  ]);

  assert.deepEqual(result.used_labels, [2, 3]);
  assert.equal(result.label_used_history.length, 1);
  assert.equal(result.label_used_history[0].qc_meta.vendor, vendor);
});

test("label cache recalculation retries an inspector version conflict", async () => {
  const originalFindOne = Inspector.findOne;
  const originalFind = Inspection.find;
  let saves = 0;

  Inspector.findOne = () => ({
    save: async () => {
      saves += 1;
      if (saves === 1) {
        const error = new Error("concurrent update");
        error.name = "VersionError";
        throw error;
      }
    },
  });
  Inspection.find = () => ({
    select() { return this; },
    populate() { return this; },
    lean: async () => [],
  });

  try {
    await recalculateInspectorUsedLabels(["507f1f77bcf86cd799439011"]);
    assert.equal(saves, 2);
  } finally {
    Inspector.findOne = originalFindOne;
    Inspection.find = originalFind;
  }
});

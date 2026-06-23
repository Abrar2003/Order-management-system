const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildValidInspectionPoLookup,
  isValidInspectionHistoryRecord,
} = require("../services/validInspectionHistory.service");

const validRecord = (po, overrides = {}) => ({
  item_code: "ITEM-1",
  order_id: po,
  inspection_date: "2026-06-20",
  inspector: "507f1f77bcf86cd799439011",
  source: "inspection_record",
  ...overrides,
});

test("qualifies an item inspected in exactly 3 distinct POs", () => {
  const lookup = buildValidInspectionPoLookup([
    validRecord("PO-1"),
    validRecord("PO-2"),
    validRecord("PO-3"),
  ]);

  assert.deepEqual(lookup.get("item-1"), {
    distinct_po_count: 3,
    eligible: true,
  });
});

test("qualifies an item inspected in more than 3 distinct POs", () => {
  const lookup = buildValidInspectionPoLookup([
    validRecord("PO-1"),
    validRecord("PO-2"),
    validRecord("PO-3"),
    validRecord("PO-4"),
  ]);

  assert.deepEqual(lookup.get("item-1"), {
    distinct_po_count: 4,
    eligible: true,
  });
});

test("multiple inspections in one PO count once", () => {
  const lookup = buildValidInspectionPoLookup([
    validRecord("PO-1"),
    validRecord(" po-1 "),
    validRecord("PO-2"),
    validRecord("PO-3"),
  ]);

  assert.deepEqual(lookup.get("item-1"), {
    distinct_po_count: 3,
    eligible: true,
  });
});

test("excludes items with fewer than 3 valid distinct POs", () => {
  const lookup = buildValidInspectionPoLookup([
    validRecord("PO-1"),
    validRecord("PO-2"),
  ]);

  assert.deepEqual(lookup.get("item-1"), {
    distinct_po_count: 2,
    eligible: false,
  });
});

test("ignores records missing PO, inspection date, or inspector", () => {
  const lookup = buildValidInspectionPoLookup([
    validRecord("PO-1"),
    validRecord("PO-2"),
    validRecord("PO-3", { order_id: "" }),
    validRecord("PO-4", { inspection_date: "" }),
    validRecord("PO-5", { inspector: null }),
  ]);

  assert.deepEqual(lookup.get("item-1"), {
    distinct_po_count: 2,
    eligible: false,
  });
});

test("QC-only snapshots never qualify as inspection history", () => {
  assert.equal(
    isValidInspectionHistoryRecord({
      itemCode: "ITEM-1",
      orderId: "PO-1",
      inspectionDate: "2026-06-20",
      inspector: "507f1f77bcf86cd799439011",
      source: "qc_snapshot",
    }),
    false,
  );
});

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatSizeArrayToReference,
  formatSizeEntryToReference,
  normalizeSizeGroupForComparison,
  pickReferenceSizeArray,
} = require("../helpers/sizeDimensionFormatter");
const { buildFinalPisCheckRows } = require("../helpers/finalPisCheck");
const {
  compareInspectionSizeSnapshot,
} = require("../helpers/inspectionSizeSnapshot");
const {
  compareItemSizeDimensionVariance,
} = require("../helpers/measurementMismatchRules");

test("reorders incoming dimensions to match reference dimensions", () => {
  const result = formatSizeEntryToReference(
    { L: 100, B: 100, H: 50 },
    { L: 100, B: 50, H: 100 },
  );

  assert.deepEqual(result, { L: 100, B: 50, H: 100 });
});

test("reorders using tolerance while preserving measured values", () => {
  const result = formatSizeEntryToReference(
    { L: 99, B: 101, H: 49 },
    { L: 100, B: 50, H: 100 },
  );

  assert.deepEqual(result, { L: 99, B: 49, H: 101 });
});

test("handles duplicate dimensions according to target axis order", () => {
  const result = formatSizeEntryToReference(
    { L: 50, B: 100, H: 100 },
    { L: 100, B: 50, H: 100 },
  );

  assert.deepEqual(result, { L: 100, B: 50, H: 100 });
});

test("uses PIS reference when master reference is unavailable", () => {
  const item = {
    master_item_sizes: [{ L: 0, B: 50, H: 100 }],
    pis_item_sizes: [{ L: 100, B: 50, H: 100 }],
  };
  const reference = pickReferenceSizeArray(item, "item");
  const result = formatSizeArrayToReference(
    [{ L: 99, B: 101, H: 49 }],
    reference,
    { type: "item" },
  );

  assert.deepEqual(reference, item.pis_item_sizes);
  assert.deepEqual(result, [{ L: 99, B: 49, H: 101 }]);
});

test("uses master reference before PIS reference", () => {
  const item = {
    master_item_sizes: [{ L: 200, B: 50, H: 100 }],
    pis_item_sizes: [{ L: 100, B: 50, H: 100 }],
  };

  assert.deepEqual(pickReferenceSizeArray(item, "item"), item.master_item_sizes);
});

test("leaves incoming unchanged when no valid reference is available", () => {
  const incoming = [{ L: 99, B: 101, H: 49 }];
  const result = formatSizeArrayToReference(incoming, [], { type: "item" });

  assert.strictEqual(result, incoming);
});

test("preserves non-dimension fields", () => {
  const result = formatSizeEntryToReference(
    {
      L: 99,
      B: 101,
      H: 49,
      remark: "top",
      net_weight: 12,
      gross_weight: 14,
      box_type: "inner",
      item_count_in_inner: 2,
      box_count_in_master: 3,
    },
    { L: 100, B: 50, H: 100 },
  );

  assert.deepEqual(result, {
    L: 99,
    B: 49,
    H: 101,
    remark: "top",
    net_weight: 12,
    gross_weight: 14,
    box_type: "inner",
    item_count_in_inner: 2,
    box_count_in_master: 3,
  });
});

test("matches box references by box_type before index", () => {
  const result = formatSizeArrayToReference(
    [
      { L: 19, B: 31, H: 9, box_type: "master" },
      { L: 99, B: 51, H: 101, box_type: "inner" },
    ],
    [
      { L: 100, B: 50, H: 100, box_type: "inner" },
      { L: 20, B: 10, H: 30, box_type: "master" },
    ],
    { type: "box" },
  );

  assert.deepEqual(result, [
    { L: 19, B: 9, H: 31, box_type: "master" },
    { L: 99, B: 51, H: 101, box_type: "inner" },
  ]);
});

test("matches tolerance exactly at one centimeter", () => {
  const result = formatSizeEntryToReference(
    { L: 99, B: 50, H: 100 },
    { L: 100, B: 50, H: 100 },
  );

  assert.deepEqual(result, { L: 99, B: 50, H: 100 });
});

test("does not match dimensions greater than tolerance", () => {
  const result = formatSizeEntryToReference(
    { L: 98.9, B: 20, H: 30 },
    { L: 100, B: 20, H: 30 },
  );

  assert.deepEqual(result, { L: 98.9, B: 20, H: 30 });
});

test("normalizes PIS diff comparison sources before size mismatch checks", () => {
  const reference = [{ L: 100, B: 50, H: 100 }];
  const inspected = normalizeSizeGroupForComparison({
    sourceSizes: [{ L: 99, B: 101, H: 49 }],
    referenceSizes: reference,
    type: "item",
  });

  const hasMismatch = ["L", "B", "H"].some((axis) =>
    compareItemSizeDimensionVariance(inspected[0][axis], reference[0][axis]).mismatch,
  );

  assert.deepEqual(inspected, [{ L: 99, B: 49, H: 101 }]);
  assert.equal(hasMismatch, false);
});

test("final PIS check does not return a row when inspected dimensions only differ by LBH order", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-1",
      description: "Normalized item",
      inspected_item_sizes: [{ L: 99, B: 101, H: 49, net_weight: 10 }],
      master_item_sizes: [{ L: 100, B: 50, H: 100, net_weight: 10 }],
    },
  ]);

  assert.deepEqual(rows, []);
});

test("final PIS check falls back to PIS reference when master sizes are missing", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-2",
      description: "PIS fallback item",
      inspected_item_sizes: [{ L: 99, B: 101, H: 49, net_weight: 10 }],
      pis_item_sizes: [{ L: 100, B: 50, H: 100, net_weight: 10 }],
    },
  ]);

  assert.deepEqual(rows, []);
});

test("QC mismatch comparison ignores inspected LBH storage order when Master/PIS reference exists", () => {
  const mismatch = compareInspectionSizeSnapshot(
    {
      inspected_item_sizes: [{ L: 99, B: 101, H: 49 }],
      inspected_box_sizes: [{ L: 29, B: 61, H: 39, box_type: "master" }],
    },
    {
      master_item_sizes: [{ L: 100, B: 50, H: 100 }],
      pis_box_sizes: [{ L: 30, B: 40, H: 60, box_type: "master" }],
      inspected_item_sizes: [{ L: 100, B: 50, H: 100 }],
      inspected_box_sizes: [{ L: 30, B: 40, H: 60, box_type: "master" }],
    },
  );

  assert.equal(mismatch.has_mismatch, false);
  assert.deepEqual(mismatch.inspection_snapshot.inspected_item_sizes[0], {
    L: 99,
    B: 49,
    H: 101,
    remark: "",
    net_weight: 0,
    gross_weight: 0,
  });
  assert.deepEqual(mismatch.inspection_snapshot.inspected_box_sizes[0], {
    L: 29,
    B: 39,
    H: 61,
    net_weight: 0,
    gross_weight: 0,
    remark: "master",
    box_type: "master",
    item_count_in_inner: 0,
    box_count_in_master: 0,
  });
});

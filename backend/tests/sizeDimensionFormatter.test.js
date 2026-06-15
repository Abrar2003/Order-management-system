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

test("matches box references by remark when box_type is shared", () => {
  const result = formatSizeArrayToReference(
    [
      { L: 55, B: 80, H: 105, remark: "base", box_type: "individual" },
      { L: 246, B: 9, H: 106, remark: "top", box_type: "individual" },
    ],
    [
      { L: 245, B: 8, H: 104.5, remark: "top", box_type: "individual" },
      { L: 55, B: 105, H: 79, remark: "base", box_type: "individual" },
    ],
    { type: "box" },
  );

  assert.deepEqual(result, [
    { L: 55, B: 105, H: 80, remark: "base", box_type: "individual" },
    { L: 246, B: 9, H: 106, remark: "top", box_type: "individual" },
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

test("final PIS check does not return a row when inspected dimensions only differ from Master by LBH order", () => {
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

test("final PIS check reports inspected item size differences against Master", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-2",
      description: "Different inspected item",
      inspected_item_sizes: [{ L: 120, B: 50, H: 100, net_weight: 10 }],
      master_item_sizes: [{ L: 100, B: 50, H: 100, net_weight: 10 }],
    },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].diff_fields, ["Item Size"]);
  assert.equal(rows[0].references.source_label, "Inspected");
  assert.equal(rows[0].references.item_label, "Master");
  assert.equal(rows[0].differences[0].inspected, "120 cm");
  assert.equal(rows[0].differences[0].pis, "100 cm");
});

test("final PIS check normalizes inspected box base dimensions against Master before mismatch rows", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-BASE",
      description: "Normalized box base",
      inspected_box_mode: "individual",
      inspected_box_sizes: [
        { remark: "base", box_type: "individual", L: 55, B: 80, H: 105 },
      ],
      master_box_mode: "individual",
      master_box_sizes: [
        { remark: "base", box_type: "individual", L: 55, B: 105, H: 79 },
      ],
      cbm: {
        calculated_inspected_total: "0.46",
        calculated_master_total: "0.46",
      },
    },
  ]);

  assert.deepEqual(rows, []);
});

test("final PIS check keeps real inspected box dimension mismatches after normalization", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-TOP",
      description: "Top height mismatch",
      inspected_box_mode: "individual",
      inspected_box_sizes: [
        { remark: "top", box_type: "individual", L: 246, B: 9, H: 106 },
      ],
      master_box_mode: "individual",
      master_box_sizes: [
        { remark: "top", box_type: "individual", L: 245, B: 8, H: 104.5 },
      ],
      cbm: {
        calculated_inspected_total: "0.2",
        calculated_master_total: "0.2",
      },
    },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].diff_fields, ["Box Size"]);
  assert.equal(rows[0].references.source_label, "Inspected");
  assert.equal(rows[0].differences.length, 1);
  assert.equal(rows[0].differences[0].segment, "Top");
  assert.equal(rows[0].differences[0].attribute, "H");
  assert.equal(rows[0].differences[0].inspected, "106 cm");
  assert.equal(rows[0].differences[0].pis, "104.5 cm");
});

test("final PIS check reports inspected box mode count and weight differences against Master", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-3",
      description: "Different inspected box",
      inspected_box_mode: "individual",
      inspected_box_sizes: [
        {
          L: 30,
          B: 40,
          H: 50,
          gross_weight: 8,
          box_count_in_master: 2,
          box_type: "master",
        },
      ],
      master_box_mode: "carton",
      master_box_sizes: [
        {
          L: 30,
          B: 40,
          H: 50,
          gross_weight: 10,
          box_count_in_master: 4,
          box_type: "master",
        },
      ],
    },
  ]);

  const differenceAttributes = rows[0].differences.map((difference) => difference.attribute);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].diff_fields, ["Box Size"]);
  assert.equal(rows[0].references.source_label, "Inspected");
  assert.ok(differenceAttributes.includes("Box Mode"));
  assert.ok(differenceAttributes.includes("Gross Weight"));
  assert.ok(differenceAttributes.includes("Box Count in Master"));
});

test("final PIS check reports missing Master data instead of falling back to PIS", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-4",
      description: "Missing master item",
      inspected_item_sizes: [{ L: 100, B: 50, H: 100, net_weight: 10 }],
    },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].diff_fields, ["Item Size"]);
  assert.equal(rows[0].references.source_label, "Inspected");
  assert.equal(rows[0].references.item_label, "Master");
  assert.equal(rows[0].differences[0].delta, "Master data missing");
});

test("final PIS check does not compare barcode differences", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-5",
      description: "Barcode source item",
      pis_master_barcode: "4006381333931",
      master_master_barcode: "1234567890128",
      qc: {
        master_barcode: "9876543210987",
      },
    },
  ]);

  assert.deepEqual(rows, []);
});

test("final PIS check reports inspected CBM differences against Master calculated CBM", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-6",
      description: "CBM mismatch item",
      inspected_box_sizes: [{ L: 30, B: 40, H: 50, gross_weight: 10 }],
      master_box_sizes: [{ L: 100, B: 100, H: 100, gross_weight: 10 }],
      cbm: {
        calculated_inspected_total: "0.5",
      },
    },
  ]);

  assert.equal(rows.length, 1);
  assert.ok(rows[0].diff_fields.includes("CBM"));
  assert.ok(rows[0].differences.some((difference) => difference.section === "CBM"));
});

test("final PIS check does not emit country differences without inspected country data", () => {
  const rows = buildFinalPisCheckRows([
    {
      code: "ITEM-7",
      description: "Country only item",
      master_country_of_origin: "India",
      country_of_origin: "China",
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

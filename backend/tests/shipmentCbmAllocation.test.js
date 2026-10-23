const assert = require("node:assert/strict");
const test = require("node:test");
const {
  resolveOrderRowCbmSummary,
  resolveOrderRowCbmSummaryWithStoredFallback,
  resolveShipmentRowCbm,
} = require("../services/shipmentCbmAllocation.service");
const { buildPackedGoodsDataset } = require("../services/packedGoods.service");

const item8824177 = {
  code: "8824177",
  inspected_item_sizes: [{ remark: "item", L: 120, B: 120, H: 77.5 }],
  inspected_box_mode: "individual",
  inspected_box_sizes: [
    { remark: "top", L: 135.5, B: 16.5, H: 135 },
    { remark: "base", L: 57, B: 58, H: 81 },
  ],
};

test("8824177 uses combined packing CBM per item and preserves total and shipment precision", async () => {
  const summary = resolveOrderRowCbmSummary(item8824177, 15);
  assert.equal(summary.per_item, 0.569612);
  assert.equal(summary.total, 8.544184);
  assert.equal(summary.source, "inspected_box");
  assert.equal(summary.packing.source, "inspected_box");
  assert.ok(Math.abs(summary.packing.unrounded_per_item - 0.56961225) < 1e-12);
  assert.deepEqual(summary.packing.boxes, [
    { label: "top", L: 135.5, B: 16.5, H: 135, cbm: 0.30182625 },
    { label: "base", L: 57, B: 58, H: 81, cbm: 0.267786 },
  ]);
  const shippedCbm = resolveShipmentRowCbm({ itemDoc: item8824177, orderQuantity: 15, shipmentQuantity: 5 });
  assert.equal(shippedCbm, 2.848061);
  assert.equal(Number((summary.total - shippedCbm).toFixed(6)), 5.696123);
  const packed = await buildPackedGoodsDataset({}, {
    fetchOrders: async () => [{
      _id: "order-117160", order_id: "117160", item: { item_code: "8824177" },
      quantity: 15, shipment: [], qc_record: { quantities: { qc_passed: 15 }, request_history: [] },
    }],
    fetchItems: async () => [item8824177],
  });
  assert.equal(packed.rows[0].per_item_cbm, 0.569612);
  assert.equal(packed.summary.total_cbm, 8.544184);
});

for (const source of ["inspected", "pis"]) {
  for (const [mode, sizes, expectedPerItem, labels] of [
    ["individual", [
      { remark: "top", L: 100, B: 100, H: 10 },
      { remark: "base", L: 100, B: 100, H: 20 },
    ], 0.3, ["top", "base"]],
    ["carton", [
      { remark: "inner", box_type: "inner", L: 50, B: 50, H: 50, item_count_in_inner: 2 },
      { remark: "master", box_type: "master", L: 100, B: 100, H: 100, box_count_in_master: 5 },
    ], 0.1, ["master"]],
    ["individual_master", [
      { remark: "master", box_type: "master", L: 100, B: 100, H: 100, box_count_in_master: 5 },
    ], 0.2, ["master"]],
  ]) {
    test(`${source} ${mode} packing uses only contributing boxes and correct counts`, () => {
      const summary = resolveOrderRowCbmSummary({
        inspected_item_sizes: [{ remark: "item", L: 200, B: 200, H: 200 }],
        [`${source}_box_mode`]: mode,
        [`${source}_box_sizes`]: sizes,
      }, 15);
      assert.equal(summary.per_item, expectedPerItem);
      assert.equal(summary.total, expectedPerItem * 15);
      assert.equal(summary.packing.source, `${source}_box`);
      assert.equal(summary.packing.mode, mode);
      assert.deepEqual(summary.packing.boxes.map((box) => box.label), labels);
      assert.equal(summary.packing.items_per_inner, mode === "carton" ? 2 : null);
      assert.equal(summary.packing.boxes_per_master, mode === "individual" ? null : 5);
    });
  }
}

test("inspected packing takes precedence without mixing PIS dimensions", () => {
  const summary = resolveOrderRowCbmSummary({
    ...item8824177,
    pis_box_sizes: [{ remark: "box", L: 100, B: 100, H: 100 }],
  }, 15);
  assert.equal(summary.per_item, 0.569612);
  assert.deepEqual(summary.packing.boxes.map((box) => box.label), ["top", "base"]);
});

for (const invalidSizes of [
  [{ remark: "box", L: 0, B: 100, H: 100 }],
  [{ remark: "box", L: "invalid", B: 100, H: 100 }],
  [{ remark: "box", L: -1, B: 100, H: 100 }],
  [{ remark: "box", L: 100, B: 100 }],
  [{ remark: "inner", box_type: "inner", item_count_in_inner: 0 },
    { remark: "master", box_type: "master", L: 100, B: 100, H: 100, box_count_in_master: 5 }],
  [{ remark: "master", box_type: "master", L: 100, B: 100, H: 100, box_count_in_master: 0 }],
]) {
  test(`invalid inspected packing falls back to PIS: ${JSON.stringify(invalidSizes)}`, () => {
    const summary = resolveOrderRowCbmSummary({
      inspected_box_sizes: invalidSizes,
      pis_box_sizes: [{ remark: "box", L: 100, B: 100, H: 50 }],
    }, 15);
    assert.equal(summary.per_item, 0.5);
    assert.equal(summary.total, 7.5);
    assert.equal(summary.packing.source, "pis_box");
    assert.deepEqual(summary.packing.boxes.map((box) => box.label), ["box"]);
    const missing = resolveOrderRowCbmSummary({ inspected_box_sizes: invalidSizes }, 15);
    assert.equal(missing.per_item, null);
    assert.equal(missing.packing, null);
  });
}

test("missing packing stays N/A despite product sizes, cached CBM, or stored order CBM", () => {
  for (const itemDoc of [null, {}, {
    inspected_item_sizes: [{ remark: "item", L: 100, B: 100, H: 100 }],
  }, { cbm: { calculated_inspected_total: "0.4" } }]) {
    const summary = resolveOrderRowCbmSummaryWithStoredFallback({ itemDoc, quantity: 15, storedTotalCbm: 9 });
    assert.equal(summary.per_item, null);
    assert.equal(summary.packing, null);
    assert.ok(summary.total > 0);
  }
  assert.equal(resolveOrderRowCbmSummaryWithStoredFallback({ quantity: 15, storedTotalCbm: 9 }).total, 9);
  const legacy = resolveOrderRowCbmSummary({ inspected_item_sizes: [{ remark: "item", L: 100, B: 100, H: 100 }] }, 15);
  assert.equal(legacy.total, 15);
  assert.equal(legacy.source, "inspected_item");
});

test("zero quantity retains packing provenance without inventing an order total", () => {
  const summary = resolveOrderRowCbmSummary(item8824177, 0);
  assert.equal(summary.per_item, 0.569612);
  assert.equal(summary.total, null);
  assert.equal(summary.packing.source, "inspected_box");
});

test("PIS Item CBM keeps the existing calculator's rounding precision", () => {
  const summary = resolveOrderRowCbmSummary({
    pis_box_sizes: [{ remark: "top", L: 1, B: 1, H: 0.6 }, { remark: "base", L: 1, B: 1, H: 0.6 }],
  }, 100000);
  assert.equal(summary.per_item, 0.000002);
  assert.equal(summary.total, 0.2);
  assert.equal(summary.packing.unrounded_per_item, 0.0000012);
});

test("PIS provenance follows its existing normalization and four-box limit", () => {
  const summary = resolveOrderRowCbmSummary({
    pis_box_mode: "individual",
    pis_box_sizes: ["master", "top", "base", "box3", "box4"].map((remark) => ({ remark, L: 100, B: 100, H: 10 })),
  }, 15);
  assert.equal(summary.per_item, 0.4);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.packing.boxes.map((box) => box.label), ["master", "top", "base", "box3"]);
});

test("normal packing ignores invalid rows and carton rows in its provenance", () => {
  const summary = resolveOrderRowCbmSummary({
    ...item8824177,
    inspected_box_sizes: [...item8824177.inspected_box_sizes,
      { remark: "box3", L: 100, B: 100, H: 0 },
      { remark: "master", box_type: "master", L: 100, B: 100, H: 100 },
    ],
  }, 15);
  assert.equal(summary.per_item, 0.569612);
  assert.deepEqual(summary.packing.boxes.map((box) => box.label), ["top", "base"]);
});

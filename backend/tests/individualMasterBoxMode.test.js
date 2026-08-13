const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  BOX_SIZE_REMARK_OPTIONS,
  buildBoxMeasurementCbmSummary,
  calculateEffectiveBoxEntriesCbmTotal,
  detectBoxPackagingMode,
  requiresInnerBarcode,
  requiresMasterBarcode,
} = require("../helpers/boxMeasurement");
const {
  calculateTotalPoCbm,
} = require("../services/orderCbm.service");
const {
  __test__: { parseSizeEntriesPayload },
} = require("../controllers/item.controller");

const masterEntry = {
  remark: BOX_ENTRY_TYPES.MASTER,
  box_type: BOX_ENTRY_TYPES.MASTER,
  L: 100,
  B: 100,
  H: 20,
  gross_weight: 10,
  item_count_in_inner: 0,
  box_count_in_master: 5,
};

test("detects master-only box entries as individual packing plus master", () => {
  assert.equal(
    detectBoxPackagingMode("", [masterEntry]),
    BOX_PACKAGING_MODES.INDIVIDUAL_MASTER,
  );
});

test("requires master and inner barcodes for master box modes", () => {
  assert.equal(requiresMasterBarcode(BOX_PACKAGING_MODES.INDIVIDUAL), false);
  assert.equal(requiresInnerBarcode(BOX_PACKAGING_MODES.INDIVIDUAL), false);
  assert.equal(requiresMasterBarcode(BOX_PACKAGING_MODES.INDIVIDUAL_MASTER), true);
  assert.equal(requiresInnerBarcode(BOX_PACKAGING_MODES.INDIVIDUAL_MASTER), true);
  assert.equal(requiresMasterBarcode(BOX_PACKAGING_MODES.CARTON), true);
  assert.equal(requiresInnerBarcode(BOX_PACKAGING_MODES.CARTON), true);
});

test("preserves pieces in master when PIS uses individual plus master packing", () => {
  const [entry] = parseSizeEntriesPayload(
    [{ ...masterEntry, box_count_in_master: 2 }],
    {
      fieldLabel: "pis_box_sizes",
      remarkOptions: BOX_SIZE_REMARK_OPTIONS,
      weightKey: "gross_weight",
      weightLabel: "gross_weight",
      mode: BOX_PACKAGING_MODES.INDIVIDUAL_MASTER,
      allowIncomplete: true,
    },
  );

  assert.equal(entry.remark, BOX_ENTRY_TYPES.MASTER);
  assert.equal(entry.box_type, BOX_ENTRY_TYPES.MASTER);
  assert.equal(entry.box_count_in_master, 2);
});

test("calculates individual packing plus master CBM per piece from master box", () => {
  const summary = buildBoxMeasurementCbmSummary({
    sizes: [masterEntry],
    mode: BOX_PACKAGING_MODES.INDIVIDUAL_MASTER,
  });

  assert.equal(summary.mode, BOX_PACKAGING_MODES.INDIVIDUAL_MASTER);
  assert.equal(summary.first, "0.2");
  assert.equal(summary.total, "0.04");
  assert.equal(
    calculateEffectiveBoxEntriesCbmTotal(
      [masterEntry],
      BOX_PACKAGING_MODES.INDIVIDUAL_MASTER,
    ),
    0.04,
  );
});

test("calculates PO and partial shipment CBM by dividing quantity by pcs in master", () => {
  assert.equal(
    calculateTotalPoCbm({
      orderQuantity: 100,
      inspectedBoxSizes: [masterEntry],
      inspectedBoxMode: BOX_PACKAGING_MODES.INDIVIDUAL_MASTER,
    }),
    4,
  );
  assert.equal(
    calculateTotalPoCbm({
      orderQuantity: 75,
      inspectedBoxSizes: [masterEntry],
      inspectedBoxMode: BOX_PACKAGING_MODES.INDIVIDUAL_MASTER,
    }),
    3,
  );
});

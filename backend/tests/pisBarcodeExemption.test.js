const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { requiresPisBarcodes },
} = require("../controllers/item.controller");
const {
  __test__: {
    getQcBarcodeValidationRequirements,
    requiresPisBarcodeValidation,
    requiresLogisticsEanScanValidation,
  },
} = require("../controllers/qc.controller");

test("QC barcode validation is required without a Logistics EAN", () => {
  assert.equal(requiresPisBarcodes({ barcode_exempted: false }), true);
  assert.equal(requiresPisBarcodes({ barcode_exempted: true }), false);
  assert.equal(requiresPisBarcodeValidation({}), true);
  assert.equal(requiresPisBarcodeValidation({ barcode_exempted: true }), false);
  assert.equal(requiresLogisticsEanScanValidation({ pis_barcode: "8721274914153" }), false);
  assert.equal(requiresLogisticsEanScanValidation({ logistics_ean: { key: "ean.pdf" } }), false);
  assert.equal(
    requiresLogisticsEanScanValidation({
      pis_logistics_ean: "8721274914154",
      logistics_ean: { key: "ean.pdf" },
    }),
    false,
  );
  assert.equal(
    requiresLogisticsEanScanValidation({
      pis_logistics_ean: "8721274914153",
      pis_box_sizes: [{}, {}],
      logistics_ean: { key: "ean.pdf" },
    }),
    true,
  );
  assert.equal(
    requiresLogisticsEanScanValidation({
      barcode_exempted: true,
      pis_logistics_ean: "8721274914153",
      logistics_ean: { key: "ean.pdf" },
    }),
    false,
  );
});

test("QC validates PIS barcodes and a distinct Logistics EAN", () => {
  const item = {
    pis_master_barcode: "123456",
    pis_inner_barcode: "654321",
    pis_logistics_eans: ["8721274914153", "4006381333931"],
    pis_box_sizes: [{}, {}],
    logistics_ean: { key: "ean.pdf" },
  };

  assert.deepEqual(
    getQcBarcodeValidationRequirements("individual", item).map((entry) => entry.scannedField),
    ["master", "logistics", "logistics"],
  );
  assert.deepEqual(
    getQcBarcodeValidationRequirements("inner_master", item).map((entry) => entry.scannedField),
    ["master", "inner", "logistics", "logistics"],
  );
});

test("QC does not require a Logistics EAN for one box size", () => {
  assert.equal(
    requiresLogisticsEanScanValidation({
      pis_logistics_ean: "8721274914153",
      pis_box_sizes: [{}],
      logistics_ean: { key: "ean.pdf" },
    }),
    false,
  );
});

test("QC requires a Logistics EAN only for individual boxes", () => {
  const item = {
    pis_logistics_ean: "8721274914153",
    pis_box_sizes: [{}, {}],
    logistics_ean: { key: "ean.pdf" },
  };

  assert.equal(requiresLogisticsEanScanValidation({ ...item, pis_box_mode: "individual" }), true);
  assert.equal(requiresLogisticsEanScanValidation({ ...item, pis_box_mode: "carton" }), false);
  assert.equal(requiresLogisticsEanScanValidation({ ...item, pis_box_mode: "individual_master" }), false);
});

test("QC only adds a Logistics EAN scan when its file is uploaded", () => {
  assert.deepEqual(
    getQcBarcodeValidationRequirements("individual", { pis_master_barcode: "123456" })
      .map((entry) => entry.scannedField),
    ["master"],
  );
});

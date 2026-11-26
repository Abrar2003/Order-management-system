const assert = require("node:assert/strict");
const test = require("node:test");

const {
  updateItemPis,
  __test__: { requiresPisBarcodes },
} = require("../controllers/item.controller");
const Item = require("../models/item.model");
const PisUpdateLog = require("../models/pisUpdateLog.model");
const {
  __test__: {
    getQcBarcodeValidationRequirements,
    requiresPisBarcodeValidation,
    requiresLogisticsEanScanValidation,
  },
} = require("../controllers/qc.controller");

test("PIS updates let managers and admins override missing barcodes and change exemptions", async (t) => {
  const itemId = "507f1f77bcf86cd799439011";
  const initialItem = { _id: itemId, code: "TEST-PIS", pis_box_mode: "carton" };
  let savedItem = initialItem;
  t.mock.method(Item, "findOne", async () => Item.hydrate(savedItem));
  const saveItem = t.mock.method(Item.prototype, "save", async function () {
    savedItem = this.toObject();
    return this;
  });
  t.mock.method(PisUpdateLog, "create", async () => {});

  const update = async (role, body) => {
    const res = {
      status(code) { this.code = code; return this; },
      json(data) { this.body = data; return this; },
    };
    await updateItemPis({ params: { id: itemId }, user: { role }, body }, res);
    return res;
  };

  const override = { admin_override_required_fields: true };
  for (const role of ["QC", "dev", "user", "viewer"]) {
    assert.equal((await update(role, override)).code, 403, role);
    assert.equal((await update(role, { barcode_exempted: true })).code, 403, role);
  }
  assert.equal(saveItem.mock.callCount(), 0);

  for (const role of ["manager", "product manager", "inspection manager", "admin", "super admin"]) {
    savedItem = initialItem;
    assert.equal((await update(role, { country_of_origin: "India" })).code, 400, role);
    assert.equal((await update(role, { barcode_exempted: true })).code, 200, role);
    assert.equal(savedItem.barcode_exempted, true);
    assert.equal((await update(role, { barcode_exempted: false })).code, 400, role);
    assert.equal(savedItem.barcode_exempted, true);

    const enableRequirements = await update(role, {
      barcode_exempted: false,
      pis_master_barcode: "123456",
      pis_inner_barcode: "654321",
    });
    assert.equal(enableRequirements.code, 200, role);
    assert.equal(savedItem.barcode_exempted, false);

    const clearBarcodes = await update(role, {
      ...override,
      pis_master_barcode: "",
      pis_inner_barcode: "",
    });
    assert.equal(clearBarcodes.code, 200, role);
    assert.equal(savedItem.pis_master_barcode, "");
    assert.equal(savedItem.pis_inner_barcode, "");
    assert.equal(savedItem.barcode_exempted, false);
  }

  const invalidEan = await update("manager", { ...override, pis_logistics_ean: "12345" });
  assert.equal(invalidEan.code, 400);
  assert.match(invalidEan.body.message, /valid 13-digit EAN/);
});

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

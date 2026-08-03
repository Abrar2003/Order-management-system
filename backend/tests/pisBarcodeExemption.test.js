const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { requiresPisBarcodes },
} = require("../controllers/item.controller");
const {
  __test__: { requiresPisBarcodeForQcUpdate },
} = require("../controllers/qc.controller");

test("barcode-exempt PIS updates do not require barcode values", () => {
  assert.equal(requiresPisBarcodes({ barcode_exempted: false }), true);
  assert.equal(requiresPisBarcodes({ barcode_exempted: true }), false);
  assert.equal(requiresPisBarcodeForQcUpdate({ barcode_exempted: false }), true);
  assert.equal(requiresPisBarcodeForQcUpdate({ barcode_exempted: true }), false);
});

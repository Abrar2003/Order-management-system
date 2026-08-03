const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { resolveBarcodeWithPisDefault },
} = require("../controllers/qc.controller");

test("blank QC barcode values use the stored PIS master barcode", () => {
  assert.equal(
    resolveBarcodeWithPisDefault({
      currentValue: "",
      pisValue: "8719087032157",
    }),
    "8719087032157",
  );
  assert.equal(
    resolveBarcodeWithPisDefault({
      currentValue: "123",
      requestedValue: "",
      pisValue: "8719087032157",
    }),
    "8719087032157",
  );
  assert.equal(
    resolveBarcodeWithPisDefault({
      currentValue: "123",
      pisValue: "8719087032157",
    }),
    "123",
  );
  assert.equal(
    resolveBarcodeWithPisDefault({ currentValue: "", pisValue: "" }),
    "",
  );
});

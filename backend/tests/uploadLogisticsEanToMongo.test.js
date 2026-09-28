const assert = require("node:assert/strict");
const test = require("node:test");

const { __test__ } = require("../scripts/uploadLogisticsEanToMongo");

test("uses the leading filename digits as the item code", () => {
  assert.equal(__test__.codeFrom("230078_Logistics_EAN.pdf"), "230078");
  assert.equal(__test__.codeFrom("no-code.pdf"), "");
  assert.equal(
    __test__.notUploadedMessage("C:\\files\\230078_Logistics_EAN.pdf", "item 230078 was not found"),
    "  230078_Logistics_EAN.pdf — item 230078 was not found",
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatManualOrderValidationMessage,
  getMissingManualOrderFields,
} = require("../helpers/manualOrderValidation");

test("lists every missing required manual-order field", () => {
  assert.deepEqual(
    getMissingManualOrderFields({
      orderId: "",
      itemCode: "ITEM-1",
      description: "",
      brand: "Brand",
      vendor: "",
      quantity: 0,
    }),
    ["PO", "Description", "Vendor", "Quantity (> 0)"],
  );
});

test("formats missing fields with their submitted row numbers", () => {
  const message = formatManualOrderValidationMessage([
    {
      row_number: 2,
      missing_fields: ["Vendor", "Quantity (> 0)"],
    },
    {
      row_number: 4,
      missing_fields: ["Description"],
    },
  ]);

  assert.equal(
    message,
    [
      "Manual order submission was blocked. Complete the required fields:",
      "Row 2: Vendor, Quantity (> 0)",
      "Row 4: Description",
    ].join("\n"),
  );
});

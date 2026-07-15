const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildManualOrderRows,
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
      orderDate: "",
      etd: "",
    }),
    [
      "PO",
      "Description",
      "Vendor",
      "Order Date",
      "ETD",
      "Quantity (> 0)",
    ],
  );
});

test("expands one PO header across manual item rows", () => {
  const rows = buildManualOrderRows({
    po: {
      order_id: "PO-1",
      brand: "Giga",
      vendor: "Jodhana",
      order_date: "2026-07-15",
      ETD: "2026-10-15",
    },
    items: [
      { item_code: "A", description: "Chair", quantity: 2, brand: "Wrong" },
      { item_code: "B", description: "Table", quantity: 3, ETD: "2000-01-01" },
    ],
  });

  assert.deepEqual(rows, [
    {
      row_number: 1,
      item_code: "A",
      description: "Chair",
      quantity: 2,
      brand: "Giga",
      order_id: "PO-1",
      vendor: "Jodhana",
      order_date: "2026-07-15",
      ETD: "2026-10-15",
    },
    {
      row_number: 2,
      item_code: "B",
      description: "Table",
      quantity: 3,
      ETD: "2026-10-15",
      order_id: "PO-1",
      brand: "Giga",
      vendor: "Jodhana",
      order_date: "2026-07-15",
    },
  ]);
});

test("keeps legacy manual order rows and requires their dates", () => {
  const legacyRows = [{
    order_id: "PO-OLD",
    item_code: "A",
    description: "Chair",
    brand: "Giga",
    vendor: "Jodhana",
    quantity: 2,
  }];

  assert.equal(buildManualOrderRows({ orders: legacyRows }), legacyRows);
  assert.deepEqual(
    getMissingManualOrderFields({
      orderId: legacyRows[0].order_id,
      itemCode: legacyRows[0].item_code,
      description: legacyRows[0].description,
      brand: legacyRows[0].brand,
      vendor: legacyRows[0].vendor,
      quantity: legacyRows[0].quantity,
    }),
    ["Order Date", "ETD"],
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

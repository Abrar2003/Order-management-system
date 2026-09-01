const test = require("node:test");
const assert = require("node:assert/strict");
const { extractRowsFromFragments } = require("../services/pdfRectifyParser.service");

const headers = [
  [20, "Ordernr."], [100, "Refer"], [180, "Order"], [220, "Date"], [270, "ETD"],
  [330, "Days till"], [410, "Our ItemCode"], [530, "Your ItemCode"],
  [650, "Description"], [850, "Quantity"],
].map(([x, text]) => ({ pageIndex: 0, x, y: 700, text }));

test("rectify parser maps values by PDF header positions and preserves blanks", () => {
  const rows = extractRowsFromFragments([
    ...headers,
    { pageIndex: 0, x: 20, y: 650, text: "PO-1" },
    { pageIndex: 0, x: 180, y: 650, text: "01-09-2026" },
    { pageIndex: 0, x: 270, y: 650, text: "15-09-2026" },
    { pageIndex: 0, x: 330, y: 650, text: "14" },
    { pageIndex: 0, x: 410, y: 650, text: "OUR-1" },
    { pageIndex: 0, x: 530, y: 650, text: "YOUR-1" },
    { pageIndex: 0, x: 650, y: 650, text: "Oak chair" },
    { pageIndex: 0, x: 850, y: 650, text: "12" },
  ]);

  assert.deepEqual(rows[0], {
    orderNumber: "PO-1", refer: "", orderDate: "01-09-2026", etd: "15-09-2026",
    daysTillEtd: "14", ourItemCode: "OUR-1", yourItemCode: "YOUR-1",
    description: "Oak chair", quantity: "12",
  });
});

test("rectify parser keeps multiline description in its physical column", () => {
  const rows = extractRowsFromFragments([
    ...headers,
    { pageIndex: 0, x: 20, y: 650, text: "PO-2" },
    { pageIndex: 0, x: 410, y: 650, text: "OUR-2" },
    { pageIndex: 0, x: 650, y: 650, text: "Dining chair" },
    { pageIndex: 0, x: 650, y: 642, text: "with oak legs" },
    { pageIndex: 0, x: 850, y: 650, text: "8" },
  ]);

  assert.equal(rows[0].description, "Dining chair with oak legs");
  assert.equal(rows[0].ourItemCode, "OUR-2");
  assert.equal(rows[0].quantity, "8");
});
test("rectify parser ignores headers and footers", () => {
  const rows = extractRowsFromFragments([
    ...headers,
    { pageIndex: 0, x: 650, y: 730, text: "Report Date: 01-09-2026" },
    { pageIndex: 0, x: 20, y: 650, text: "PO-3" },
    { pageIndex: 0, x: 410, y: 650, text: "ITEM-3" },
    { pageIndex: 0, x: 850, y: 650, text: "3" },
    { pageIndex: 0, x: 650, y: 20, text: "Page 1/1" },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].ourItemCode, "ITEM-3");
});
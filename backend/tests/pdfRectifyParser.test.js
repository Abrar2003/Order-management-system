const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractRowsFromFragments,
  extractTableRowsFromPdfBuffer,
} = require("../services/pdfRectifyParser.service");

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

test("rectify PDF reads order dates left of their header and keeps an absent date blank", () => {
  const data = [
    [650, [[20, "20260475"], [100, "68-1 / 66 CBM"], [135, "27-10-2026"], [270, "18-01-2027"], [410, "95749"], [850, "50.00"]]],
    [630, [[20, "20260490"], [100, "68-2 / 66"], [135, "28-10-2026"], [270, "20-01-2027"], [410, "96106"], [850, "50.00"]]],
    [610, [[20, "20260491"], [105, "29-10-2026"], [270, "21-01-2027"], [410, "96152"], [850, "50.00"]]],
  ].flatMap(([y, cells]) => cells.map(([x, text]) => ({ x, y, text })));
  const content = [...headers, ...data].map(({ x, y, text }) =>
    `BT 1 0 0 1 ${x} ${y} Tm (${text}) Tj ET`,
  ).join("\n");
  const pdf = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Page /Contents 2 0 R >> endobj
2 0 obj << /Length ${content.length} >>
stream
${content}
endstream
endobj`);

  const rows = extractTableRowsFromPdfBuffer(pdf);
  assert.deepEqual(rows.map(({ orderNumber, refer, orderDate, etd }) => [orderNumber, refer, orderDate, etd]), [
    ["20260475", "68-1 / 66 CBM", "27-10-2026", "18-01-2027"],
    ["20260490", "68-2 / 66", "28-10-2026", "20-01-2027"],
    ["20260491", "29-10-2026", "", "21-01-2027"],
  ]);
});

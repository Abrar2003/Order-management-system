const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFParse } = require("pdf-parse");

const {
  closePdfRenderer,
  renderPdf,
} = require("../services/pdfRenderer");

test.after(async () => {
  await closePdfRenderer();
});

test("Chromium PDF repeats table headers and keeps rows together", async () => {
  const rows = Array.from({ length: 28 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `
      <tr>
        <td>ROW-${number}-START</td>
        <td>Purchase order ${number}<br />${"Stable row content ".repeat(12)}</td>
        <td>ROW-${number}-END</td>
      </tr>
    `;
  }).join("");

  const pdfBuffer = await renderPdf({
    html: `
      <table>
        <thead>
          <tr class="pdf-report-meta-row">
            <th colspan="3">
              <div class="pdf-report-title">PO-wise Summary Fixture</div>
              <div class="pdf-report-subtitle">Multi-page renderer validation</div>
            </th>
          </tr>
          <tr><th>PO</th><th>Details</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `,
    format: "A4",
    landscape: true,
    margin: { top: "10mm", right: "8mm", bottom: "10mm", left: "8mm" },
    extraCss: `
      body { font-family: Arial, sans-serif; font-size: 10px; }
      th, td { padding: 16px 8px; border: 1px solid #999; }
      thead th { background: #efe7dc; }
    `,
  });

  assert.ok(pdfBuffer.length > 1000);
  assert.equal(pdfBuffer.subarray(0, 4).toString(), "%PDF");

  const parser = new PDFParse({ data: pdfBuffer });
  const info = await parser.getInfo();
  assert.ok(info.total >= 2, `expected at least two pages, got ${info.total}`);

  for (let pageNumber = 1; pageNumber <= info.total; pageNumber += 1) {
    const pageResult = await parser.getText({ partial: [pageNumber] });
    const pageText = pageResult.text;
    assert.match(pageText, /PO-wise Summary Fixture/);
    assert.match(pageText, /PO\s+Details\s+Status/);

    const starts = [...pageText.matchAll(/ROW-(\d+)-START/g)].map((match) => match[1]);
    const ends = new Set(
      [...pageText.matchAll(/ROW-(\d+)-END/g)].map((match) => match[1]),
    );
    starts.forEach((rowNumber) => {
      assert.ok(
        ends.has(rowNumber),
        `row ${rowNumber} was split across a page boundary`,
      );
    });
  }

  await parser.destroy();
});

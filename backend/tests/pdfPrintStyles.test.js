const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPdfPrintStyles,
} = require("../services/pdfPrintStyles");

test("shared PDF print styles provide readable typography and spacing", () => {
  const styles = buildPdfPrintStyles();

  assert.match(styles, /font-size:\s*11px/);
  assert.match(styles, /line-height:\s*1\.45/);
  assert.match(styles, /\.pdf-report \.gap-3/);
  assert.match(styles, /\.pdf-report \.mb-3/);
  assert.match(styles, /\.pdf-report \.om-summary-chip/);
  assert.match(styles, /padding:\s*1\.8mm 1\.5mm/);
});

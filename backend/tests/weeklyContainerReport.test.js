const assert = require("node:assert/strict");
const test = require("node:test");
const { getContainerEtaWeek, buildWeeklyContainerReport } = require("../services/weeklyContainerReport");

test("weekly container reports use the same Monday to Sunday range for every day in the week", () => {
  const expected = { start: "2026-12-28", end: "2027-01-03" };
  assert.deepEqual(getContainerEtaWeek("2026-12-28"), expected);
  assert.deepEqual(getContainerEtaWeek("2027-01-01"), expected);
  assert.deepEqual(getContainerEtaWeek("2027-01-03"), expected);
  assert.equal(getContainerEtaWeek("2026-02-30"), null);
});

test("container PDFs include both ETA boundaries and omit missing or out-of-week ETAs", () => {
  const week = getContainerEtaWeek("2027-01-01");
  const rows = [
    { container: "OUT-BEFORE", shipping_ETA: "2026-12-27", shipping_date: "2026-12-28" },
    { container: "IN-MONDAY", shipping_ETA: "2026-12-28", shipping_date: "2026-11-18", vendor: "Wood & <Co>", total_cbm: 68.36 },
    { container: "IN-SUNDAY", shipping_ETA: "2027-01-03" },
    { container: "OUT-AFTER", shipping_ETA: "2027-01-04" },
    { container: "OUT-MISSING", shipping_ETA: null },
  ];
  const { html, landscape, format } = buildWeeklyContainerReport(rows, week);
  assert.equal(landscape, false);
  assert.equal(format, "A4");
  assert.match(html, /28 Dec 2026 - 03 Jan 2027/);
  assert.match(html, /IN-MONDAY[\s\S]*Wood &amp; &lt;Co&gt;[\s\S]*18 Nov 2026[\s\S]*68\.36[\s\S]*IN-SUNDAY/);
  assert.doesNotMatch(html, /OUT-/);
  assert.match(buildWeeklyContainerReport([], week).html, /No containers have an ETA in this week/);
});

test("weekly export matches any selected brand and keeps the full container", async (t) => {
  const Order = require("../models/order.model");
  const Sample = require("../models/sample.model");
  const pdfRenderer = require("../services/pdfRenderer");
  t.mock.method(pdfRenderer, "renderPdf", async ({ html }) => html);
  const { exportWeeklyContainerReport } = require("../controllers/order.controller");

  const order = (order_id, brand, container) => ({
    order_id, brand, status: "Shipped", vendor: "Vendor", quantity: 5,
    shipment: [{ container, quantity: 5, stuffing_date: "2026-12-20", shipping_ETA: "2026-12-28" }],
  });
  const query = (rows) => ({
    select() { return this; }, populate() { return this; }, sort() { return this; },
    lean: async () => rows,
  });
  t.mock.method(Order, "find", () => query([
    order("PO-1", "By Boo", "MIXED"),
    order("PO-2", "Eleonora", "MIXED"),
    order("PO-3", "Giga", "GIGA-ONLY"),
    order("PO-4", "Isaa", "ISAA-ONLY"),
  ]));
  t.mock.method(Sample, "find", () => query([]));
  const res = { attachment() { return this; }, send(html) { this.html = html; } };
  await exportWeeklyContainerReport({
    query: { date: "2026-12-29", brand: ["By Boo", "Giga"] }, user: { role: "admin" },
  }, res);

  assert.match(res.html, /By Boo, Giga/);
  assert.match(res.html, /MIXED<\/td><td>By Boo, Eleonora<\/td>/);
  assert.match(res.html, /GIGA-ONLY/);
  assert.doesNotMatch(res.html, /ISAA-ONLY/);

  await exportWeeklyContainerReport({ query: { date: "2026-12-29" }, user: { role: "admin" } }, res);
  assert.match(res.html, /All containers/);
  assert.match(res.html, /ISAA-ONLY/);
});

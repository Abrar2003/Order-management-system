const assert = require("node:assert/strict");
const test = require("node:test");
const ExcelJS = require("exceljs");
const {
  getVendorPerformanceReport,
  exportVendorPerformanceReport,
  __test__: { buildClaimRows, buildPoSections, buildEffectiveEtdMatch, buildVendorPerformanceChartSpecs, resolveEtdDateRange },
} = require("../controllers/vendorPerformanceReport.controller");
const Order = require("../models/order.model");
const Item = require("../models/item.model");

const query = (rows) => ({
  select() { return this; },
  populate() { return this; },
  lean: async () => rows,
});

test("vendor performance returns both stuffing comparisons", () => {
  const sections = buildPoSections([
    {
      order_id: "PO-1", brand: "Brand", vendor: { name: "Vendor" }, quantity: 5,
      status: "Inspection Done", ETD: "2026-01-10",
      qc_record: { last_inspected_date: "2026-01-12", quantities: { qc_passed: 5 } },
      shipment: [{ stuffing_date: "2026-01-15", quantity: 5 }],
    },
  ]);
  assert.equal(sections.po_delay[0].difference_days, 2);
  assert.equal(sections.shipping_delay[0].final_packed_date, "2026-01-12");
  assert.equal(sections.shipping_delay[0].packed_difference_days, 3);
  assert.equal(sections.shipping_delay[0].effective_etd, "2026-01-10");
  assert.equal(sections.shipping_delay[0].etd_difference_days, 5);
});

test("vendor performance reads day-first QC packed dates correctly", () => {
  const sections = buildPoSections([{
    order_id: "PO-DMY", brand: "Brand", vendor: "Vendor", quantity: 5,
    status: "Shipped", ETD: "2026-01-24",
    qc_record: { last_inspected_date: "07/01/2026", quantities: { qc_passed: 5 } },
    shipment: [{ stuffing_date: "2026-01-17", quantity: 5 }],
  }]);
  assert.equal(sections.po_delay[0].packed_date, "2026-01-07");
  assert.equal(sections.shipping_delay[0].packed_difference_days, 10);
});

test("vendor performance calculates PO delays from Kolkata calendar dates", () => {
  const sections = buildPoSections([{
    order_id: "PO-IST", brand: "Brand", vendor: "Vendor", quantity: 5,
    status: "Inspection Done", ETD: new Date("2026-01-10T20:00:00Z"),
    qc_record: { last_inspected_date: new Date("2026-01-11T00:30:00Z"), quantities: { qc_passed: 5 } }, shipment: [],
  }]);
  assert.equal(sections.po_delay[0].etd, "2026-01-11");
  assert.equal(sections.po_delay[0].packed_date, "2026-01-11");
  assert.equal(sections.po_delay[0].difference_days, 0);
});

test("vendor performance flags a lower latest claim percentage as positive", () => {
  const [row] = buildClaimRows([{
    _id: "item-1", code: "ITEM-1", vendors: ["Vendor"],
    claim_tenures: [
      { from_date: "2026-01-01", to_date: "2026-01-31", delivered_quantity: 100, rejected_quantity: 10 },
      { from_date: "2026-02-01", to_date: "2026-02-28", delivered_quantity: 100, rejected_quantity: 5 },
    ],
  }]);
  assert.equal(row.current_claim_percentage, 5);
  assert.equal(row.remark, "positive");
});

test("vendor performance flags missing prior and current tenure claims", () => {
  const rows = buildClaimRows([
    {
      _id: "current-only", code: "CURRENT", vendors: ["Vendor"],
      claim_tenures: [{ from_date: "2026-05-19", to_date: "2026-08-13", delivered_quantity: 100, rejected_quantity: 5 }],
    },
    {
      _id: "previous-only", code: "PREVIOUS", vendors: ["Vendor"],
      claim_tenures: [{ from_date: "2025-11-18", to_date: "2026-05-18", delivered_quantity: 100, rejected_quantity: 5 }],
    },
  ]);
  assert.equal(rows.find((row) => row.code === "CURRENT").remark, "negative");
  assert.equal(rows.find((row) => row.code === "PREVIOUS").current_claim_percentage, 0);
  assert.equal(rows.find((row) => row.code === "PREVIOUS").remark, "positive");
});

test("vendor performance excludes incomplete POs from PO-wise delay", () => {
  const { po_delay: rows } = buildPoSections([{
    order_id: "PO-PENDING", brand: "Brand", vendor: "Vendor", quantity: 5,
    status: "Under Inspection", ETD: "2020-01-10",
    qc_record: { quantities: { qc_passed: 3 } }, shipment: [],
  }, {
    order_id: "PO-UPCOMING", brand: "Brand", vendor: "Vendor", quantity: 5,
    status: "Pending", ETD: "2099-01-10", qc_record: {}, shipment: [],
  }]);
  assert.equal(rows.length, 0);
});

test("vendor performance ETD range is inclusive and gives revised ETD priority", () => {
  const range = resolveEtdDateRange({ fromDate: "2026-01-10", toDate: "2026-01-31" });
  const match = buildEffectiveEtdMatch(range);
  assert.equal(match.$or[0].revised_ETD.$gte.toISOString(), "2026-01-09T18:30:00.000Z");
  assert.equal(match.$or[0].revised_ETD.$lt.toISOString(), "2026-01-31T18:30:00.000Z");
  assert.equal(match.$or[1].revised_ETD, null);
  assert.equal(match.$or[1].ETD.$lt.toISOString(), "2026-01-31T18:30:00.000Z");
  assert.equal(resolveEtdDateRange({ fromDate: "2026-02-30" }), null);
  assert.equal(resolveEtdDateRange({ fromDate: "2026-02-01", toDate: "2026-01-31" }), null);
});

test("vendor performance builds filtered chart data for each charted section", () => {
  const poCharts = buildVendorPerformanceChartSpecs("po_delay", [{
    po: "PO-1", brand: "Brand", etd: "2026-01-10", difference_days: 3, status: "Delayed",
  }]);
  const claimCharts = buildVendorPerformanceChartSpecs("product_complaints", [{
    code: "ITEM-1", tenures: [{ tenure_id: "tenure-1", from_date: "2026-01-01", to_date: "2026-01-31", delivered_quantity: 100, rejected_quantity: 4.5 }],
  }]);
  const stuffingCharts = buildVendorPerformanceChartSpecs("shipping_delay", [{
    po: "PO-1", brand: "Brand", final_packed_date: "2026-02-10", packed_difference_days: 1, etd_difference_days: 3,
    packed_status: "Early", etd_status: "Delayed",
  }]);
  assert.equal(poCharts.length, 3);
  assert.equal(poCharts[0].type, "monthly_po_delay");
  assert.equal(poCharts[0].data[0].month, "2026-01");
  assert.equal(poCharts[0].title, "Monthly PO delay: ETD vs final packed");
  assert.equal(poCharts[0].data[0].average_delay, 3);
  assert.equal(poCharts[0].data[0].overall_average_delay, 3);
  assert.match(poCharts[0].data[0].color, /^hsl\(/);
  assert.equal(poCharts[1].data[0].difference_days, 3);
  assert.equal(claimCharts[1].data[0].average_claim_percentage, 4.5);
  assert.equal(stuffingCharts[0].title, "Monthly stuffing delay: final packed vs stuffing");
  assert.equal(stuffingCharts[0].data[0].month, "2026-02");
  assert.deepEqual(stuffingCharts[2].data.find((row) => row.label === "Early"), { label: "Early", packed: 1, etd: 0 });
  assert.deepEqual(stuffingCharts[2].data.find((row) => row.label === "Delayed"), { label: "Delayed", packed: 0, etd: 1 });
});

test("vendor performance scopes both selected vendor data sources", async (t) => {
  const orderMatches = [];
  const itemMatches = [];
  let orderCall = 0;
  t.mock.method(Order, "find", (match) => {
    orderMatches.push(match);
    orderCall += 1;
    return query(orderCall === 1 ? [{ vendor: { name: "Vendor A" } }] : []);
  });
  t.mock.method(Item, "find", (match) => {
    itemMatches.push(match);
    return query([]);
  });
  const res = { body: null, json(body) { this.body = body; return this; }, status() { return this; } };

  await getVendorPerformanceReport({
    query: { vendor: "Vendor B", brands: "Brand A,Brand B", from_date: "2026-01-01", to_date: "2026-01-31" },
    user: { role: "admin", allowed_brands: [{ name: "Brand A" }], allowed_vendors: ["Vendor A"] },
  }, res);

  assert.deepEqual(res.body.sections.po_delay.rows, []);
  assert.match(JSON.stringify(orderMatches[1]), /Brand A/);
  assert.match(JSON.stringify(orderMatches[1]), /Vendor A/);
  assert.match(JSON.stringify(orderMatches[1]), /Vendor B/);
  assert.match(JSON.stringify(orderMatches[2]), /Vendor B/);
  assert.match(JSON.stringify(orderMatches[1]), /Brand B/);
  assert.match(JSON.stringify(itemMatches[0]), /Vendor A/);
  assert.match(JSON.stringify(itemMatches[0]), /Vendor B/);
  assert.match(JSON.stringify(orderMatches[1]), /2026-01-31T18:30:00.000Z/);
});

test("vendor performance rejects malformed and reversed ETD dates", async () => {
  for (const queryParams of [
    { vendor: "Vendor", from_date: "2026-02-30" },
    { vendor: "Vendor", from_date: "2026-02-01", to_date: "2026-01-31" },
  ]) {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await getVendorPerformanceReport({ query: queryParams, user: { role: "admin" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Invalid date filters");
  }
});

test("vendor performance XLSX export places charts above the table", async (t) => {
  let orderCall = 0;
  const order = {
    order_id: "PO-1", brand: "Brand", vendor: { name: "Vendor" }, quantity: 5,
    status: "Inspection Done", ETD: "2026-01-10",
    qc_record: { last_inspected_date: "2026-01-12", quantities: { qc_passed: 5 } }, shipment: [],
  };
  t.mock.method(Order, "find", () => {
    orderCall += 1;
    return query(orderCall === 1 ? [{ vendor: { name: "Vendor" }, brand: "Brand" }] : [order]);
  });
  t.mock.method(Item, "find", () => query([]));
  const res = {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    send(body) { this.body = body; return this; },
    status() { return this; },
    json(body) { this.body = body; return this; },
  };

  await exportVendorPerformanceReport({ query: { vendor: "Vendor", section: "po_delay" }, user: { role: "admin" } }, res);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.body);
  const worksheet = workbook.worksheets[0];
  assert.equal(worksheet.getImages().length, 3);
  assert.ok(worksheet.getColumn(1).values.indexOf("PO") > 1);
});

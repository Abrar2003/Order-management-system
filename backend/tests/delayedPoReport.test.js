const assert = require("node:assert/strict");
const test = require("node:test");
const XLSX = require("xlsx");

const Order = require("../models/order.model");
const {
  getDelayedPoReport,
  getUpcomingEtdReport,
  getShippingDelayReport,
  exportDelayedPoReport,
  exportUpcomingEtdReport,
} = require("../controllers/order.controller");

const asQuery = (value) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  lean: async () => value,
});

const response = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  file: null,
  status(statusCode) { this.statusCode = statusCode; return this; },
  json(body) { this.body = body; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  send(file) { this.file = file; return this; },
});

test("delayed PO report excludes POs fully inspected before their ETD", async (t) => {
  t.mock.method(Order, "find", () => asQuery([
    {
      _id: "excluded-po",
      order_id: "PO-EXCLUDED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-1" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-01-31",
      },
    },
    {
      _id: "included-po",
      order_id: "PO-INCLUDED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-2" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-02-02",
      },
    },
  ]));

  const res = response();
  await getDelayedPoReport({ query: {}, user: { role: "admin" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.rows.map((row) => row.order_id), ["PO-INCLUDED"]);
});

test("shipping delay report includes only fully packed, unshipped POs past ETD", async (t) => {
  t.mock.method(Order, "find", () => asQuery([
    {
      _id: "included-po",
      order_id: "PO-PACKED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-1" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-01-31",
      },
    },
    {
      _id: "partially-packed-po",
      order_id: "PO-PARTIAL",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-2" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 5 },
        last_inspected_date: "2020-01-31",
      },
    },
    {
      _id: "shipped-po",
      order_id: "PO-SHIPPED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-3" },
      ETD: "2020-02-01",
      shipment: [{ quantity: 10 }],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-01-31",
      },
    },
    {
      _id: "late-packed-po",
      order_id: "PO-LATE-PACKED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-4" },
      ETD: "2020-02-01",
      shipment: [],
      qc_record: {
        quantities: { qc_passed: 10 },
        last_inspected_date: "2020-02-02",
      },
    },
  ]));

  const res = response();
  await getShippingDelayReport({ query: {}, user: { role: "admin" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.rows.map((row) => row.order_id), ["PO-PACKED"]);
  assert.equal(res.body.rows[0].delay_days > 0, true);
});

test("delayed PO uses effective ETD and the selected reference date", async (t) => {
  t.mock.method(Order, "find", () => asQuery([
    {
      _id: "revised-po",
      order_id: "PO-REVISED",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-1" },
      ETD: "2030-03-01",
      revised_ETD: "2030-03-20",
      shipment: [],
      qc_record: { quantities: {} },
    },
  ]));

  const res = response();
  await getDelayedPoReport({
    query: { from_date: "2030-03-21" },
    user: { role: "admin" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.filters.report_date, "2030-03-21");
  assert.equal(res.body.rows[0].etd, "2030-03-01");
  assert.equal(res.body.rows[0].effective_etd, "2030-03-20");
  assert.equal(res.body.rows[0].delay_days, 1);
});

test("upcoming ETD starts at the selected date and defaults to a ten-day window", async (t) => {
  t.mock.method(Order, "find", () => asQuery([
    {
      _id: "window-start",
      order_id: "PO-START",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-1" },
      ETD: "2030-02-20",
      revised_ETD: "2030-03-01",
      shipment: [],
      qc_record: { quantities: {} },
    },
    {
      _id: "window-end",
      order_id: "PO-END",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-2" },
      ETD: "2030-03-11",
      shipment: [],
      qc_record: { quantities: {} },
    },
    {
      _id: "outside-window",
      order_id: "PO-OUTSIDE",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-3" },
      ETD: "2030-03-12",
      shipment: [],
      qc_record: { quantities: {} },
    },
  ]));

  const res = response();
  await getUpcomingEtdReport({
    query: { from_date: "2030-03-01" },
    user: { role: "admin" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.filters.report_start_date, "2030-03-01");
  assert.equal(res.body.filters.report_end_date, "2030-03-11");
  assert.deepEqual(res.body.rows.map((row) => row.order_id), ["PO-START", "PO-END"]);
  assert.deepEqual(res.body.rows.map((row) => row.days_until_etd), [0, 10]);
});

test("upcoming ETD rejects an end date before its selected start date", async () => {
  const res = response();
  await getUpcomingEtdReport({
    query: { from_date: "2030-03-11", to_date: "2030-03-10" },
    user: { role: "admin" },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Until date must be on or after From date.");
});

test("date-selected exports use the same effective ETD calculations", async (t) => {
  t.mock.method(Order, "find", () => asQuery([
    {
      _id: "export-po",
      order_id: "PO-EXPORT",
      brand: "Brand A",
      vendor: "Vendor A",
      quantity: 10,
      item: { item_code: "ITEM-1" },
      ETD: "2030-03-01",
      revised_ETD: "2030-03-08",
      shipment: [],
      qc_record: { quantities: {} },
    },
  ]));

  const delayedRes = response();
  await exportDelayedPoReport({
    query: { from_date: "2030-03-10", report_type: "summary" },
    user: { role: "admin" },
  }, delayedRes);
  const delayedRows = XLSX.utils.sheet_to_json(
    XLSX.read(delayedRes.file, { type: "buffer" }).Sheets["PO Summary"],
  );
  assert.equal(delayedRows[0]["Effective ETD"], "08/03/2030");
  assert.equal(delayedRows[0]["Delay (Days)"], 2);

  const upcomingRes = response();
  await exportUpcomingEtdReport({
    query: { from_date: "2030-03-03", to_date: "2030-03-10" },
    user: { role: "admin" },
  }, upcomingRes);
  const upcomingRows = XLSX.utils.sheet_to_json(
    XLSX.read(upcomingRes.file, { type: "buffer" }).Sheets["Upcoming ETD Report"],
  );
  assert.equal(upcomingRows[0]["Effective ETD"], "08/03/2030");
  assert.equal(upcomingRows[0]["Days Until ETD"], 5);
});

test("delayed PO XLS exports the requested item columns and applied filters", async (t) => {
  const order = {
    order_id: "PO-EXPORT",
    brand: "Brand A",
    vendor: "Vendor A",
    quantity: 10,
    order_date: "2030-02-01",
    ETD: "2030-03-01",
    revised_ETD: "2030-03-08",
    shipment: [],
    qc_record: { quantities: {} },
  };
  t.mock.method(Order, "find", () => asQuery([
    { ...order, _id: "pending", item: { item_code: "001" } },
    {
      ...order, _id: "partial", item: { item_code: "002" },
      shipment: [{ quantity: 3 }],
      qc_record: { quantities: { qc_passed: 10 } },
    },
    {
      ...order, _id: "shipped", item: { item_code: "003" },
      shipment: [{ quantity: 10 }],
      qc_record: { quantities: { qc_passed: 10 } },
    },
    { ...order, _id: "brand", brand: "Brand B", item: { item_code: "OTHER-BRAND" } },
    { ...order, _id: "vendor", vendor: "Vendor B", item: { item_code: "OTHER-VENDOR" } },
    { ...order, _id: "po", order_id: "OTHER-PO", item: { item_code: "OTHER-PO" } },
  ]));

  const res = response();
  const query = {
    brand: "Brand A", vendor: "Vendor A", order_id: "PO-EXPORT",
    from_date: "2030-03-10", report_type: "detailed",
  };
  await exportDelayedPoReport({ query, user: { role: "admin" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/vnd.ms-excel");
  assert.match(res.headers["Content-Disposition"], /delayed-po-detailed-report-.*\.xls/);
  const workbook = XLSX.read(res.file, { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Item Details"]);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Item Details"], { header: 1 });
  const headers = ["PO", "Item Code", "Brand", "Vendor", "Status", "Order Date", "ETD", "Order Quantity", "Pending", "Shipped", "Packed"];
  assert.deepEqual(rows, [
    headers,
    ["PO-EXPORT", "001", "Brand A", "Vendor A", "Pending", "01/02/2030", "08/03/2030", 10, 10, 0, 0],
    ["PO-EXPORT", "002", "Brand A", "Vendor A", "Partial Shipped", "01/02/2030", "08/03/2030", 10, 0, 3, 7],
    ["PO-EXPORT", "003", "Brand A", "Vendor A", "Shipped", "01/02/2030", "08/03/2030", 10, 0, 10, 0],
  ]);

  const emptyRes = response();
  await exportDelayedPoReport({
    query: { ...query, order_id: "NO-MATCH" }, user: { role: "admin" },
  }, emptyRes);
  assert.equal(emptyRes.statusCode, 200);
  const emptySheet = XLSX.read(emptyRes.file, { type: "buffer" }).Sheets["Item Details"];
  assert.deepEqual(XLSX.utils.sheet_to_json(emptySheet, { header: 1 }), [headers]);
});

test("delayed PO exports exclude completely shipped POs in both report types", async (t) => {
  const order = {
    brand: "Brand A",
    vendor: "Vendor A",
    quantity: 10,
    ETD: "2030-03-01",
    qc_record: { quantities: {} },
  };
  t.mock.method(Order, "find", () => asQuery([
    { ...order, order_id: "FULLY-SHIPPED", item: { item_code: "001" }, shipment: [{ quantity: 10 }] },
    { ...order, order_id: "FULLY-SHIPPED", item: { item_code: "002" }, shipment: [{ quantity: 10 }] },
    { ...order, order_id: "OVER-SHIPPED", item: { item_code: "003" }, shipment: [{ quantity: 12 }] },
    { ...order, order_id: "PARTLY-SHIPPED", item: { item_code: "004" }, shipment: [{ quantity: 10 }] },
    { ...order, order_id: "PARTLY-SHIPPED", item: { item_code: "005" }, shipment: [] },
  ]));

  for (const reportType of ["detailed", "summary"]) {
    const res = response();
    await exportDelayedPoReport({
      query: { from_date: "2030-03-10", report_type: reportType },
      user: { role: "admin" },
    }, res);
    assert.equal(res.statusCode, 200);
    const workbook = XLSX.read(res.file, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    assert.deepEqual(rows.map((row) => row.PO),
      reportType === "detailed" ? ["PARTLY-SHIPPED", "PARTLY-SHIPPED"] : ["PARTLY-SHIPPED"]);
  }
});

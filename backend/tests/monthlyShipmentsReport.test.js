const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveShipmentRowCbm,
} = require("../services/shipmentCbmAllocation.service");
const {
  buildMonthlyShipmentsDrilldownFromRows,
  buildMonthlyShipmentsReportFromRows,
  buildShipmentBaseMatch,
  getMonthlyShipmentsReportData,
  resolveReportPeriod,
} = require("../services/monthlyShipmentsReport.service");

const period = resolveReportPeriod({
  now: new Date("2026-07-04T08:00:00.000Z"),
});

const shipmentDate = (isoDate) => new Date(`${isoDate}T00:00:00.000Z`);

const row = ({
  container = "MSCU-123456-7",
  brand = "Brand A",
  vendor = "Vendor A",
  country = "India",
  orderId = "PO-1",
  itemCode = "ITEM-1",
  date = "2026-02-10",
  allocatedCbm = 10,
  shipmentQuantity = 10,
} = {}) => ({
  order_document_id: `${orderId}-${itemCode}`,
  shipment_id: `${orderId}-${itemCode}-${container}`,
  order_id: orderId,
  item_code: itemCode,
  brand,
  vendor,
  country,
  status: "Shipped",
  container,
  stuffing_date: shipmentDate(date),
  order_quantity: 100,
  shipment_quantity: shipmentQuantity,
  allocated_cbm: allocatedCbm,
});

test("monthly shipments defaults to the previous six completed calendar months", () => {
  assert.equal(period.from_date, "2026-01-01");
  assert.equal(period.to_date, "2026-06-30");
  assert.equal(period.label, "01 Jan 2026 - 30 Jun 2026");
  assert.deepEqual(
    period.months.map((entry) => entry.key),
    ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
  );
});

test("one order, one shipment, one container builds one vendor total", () => {
  const report = buildMonthlyShipmentsReportFromRows({
    rows: [row()],
    period,
  });

  assert.equal(report.summary.total_unique_containers, 1);
  assert.equal(report.summary.total_allocated_cbm, 10);
  assert.deepEqual(report.overall.vendor_totals, [{
    vendor: "Vendor A",
    unique_container_count: 1,
    total_allocated_cbm: 10,
  }]);
});

test("multiple shipment rows for the same order and container do not inflate container count", () => {
  const rows = [
    row({ orderId: "PO-2", itemCode: "ITEM-2", allocatedCbm: 3 }),
    row({ orderId: "PO-2", itemCode: "ITEM-2", allocatedCbm: 2 }),
  ];
  const report = buildMonthlyShipmentsReportFromRows({ rows, period });
  const drilldown = buildMonthlyShipmentsDrilldownFromRows({ rows, period });

  assert.equal(report.overall.vendor_totals[0].unique_container_count, 1);
  assert.equal(report.overall.vendor_totals[0].total_allocated_cbm, 5);
  assert.equal(drilldown.records.length, 1);
  assert.equal(drilldown.records[0].allocated_cbm, 5);
});

test("same container shared by same brand and vendor counts once in brand vendor bars", () => {
  const rows = [
    row({ orderId: "PO-3", itemCode: "ITEM-3A", allocatedCbm: 4 }),
    row({ orderId: "PO-3", itemCode: "ITEM-3B", allocatedCbm: 6 }),
  ];
  const report = buildMonthlyShipmentsReportFromRows({ rows, period });
  const brandSection = report.by_brand.brands[0];

  assert.equal(brandSection.unique_container_count, 1);
  assert.equal(brandSection.total_allocated_cbm, 10);
  assert.equal(brandSection.vendors[0].unique_container_count, 1);
  assert.equal(brandSection.vendors[0].total_allocated_cbm, 10);
});

test("same container can be counted once for each contained brand", () => {
  const rows = [
    row({ container: "MSCU-222222-2", brand: "Brand A", allocatedCbm: 5 }),
    row({ container: "MSCU-222222-2", brand: "Brand B", allocatedCbm: 7 }),
  ];
  const report = buildMonthlyShipmentsReportFromRows({ rows, period });

  assert.equal(report.summary.total_unique_containers, 1);
  assert.equal(report.overall.vendor_totals[0].unique_container_count, 1);
  assert.equal(report.overall.vendor_totals[0].total_allocated_cbm, 12);
  assert.deepEqual(
    report.by_brand.brands.map((entry) => [
      entry.brand,
      entry.unique_container_count,
      entry.total_allocated_cbm,
    ]),
    [["Brand A", 1, 5], ["Brand B", 1, 7]],
  );
});

test("same container can be counted once for each contained vendor", () => {
  const rows = [
    row({ container: "MSCU-333333-3", vendor: "Vendor A", allocatedCbm: 5 }),
    row({ container: "MSCU-333333-3", vendor: "Vendor B", allocatedCbm: 6 }),
  ];
  const report = buildMonthlyShipmentsReportFromRows({ rows, period });

  assert.equal(report.summary.total_unique_containers, 1);
  assert.deepEqual(
    report.overall.vendor_totals.map((entry) => [
      entry.vendor,
      entry.unique_container_count,
      entry.total_allocated_cbm,
    ]),
    [["Vendor A", 1, 5], ["Vendor B", 1, 6]],
  );
});

test("base match includes only shipped statuses, active orders, dated shipment rows, and scoped access", () => {
  const match = buildShipmentBaseMatch({
    period,
    user: {
      allowed_brands: [],
      allowed_vendors: ["Vendor A"],
      brand_scope: "all",
    },
  });
  const serialized = JSON.stringify(match);

  assert.match(serialized, /Partial Shipped/);
  assert.match(serialized, /Shipped/);
  assert.match(serialized, /archived/);
  assert.match(serialized, /shipment\.stuffing_date/);
  assert.match(serialized, /Vendor A/);
});

test("empty containers and missing stuffing dates are excluded before aggregation", () => {
  const rows = [
    row({ container: "", allocatedCbm: 8 }),
    { ...row({ allocatedCbm: 9 }), stuffing_date: null },
    row({ allocatedCbm: 4 }),
  ];
  const report = buildMonthlyShipmentsReportFromRows({ rows, period });

  assert.equal(report.summary.total_unique_containers, 1);
  assert.equal(report.summary.total_allocated_cbm, 4);
});

test("month and custom date modes resolve inclusive business-date ranges", () => {
  const monthPeriod = resolveReportPeriod({
    query: { period_mode: "month", year: "2026", month: "2" },
  });
  const customPeriod = resolveReportPeriod({
    query: {
      period_mode: "custom",
      from_date: "2026-02-15",
      to_date: "2026-04-02",
    },
  });

  assert.equal(monthPeriod.from_date, "2026-02-01");
  assert.equal(monthPeriod.to_date, "2026-02-28");
  assert.equal(customPeriod.from_date, "2026-02-15");
  assert.equal(customPeriod.to_date, "2026-04-02");
  assert.deepEqual(
    customPeriod.months.map((entry) => entry.key),
    ["2026-02", "2026-03", "2026-04"],
  );
});

test("country filter uses item master country values and supports Not Set", () => {
  const rows = [
    row({ country: "India", allocatedCbm: 5 }),
    row({ container: "MSCU-444444-4", country: "China", allocatedCbm: 6 }),
    row({ container: "MSCU-555555-5", country: "", allocatedCbm: 7 }),
  ];
  const indiaReport = buildMonthlyShipmentsReportFromRows({
    rows,
    period,
    query: { country: "india" },
  });
  const notSetReport = buildMonthlyShipmentsReportFromRows({
    rows,
    period,
    query: { country: "Not Set" },
  });

  assert.equal(indiaReport.summary.total_unique_containers, 1);
  assert.equal(indiaReport.summary.total_allocated_cbm, 5);
  assert.equal(notSetReport.summary.total_unique_containers, 1);
  assert.equal(notSetReport.summary.total_allocated_cbm, 7);
});

test("shipment CBM allocation matches the container-page quantity ratio fallback", () => {
  const allocated = resolveShipmentRowCbm({
    itemDoc: null,
    orderQuantity: 100,
    storedPoCbm: 20,
    shipmentQuantity: 25,
  });
  const rows = [
    row({ container: "MSCU-666666-6", allocatedCbm: allocated }),
    row({ container: "MSCU-666666-6", allocatedCbm: 15 }),
  ];
  const report = buildMonthlyShipmentsReportFromRows({ rows, period });

  assert.equal(allocated, 5);
  assert.equal(report.overall.vendor_totals[0].unique_container_count, 1);
  assert.equal(report.overall.vendor_totals[0].total_allocated_cbm, 20);
});

test("report data loader passes user scope through to the row fetcher", async () => {
  const user = { _id: "user-1", role: "user", allowed_vendors: ["Vendor A"] };
  let seenUser = null;
  const report = await getMonthlyShipmentsReportData({
    query: {},
    user,
    now: new Date("2026-07-04T08:00:00.000Z"),
    fetchRows: async ({ user: scopedUser }) => {
      seenUser = scopedUser;
      return [row()];
    },
  });

  assert.equal(seenUser, user);
  assert.equal(report.summary.total_unique_containers, 1);
});

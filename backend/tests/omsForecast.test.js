const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildExpectedCbmTimeline,
  calculateLeadTimeStatistics,
  forecastVendorNextShipment,
  getHistoricalInspectionLeadTime,
  normalizeHistoricalSamples,
  selectLeadTimeEstimate,
} = require("../services/omsForecast.service");

const completedHistory = ({
  orderId,
  itemCode = "CHAIR-1",
  vendor = "Boranada",
  productType = "Chair",
  orderDate,
  inspectionDate,
} = {}) => ({
  order_id: orderId,
  item_code: itemCode,
  vendor,
  product_type: productType,
  order_date: orderDate,
  inspection_date: inspectionDate,
  inspection_status: "Inspection Done",
  order_status: "Shipped",
  passed: 10,
});

test("lead-time statistics use robust percentiles and remove severe outliers", () => {
  const statistics = calculateLeadTimeStatistics([10, 11, 12, 13, 100]);

  assert.equal(statistics.sampleCount, 4);
  assert.equal(statistics.outlierCount, 1);
  assert.equal(statistics.medianDays, 11.5);
  assert.equal(statistics.p75Days, 12.3);
  assert.equal(statistics.p90Days, 12.7);
});

test("historical samples require successful completed evidence and de-duplicate a PO item", () => {
  const rows = [
    completedHistory({ orderId: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-21" }),
    completedHistory({ orderId: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-25" }),
    { ...completedHistory({ orderId: "PO-2", orderDate: "2026-01-01", inspectionDate: "2026-01-20" }), inspection_status: "Rejected" },
    { ...completedHistory({ orderId: "PO-3", orderDate: "2026-01-01", inspectionDate: "2026-01-20" }), passed: 0 },
  ];

  const samples = normalizeHistoricalSamples(rows, { now: new Date("2026-08-18T00:00:00Z") });

  assert.equal(samples.length, 1);
  assert.equal(samples[0].days, 20);
});

test("lead-time fallback prefers item/vendor and falls back to vendor-wide evidence", () => {
  const samples = [
    { days: 20, itemCode: "A", vendor: "V", productType: "Chair" },
    { days: 22, itemCode: "A", vendor: "V", productType: "Chair" },
    { days: 24, itemCode: "A", vendor: "V", productType: "Chair" },
    { days: 40, itemCode: "B", vendor: "V", productType: "Table" },
    { days: 42, itemCode: "C", vendor: "V", productType: "Cabinet" },
    { days: 44, itemCode: "D", vendor: "V", productType: "Sofa" },
  ];

  assert.equal(selectLeadTimeEstimate(samples, { itemCode: "A", vendor: "V" }).sourceLevel, "same_item_same_vendor");
  const fallback = selectLeadTimeEstimate(samples, { itemCode: "missing", vendor: "V", productType: "missing" });
  assert.equal(fallback.sourceLevel, "vendor_wide");
  assert.equal(fallback.sampleCount, 6);
});

test("lead-time estimator returns null when no fallback has enough history", () => {
  const result = getHistoricalInspectionLeadTime([
    completedHistory({ orderId: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-20" }),
  ], { itemCode: "CHAIR-1", vendor: "Boranada" }, { now: new Date("2026-08-18T00:00:00Z") });

  assert.equal(result, null);
});

test("CBM timeline accumulates multiple POs and reports the first threshold crossing", () => {
  const result = buildExpectedCbmTimeline({
    currentReadyCbm: 41,
    targetCbm: 65,
    contributions: [
      { date: "2026-08-26", cbm: 7, orderId: "1" },
      { date: "2026-09-02", cbm: 9, orderId: "2" },
      { date: "2026-09-07", cbm: 12, orderId: "3" },
    ],
  });

  assert.equal(result.thresholdCrossingDate, "2026-09-07");
  assert.equal(result.projectedCbm, 69);
  assert.equal(result.timeline[1].runningCbm, 57);
});

test("CBM timeline reports when available and forecast stock never reaches target", () => {
  const result = buildExpectedCbmTimeline({
    currentReadyCbm: 10,
    targetCbm: 65,
    contributions: [{ date: "2026-09-01", cbm: 20, orderId: "1" }],
  });

  assert.equal(result.thresholdCrossingDate, null);
  assert.equal(result.projectedCbm, 30);
  assert.equal(result.remainingCbm, 55);
});

test("Boranada forecast groups by brand, respects delayed ETD, and identifies its next shipment", () => {
  const history = [
    completedHistory({ orderId: "H-1", orderDate: "2026-01-01", inspectionDate: "2026-01-29" }),
    completedHistory({ orderId: "H-2", orderDate: "2026-02-01", inspectionDate: "2026-03-03" }),
    completedHistory({ orderId: "H-3", orderDate: "2026-03-01", inspectionDate: "2026-04-02" }),
  ];
  const orders = [{
    order_id: "OPEN-1",
    item_code: "CHAIR-1",
    vendor: "Boranada",
    brand: "Brand A",
    product_type: "Chair",
    order_date: "2026-08-01",
    revised_ETD: "2026-09-05",
    quantity: 100,
    total_po_cbm: 100,
    shipment: [],
    qc_record: { quantities: { qc_passed: 40 }, request_history: [] },
  }];

  const result = forecastVendorNextShipment({
    vendor: "Boranada",
    orders,
    historicalRows: history,
    targetCbm: 65,
    now: new Date("2026-08-18T00:00:00Z"),
  });

  assert.equal(result.vendor, "Boranada");
  assert.equal(result.status, "forecast_ready");
  assert.equal(result.nextShipment.brand, "Brand A");
  assert.equal(result.nextShipment.readyCbm, 40);
  assert.equal(result.nextShipment.remainingCbm, 25);
  assert.equal(result.nextShipment.thresholdCrossingDate, "2026-09-05");
  assert.equal(result.nextShipment.contributingOrders[0].forecast.sourceLevel, "same_item_same_vendor");
  assert.equal(result.confidence.label, "moderate");
});

test("forecast reports ready-now and no-history outcomes without inventing dates", () => {
  const ready = forecastVendorNextShipment({
    vendor: "Boranada",
    targetCbm: 65,
    orders: [{
      order_id: "READY-1",
      vendor: "Boranada",
      brand: "Brand Ready",
      quantity: 100,
      total_po_cbm: 100,
      shipment: [],
      qc_record: { quantities: { qc_passed: 70 }, request_history: [] },
    }],
    now: new Date("2026-08-18T00:00:00Z"),
  });
  assert.equal(ready.status, "ready_now");
  assert.equal(ready.nextShipment.readyCbm, 70);

  const noHistory = forecastVendorNextShipment({
    vendor: "Boranada",
    targetCbm: 65,
    orders: [{
      order_id: "OPEN-2",
      vendor: "Boranada",
      brand: "Brand A",
      order_date: "2026-08-01",
      quantity: 100,
      total_po_cbm: 20,
      shipment: [],
      qc_record: { quantities: { qc_passed: 0 }, request_history: [] },
    }],
    now: new Date("2026-08-18T00:00:00Z"),
  });
  assert.equal(noHistory.status, "threshold_not_reached");
  assert.equal(noHistory.confidence.label, "low");
  assert.equal(noHistory.forecast.planningDate, null);
});

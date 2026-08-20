const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildExpectedCbmTimeline,
  calculateLeadTimeStatistics,
  forecastBrandNextContainerVendor,
  forecastVendorNextShipment,
  getHistoricalInspectionLeadTime,
  normalizeHistoricalSamples,
  OmsForecastValidationError,
  runOmsForecastAnalysis,
  selectLeadTimeEstimate,
  validateAnalyticsRequest,
  __test__: forecastInternals,
} = require("../services/omsForecast.service");
const { OmsChatQueryError } = require("../services/omsChatQuery.service");

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

  const zeroIqr = calculateLeadTimeStatistics([10, 10, 10, 10, 100]);
  assert.equal(zeroIqr.sampleCount, 4);
  assert.equal(zeroIqr.outlierCount, 1);
});

test("forecast filters treat common brand separators as equivalent", () => {
  const brandMatch = forecastInternals.buildOpenOrderPipeline({ brand: "By-Boo" })[0].$match.brand;
  assert.match("By Boo", new RegExp(brandMatch.$regex, brandMatch.$options));
});

test("lead-time statistics retain full history and report the recent performance trend", () => {
  const statistics = calculateLeadTimeStatistics([
    { days: 60, inspectionDate: new Date("2024-01-01T00:00:00Z") },
    { days: 55, inspectionDate: new Date("2024-02-01T00:00:00Z") },
    { days: 40, inspectionDate: new Date("2026-06-01T00:00:00Z") },
    { days: 42, inspectionDate: new Date("2026-07-01T00:00:00Z") },
  ], { now: new Date("2026-08-18T00:00:00Z") });

  assert.equal(statistics.sampleCount, 4);
  assert.equal(statistics.recentSampleCount, 2);
  assert.equal(statistics.recentMedianDays, 41);
  assert.equal(statistics.recentTrendDays, -7.5);
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
  assert.equal(noHistory.nextShipment.projectedCbm, 0);
  assert.deepEqual(noHistory.nextShipment.contributingOrders, []);
});

test("brand vendor forecast chooses a ready vendor and ranks a closest vendor when none reaches target", () => {
  const readyNow = forecastBrandNextContainerVendor({
    brand: "By Boo",
    targetCbm: 65,
    orders: [
      {
        order_id: "READY-VENDOR",
        vendor: "Vendor Ready",
        brand: "By Boo",
        quantity: 100,
        total_po_cbm: 100,
        shipment: [],
        qc_record: { quantities: { qc_passed: 70 }, request_history: [] },
      },
      {
        order_id: "LATER-VENDOR",
        vendor: "Vendor Later",
        brand: "By Boo",
        order_date: "2026-08-01",
        revised_ETD: "2026-09-05",
        quantity: 100,
        total_po_cbm: 100,
        shipment: [],
        qc_record: { quantities: { qc_passed: 40 }, request_history: [] },
      },
    ],
    now: new Date("2026-08-18T00:00:00Z"),
  });

  assert.equal(readyNow.status, "ready_now");
  assert.equal(readyNow.mostLikelyVendor.vendor, "Vendor Ready");
  assert.equal(readyNow.mostLikelyVendor.currentReadyCbm, 70);
  assert.equal(readyNow.evidence.candidateVendorCount, 2);

  const noTarget = forecastBrandNextContainerVendor({
    brand: "By Boo",
    targetCbm: 65,
    orders: [
      {
        order_id: "CLOSEST-VENDOR",
        vendor: "Vendor Near",
        brand: "By Boo",
        order_date: "2026-08-01",
        revised_ETD: "2026-09-05",
        quantity: 100,
        total_po_cbm: 40,
        shipment: [],
        qc_record: { quantities: { qc_passed: 30 }, request_history: [] },
      },
      {
        order_id: "FARTHER-VENDOR",
        vendor: "Vendor Far",
        brand: "By Boo",
        order_date: "2026-08-01",
        revised_ETD: "2026-09-05",
        quantity: 100,
        total_po_cbm: 20,
        shipment: [],
        qc_record: { quantities: { qc_passed: 10 }, request_history: [] },
      },
    ],
    now: new Date("2026-08-18T00:00:00Z"),
  });

  assert.equal(noTarget.status, "threshold_not_reached");
  assert.equal(noTarget.mostLikelyVendor.vendor, "Vendor Near");
  assert.equal(noTarget.mostLikelyVendor.thresholdCrossingDate, null);
  assert.equal(noTarget.mostLikelyVendor.projectedCbm, 40);
});

test("vendor and brand vendor forecasts enforce their distinct required entity", () => {
  assert.throws(
    () => validateAnalyticsRequest({ analysisType: "vendor_next_shipment_forecast" }),
    (error) => error instanceof OmsForecastValidationError && error.code === "vendor_required",
  );
  assert.throws(
    () => validateAnalyticsRequest({ analysisType: "brand_next_container_vendor_forecast" }),
    (error) => error instanceof OmsForecastValidationError && error.code === "brand_required",
  );
});

test("controlled forecast returns a low-confidence ETD-only result when optional history times out", async () => {
  let calls = 0;
  const result = await runOmsForecastAnalysis(
    { analysisType: "vendor_next_shipment_forecast", vendor: "Boranada", targetCbm: 65 },
    {
      now: new Date("2026-08-18T00:00:00Z"),
      user: { _id: "user-1" },
      queryExecutor: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            rows: [{
              order_id: "OPEN-ETD",
              item_code: "CHAIR-1",
              vendor: "Boranada",
              brand: "Brand A",
              order_date: "2026-08-01",
              revised_ETD: "2026-09-10",
              quantity: 100,
              total_po_cbm: 100,
              shipment: [],
              qc_passed: 60,
              qc_request_history: [],
            }],
            audit: { collection: "orders", stageCount: 7, durationMs: 4, returnedRows: 1, truncated: false },
          };
        }
        const error = new OmsChatQueryError("Historical query timed out", {
          statusCode: 504,
          category: "database_timeout",
        });
        error.audit = { collection: "orders", stageCount: 10, durationMs: 8_000, returnedRows: 0, truncated: false };
        throw error;
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.partialResults, true);
  assert.equal(result.analysis.status, "forecast_ready");
  assert.equal(result.analysis.forecast.planningDate, "2026-09-10");
  assert.equal(result.analysis.confidence.label, "low");
  assert.match(result.limitations[0], /Historical inspection evidence was unavailable/);
});

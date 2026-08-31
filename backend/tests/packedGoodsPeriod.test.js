const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  PackedGoodsPeriodValidationError,
  allocatePackedQuantities,
  buildPackedGoodsPeriodDataset,
  fetchSelectedPeriodInspections,
  resolvePackedGoodsPeriod,
} = require("../services/packedGoodsPeriod.service");
const {
  buildApprovedGoodsQuantityByInspectionId,
  isQualifyingPackedInspection,
} = require("../helpers/inspectionPassedQuantity");

const makeOrder = ({
  id,
  qcId,
  orderId = "PO-1",
  itemCode = "ITEM-1",
  brand = "Brand A",
  vendor = "Vendor A",
  quantity = 20,
  shipment = [],
  requestType = "FULL",
  requestHistory = [],
} = {}) => ({
  _id: id || `order-${qcId}`,
  order_id: orderId,
  order_date: new Date("2020-01-01T00:00:00Z"),
  item: { item_code: itemCode },
  brand,
  vendor,
  quantity,
  shipment,
  qc_record: {
    _id: qcId,
    request_type: requestType,
    request_history: requestHistory,
    quantities: { quantity_requested: quantity },
  },
});

const makeInspection = ({
  id,
  qcId,
  date,
  passed,
  status = "Inspection Done",
  requestHistoryId = "",
  vendorRequested = 0,
  goodsNotReady,
} = {}) => ({
  _id: id,
  qc: qcId,
  inspection_date: date,
  requested_date: date,
  request_history_id: requestHistoryId,
  passed,
  vendor_requested: vendorRequested,
  status,
  goods_not_ready: goodsNotReady,
});

const buildDataset = async ({
  selected = [],
  history = selected,
  orders = [],
  items = [],
  now = new Date("2026-08-31T12:00:00Z"),
  ...filters
} = {}) => {
  const qcs = orders.map((order) => ({
    _id: order.qc_record._id,
    order_meta: { order_id: order.order_id },
  }));
  return buildPackedGoodsPeriodDataset(filters, {
    now,
    fetchSelectedInspections: async () => selected,
    fetchQcs: async ({ qcIds }) => qcs.filter((qc) => qcIds.includes(qc._id)),
    fetchOrders: async () => orders,
    fetchHistoryInspections: async ({ qcIds }) => history.filter((row) => qcIds.includes(row.qc)),
    fetchItems: async () => items,
  });
};

test("defaults to the inclusive Tuesday-Monday week and validates explicit date pairs", () => {
  assert.deepEqual(
    resolvePackedGoodsPeriod({ now: new Date("2026-08-31T12:00:00Z") }),
    { from_date: "2026-08-25", to_date: "2026-08-31", is_default_week: true },
  );
  assert.deepEqual(
    resolvePackedGoodsPeriod({ fromDate: "2026-08-25", toDate: "2026-08-31" }),
    { from_date: "2026-08-25", to_date: "2026-08-31", is_default_week: false },
  );
  assert.throws(
    () => resolvePackedGoodsPeriod({ fromDate: "2026-08-25" }),
    PackedGoodsPeriodValidationError,
  );
  assert.throws(
    () => resolvePackedGoodsPeriod({ fromDate: "2026-08-31", toDate: "2026-08-25" }),
    /later than To date/,
  );
});

test("scans indexed inspection dates, not order_date, and respects Tuesday and Monday inclusively", async () => {
  let match;
  const query = {
    select() { return this; },
    sort() { return this; },
    async lean() { return []; },
  };
  await fetchSelectedPeriodInspections({
    fromDate: "2026-08-25",
    toDate: "2026-08-31",
    InspectionModel: { find(value) { match = value; return query; } },
  });
  assert.deepEqual(match.inspection_date, { $gte: "2026-08-25", $lte: "2026-08-31" });
  assert.equal(match.passed.$gt, 0);
  assert.equal(Object.hasOwn(match, "order_date"), false);

  const order = makeOrder({ qcId: "qc-1" });
  const selected = [
    makeInspection({ id: "tuesday", qcId: "qc-1", date: "2026-08-25", passed: 3 }),
    makeInspection({ id: "monday", qcId: "qc-1", date: "2026-08-31", passed: 4 }),
  ];
  const dataset = await buildDataset({ selected, orders: [order] });
  assert.equal(dataset.rows.length, 1);
  assert.equal(dataset.rows[0].qc_id, "qc-1");
  assert.equal(dataset.rows[0].period_packed_quantity, 7);
  assert.equal(dataset.rows[0].order_date, "2020-01-01");
});

test("previously packed totals every earlier full-inspection visit", async () => {
  const order = makeOrder({ qcId: "qc-1" });
  const history = [
    makeInspection({ id: "before", qcId: "qc-1", date: "2026-08-24", passed: 5, requestHistoryId: "request-1" }),
    makeInspection({ id: "during", qcId: "qc-1", date: "2026-08-29", passed: 9, requestHistoryId: "request-1" }),
  ];
  const dataset = await buildDataset({
    selected: [history[1]],
    history,
    orders: [order],
  });
  assert.deepEqual(
    {
      previous: dataset.rows[0].previously_packed_quantity,
      period: dataset.rows[0].period_packed_quantity,
      total: dataset.rows[0].total_packed_quantity,
    },
    { previous: 5, period: 9, total: 14 },
  );
});

test("separates shipped quantity from remaining packed quantity", async () => {
  const order = makeOrder({
    qcId: "qc-1",
    shipment: [
      { quantity: 7, stuffing_date: new Date("2026-08-30T12:00:00Z") },
      { quantity: 50, stuffing_date: new Date("2026-09-02T12:00:00Z") },
    ],
  });
  const history = [
    makeInspection({ id: "before", qcId: "qc-1", date: "2026-08-24", passed: 5 }),
    makeInspection({ id: "during", qcId: "qc-1", date: "2026-08-29", passed: 9 }),
    makeInspection({ id: "after", qcId: "qc-1", date: "2026-09-01", passed: 9 }),
  ];
  const dataset = await buildDataset({
    selected: [history[1]],
    history,
    orders: [order],
    items: [{ code: "ITEM-1", inspected_item_sizes: [{ remark: "item", L: 100, B: 100, H: 100 }] }],
  });
  assert.deepEqual(
    dataset.rows[0] && {
      previous: dataset.rows[0].previously_packed_quantity,
      period: dataset.rows[0].period_packed_quantity,
      total: dataset.rows[0].total_packed_quantity,
      shipped: dataset.rows[0].shipped_quantity,
      cbm: dataset.rows[0].total_packed_cbm,
    },
    { previous: 0, period: 7, total: 7, shipped: 7, cbm: 7 },
  );
  assert.deepEqual(
    allocatePackedQuantities({ orderQuantity: 20, previouslyPassed: 5, periodPassed: 9, shippedAsOf: 7 }),
    { previously_packed_quantity: 0, period_packed_quantity: 7, total_packed_quantity: 7 },
  );
});

test("keeps QC AQL aggregation separate and excludes non-packed inspection visits", async () => {
  const requestHistory = [{ _id: "request-1", quantity_requested: 10, request_type: "AQL" }];
  const order = makeOrder({ qcId: "qc-aql", requestType: "AQL", requestHistory });
  const history = [
    makeInspection({ id: "first", qcId: "qc-aql", date: "2026-08-24", passed: 1, requestHistoryId: "request-1", vendorRequested: 10 }),
    makeInspection({ id: "owner", qcId: "qc-aql", date: "2026-08-28", passed: 1, requestHistoryId: "request-1", vendorRequested: 10 }),
  ];
  const approved = buildApprovedGoodsQuantityByInspectionId(history.map((record) => ({ ...record, qc: order.qc_record })));
  assert.equal(approved.get("owner"), 10);
  const fallbackApproved = buildApprovedGoodsQuantityByInspectionId([
    { ...history[0], _id: "created-at-owner", inspection_date: "invalid", createdAt: "2026-08-29T10:00:00Z", qc: order.qc_record },
    { ...history[1], _id: "dated-earlier", inspection_date: "2026-08-28", qc: order.qc_record },
  ]);
  assert.equal(fallbackApproved.get("created-at-owner"), 10);

  const excluded = [
    makeInspection({ id: "rejected", qcId: "qc-aql", date: "2026-08-28", passed: 3, status: "rejected" }),
    makeInspection({ id: "transferred", qcId: "qc-aql", date: "2026-08-28", passed: 3, status: "transferred" }),
    makeInspection({ id: "gnr", qcId: "qc-aql", date: "2026-08-28", passed: 3, goodsNotReady: { ready: true } }),
    makeInspection({ id: "shifted", qcId: "qc-aql", date: "2026-08-28", passed: 3, status: "shifted for later" }),
  ];
  assert.deepEqual(excluded.map(isQualifyingPackedInspection), [false, false, false, false]);

  const dataset = await buildDataset({ selected: [history[1], ...excluded], history, orders: [order] });
  assert.equal(dataset.rows[0].period_packed_quantity, 1);
});

test("sums all qualifying passed visits into 18 previous, 1 period, and 19 total", async () => {
  const requestHistory = [{ _id: "request-1", quantity_requested: 20, request_type: "AQL" }];
  const order = makeOrder({ qcId: "qc-19", quantity: 20, requestType: "AQL", requestHistory });
  const history = [
    makeInspection({ id: "may", qcId: "qc-19", date: "2026-05-14", passed: 15, requestHistoryId: "request-1", vendorRequested: 20 }),
    makeInspection({ id: "august-prior", qcId: "qc-19", date: "2026-08-10", passed: 3, requestHistoryId: "request-1", vendorRequested: 5 }),
    makeInspection({ id: "period", qcId: "qc-19", date: "2026-08-29", passed: 1, requestHistoryId: "request-1", vendorRequested: 1 }),
  ];
  const dataset = await buildDataset({
    selected: [history[2]],
    history,
    orders: [order],
  });
  assert.deepEqual(
    {
      previous: dataset.rows[0].previously_packed_quantity,
      period: dataset.rows[0].period_packed_quantity,
      total: dataset.rows[0].total_packed_quantity,
    },
    { previous: 18, period: 1, total: 19 },
  );
});

test("keeps PO and item rows distinct, applies combined server filters, and batches all lookups", async () => {
  const orders = [
    makeOrder({ id: "one", qcId: "qc-1", orderId: "PO-A", itemCode: "ITEM-1", brand: "Brand A", vendor: "Vendor A" }),
    makeOrder({ id: "two", qcId: "qc-2", orderId: "PO-A", itemCode: "ITEM-2", brand: "Brand A", vendor: "Vendor A" }),
    makeOrder({ id: "three", qcId: "qc-3", orderId: "PO-B", itemCode: "ITEM-1", brand: "Brand B", vendor: "Vendor B" }),
  ];
  const selected = [
    makeInspection({ id: "i-1", qcId: "qc-1", date: "2026-08-27", passed: 1 }),
    makeInspection({ id: "i-2", qcId: "qc-2", date: "2026-08-28", passed: 2 }),
    makeInspection({ id: "i-3", qcId: "qc-3", date: "2026-08-29", passed: 3 }),
  ];
  const calls = { selected: 0, qcs: 0, orders: 0, history: 0, items: 0 };
  const qcs = orders.map((order) => ({ _id: order.qc_record._id, order_meta: { order_id: order.order_id } }));
  const dataset = await buildPackedGoodsPeriodDataset({ brands: ["Brand A"], vendor: "Vendor A", orderId: "PO-A" }, {
    fetchSelectedInspections: async () => { calls.selected += 1; return selected; },
    fetchQcs: async ({ qcIds }) => { calls.qcs += 1; return qcs.filter((qc) => qcIds.includes(qc._id)); },
    fetchOrders: async () => { calls.orders += 1; return orders; },
    fetchHistoryInspections: async ({ qcIds }) => { calls.history += 1; return selected.filter((row) => qcIds.includes(row.qc)); },
    fetchItems: async () => { calls.items += 1; return []; },
  });
  assert.deepEqual(dataset.rows.map((row) => [row.order_id, row.item_code]), [["PO-A", "ITEM-1"], ["PO-A", "ITEM-2"]]);
  assert.deepEqual(calls, { selected: 1, qcs: 1, orders: 1, history: 1, items: 1 });
  assert.deepEqual(dataset.filters, {
    ...dataset.filters,
    from_date: "2026-08-25",
    to_date: "2026-08-31",
    brand: ["Brand A"],
    vendor: "Vendor A",
    order_id: "PO-A",
  });
});

test("page and XLS route to the period builder while the Assistant keeps the existing builder", () => {
  const controllerSource = fs.readFileSync(path.resolve(__dirname, "../controllers/order.controller.js"), "utf8");
  const capabilitySource = fs.readFileSync(path.resolve(__dirname, "../services/omsCapabilityExecution.service.js"), "utf8");
  assert.match(controllerSource, /packedGoodsPeriod\.service/);
  assert.match(controllerSource, /Previously Packed Quantity/);
  assert.match(controllerSource, /This Period Packed/);
  assert.match(controllerSource, /Total Packed CBM/);
  assert.match(capabilitySource, /packedGoods\.service/);
});

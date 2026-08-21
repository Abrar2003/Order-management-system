const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildPackedGoodsDataset,
} = require("../services/packedGoods.service");
const {
  CAPABILITY_ADAPTERS,
  OmsCapabilityError,
  assertAdapterRegistryMatchesKnowledgeBase,
  executeOmsCapability,
  findRelevantCapabilities,
} = require("../services/omsCapabilityExecution.service");
const {
  forecastBrandNextContainerVendor,
} = require("../services/omsForecast.service");

const fixtureOrders = [
  ["PO-A1", "Vendor A", 10],
  ["PO-A2", "Vendor A", 15],
  ["PO-B1", "Vendor B", 18],
].map(([orderId, vendor, passed], index) => ({
  _id: `order-${index}`,
  order_id: orderId,
  order_date: new Date("2026-08-01T00:00:00Z"),
  item: { item_code: `ITEM-${index}` },
  brand: "By Boo",
  vendor,
  quantity: 100,
  shipment: [],
  total_po_cbm: 100,
  qc_record: { quantities: { qc_passed: passed }, request_history: [] },
}));

const buildFixtureDataset = () => buildPackedGoodsDataset({}, {
  fetchOrders: async () => fixtureOrders,
  fetchItems: async () => [],
});

test("Packed Goods API service, capability grouping, and forecast ready CBM agree", async () => {
  const apiDataset = await buildFixtureDataset();
  const capability = await executeOmsCapability({
    capability: "packed_goods",
    filters: { brand: "By Boo" },
    operation: {
      type: "group",
      groupBy: ["vendor"],
      metrics: [{ operation: "sum", field: "total_cbm", as: "ready_cbm" }],
      sort: [{ field: "ready_cbm", direction: "desc" }],
      limit: 100,
    },
  }, {
    models: {},
    packedGoodsBuilder: async () => apiDataset,
  });
  const forecast = forecastBrandNextContainerVendor({
    brand: "By Boo",
    orders: [],
    historicalRows: [],
    readyCbmByVendor: capability.grouped,
    targetCbm: 20,
    now: new Date("2026-08-20T00:00:00Z"),
  });

  assert.equal(apiDataset.rows.length, 3);
  assert.equal(apiDataset.summary.total_packed_quantity, 43);
  assert.equal(apiDataset.summary.total_cbm, 43);
  assert.deepEqual(capability.grouped, [
    { vendor: "Vendor A", ready_cbm: 25 },
    { vendor: "Vendor B", ready_cbm: 18 },
  ]);
  assert.equal(capability.summary.totalCbm, 43);
  assert.equal(capability.provenance.cbmFallbackUsed, true);
  assert.match(capability.warnings[0], /fallback/i);
  assert.deepEqual(
    forecast.vendors.map(({ vendor, currentReadyCbm }) => ({ vendor, currentReadyCbm })),
    [
      { vendor: "Vendor A", currentReadyCbm: 25 },
      { vendor: "Vendor B", currentReadyCbm: 18 },
    ],
  );

  const controllerSource = fs.readFileSync(
    path.resolve(__dirname, "../controllers/order.controller.js"),
    "utf8",
  );
  assert.match(controllerSource, /require\("\.\.\/services\/packedGoods\.service"\)/);
  assert.doesNotMatch(controllerSource, /const buildPackedGoodsDataset = async/);
});

test("Packed Goods prefers measurement CBM and only warns for the stored fallback", async () => {
  const order = { ...fixtureOrders[0], total_po_cbm: 999 };
  const calculatedDataset = await buildPackedGoodsDataset({}, {
    fetchOrders: async () => [order],
    fetchItems: async () => [{
      code: order.item.item_code,
      inspected_item_sizes: [{ remark: "Item", L: 100, B: 100, H: 100 }],
    }],
  });
  const calculatedCapability = await executeOmsCapability({
    capability: "packed_goods",
    operation: { type: "summary" },
  }, {
    models: {},
    packedGoodsBuilder: async () => calculatedDataset,
  });

  assert.equal(calculatedDataset.rows[0].total_cbm, 10);
  assert.equal(calculatedDataset.rows[0].cbm_source, "inspected_item");
  assert.equal(calculatedCapability.provenance.cbmFallbackUsed, false);
  assert.deepEqual(calculatedCapability.warnings, []);
});

test("Assistant Packed Goods supports its intentional unscoped null-user read", async () => {
  let orderMatch;
  let itemMatch;
  const query = (rows) => ({
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    maxTimeMS() { return this; },
    async lean() { return rows; },
  });
  const result = await executeOmsCapability({
    capability: "packed_goods",
    operation: { type: "summary" },
  }, {
    models: {
      OrderModel: {
        find(match) {
          orderMatch = match;
          return query([fixtureOrders[0]]);
        },
      },
      ItemModel: {
        find(match) {
          itemMatch = match;
          return query([]);
        },
      },
    },
  });

  assert.deepEqual(orderMatch, {
    $and: [{ archived: { $ne: true } }, { status: { $ne: "Cancelled" } }],
  });
  assert.deepEqual(itemMatch, { code: { $in: ["ITEM-0"] } });
  assert.equal(result.success, true);
  assert.equal(result.summary.totalCbm, 10);
});

test("capability execution forwards the authenticated scope before canonical calculation", async () => {
  const user = { allowed_vendors: ["Vendor A"], allowed_brands: [] };
  let receivedUser;
  await executeOmsCapability({ capability: "packed_goods", operation: { type: "summary" } }, {
    models: {},
    user,
    packedGoodsBuilder: async ({ user: builderUser }) => {
      receivedUser = builderUser;
      return { rows: [], summary: { total_rows: 0, total_packed_quantity: 0, total_cbm: 0 } };
    },
  });
  assert.equal(receivedUser, user);
});

test("capability registry contains only the explicit registered direct adapters", () => {
  assert.doesNotThrow(assertAdapterRegistryMatchesKnowledgeBase);
  assert.deepEqual(Object.keys(CAPABILITY_ADAPTERS).sort(), [
    "monthly_shipments",
    "packed_goods",
    "shipment_cbm",
  ]);
  const executionSource = fs.readFileSync(
    path.resolve(__dirname, "../services/omsCapabilityExecution.service.js"),
    "utf8",
  );
  assert.doesNotMatch(executionSource, /require\(capability\.sourceOfTruth/);
  assert.doesNotMatch(executionSource, /canonicalFile\)/);
});

test("Shipment CBM adapter uses the canonical calculation with bounded PO filters", async () => {
  const chain = (rows) => ({
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    maxTimeMS() { return this; },
    async lean() { return rows; },
  });
  const result = await executeOmsCapability({
    capability: "shipment_cbm",
    filters: { po: "PO-A1", shipment_quantity: 5 },
    operation: { type: "rows", limit: 10 },
  }, {
    models: {
      OrderModel: { find: () => chain([fixtureOrders[0]]) },
      ItemModel: { find: () => chain([]) },
    },
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].total_cbm, 5);
  assert.equal(result.rows[0].cbm_source, "total_po_cbm");
  assert.equal(result.capability.id, "shipment_cbm");
});

test("Monthly Shipments adapter reuses its canonical service result", async () => {
  let receivedQuery;
  const result = await executeOmsCapability({
    capability: "monthly_shipments",
    filters: { fromDate: "2026-07-01", toDate: "2026-07-31" },
    operation: { type: "rows", limit: 100 },
  }, {
    models: { OrderModel: {} },
    now: new Date("2026-08-20T00:00:00Z"),
    monthlyShipmentsLoader: async ({ query }) => {
      receivedQuery = query;
      return {
        period: { start: "2026-07-01", end: "2026-07-31" },
        summary: { total_unique_containers: 3, total_allocated_cbm: 120, vendors_count: 1 },
        overall: { vendor_totals: [{ vendor: "Vendor A", unique_container_count: 3, total_allocated_cbm: 120 }] },
      };
    },
  });

  assert.deepEqual(receivedQuery, {
    from_date: "2026-07-01",
    to_date: "2026-07-31",
    period_mode: "custom",
  });
  assert.equal(result.summary.totalUniqueContainers, 3);
  assert.equal(result.summary.totalAllocatedCbm, 120);
  assert.equal(result.rows[0].vendor, "Vendor A");
  assert.equal(result.provenance.sourceLabel, "Monthly Shipments");
});

test("capability validation rejects unavailable access and unsafe operations recoverably", async () => {
  const expectCode = async (request, code) => assert.rejects(
    executeOmsCapability(request, { models: {} }),
    (error) => error instanceof OmsCapabilityError
      && error.recoverable
      && error.code === code
      && error.toToolResult().success === false,
  );

  await expectCode({ capability: "made_up_report" }, "unknown_capability");
  await expectCode({ capability: "notifications" }, "capability_not_available");
  await expectCode({ capability: "email_logs" }, "capability_not_available");
  await expectCode({ capability: "pending_po" }, "capability_not_ready");
  await expectCode({ capability: "packed_goods", filters: { secret: "x" } }, "invalid_capability_filter");
  await expectCode({ capability: "packed_goods", filters: { from_date: "2026-02-30" } }, "invalid_capability_filter");
  await expectCode({ capability: "packed_goods", operation: { type: "group", groupBy: ["password"], metrics: [] } }, "invalid_capability_group_field");
  await expectCode({ capability: "packed_goods", operation: { type: "group", groupBy: ["vendor"], metrics: [{ operation: "sum", field: "password", as: "total" }] } }, "invalid_capability_metric");
  await expectCode({ capability: "packed_goods", operation: { type: "rows", limit: 101 } }, "invalid_capability_limit");
});

test("capability post-processing accepts only bounded declarative operations", () => {
  const operation = require("../services/omsCapabilityExecution.service").__test__.validateOperation({
    type: "group",
    groupBy: ["vendor"],
    filter: { brand: ["By Boo"] },
    distinct: "vendor",
    metrics: [{ type: "average", field: "total_cbm", as: "average_cbm" }],
    sort: [{ field: "average_cbm", direction: "desc" }],
    limit: 10,
  }, {
    fields: new Set(["brand", "vendor", "total_cbm"]),
    numericFields: new Set(["total_cbm"]),
  });

  assert.equal(operation.metrics[0].operation, "avg");
  assert.equal(operation.distinct, "vendor");
  assert.deepEqual(operation.filter.brand, ["By Boo"]);
});

test("knowledge preselection ranks canonical natural-language matches", () => {
  assert.equal(findRelevantCapabilities("How much By Boo goods ready CBM is available to ship?")[0].id, "packed_goods");
  assert.equal(findRelevantCapabilities("How many containers shipped last month?")[0].id, "monthly_shipments");
  assert.ok(findRelevantCapabilities("Count open orders").some((entry) => entry.id === "order_list"));
  assert.ok(findRelevantCapabilities("Which POs are delayed today?").some((entry) => entry.id === "delayed_po"));
});

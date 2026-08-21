const Order = require("../models/order.model");
const Item = require("../models/item.model");
const Qc = require("../models/qc.model");
const { buildPackedGoodsDataset } = require("./packedGoods.service");
const {
  fetchMonthlyShipmentContributionRows,
  getMonthlyShipmentsReportData,
} = require("./monthlyShipmentsReport.service");
const {
  resolveOrderRowCbmSummary,
  resolveOrderRowCbmSummaryWithStoredFallback,
  resolveShipmentRowCbm,
} = require("./shipmentCbmAllocation.service");
const { getOmsChatConnection } = require("./omsChatQuery.service");
const {
  getCapability,
} = require("./omsKnowledgeBase.service");
const {
  buildCapabilityPlannerContext,
  findRelevantCapabilities: findPlannedCapabilities,
  getCanonicalCapabilityGuidance,
} = require("./omsCapabilityPlanner.service");
const { applyDataAccessMatch } = require("./userDataAccess.service");
const {
  logOmsChatError,
  logOmsChatEvent,
} = require("./omsChatLogger.service");

const MAX_CAPABILITY_ROWS = 100;
const CAPABILITY_TIMEOUT_MS = 8_000;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const PACKED_GOODS_FIELDS = new Set([
  "id", "order_id", "order_date", "item_code", "brand", "vendor",
  "order_quantity", "packed_quantity", "pending_quantity",
  "po_has_no_pending_quantity", "total_cbm", "per_item_cbm", "cbm_source",
]);
const PACKED_GOODS_NUMERIC_FIELDS = new Set([
  "order_quantity", "packed_quantity", "pending_quantity", "total_cbm", "per_item_cbm",
]);
const MONTHLY_SHIPMENT_FIELDS = new Set([
  "vendor", "unique_container_count", "total_allocated_cbm",
]);
const MONTHLY_SHIPMENT_NUMERIC_FIELDS = new Set([
  "unique_container_count", "total_allocated_cbm",
]);
const SHIPMENT_CBM_FIELDS = new Set([
  "id", "order_id", "item_code", "brand", "vendor", "order_quantity",
  "shipment_quantity", "total_cbm", "per_item_cbm", "cbm_source",
]);
const SHIPMENT_CBM_NUMERIC_FIELDS = new Set([
  "order_quantity", "shipment_quantity", "total_cbm", "per_item_cbm",
]);

class OmsCapabilityError extends Error {
  constructor(code, message, { recoverable = true, statusCode = 422 } = {}) {
    super(message);
    this.name = "OmsCapabilityError";
    this.code = code;
    this.category = "capability_validation";
    this.recoverable = recoverable;
    this.statusCode = statusCode;
  }

  toToolResult() {
    return { success: false, code: this.code, message: this.message };
  }
}

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const assertPlainObject = (value, label) => {
  if (!isPlainObject(value) || Object.keys(value).some((key) => BLOCKED_KEYS.has(key))) {
    throw new OmsCapabilityError("invalid_capability_arguments", `${label} must be a safe object.`);
  }
};
const assertAllowedKeys = (value, allowed, code, message) => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new OmsCapabilityError(code, message);
};
const cleanText = (value, label, { optional = true } = {}) => {
  if (value === undefined || value === null || value === "") {
    if (optional) return "";
    throw new OmsCapabilityError("invalid_capability_filter", `${label} is required.`);
  }
  if (typeof value !== "string") {
    throw new OmsCapabilityError("invalid_capability_filter", `${label} must be text.`);
  }
  const text = value.trim();
  if ((!text && !optional) || text.length > 120) {
    throw new OmsCapabilityError("invalid_capability_filter", `${label} is invalid.`);
  }
  return text;
};
const cleanDate = (value, label) => {
  const text = cleanText(value, label);
  const parsed = text ? new Date(`${text}T00:00:00.000Z`) : null;
  if (text && (
    !DATE_VALUE.test(text)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== text
  )) {
    throw new OmsCapabilityError("invalid_capability_filter", `${label} must use YYYY-MM-DD.`);
  }
  return text;
};
const cleanStringList = (value, label) => {
  const values = value === undefined || value === null || value === ""
    ? []
    : Array.isArray(value) ? value : [value];
  if (values.length > 20) {
    throw new OmsCapabilityError("invalid_capability_filter", `${label} has too many values.`);
  }
  if (values.some((entry) => typeof entry !== "string")) {
    throw new OmsCapabilityError("invalid_capability_filter", `${label} must contain only text values.`);
  }
  return [...new Set(values.flatMap((entry) => entry.split(","))
    .map((entry) => cleanText(entry, label))
    .filter(Boolean))];
};

const normalizePackedGoodsFilters = (filters = {}) => {
  assertPlainObject(filters, "filters");
  assertAllowedKeys(
    filters,
    new Set(["brand", "brands", "vendor", "order_id", "order", "po", "from_date", "fromDate", "to_date", "toDate"]),
    "invalid_capability_filter",
    "Packed Goods supports brand, vendor, PO, from-date, and to-date filters.",
  );
  const normalized = {
    brands: cleanStringList(filters.brands ?? filters.brand, "brand"),
    vendor: cleanText(filters.vendor, "vendor"),
    orderId: cleanText(filters.order_id ?? filters.order ?? filters.po, "PO"),
    fromDate: cleanDate(filters.from_date ?? filters.fromDate, "from_date"),
    toDate: cleanDate(filters.to_date ?? filters.toDate, "to_date"),
  };
  if (normalized.fromDate && normalized.toDate && normalized.fromDate > normalized.toDate) {
    throw new OmsCapabilityError("invalid_capability_filter", "from_date cannot be after to_date.");
  }
  return normalized;
};

const normalizeMonthlyShipmentFilters = (filters = {}) => {
  assertPlainObject(filters, "filters");
  assertAllowedKeys(
    filters,
    new Set(["period_mode", "periodMode", "mode", "year", "month", "from_date", "fromDate", "from", "to_date", "toDate", "to", "country", "brand", "vendor"]),
    "invalid_capability_filter",
    "Monthly Shipments supports period, country, brand, and vendor filters.",
  );
  const mode = cleanText(filters.period_mode ?? filters.periodMode ?? filters.mode, "period_mode").toLowerCase();
  if (mode && !["month", "selected-month", "month-selection", "custom", "custom-range", "custom-date-range", "last-six-months"].includes(mode)) {
    throw new OmsCapabilityError("invalid_capability_filter", "period_mode is invalid.");
  }
  const query = {};
  if (mode) query.period_mode = mode;
  if (filters.year !== undefined) {
    const year = Number(filters.year);
    if (!Number.isInteger(year) || year < 1900 || year > 3000) {
      throw new OmsCapabilityError("invalid_capability_filter", "year is invalid.");
    }
    query.year = year;
  }
  if (filters.month !== undefined) {
    const month = Number(filters.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new OmsCapabilityError("invalid_capability_filter", "month is invalid.");
    }
    query.month = month;
  }
  const fromDate = cleanDate(filters.from_date ?? filters.fromDate ?? filters.from, "from_date");
  const toDate = cleanDate(filters.to_date ?? filters.toDate ?? filters.to, "to_date");
  if (fromDate) query.from_date = fromDate;
  if (toDate) query.to_date = toDate;
  if (fromDate && toDate && !query.period_mode) query.period_mode = "custom";
  if (fromDate && toDate && fromDate > toDate) {
    throw new OmsCapabilityError("invalid_capability_filter", "from_date cannot be after to_date.");
  }
  for (const field of ["country", "brand", "vendor"]) {
    const value = cleanText(filters[field], field);
    if (value) query[field] = value;
  }
  return query;
};

const normalizeShipmentCbmFilters = (filters = {}) => {
  assertPlainObject(filters, "filters");
  assertAllowedKeys(
    filters,
    new Set(["po", "order_id", "order", "item", "item_code", "shipment_quantity"]),
    "invalid_capability_filter",
    "Shipment CBM supports PO, item, and shipment quantity filters.",
  );
  const shipmentQuantity = filters.shipment_quantity === undefined
    ? null
    : Number(filters.shipment_quantity);
  if (shipmentQuantity !== null && (!Number.isFinite(shipmentQuantity) || shipmentQuantity <= 0)) {
    throw new OmsCapabilityError("invalid_capability_filter", "shipment_quantity must be a positive number.");
  }
  const normalized = {
    orderId: cleanText(filters.po ?? filters.order_id ?? filters.order, "PO"),
    itemCode: cleanText(filters.item ?? filters.item_code, "item"),
    shipmentQuantity: shipmentQuantity === null ? null : Number(shipmentQuantity.toFixed(6)),
  };
  if (!normalized.orderId && !normalized.itemCode) {
    throw new OmsCapabilityError("invalid_capability_filter", "Shipment CBM requires a PO or item filter.");
  }
  return normalized;
};

const validateOperation = (operation = {}, { fields, numericFields }) => {
  assertPlainObject(operation, "operation");
  assertAllowedKeys(
    operation,
    new Set(["type", "groupBy", "metrics", "sort", "limit", "filter", "distinct"]),
    "invalid_capability_operation",
    "Capability operation contains an unsupported setting.",
  );
  const type = cleanText(operation.type || "summary", "operation type", { optional: false }).toLowerCase();
  if (!["summary", "rows", "group"].includes(type)) {
    throw new OmsCapabilityError("invalid_capability_operation", "Operation type must be summary, rows, or group.");
  }
  const limit = operation.limit === undefined ? MAX_CAPABILITY_ROWS : Number(operation.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CAPABILITY_ROWS) {
    throw new OmsCapabilityError("invalid_capability_limit", `Capability limit must be between 1 and ${MAX_CAPABILITY_ROWS}.`);
  }
  const groupBy = operation.groupBy === undefined ? [] : operation.groupBy;
  if (!Array.isArray(groupBy) || groupBy.length > 3 || groupBy.some((field) => !fields.has(field))) {
    throw new OmsCapabilityError("invalid_capability_group_field", "Capability grouping contains an unsupported field.");
  }
  const metrics = operation.metrics === undefined ? [] : operation.metrics;
  if (!Array.isArray(metrics) || metrics.length > 6) {
    throw new OmsCapabilityError("invalid_capability_metric", "Capability metrics are invalid.");
  }
  const normalizedMetrics = metrics.map((metric) => {
    assertPlainObject(metric, "metric");
    assertAllowedKeys(metric, new Set(["operation", "type", "field", "as"]), "invalid_capability_metric", "Capability metric contains an unsupported setting.");
    const aggregation = cleanText(metric.operation ?? metric.type, "metric operation", { optional: false }).toLowerCase();
    const field = cleanText(metric.field, "metric field", { optional: false });
    const as = cleanText(metric.as, "metric alias", { optional: false });
    const normalizedAggregation = aggregation === "average" ? "avg" : aggregation;
    if (!["sum", "count", "avg", "min", "max"].includes(normalizedAggregation)
      || (!numericFields.has(field) && !(aggregation === "count" && field === "*"))
      || !SAFE_NAME.test(as)
      || BLOCKED_KEYS.has(as)) {
      throw new OmsCapabilityError("invalid_capability_metric", "Capability metric is not allowed.");
    }
    return { operation: normalizedAggregation, field, as };
  });
  if (type === "group" && (!groupBy.length || !normalizedMetrics.length)) {
    throw new OmsCapabilityError("invalid_capability_operation", "Grouped operations require groupBy and metrics.");
  }
  const outputFields = new Set([...fields, ...groupBy, ...normalizedMetrics.map((metric) => metric.as)]);
  const sort = operation.sort === undefined ? [] : operation.sort;
  if (!Array.isArray(sort) || sort.length > 3) {
    throw new OmsCapabilityError("invalid_capability_sort", "Capability sort is invalid.");
  }
  const normalizedSort = sort.map((entry) => {
    assertPlainObject(entry, "sort");
    assertAllowedKeys(entry, new Set(["field", "direction"]), "invalid_capability_sort", "Capability sort contains an unsupported setting.");
    const field = cleanText(entry.field, "sort field", { optional: false });
    const direction = cleanText(entry.direction || "asc", "sort direction", { optional: false }).toLowerCase();
    if (!outputFields.has(field) || !["asc", "desc"].includes(direction)) {
      throw new OmsCapabilityError("invalid_capability_sort", "Capability sort field or direction is invalid.");
    }
    return { field, direction };
  });
  const filter = operation.filter === undefined ? {} : operation.filter;
  assertPlainObject(filter, "operation filter");
  assertAllowedKeys(filter, fields, "invalid_capability_filter", "Capability result filter contains an unsupported field.");
  const normalizedFilter = Object.fromEntries(Object.entries(filter).map(([field, value]) => [
    field,
    cleanStringList(value, field),
  ]));
  const distinct = operation.distinct === undefined ? "" : cleanText(operation.distinct, "distinct field");
  if (distinct && !fields.has(distinct)) {
    throw new OmsCapabilityError("invalid_capability_field", "Capability distinct field is not allowed.");
  }
  return {
    type, groupBy, metrics: normalizedMetrics, sort: normalizedSort, limit,
    filter: normalizedFilter, distinct,
  };
};

const compare = (left, right, field) => {
  const leftValue = left?.[field];
  const rightValue = right?.[field];
  if (typeof leftValue === "number" || typeof rightValue === "number") {
    return Number(leftValue || 0) - Number(rightValue || 0);
  }
  return String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, { numeric: true, sensitivity: "base" });
};
const sortRows = (rows, sort) => [...rows].sort((left, right) => {
  for (const entry of sort) {
    const order = compare(left, right, entry.field);
    if (order) return entry.direction === "desc" ? -order : order;
  }
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
});
const groupRows = (rows, operation) => {
  const groups = new Map();
  for (const row of rows) {
    const keyValues = operation.groupBy.map((field) => row?.[field] ?? null);
    const groupKey = JSON.stringify(keyValues);
    if (!groups.has(groupKey)) {
      const result = Object.fromEntries(operation.groupBy.map((field, index) => [field, keyValues[index]]));
      groups.set(groupKey, { result, states: Object.create(null) });
    }
    const group = groups.get(groupKey);
    for (const metric of operation.metrics) {
      const value = metric.field === "*" ? 1 : Number(row?.[metric.field]);
      const state = group.states[metric.as] || { count: 0, sum: 0, min: null, max: null };
      if (metric.operation === "count" || Number.isFinite(value)) {
        state.count += 1;
        state.sum += Number.isFinite(value) ? value : 0;
        if (Number.isFinite(value)) {
          state.min = state.min === null ? value : Math.min(state.min, value);
          state.max = state.max === null ? value : Math.max(state.max, value);
        }
      }
      group.states[metric.as] = state;
    }
  }
  return [...groups.values()].map(({ result, states }) => {
    for (const metric of operation.metrics) {
      const state = states[metric.as];
      const value = metric.operation === "count" ? state.count
        : metric.operation === "sum" ? state.sum
          : metric.operation === "avg" ? state.count ? state.sum / state.count : 0
            : metric.operation === "min" ? state.min
              : state.max;
      result[metric.as] = Number.isFinite(value) ? Number(value.toFixed(6)) : null;
    }
    return result;
  });
};
const postProcess = (rows, operation) => {
  if (operation.type === "summary") return { rows: [], grouped: [], truncated: false };
  const filtered = rows.filter((row) => Object.entries(operation.filter || {}).every(([field, values]) => (
    !values.length || values.includes(String(row?.[field] ?? ""))
  )));
  const uniqueRows = operation.distinct
    ? [...new Map(filtered.map((row) => [JSON.stringify(row?.[operation.distinct] ?? null), row])).values()]
    : filtered;
  const processed = operation.type === "group" ? groupRows(uniqueRows, operation) : uniqueRows;
  const sorted = operation.sort.length ? sortRows(processed, operation.sort) : processed;
  return {
    rows: operation.type === "rows" ? sorted.slice(0, operation.limit) : [],
    grouped: operation.type === "group" ? sorted.slice(0, operation.limit) : [],
    truncated: sorted.length > operation.limit,
  };
};

const getReadOnlyModels = async (connectionProvider = getOmsChatConnection) => {
  const connection = await connectionProvider();
  const register = (model) => connection.models[model.modelName]
    || connection.model(model.modelName, model.schema, model.collection.name);
  register(Qc);
  return { OrderModel: register(Order), ItemModel: register(Item) };
};

const safeCapabilityMetadata = (capability) => ({
  id: capability.id,
  name: capability.name,
  certainty: capability.certainty,
  sourceKind: capability.sourceOfTruth.kind,
});
const routePermissions = (capability) => [...new Set(
  capability.routes.map((route) => route.permission).filter(Boolean),
)];

const executePackedGoods = async ({ filters, operation }, dependencies = {}) => {
  const normalizedFilters = normalizePackedGoodsFilters(filters);
  const normalizedOperation = validateOperation(operation, {
    fields: PACKED_GOODS_FIELDS,
    numericFields: PACKED_GOODS_NUMERIC_FIELDS,
  });
  const models = dependencies.models || await getReadOnlyModels(dependencies.connectionProvider);
  const builder = dependencies.packedGoodsBuilder || buildPackedGoodsDataset;
  const dataset = await builder({ ...normalizedFilters, user: dependencies.user || null }, {
    ...models,
    maxTimeMS: CAPABILITY_TIMEOUT_MS,
  });
  const processed = postProcess(dataset.rows, normalizedOperation);
  const fallbackUsed = dataset.rows.some((row) => row?.cbm_source === "total_po_cbm");
  return {
    appliedFilters: normalizedFilters,
    summary: {
      rowCount: dataset.summary.total_rows,
      totalPackedQuantity: dataset.summary.total_packed_quantity,
      totalCbm: dataset.summary.total_cbm,
    },
    ...processed,
    warnings: fallbackUsed ? ["Some CBM values use the stored Total PO CBM fallback."] : [],
    provenance: { canonical: true, sourceLabel: "Packed Goods", sourceType: "canonical_report", cbmFallbackUsed: fallbackUsed },
    databaseCalls: 2,
    audit: { collections: ["orders", "qcs", "items"], stageCount: 0 },
  };
};

const executeMonthlyShipments = async ({ filters, operation }, dependencies = {}) => {
  const query = normalizeMonthlyShipmentFilters(filters);
  const normalizedOperation = validateOperation(operation, {
    fields: MONTHLY_SHIPMENT_FIELDS,
    numericFields: MONTHLY_SHIPMENT_NUMERIC_FIELDS,
  });
  const { OrderModel } = dependencies.models || await getReadOnlyModels(dependencies.connectionProvider);
  const loader = dependencies.monthlyShipmentsLoader || getMonthlyShipmentsReportData;
  const report = await loader({
    query,
    user: dependencies.user || null,
    now: dependencies.now || new Date(),
    fetchRows: ({ period, user, query: reportQuery }) => fetchMonthlyShipmentContributionRows({
      period,
      user,
      query: reportQuery,
      OrderModel,
      allowDiskUse: false,
      maxTimeMS: CAPABILITY_TIMEOUT_MS,
    }),
  });
  const rows = report?.overall?.vendor_totals || [];
  return {
    appliedFilters: query,
    summary: {
      rowCount: rows.length,
      totalUniqueContainers: Number(report?.summary?.total_unique_containers || 0),
      totalAllocatedCbm: Number(report?.summary?.total_allocated_cbm || 0),
      vendorCount: Number(report?.summary?.vendors_count || 0),
      period: report?.period || null,
    },
    ...postProcess(rows, normalizedOperation),
    warnings: [],
    provenance: { canonical: true, sourceLabel: "Monthly Shipments", sourceType: "canonical_service", cbmFallbackUsed: false },
    databaseCalls: 1,
    audit: { collections: ["orders", "items"], stageCount: 0 },
  };
};

const escapeRegex = (value = "") => String(value)
  .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const executeShipmentCbm = async ({ filters, operation }, dependencies = {}) => {
  const normalizedFilters = normalizeShipmentCbmFilters(filters);
  const normalizedOperation = validateOperation(operation, {
    fields: SHIPMENT_CBM_FIELDS,
    numericFields: SHIPMENT_CBM_NUMERIC_FIELDS,
  });
  const models = dependencies.models || await getReadOnlyModels(dependencies.connectionProvider);
  const orderMatch = {
    $and: [{ archived: { $ne: true } }, { status: { $ne: "Cancelled" } }],
    ...(normalizedFilters.orderId ? {
      order_id: { $regex: `^${escapeRegex(normalizedFilters.orderId)}$`, $options: "i" },
    } : {}),
    ...(normalizedFilters.itemCode ? {
      "item.item_code": { $regex: `^${escapeRegex(normalizedFilters.itemCode)}$`, $options: "i" },
    } : {}),
  };
  const scopedOrderMatch = dependencies.user
    ? applyDataAccessMatch(orderMatch, dependencies.user)
    : orderMatch;
  const query = models.OrderModel.find(scopedOrderMatch)
    .select("_id order_id item brand vendor quantity total_po_cbm")
    .sort({ order_date: -1, _id: 1 })
    .limit(MAX_CAPABILITY_ROWS);
  if (typeof query.maxTimeMS === "function") query.maxTimeMS(CAPABILITY_TIMEOUT_MS);
  const orders = await query.lean();
  const itemCodes = [...new Set(orders.map((order) => String(order?.item?.item_code || "").trim()).filter(Boolean))];
  const itemMatch = dependencies.user
    ? applyDataAccessMatch({ code: { $in: itemCodes } }, dependencies.user, {
      brandFields: ["brand", "brand_name", "brands"],
      vendorFields: ["vendors"],
    })
    : { code: { $in: itemCodes } };
  const itemQuery = itemCodes.length
    ? models.ItemModel.find(itemMatch).select("code cbm inspected_item_sizes inspected_box_sizes inspected_box_mode pis_item_sizes pis_box_sizes pis_box_mode")
    : null;
  if (itemQuery && typeof itemQuery.maxTimeMS === "function") itemQuery.maxTimeMS(CAPABILITY_TIMEOUT_MS);
  const items = itemQuery ? await itemQuery.lean() : [];
  const itemByCode = new Map(items.map((item) => [String(item?.code || "").trim().toLowerCase(), item]));
  const rows = orders.map((order) => {
    const orderQuantity = Math.max(0, Number(order?.quantity || 0));
    const shipmentQuantity = normalizedFilters.shipmentQuantity || orderQuantity;
    const itemCode = String(order?.item?.item_code || "").trim();
    const itemDoc = itemByCode.get(itemCode.toLowerCase()) || null;
    const calculatedShipment = normalizedFilters.shipmentQuantity
      ? resolveOrderRowCbmSummary(itemDoc, shipmentQuantity)
      : null;
    const cbm = normalizedFilters.shipmentQuantity
      ? {
          total: resolveShipmentRowCbm({
            itemDoc,
            orderQuantity,
            storedPoCbm: order?.total_po_cbm,
            shipmentQuantity,
          }),
          per_item: Number(calculatedShipment?.per_item || 0)
            || (orderQuantity > 0 ? Number(order?.total_po_cbm || 0) / orderQuantity : 0),
          source: calculatedShipment?.total ? calculatedShipment.source
            : Number(order?.total_po_cbm || 0) > 0 ? "total_po_cbm" : null,
        }
      : resolveOrderRowCbmSummaryWithStoredFallback({
          itemDoc,
          quantity: orderQuantity,
          storedTotalCbm: order?.total_po_cbm,
        });
    return {
      id: String(order?._id || ""),
      order_id: String(order?.order_id || "").trim(),
      item_code: itemCode,
      brand: String(order?.brand || "").trim(),
      vendor: String(order?.vendor?.name || order?.vendor || "").trim(),
      order_quantity: orderQuantity,
      shipment_quantity: shipmentQuantity,
      total_cbm: Number(cbm?.total || 0),
      per_item_cbm: Number(cbm?.per_item || 0),
      cbm_source: cbm?.source || null,
    };
  });
  const fallbackUsed = rows.some((row) => row.cbm_source === "total_po_cbm");
  return {
    appliedFilters: normalizedFilters,
    summary: {
      rowCount: rows.length,
      totalCbm: Number(rows.reduce((sum, row) => sum + row.total_cbm, 0).toFixed(6)),
    },
    ...postProcess(rows, normalizedOperation),
    warnings: fallbackUsed ? ["Some CBM values use the stored Total PO CBM fallback."] : [],
    provenance: { canonical: true, sourceLabel: "Shipment CBM", sourceType: "canonical_service", cbmFallbackUsed: fallbackUsed },
    databaseCalls: itemCodes.length ? 2 : 1,
    audit: { collections: ["orders", "items"], stageCount: 0 },
  };
};

const CAPABILITY_ADAPTERS = Object.freeze({
  packed_goods: executePackedGoods,
  monthly_shipments: executeMonthlyShipments,
  shipment_cbm: executeShipmentCbm,
});

const assertAdapterRegistryMatchesKnowledgeBase = () => {
  const registered = Object.keys(CAPABILITY_ADAPTERS).sort();
  const invalid = registered.filter((id) => {
    const capability = getCapability(id);
    return !capability
      || capability.assistantRecommendation !== "DIRECT_CAPABILITY"
      || !["existing_assistant_feature", "ready"].includes(capability.assistantStatus);
  });
  if (invalid.length) {
    throw new Error("OMS capability adapter registry is out of sync with the Knowledge Base");
  }
};
assertAdapterRegistryMatchesKnowledgeBase();

const executeOmsCapability = async (request, dependencies = {}) => {
  assertPlainObject(request, "capability request");
  assertAllowedKeys(request, new Set(["capability", "filters", "operation"]), "invalid_capability_arguments", "Capability request contains an unsupported argument.");
  const capabilityId = cleanText(request.capability, "capability", { optional: false });
  logOmsChatEvent("capability.requested", { capability_id: capabilityId });
  const capability = getCapability(capabilityId);
  if (!capability) throw new OmsCapabilityError("unknown_capability", "That OMS capability is not available.");
  if (!CAPABILITY_ADAPTERS[capability.id]) {
    const unavailable = ["NOT_ASSISTANT_SAFE", "EXPORT_ONLY", "PRESENTATION_ONLY"].includes(capability.assistantRecommendation)
      || capability.assistantStatus === "not_tool_eligible";
    throw new OmsCapabilityError(
      unavailable ? "capability_not_available" : "capability_not_ready",
      unavailable
        ? "That OMS capability is not available to the Assistant."
        : "OMS contains this business report, but it is not yet available as a direct Assistant capability.",
    );
  }
  logOmsChatEvent("capability.validation_completed", {
    capability_id: capability.id,
    source_kind: capability.sourceOfTruth.kind,
    filter_names: Object.keys(request.filters || {}),
    operation_type: request.operation?.type || "summary",
  });
  const startedAt = Date.now();
  logOmsChatEvent("capability.execution_started", { capability_id: capability.id });
  try {
    const adapter = CAPABILITY_ADAPTERS[capability.id];
    const result = await adapter({
      filters: request.filters || {},
      operation: request.operation || {},
    }, dependencies);
    const normalized = {
      success: true,
      factuality: "fact",
      capability: {
        ...safeCapabilityMetadata(capability),
        auditId: capability.auditId,
        sourceClass: capability.sourceClass,
      },
      ...result,
      filters: result.appliedFilters,
      groups: result.grouped,
      provenance: {
        ...result.provenance,
        routePermissions: routePermissions(capability),
      },
      durationMs: Date.now() - startedAt,
    };
    logOmsChatEvent("capability.execution_completed", {
      capability_id: capability.id,
      source_kind: capability.sourceOfTruth.kind,
      returned_rows: normalized.rows.length,
      returned_groups: normalized.grouped.length,
      truncated: normalized.truncated,
      duration_ms: normalized.durationMs,
    });
    return normalized;
  } catch (error) {
    if (error instanceof OmsCapabilityError) throw error;
    logOmsChatError("capability.execution_failed", error, {
      capability_id: capability.id,
      source_kind: capability.sourceOfTruth.kind,
      duration_ms: Date.now() - startedAt,
    });
    throw error;
  }
};

const findRelevantCapabilities = (question, options = {}) => findPlannedCapabilities({ question, ...options });
const getCanonicalCapabilityRequirement = (question) => getCanonicalCapabilityGuidance(question, {
  adapterIds: Object.keys(CAPABILITY_ADAPTERS),
});
const buildKnowledgeCapabilityContext = (capabilities = []) => buildCapabilityPlannerContext({
  capabilities,
  adapterIds: Object.keys(CAPABILITY_ADAPTERS),
});

module.exports = {
  CAPABILITY_ADAPTERS,
  CAPABILITY_TIMEOUT_MS,
  MAX_CAPABILITY_ROWS,
  OmsCapabilityError,
  assertAdapterRegistryMatchesKnowledgeBase,
  executeOmsCapability,
  findRelevantCapabilities,
  getCanonicalCapabilityRequirement,
  buildKnowledgeCapabilityContext,
  __test__: {
    executeMonthlyShipments,
    executePackedGoods,
    executeShipmentCbm,
    getReadOnlyModels,
    groupRows,
    normalizeMonthlyShipmentFilters,
    normalizePackedGoodsFilters,
    normalizeShipmentCbmFilters,
    postProcess,
    validateOperation,
  },
};

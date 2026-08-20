const Order = require("../models/order.model");
const Item = require("../models/item.model");
const Qc = require("../models/qc.model");
const { buildPackedGoodsDataset } = require("./packedGoods.service");
const {
  fetchMonthlyShipmentContributionRows,
  getMonthlyShipmentsReportData,
} = require("./monthlyShipmentsReport.service");
const { getOmsChatConnection } = require("./omsChatQuery.service");
const {
  getCapability,
  listCapabilities,
  searchCapabilities,
} = require("./omsKnowledgeBase.service");
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
  if (fromDate && toDate && fromDate > toDate) {
    throw new OmsCapabilityError("invalid_capability_filter", "from_date cannot be after to_date.");
  }
  for (const field of ["country", "brand", "vendor"]) {
    const value = cleanText(filters[field], field);
    if (value) query[field] = value;
  }
  return query;
};

const validateOperation = (operation = {}, { fields, numericFields }) => {
  assertPlainObject(operation, "operation");
  assertAllowedKeys(
    operation,
    new Set(["type", "groupBy", "metrics", "sort", "limit"]),
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
    assertAllowedKeys(metric, new Set(["operation", "field", "as"]), "invalid_capability_metric", "Capability metric contains an unsupported setting.");
    const aggregation = cleanText(metric.operation, "metric operation", { optional: false }).toLowerCase();
    const field = cleanText(metric.field, "metric field", { optional: false });
    const as = cleanText(metric.as, "metric alias", { optional: false });
    if (!["sum", "count", "avg", "min", "max"].includes(aggregation)
      || (!numericFields.has(field) && !(aggregation === "count" && field === "*"))
      || !SAFE_NAME.test(as)
      || BLOCKED_KEYS.has(as)) {
      throw new OmsCapabilityError("invalid_capability_metric", "Capability metric is not allowed.");
    }
    return { operation: aggregation, field, as };
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
  return { type, groupBy, metrics: normalizedMetrics, sort: normalizedSort, limit };
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
  const processed = operation.type === "group" ? groupRows(rows, operation) : [...rows];
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
  const dataset = await builder({ ...normalizedFilters, user: null }, {
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
    user: null,
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

const CAPABILITY_ADAPTERS = Object.freeze({
  packed_goods: executePackedGoods,
  monthly_shipments: executeMonthlyShipments,
});

const assertAdapterRegistryMatchesKnowledgeBase = () => {
  const eligible = listCapabilities({ assistantStatus: "tool_eligible" }).map((entry) => entry.id).sort();
  const registered = Object.keys(CAPABILITY_ADAPTERS).sort();
  if (JSON.stringify(eligible) !== JSON.stringify(registered)) {
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
  if (capability.assistantStatus !== "tool_eligible" || !CAPABILITY_ADAPTERS[capability.id]) {
    throw new OmsCapabilityError("capability_not_available", "That OMS capability is not available to the Assistant.");
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
      capability: safeCapabilityMetadata(capability),
      ...result,
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

const strongIntentCapabilityIds = (question) => {
  const text = String(question || "").toLowerCase();
  const ids = [];
  if (/(packed goods|goods ready|ready goods|ready\s+cbm|ready to ship|available to ship|inspected but unshipped|next container)/i.test(text)) {
    ids.push("packed_goods");
  }
  if (/(monthly shipments|containers? shipped|shipped last month)/i.test(text)) {
    ids.push("monthly_shipments");
  }
  return ids;
};

const findRelevantCapabilities = (question, { limit = 5 } = {}) => {
  const preferred = strongIntentCapabilityIds(question).map(getCapability).filter(Boolean);
  const searched = searchCapabilities(question, { limit: 12 });
  return [...new Map([...preferred, ...searched].map((entry) => [entry.id, entry])).values()]
    .filter((capability) => capability.assistantStatus !== "documented_not_tool_eligible")
    .slice(0, Math.max(1, Math.min(6, limit)));
};

const getCanonicalCapabilityRequirement = (question) => {
  const text = String(question || "").toLowerCase();
  if (/(packed goods|goods ready|ready goods|ready\s+cbm|ready to ship|available to ship|inspected but unshipped|shipment[- ]ready volume)/i.test(text)) {
    return getCapability("packed_goods");
  }
  if (/(monthly shipments|how many containers? shipped|containers? shipped last month)/i.test(text)) {
    return getCapability("monthly_shipments");
  }
  return null;
};

const buildKnowledgeCapabilityContext = (capabilities = []) => (
  capabilities.length
    ? capabilities.map((capability) => {
        const inputs = capability.inputs?.length ? ` Supported filters: ${capability.inputs.join(", ")}.` : "";
        const priority = capability.assistantStatus === "tool_eligible"
          ? " Use the canonical capability before rebuilding this concept from raw data."
          : " This capability is already represented by an existing bounded Assistant path.";
        return `- ${capability.id} (${capability.name}): ${capability.description}${inputs}${priority}`;
      }).join("\n")
    : "- No strong canonical capability match was found; safe schema inspection or raw Mongo investigation may be used."
);

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
    getReadOnlyModels,
    groupRows,
    normalizeMonthlyShipmentFilters,
    normalizePackedGoodsFilters,
    postProcess,
    validateOperation,
  },
};

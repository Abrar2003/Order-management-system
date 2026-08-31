const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const Item = require("../models/item.model");
const { parseDateOnly, toDateOnlyIso } = require("../helpers/dateOnly");
const { deriveOrderProgress } = require("../helpers/orderStatus");
const { isQualifyingPackedInspection } = require("../helpers/inspectionPassedQuantity");
const { getVendorName, normalizeVendorDisplayList } = require("../helpers/vendorRef");
const {
  resolveOrderRowCbmSummary,
  toPositiveCbmNumber,
  toRoundedCbmValue,
} = require("./shipmentCbmAllocation.service");
const { applyDataAccessMatch } = require("./userDataAccess.service");
const {
  ACTIVE_ORDER_MATCH,
  fetchPackedGoodsItems,
} = require("./packedGoods.service");

const NON_PACKED_INSPECTION_STATUSES = [
  "goods not ready",
  "rejected",
  "shifted for later",
  "transfered",
  "transferred",
];
const INVALID_TEXT_VALUES = new Set(["[object Object]", "undefined", "null"]);

class PackedGoodsPeriodValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PackedGoodsPeriodValidationError";
    this.statusCode = 400;
  }
}

const normalizePrimitiveString = (value) => {
  const text = String(value ?? "").trim();
  return INVALID_TEXT_VALUES.has(text) ? "" : text;
};
const normalizeLooseString = (value) => getVendorName(value) || normalizePrimitiveString(value);
const normalizeBrandKey = (value) => normalizeLooseString(value).toLowerCase();
const normalizeOrderKey = (value) => {
  const normalized = normalizeLooseString(value);
  if (!normalized) return "";
  return /^\d+\.0+$/.test(normalized)
    ? normalized.replace(/\.0+$/, "")
    : normalized.toUpperCase();
};
const normalizeFilterValue = (value) => {
  const cleaned = normalizePrimitiveString(value);
  return !cleaned || ["all", "undefined", "null"].includes(cleaned.toLowerCase())
    ? null
    : cleaned;
};
const normalizeFilterValues = (value) => [
  ...new Set(
    (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
      .flatMap((entry) => String(entry ?? "").split(","))
      .map((entry) => String(entry ?? "").trim())
      .filter((entry) => entry && !["all", "undefined", "null"].includes(entry.toLowerCase())),
  ),
].sort((left, right) => left.localeCompare(right));
const normalizeDistinctValues = (values = []) => [
  ...new Set((Array.isArray(values) ? values : []).map(normalizeLooseString).filter(Boolean)),
].sort((left, right) => left.localeCompare(right));
const idString = (value) => String(value?._id || value || "").trim();
const withMaxTime = (query, maxTimeMS) => (
  Number(maxTimeMS) > 0 && typeof query?.maxTimeMS === "function"
    ? query.maxTimeMS(Number(maxTimeMS))
    : query
);

const addUtcDays = (date, days) => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const resolvePackedGoodsPeriod = ({ fromDate = "", toDate = "", now = new Date() } = {}) => {
  const normalizedFrom = normalizePrimitiveString(fromDate);
  const normalizedTo = normalizePrimitiveString(toDate);
  if (Boolean(normalizedFrom) !== Boolean(normalizedTo)) {
    throw new PackedGoodsPeriodValidationError("From and To dates must be supplied together.");
  }

  if (!normalizedFrom) {
    const today = parseDateOnly(toDateOnlyIso(now));
    const daysSinceTuesday = (today.getUTCDay() - 2 + 7) % 7;
    const start = addUtcDays(today, -daysSinceTuesday);
    return {
      from_date: toDateOnlyIso(start),
      to_date: toDateOnlyIso(addUtcDays(start, 6)),
      is_default_week: true,
    };
  }

  const parsedFrom = parseDateOnly(normalizedFrom);
  const parsedTo = parseDateOnly(normalizedTo);
  if (!parsedFrom || !parsedTo) {
    throw new PackedGoodsPeriodValidationError("From and To must be valid YYYY-MM-DD dates.");
  }
  if (parsedFrom > parsedTo) {
    throw new PackedGoodsPeriodValidationError("From date cannot be later than To date.");
  }
  return {
    from_date: toDateOnlyIso(parsedFrom),
    to_date: toDateOnlyIso(parsedTo),
    is_default_week: false,
  };
};

const inspectionMatch = (dateMatch, extra = {}) => ({
  ...extra,
  inspection_date: dateMatch,
  passed: { $gt: 0 },
  status: { $nin: NON_PACKED_INSPECTION_STATUSES },
});

const fetchSelectedPeriodInspections = async ({
  fromDate,
  toDate,
  InspectionModel = Inspection,
  maxTimeMS,
} = {}) => {
  const query = InspectionModel.find(inspectionMatch({ $gte: fromDate, $lte: toDate }))
    .select("_id qc inspector inspection_date requested_date request_history_id status passed vendor_requested goods_not_ready createdAt")
    .sort({ inspection_date: 1, _id: 1 });
  return withMaxTime(query, maxTimeMS).lean();
};

const fetchPackedGoodsPeriodQcs = async ({
  qcIds,
  QcModel = QC,
  maxTimeMS,
} = {}) => {
  if (!qcIds.length) return [];
  const query = QcModel.find({ _id: { $in: qcIds } })
    .select("_id order order_meta item");
  return withMaxTime(query, maxTimeMS).lean();
};

const fetchPackedGoodsPeriodOrders = async ({
  orderIds,
  user,
  OrderModel = Order,
  maxTimeMS,
} = {}) => {
  if (!orderIds.length) return [];
  const query = OrderModel.find(applyDataAccessMatch(
    { ...ACTIVE_ORDER_MATCH, order_id: { $in: orderIds } },
    user,
  ))
    .select("order_id item brand vendor quantity shipment qc_record order_date updatedAt total_po_cbm")
    .populate({
      path: "qc_record",
      select: "_id request_type request_history quantities order_meta item",
    })
    .sort({ order_date: -1, updatedAt: -1, order_id: 1 });
  return withMaxTime(query, maxTimeMS).lean();
};

const fetchPackedGoodsHistoryInspections = async ({
  qcIds,
  toDate,
  InspectionModel = Inspection,
  maxTimeMS,
} = {}) => {
  if (!qcIds.length) return [];
  const query = InspectionModel.find(inspectionMatch(
    { $lte: toDate },
    { qc: { $in: qcIds } },
  ))
    .select("_id qc inspector inspection_date requested_date request_history_id status passed vendor_requested goods_not_ready createdAt")
    .sort({ inspection_date: 1, _id: 1 });
  return withMaxTime(query, maxTimeMS).lean();
};

const resolveShipmentQuantityAsOf = (shipmentEntries = [], toDate = "") => {
  let quantity = 0;
  let undatedCount = 0;
  for (const shipment of Array.isArray(shipmentEntries) ? shipmentEntries : []) {
    const shipmentQuantity = Math.max(0, Number(shipment?.quantity || 0));
    if (shipmentQuantity <= 0) continue;
    const shipmentDate = toDateOnlyIso(shipment?.stuffing_date);
    if (!shipmentDate) {
      quantity += shipmentQuantity;
      undatedCount += 1;
    } else if (shipmentDate <= toDate) {
      quantity += shipmentQuantity;
    }
  }
  return { quantity, undatedCount };
};

const allocatePackedQuantities = ({
  orderQuantity = 0,
  previouslyPassed = 0,
  periodPassed = 0,
  shippedAsOf = 0,
} = {}) => {
  const quantity = Math.max(0, Number(orderQuantity || 0));
  const previousAccepted = Math.min(quantity, Math.max(0, Number(previouslyPassed || 0)));
  const periodAccepted = Math.min(
    Math.max(0, quantity - previousAccepted),
    Math.max(0, Number(periodPassed || 0)),
  );
  const shipped = Math.min(quantity, Math.max(0, Number(shippedAsOf || 0)));
  const previouslyPacked = Math.max(0, previousAccepted - shipped);
  const periodPacked = Math.max(
    0,
    periodAccepted - Math.max(0, shipped - previousAccepted),
  );
  return {
    previously_packed_quantity: previouslyPacked,
    period_packed_quantity: periodPacked,
    total_packed_quantity: previouslyPacked + periodPacked,
  };
};

const resolvePackedCbm = (orderEntry, itemDoc, packedQuantity) => {
  const calculated = resolveOrderRowCbmSummary(itemDoc, packedQuantity);
  const calculatedTotal = toPositiveCbmNumber(calculated?.total);
  const orderQuantity = Math.max(0, Number(orderEntry?.quantity || 0));
  const storedPoCbm = toPositiveCbmNumber(orderEntry?.total_po_cbm);
  const storedPerItem = storedPoCbm > 0 && orderQuantity > 0
    ? toRoundedCbmValue(storedPoCbm / orderQuantity)
    : 0;
  const perItemCbm = calculatedTotal > 0 && packedQuantity > 0
    ? toRoundedCbmValue(calculatedTotal / packedQuantity)
    : storedPerItem || Number(calculated?.per_item || 0);
  return {
    total_packed_cbm: calculatedTotal > 0
      ? toRoundedCbmValue(calculatedTotal)
      : toRoundedCbmValue(perItemCbm * packedQuantity),
    per_item_cbm: Number.isFinite(perItemCbm) ? perItemCbm : 0,
    cbm_source: calculatedTotal > 0
      ? calculated?.source || null
      : storedPoCbm > 0 ? "total_po_cbm" : calculated?.source || null,
  };
};

const buildPackedGoodsPeriodDataset = async ({
  brands = [],
  vendor = "",
  orderId = "",
  fromDate = "",
  toDate = "",
  user = null,
} = {}, {
  now = new Date(),
  InspectionModel = Inspection,
  QcModel = QC,
  OrderModel = Order,
  ItemModel = Item,
  fetchSelectedInspections = fetchSelectedPeriodInspections,
  fetchQcs = fetchPackedGoodsPeriodQcs,
  fetchOrders = fetchPackedGoodsPeriodOrders,
  fetchHistoryInspections = fetchPackedGoodsHistoryInspections,
  fetchItems = fetchPackedGoodsItems,
  maxTimeMS,
} = {}) => {
  const period = resolvePackedGoodsPeriod({ fromDate, toDate, now });
  const selectedBrands = normalizeFilterValues(brands);
  const selectedBrandKeys = new Set(selectedBrands.map(normalizeBrandKey));
  const selectedVendor = normalizeFilterValue(vendor);
  const selectedOrderId = normalizeFilterValue(orderId);

  const selectedInspections = (await fetchSelectedInspections({
    fromDate: period.from_date,
    toDate: period.to_date,
    InspectionModel,
    maxTimeMS,
  })).filter(isQualifyingPackedInspection);
  const selectedQcIds = normalizeDistinctValues(selectedInspections.map((row) => idString(row?.qc)));
  const selectedQcs = await fetchQcs({ qcIds: selectedQcIds, QcModel, maxTimeMS });
  const relevantOrderIds = normalizeDistinctValues(
    selectedQcs.map((qc) => qc?.order_meta?.order_id),
  );
  const allPoOrders = await fetchOrders({
    orderIds: relevantOrderIds,
    user,
    OrderModel,
    maxTimeMS,
  });
  const selectedQcIdSet = new Set(selectedQcIds);
  const activityOrders = allPoOrders.filter((order) => selectedQcIdSet.has(idString(order?.qc_record)));

  const metadataRows = activityOrders.map((order) => ({
    brand: normalizeLooseString(order?.brand),
    vendor: normalizeLooseString(order?.vendor),
    order_id: normalizeOrderKey(order?.order_id),
  }));
  const brandFilteredMetadata = metadataRows.filter((row) => !selectedBrandKeys.size
    || selectedBrandKeys.has(normalizeBrandKey(row.brand)));
  const brandVendorFilteredMetadata = brandFilteredMetadata.filter((row) => !selectedVendor
    || row.vendor === selectedVendor);
  const filteredOrders = activityOrders.filter((order) => {
    const brand = normalizeLooseString(order?.brand);
    const vendorValue = normalizeLooseString(order?.vendor);
    const normalizedOrderId = normalizeOrderKey(order?.order_id);
    return (!selectedBrandKeys.size || selectedBrandKeys.has(normalizeBrandKey(brand)))
      && (!selectedVendor || vendorValue === selectedVendor)
      && (!selectedOrderId || normalizedOrderId === normalizeOrderKey(selectedOrderId));
  });

  const filteredQcIds = normalizeDistinctValues(filteredOrders.map((order) => idString(order?.qc_record)));
  const history = (await fetchHistoryInspections({
    qcIds: filteredQcIds,
    toDate: period.to_date,
    InspectionModel,
    maxTimeMS,
  })).filter(isQualifyingPackedInspection);
  const qcById = new Map(filteredOrders.map((order) => [
    idString(order?.qc_record),
    order?.qc_record,
  ]));
  const historyWithQc = history
    .map((inspection) => ({ ...inspection, qc: qcById.get(idString(inspection?.qc)) || null }))
    .filter((inspection) => inspection.qc);
  const quantitiesByQcId = new Map();
  for (const inspection of historyWithQc) {
    const qcId = idString(inspection?.qc);
    const inspectionDate = toDateOnlyIso(inspection?.inspection_date);
    if (!inspectionDate) continue;
    const packedQuantity = Math.max(0, Number(inspection?.passed || 0));
    if (packedQuantity <= 0) continue;
    const entry = quantitiesByQcId.get(qcId) || { previous: 0, period: 0 };
    if (inspectionDate < period.from_date) entry.previous += packedQuantity;
    else if (inspectionDate <= period.to_date) entry.period += packedQuantity;
    quantitiesByQcId.set(qcId, entry);
  }

  const poPendingQuantityMap = new Map();
  for (const order of allPoOrders) {
    const progress = deriveOrderProgress({ orderEntry: order });
    const poKey = [
      normalizeOrderKey(order?.order_id) || "N/A",
      normalizeLooseString(order?.brand) || "N/A",
      normalizeLooseString(order?.vendor) || "N/A",
    ].join("__");
    poPendingQuantityMap.set(
      poKey,
      (poPendingQuantityMap.get(poKey) || 0)
        + Math.max(0, Number(progress?.pending_inspection_quantity || 0)),
    );
  }

  const itemCodes = normalizeDistinctValues(filteredOrders.map((order) => order?.item?.item_code));
  const itemDocs = await fetchItems({ itemCodes, user, ItemModel, maxTimeMS });
  const itemMap = new Map(itemDocs.map((item) => [normalizeLooseString(item?.code).toLowerCase(), item]));
  let undatedShipmentCount = 0;
  const rows = filteredOrders.map((order) => {
    const qcId = idString(order?.qc_record);
    const quantities = quantitiesByQcId.get(qcId) || { previous: 0, period: 0 };
    if (quantities.period <= 0) return null;
    const shipment = resolveShipmentQuantityAsOf(order?.shipment, period.to_date);
    undatedShipmentCount += shipment.undatedCount;
    const allocated = allocatePackedQuantities({
      orderQuantity: order?.quantity,
      previouslyPassed: quantities.previous,
      periodPassed: quantities.period,
      shippedAsOf: shipment.quantity,
    });
    const brand = normalizeLooseString(order?.brand) || "N/A";
    const vendorValue = normalizeLooseString(order?.vendor) || "N/A";
    const normalizedOrderId = normalizeOrderKey(order?.order_id) || "N/A";
    const itemCode = normalizeLooseString(order?.item?.item_code) || "N/A";
    const cbm = resolvePackedCbm(
      order,
      itemMap.get(itemCode.toLowerCase()) || null,
      allocated.total_packed_quantity,
    );
    const poKey = [normalizedOrderId, brand, vendorValue].join("__");
    return {
      id: idString(order),
      qc_id: qcId,
      order_id: normalizedOrderId,
      order_date: toDateOnlyIso(order?.order_date),
      item_code: itemCode,
      brand,
      vendor: vendorValue,
      order_quantity: Math.max(0, Number(order?.quantity || 0)),
      ...allocated,
      shipped_quantity: shipment.quantity,
      ...cbm,
      po_has_no_pending_quantity: Number(poPendingQuantityMap.get(poKey) || 0) <= 0,
      packed_quantity: allocated.total_packed_quantity,
      total_cbm: cbm.total_packed_cbm,
    };
  }).filter(Boolean);

  const historicalLimitations = undatedShipmentCount > 0
    ? [`${undatedShipmentCount} legacy shipment record(s) had no stuffing date and were conservatively treated as shipped before the report cutoff.`]
    : [];
  const brandFilterSource = selectedVendor
    ? metadataRows.filter((row) => row.vendor === selectedVendor)
    : metadataRows;

  return {
    rows,
    filters: {
      from_date: period.from_date,
      to_date: period.to_date,
      brand: selectedBrands,
      vendor: selectedVendor || "",
      order_id: selectedOrderId ? normalizeOrderKey(selectedOrderId) : "",
      brands: normalizeDistinctValues(brandFilterSource.map((row) => row.brand)),
      vendors: normalizeVendorDisplayList(brandFilteredMetadata.map((row) => row.vendor)),
      order_ids: normalizeDistinctValues(brandVendorFilteredMetadata.map((row) => row.order_id)),
      is_default_week: period.is_default_week,
    },
    summary: {
      rows: rows.length,
      total_rows: rows.length,
      previously_packed_quantity: rows.reduce((sum, row) => sum + row.previously_packed_quantity, 0),
      period_packed_quantity: rows.reduce((sum, row) => sum + row.period_packed_quantity, 0),
      total_packed_quantity: rows.reduce((sum, row) => sum + row.total_packed_quantity, 0),
      shipped_quantity: rows.reduce((sum, row) => sum + row.shipped_quantity, 0),
      total_packed_cbm: toRoundedCbmValue(rows.reduce((sum, row) => sum + row.total_packed_cbm, 0)),
      total_cbm: toRoundedCbmValue(rows.reduce((sum, row) => sum + row.total_packed_cbm, 0)),
    },
    warnings: historicalLimitations,
    historical_limitations: historicalLimitations,
  };
};

module.exports = {
  NON_PACKED_INSPECTION_STATUSES,
  PackedGoodsPeriodValidationError,
  allocatePackedQuantities,
  buildPackedGoodsPeriodDataset,
  fetchPackedGoodsHistoryInspections,
  fetchPackedGoodsPeriodOrders,
  fetchPackedGoodsPeriodQcs,
  fetchSelectedPeriodInspections,
  resolvePackedGoodsPeriod,
  resolveShipmentQuantityAsOf,
};

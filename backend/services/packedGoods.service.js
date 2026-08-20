const Order = require("../models/order.model");
const Item = require("../models/item.model");
const { parseDateOnly, toDateOnlyIso } = require("../helpers/dateOnly");
const { deriveOrderProgress } = require("../helpers/orderStatus");
const { getVendorName, normalizeVendorDisplayList } = require("../helpers/vendorRef");
const {
  resolveOrderRowCbmSummary,
  toPositiveCbmNumber,
  toRoundedCbmValue,
} = require("./shipmentCbmAllocation.service");
const { applyDataAccessMatch } = require("./userDataAccess.service");

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVE_ORDER_MATCH = {
  $and: [{ archived: { $ne: true } }, { status: { $ne: "Cancelled" } }],
};
const INVALID_TEXT_VALUES = new Set(["[object Object]", "undefined", "null"]);

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
  if (value === undefined || value === null) return null;
  const cleaned = normalizePrimitiveString(value);
  return !cleaned || ["all", "undefined", "null"].includes(cleaned.toLowerCase())
    ? null
    : cleaned;
};
const normalizeDistinctValues = (values = []) => [
  ...new Set(
    (Array.isArray(values) ? values : [values])
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => getVendorName(value) || normalizePrimitiveString(value))
      .filter(Boolean),
  ),
].sort((left, right) => left.localeCompare(right));
const normalizeFilterValues = (value) => normalizeDistinctValues(
  (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
    .flatMap((entry) => String(entry ?? "").split(","))
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry && !["all", "undefined", "null"].includes(entry.toLowerCase())),
);
const toUtcDayStart = (value) => {
  const parsed = parseDateOnly(value);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
};
const withMaxTime = (query, maxTimeMS) => (
  Number(maxTimeMS) > 0 && typeof query?.maxTimeMS === "function"
    ? query.maxTimeMS(Number(maxTimeMS))
    : query
);
const applyOptionalDataAccessMatch = (match, user, options) => (
  user ? applyDataAccessMatch(match, user, options) : match
);

const fetchPackedGoodsOrders = async ({
  orderMatch,
  user,
  OrderModel = Order,
  maxTimeMS,
} = {}) => {
  const query = OrderModel.find(applyOptionalDataAccessMatch(orderMatch, user))
    .select("order_id item brand vendor quantity shipment qc_record order_date updatedAt total_po_cbm")
    .populate({
      path: "qc_record",
      select: "quantities request_history last_inspected_date inspection_dates",
    })
    .sort({ order_date: -1, updatedAt: -1, order_id: 1 });
  return withMaxTime(query, maxTimeMS).lean();
};

const fetchPackedGoodsItems = async ({
  itemCodes,
  user,
  ItemModel = Item,
  maxTimeMS,
} = {}) => {
  if (!itemCodes.length) return [];
  const query = ItemModel.find(applyOptionalDataAccessMatch(
    { code: { $in: itemCodes } },
    user,
    { brandFields: ["brand", "brand_name", "brands"], vendorFields: ["vendors"] },
  )).select([
    "code", "cbm", "inspected_item_sizes", "inspected_item_LBH",
    "inspected_item_top_LBH", "inspected_item_bottom_LBH", "inspected_box_sizes",
    "inspected_box_mode", "inspected_box_LBH", "inspected_box_top_LBH",
    "inspected_box_bottom_LBH", "inspected_top_LBH", "inspected_bottom_LBH",
    "pis_item_sizes", "pis_item_LBH", "pis_item_top_LBH", "pis_item_bottom_LBH",
    "pis_box_sizes", "pis_box_mode", "pis_box_LBH", "pis_box_top_LBH",
    "pis_box_bottom_LBH",
  ].join(" "));
  return withMaxTime(query, maxTimeMS).lean();
};

const buildPackedGoodsDataset = async ({
  brands = [],
  vendor = "",
  orderId = "",
  fromDate = "",
  toDate = "",
  user = null,
} = {}, {
  OrderModel = Order,
  ItemModel = Item,
  fetchOrders = fetchPackedGoodsOrders,
  fetchItems = fetchPackedGoodsItems,
  maxTimeMS,
} = {}) => {
  const selectedBrands = normalizeFilterValues(brands);
  const selectedBrandKeys = new Set(selectedBrands.map(normalizeBrandKey));
  const selectedVendor = normalizeFilterValue(vendor);
  const selectedOrderId = normalizeFilterValue(orderId);
  const dateMatch = {};
  const parsedFromDate = toUtcDayStart(fromDate);
  const parsedToDate = toUtcDayStart(toDate);
  if (parsedFromDate) dateMatch.$gte = parsedFromDate;
  if (parsedToDate) dateMatch.$lt = new Date(parsedToDate.getTime() + MS_PER_DAY);
  const orderMatch = Object.keys(dateMatch).length
    ? { ...ACTIVE_ORDER_MATCH, order_date: dateMatch }
    : ACTIVE_ORDER_MATCH;
  const orders = await fetchOrders({ orderMatch, user, OrderModel, maxTimeMS });
  const itemCodes = [...new Set(
    (Array.isArray(orders) ? orders : [])
      .map((entry) => normalizeLooseString(entry?.item?.item_code))
      .filter(Boolean),
  )];
  const itemDocs = await fetchItems({ itemCodes, user, ItemModel, maxTimeMS });
  const itemMap = new Map((Array.isArray(itemDocs) ? itemDocs : []).map((entry) => [
    normalizeLooseString(entry?.code).toLowerCase(),
    entry,
  ]));
  const poPendingQuantityMap = new Map();

  for (const orderEntry of Array.isArray(orders) ? orders : []) {
    const progress = deriveOrderProgress({ orderEntry });
    const poKey = [
      normalizeOrderKey(orderEntry?.order_id) || "N/A",
      normalizeLooseString(orderEntry?.brand) || "N/A",
      normalizeLooseString(orderEntry?.vendor) || "N/A",
    ].join("__");
    poPendingQuantityMap.set(
      poKey,
      (poPendingQuantityMap.get(poKey) || 0)
        + Math.max(0, Number(progress?.pending_inspection_quantity || 0)),
    );
  }

  const allRows = (Array.isArray(orders) ? orders : []).map((orderEntry) => {
    const progress = deriveOrderProgress({ orderEntry });
    const packedQuantity = Math.max(0, Number(progress?.inspected_unshipped_quantity || 0));
    if (packedQuantity <= 0) return null;
    const brand = normalizeLooseString(orderEntry?.brand);
    const vendorValue = normalizeLooseString(orderEntry?.vendor);
    const itemCode = normalizeLooseString(orderEntry?.item?.item_code);
    const itemDoc = itemMap.get(itemCode.toLowerCase()) || null;
    const storedPoCbm = toPositiveCbmNumber(orderEntry?.total_po_cbm);
    const orderQuantity = Math.max(0, Number(orderEntry?.quantity || 0));
    const cbmSummary = resolveOrderRowCbmSummary(itemDoc, packedQuantity);
    const calculatedPackedCbm = toPositiveCbmNumber(cbmSummary?.total);
    const storedPerItemCbm = storedPoCbm > 0 && orderQuantity > 0
      ? toRoundedCbmValue(storedPoCbm / orderQuantity)
      : 0;
    const perItemCbm = calculatedPackedCbm > 0 && packedQuantity > 0
      ? toRoundedCbmValue(calculatedPackedCbm / packedQuantity)
      : storedPerItemCbm || Number(cbmSummary?.per_item || 0);
    const totalCbm = calculatedPackedCbm > 0
      ? toRoundedCbmValue(calculatedPackedCbm)
      : toRoundedCbmValue(perItemCbm * packedQuantity);
    const cbmSource = calculatedPackedCbm > 0
      ? cbmSummary?.source || null
      : storedPoCbm > 0 ? "total_po_cbm" : cbmSummary?.source || null;
    const normalizedOrderId = normalizeOrderKey(orderEntry?.order_id) || "N/A";
    const poKey = [normalizedOrderId, brand || "N/A", vendorValue || "N/A"].join("__");

    return {
      id: String(orderEntry?._id || ""),
      order_id: normalizedOrderId,
      order_date: toDateOnlyIso(orderEntry?.order_date),
      item_code: itemCode || "N/A",
      brand: brand || "N/A",
      vendor: vendorValue || "N/A",
      order_quantity: orderQuantity,
      packed_quantity: packedQuantity,
      pending_quantity: Math.max(0, Number(progress?.pending_inspection_quantity || 0)),
      po_has_no_pending_quantity: Number(poPendingQuantityMap.get(poKey) || 0) <= 0,
      total_cbm: Number.isFinite(totalCbm) ? totalCbm : 0,
      per_item_cbm: Number.isFinite(perItemCbm) ? perItemCbm : 0,
      cbm_source: cbmSource,
    };
  }).filter(Boolean);

  const brandFilteredRows = allRows.filter((row) => !selectedBrandKeys.size
    || selectedBrandKeys.has(normalizeBrandKey(row?.brand)));
  const brandVendorFilteredRows = brandFilteredRows.filter((row) => !selectedVendor
    || normalizeLooseString(row?.vendor) === selectedVendor);
  const rows = selectedOrderId
    ? brandVendorFilteredRows.filter((row) => normalizeOrderKey(row?.order_id) === normalizeOrderKey(selectedOrderId))
    : brandVendorFilteredRows;
  const brandFilterSource = selectedVendor
    ? allRows.filter((row) => normalizeLooseString(row?.vendor) === selectedVendor)
    : allRows;

  return {
    rows,
    filters: {
      brands: normalizeDistinctValues(brandFilterSource.map((row) => row?.brand)),
      vendors: normalizeVendorDisplayList(brandFilteredRows.map((row) => row?.vendor)),
      order_ids: normalizeDistinctValues(brandVendorFilteredRows.map((row) => row?.order_id)),
    },
    summary: {
      total_rows: rows.length,
      total_packed_quantity: rows.reduce((sum, row) => sum + Number(row?.packed_quantity || 0), 0),
      total_cbm: toRoundedCbmValue(rows.reduce((sum, row) => sum + Number(row?.total_cbm || 0), 0)),
    },
  };
};

module.exports = {
  ACTIVE_ORDER_MATCH,
  buildPackedGoodsDataset,
  fetchPackedGoodsItems,
  fetchPackedGoodsOrders,
};

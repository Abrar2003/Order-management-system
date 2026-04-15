const XLSX = require("xlsx");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const UploadLog = require("../models/uploadLog.model");
const OrderEditLog = require("../models/orderEditLog.model");
const mongoose = require("mongoose");
const dateParser = require("../helpers/dateparsser");
const {
  formatDateOnlyDDMMYYYY,
  parseDateOnly,
  parseDateTime,
  toDateOnlyIso,
} = require("../helpers/dateOnly");
const {
  ORDER_STATUS_SEQUENCE,
  deriveGroupedOrderStatus,
  deriveOrderProgress,
  deriveOrderStatus,
  normalizeOrderStatus,
} = require("../helpers/orderStatus");
const {
  syncOrderGroup,
  purgeOmsEventsForConfiguredBrandCalendars,
} = require("../services/gcalSync");
const {
  upsertItemsFromOrders,
  upsertItemFromOrder,
} = require("../services/itemSync");
const {
  extractTableRowsFromPdfBuffer,
} = require("../services/pdfRectifyParser.service");
const {
  isConfigured: isWasabiConfigured,
  createStorageKey,
  uploadBuffer,
} = require("../services/wasabiStorage.service");

const DEFAULT_PO_STATUS_REPORT_STATUS = "Inspection Done";
const PO_STATUS_REPORT_STATUS_OPTIONS = [
  "Partially Inspected",
  "Inspection Done",
];

const SHIPMENT_VISIBLE_STATUSES = [
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECTIFY_DEFAULT_ETD_OFFSET_DAYS = 60;
const INVALID_DATE_RANGE = Symbol("invalid-date-range");

const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeFilterValue = (value) => {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  const lowered = cleaned.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return null;
  }
  return cleaned;
};

const parsePositiveInt = (value, fallback) => {
  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue < 1) {
    return fallback;
  }
  return parsedValue;
};

const withTimeout = (promise, timeoutMs, label = "operation") =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const normalizeDistinctValues = (values = []) =>
  [
    ...new Set(
      values.map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

const normalizeLooseString = (value) => String(value ?? "").trim();
const normalizeShipmentInvoiceNumber = (value, fallback = "N/A") => {
  const normalized = String(value ?? "").trim();
  if (normalized) return normalized;
  return String(fallback ?? "").trim();
};
const toPositiveCbmNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

const toRoundedCbmValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(6));
};

const calculateCbmFromLbh = (dimensions = {}) => {
  const length = Math.max(0, Number(dimensions?.L || 0));
  const breadth = Math.max(0, Number(dimensions?.B || 0));
  const height = Math.max(0, Number(dimensions?.H || 0));
  if (!Number.isFinite(length) || !Number.isFinite(breadth) || !Number.isFinite(height)) {
    return 0;
  }
  if (length <= 0 || breadth <= 0 || height <= 0) return 0;
  return (length * breadth * height) / 1000000;
};

const resolveSplitOrSingleLbhCbmTotal = ({
  topLbh = null,
  bottomLbh = null,
  singleLbh = null,
} = {}) => {
  const topCbm = toPositiveCbmNumber(calculateCbmFromLbh(topLbh));
  const bottomCbm = toPositiveCbmNumber(calculateCbmFromLbh(bottomLbh));
  if (topCbm > 0 && bottomCbm > 0) {
    return topCbm + bottomCbm;
  }

  return toPositiveCbmNumber(calculateCbmFromLbh(singleLbh));
};

const resolveOrderRowCbmSummary = (itemDoc = null, orderQuantity = 0) => {
  if (!itemDoc || typeof itemDoc !== "object") {
    return {
      source: null,
      per_item: null,
      total: null,
    };
  }

  const inspectedStoredCbm = [
    itemDoc?.cbm?.calculated_inspected_total,
    itemDoc?.cbm?.inspected_total,
  ]
    .map((value) => toPositiveCbmNumber(value))
    .find((value) => value > 0);
  if (inspectedStoredCbm > 0) {
    const perItem = toRoundedCbmValue(inspectedStoredCbm);
    return {
      source: "inspected",
      per_item: perItem,
      total: toRoundedCbmValue(Math.max(0, Number(orderQuantity || 0)) * perItem),
    };
  }

  const pisTopCbm = toPositiveCbmNumber(itemDoc?.cbm?.top);
  const pisBottomCbm = toPositiveCbmNumber(itemDoc?.cbm?.bottom);
  if (pisTopCbm > 0 && pisBottomCbm > 0) {
    const perItem = toRoundedCbmValue(pisTopCbm + pisBottomCbm);
    return {
      source: "pis",
      per_item: perItem,
      total: toRoundedCbmValue(Math.max(0, Number(orderQuantity || 0)) * perItem),
    };
  }

  const pisStoredCbm = [
    itemDoc?.cbm?.calculated_pis_total,
    itemDoc?.cbm?.total,
  ]
    .map((value) => toPositiveCbmNumber(value))
    .find((value) => value > 0);
  if (pisStoredCbm > 0) {
    const perItem = toRoundedCbmValue(pisStoredCbm);
    return {
      source: "pis",
      per_item: perItem,
      total: toRoundedCbmValue(Math.max(0, Number(orderQuantity || 0)) * perItem),
    };
  }

  const inspectedLbhCbm = resolveSplitOrSingleLbhCbmTotal({
    topLbh:
      itemDoc?.inspected_box_top_LBH ||
      itemDoc?.inspected_top_LBH ||
      itemDoc?.inspected_item_top_LBH,
    bottomLbh:
      itemDoc?.inspected_box_bottom_LBH ||
      itemDoc?.inspected_bottom_LBH ||
      itemDoc?.inspected_item_bottom_LBH,
    singleLbh:
      itemDoc?.inspected_box_LBH ||
      itemDoc?.inspected_item_LBH,
  });
  if (inspectedLbhCbm > 0) {
    const perItem = toRoundedCbmValue(inspectedLbhCbm);
    return {
      source: "inspected",
      per_item: perItem,
      total: toRoundedCbmValue(Math.max(0, Number(orderQuantity || 0)) * perItem),
    };
  }

  const pisLbhCbm = resolveSplitOrSingleLbhCbmTotal({
    topLbh: itemDoc?.pis_box_top_LBH || itemDoc?.pis_item_top_LBH,
    bottomLbh: itemDoc?.pis_box_bottom_LBH || itemDoc?.pis_item_bottom_LBH,
    singleLbh: itemDoc?.pis_box_LBH || itemDoc?.pis_item_LBH,
  });
  if (pisLbhCbm > 0) {
    const perItem = toRoundedCbmValue(pisLbhCbm);
    return {
      source: "pis",
      per_item: perItem,
      total: toRoundedCbmValue(Math.max(0, Number(orderQuantity || 0)) * perItem),
    };
  }

  return {
    source: null,
    per_item: null,
    total: null,
  };
};

const normalizeBrandKey = (value) => normalizeLooseString(value).toLowerCase();

const normalizeVendorKey = (value) => normalizeLooseString(value).toLowerCase();

const normalizeBrandVendorKey = (brand, vendor) =>
  `${normalizeBrandKey(brand)}__${normalizeVendorKey(vendor)}`;

const normalizeOrderKey = (value) => {
  const normalized = normalizeLooseString(value);
  if (!normalized) return "";

  if (/^\d+\.0+$/.test(normalized)) {
    return normalized.replace(/\.0+$/, "");
  }

  return normalized.toUpperCase();
};

const normalizeStatusList = (values = []) => {
  const normalized = normalizeDistinctValues(values);
  return normalized.sort((a, b) => {
    const aIndex = ORDER_STATUS_SEQUENCE.indexOf(a);
    const bIndex = ORDER_STATUS_SEQUENCE.indexOf(b);

    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
};

const normalizePoStatusReportStatus = (value) => {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return DEFAULT_PO_STATUS_REPORT_STATUS;

  const matchedStatus = PO_STATUS_REPORT_STATUS_OPTIONS.find(
    (status) => status.toLowerCase() === normalized.toLowerCase(),
  );
  return matchedStatus || DEFAULT_PO_STATUS_REPORT_STATUS;
};

const createPoStatusCounts = () => ({
  pending: 0,
  under_inspection: 0,
  inspection_done: 0,
  partially_shipped: 0,
  shipped: 0,
});

const incrementPoStatusCounts = (counts, statusValue = "") => {
  const target = counts && typeof counts === "object" ? counts : createPoStatusCounts();
  const normalizedStatus = normalizeLooseString(statusValue).toLowerCase();

  if (normalizedStatus === "pending") {
    target.pending += 1;
  } else if (normalizedStatus === "under inspection") {
    target.under_inspection += 1;
  } else if (normalizedStatus === "inspection done") {
    target.inspection_done += 1;
  } else if (normalizedStatus === "partial shipped") {
    target.partially_shipped += 1;
  } else if (normalizedStatus === "shipped") {
    target.shipped += 1;
  }

  return target;
};

const sumPoStatusCounts = (baseCounts, nextCounts) => {
  const source = nextCounts && typeof nextCounts === "object" ? nextCounts : {};
  const target =
    baseCounts && typeof baseCounts === "object" ? baseCounts : createPoStatusCounts();

  target.pending += Number(source.pending || 0);
  target.under_inspection += Number(source.under_inspection || 0);
  target.inspection_done += Number(source.inspection_done || 0);
  target.partially_shipped += Number(source.partially_shipped || 0);
  target.shipped += Number(source.shipped || 0);

  return target;
};

const getPoOpenItemsCount = (counts = {}) =>
  Number(counts.pending || 0) + Number(counts.under_inspection || 0);

const getPoProgressedItemsCount = (counts = {}) =>
  Number(counts.inspection_done || 0) +
  Number(counts.partially_shipped || 0) +
  Number(counts.shipped || 0);

const getPoStatusTooltipShippedQuantity = (shipmentEntries = []) =>
  Math.max(0, Number(getShipmentQuantityTotal(shipmentEntries) || 0));

const getPoStatusTooltipOpenQuantity = (orderEntry = {}) => {
  return deriveOrderProgress({ orderEntry }).pending_inspection_quantity;
};

const buildPoStatusTooltipItem = (orderEntry = {}) => {
  const progress = deriveOrderProgress({ orderEntry });

  return {
    _id: String(orderEntry?._id || ""),
    order_id: normalizeOrderKey(orderEntry?.order_id || "") || "N/A",
    qc_id:
      String(orderEntry?.qc_record?._id || orderEntry?.qc_record || "").trim() ||
      null,
    item_code: normalizeLooseString(orderEntry?.item?.item_code || "") || "N/A",
    status: progress.status,
    order_quantity: progress.order_quantity,
    total_quantity: progress.order_quantity,
    open_quantity: getPoStatusTooltipOpenQuantity(orderEntry),
    shipped_quantity: getPoStatusTooltipShippedQuantity(orderEntry?.shipment),
  };
};

const ACTIVE_ORDER_MATCH = {
  $and: [{ archived: { $ne: true } }, { status: { $ne: "Cancelled" } }],
};

const buildArchivedByName = (user) =>
  String(user?.name || user?.username || user?.email || "").trim();

const buildAuditActor = (user = null) => ({
  user:
    user?._id && mongoose.Types.ObjectId.isValid(user._id) ? user._id : null,
  name: buildArchivedByName(user),
});

const normalizeRestorableArchivedStatus = (value) => {
  const normalized = normalizeLooseString(value);
  return ORDER_STATUS_SEQUENCE.includes(normalized) ? normalized : "";
};

const buildArchivedOrderLookupKey = (orderEntry = {}) =>
  [
    normalizeLooseString(orderEntry?.order_id),
    normalizeLooseString(orderEntry?.brand),
    normalizeLooseString(orderEntry?.vendor),
    normalizeLooseString(orderEntry?.item_code ?? orderEntry?.item?.item_code),
  ]
    .join("__")
    .toLowerCase();

const resolveArchivedStatusFromLogEntry = (logEntry = {}) => {
  const statusChange = (Array.isArray(logEntry?.changes) ? logEntry.changes : [])
    .find(
      (entry) => normalizeLooseString(entry?.field).toLowerCase() === "status",
    );

  return normalizeRestorableArchivedStatus(statusChange?.before);
};

const attachArchivedRestoreStatus = async (orderEntries = []) => {
  const rows = Array.isArray(orderEntries) ? orderEntries : [];
  if (rows.length === 0) return [];

  const restoreStatusByKey = new Map();
  const missingLogMatches = [];
  const queuedKeys = new Set();

  rows.forEach((row) => {
    const lookupKey = buildArchivedOrderLookupKey(row);
    if (!lookupKey) return;

    const directStatus = normalizeRestorableArchivedStatus(
      row?.archived_previous_status,
    );
    if (directStatus) {
      restoreStatusByKey.set(lookupKey, directStatus);
      return;
    }

    if (queuedKeys.has(lookupKey)) return;
    queuedKeys.add(lookupKey);
    missingLogMatches.push({
      order_id: normalizeLooseString(row?.order_id),
      brand: normalizeLooseString(row?.brand),
      vendor: normalizeLooseString(row?.vendor),
      item_code: normalizeLooseString(row?.item?.item_code),
    });
  });

  if (missingLogMatches.length > 0) {
    const archiveLogs = await OrderEditLog.find({
      operation_type: "order_edit_archive",
      $or: missingLogMatches,
    })
      .sort({ createdAt: -1 })
      .lean();

    archiveLogs.forEach((logEntry) => {
      const lookupKey = buildArchivedOrderLookupKey(logEntry);
      if (!lookupKey || restoreStatusByKey.has(lookupKey)) return;

      const restoredStatus = resolveArchivedStatusFromLogEntry(logEntry);
      if (restoredStatus) {
        restoreStatusByKey.set(lookupKey, restoredStatus);
      }
    });
  }

  return rows.map((row) => ({
    ...row,
    restore_status: restoreStatusByKey.get(buildArchivedOrderLookupKey(row)) || "",
  }));
};

const PREVIOUS_ORDER_ACTION_STRATEGY = Object.freeze({
  KEEP_BOTH: "keep_both",
  REPLACE_PREVIOUS: "replace_previous",
});

const normalizeActionBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(
    String(value).trim().toLowerCase(),
  );
};

const normalizePreviousOrderActionStrategy = (value) =>
  String(value || "")
    .trim()
    .toLowerCase() === PREVIOUS_ORDER_ACTION_STRATEGY.REPLACE_PREVIOUS
    ? PREVIOUS_ORDER_ACTION_STRATEGY.REPLACE_PREVIOUS
    : PREVIOUS_ORDER_ACTION_STRATEGY.KEEP_BOTH;

const normalizePreviousOrderActionInput = (value = {}) => {
  const source = value && typeof value === "object" ? value : {};
  const previousOrderDbId = String(
    source?.previous_order_db_id ||
      source?.previousOrderDbId ||
      source?.previous_order_id ||
      source?.previousOrderId ||
      "",
  ).trim();
  const previousOrderOrderId = normalizeOrderKey(
    source?.previous_order_order_id ||
      source?.previousOrderOrderId ||
      source?.previous_order_po ||
      source?.previousOrderPo ||
      "",
  );

  return {
    previous_order_db_id:
      previousOrderDbId && mongoose.Types.ObjectId.isValid(previousOrderDbId)
        ? previousOrderDbId
        : null,
    previous_order_order_id: previousOrderOrderId || null,
    strategy: normalizePreviousOrderActionStrategy(
      source?.strategy || source?.action || source?.mode,
    ),
    transfer_inspection_records: normalizeActionBoolean(
      source?.transfer_inspection_records ?? source?.transferInspectionRecords,
      false,
    ),
  };
};

const normalizeHistoryActor = (value = {}) => {
  const actorId =
    value?.user && mongoose.Types.ObjectId.isValid(value.user)
      ? value.user
      : null;

  return {
    user: actorId,
    name: String(value?.name || "").trim(),
  };
};

const buildOrderListMatch = ({
  brand,
  vendor,
  status,
  order,
  itemCode,
  isDelayed = false,
  includeBrand = true,
  includeVendor = true,
  includeStatus = true,
  includeOrder = true,
  includeItemCode = true,
} = {}) => {
  const match = { ...ACTIVE_ORDER_MATCH };
  const normalizedBrand = normalizeFilterValue(brand);
  const normalizedVendor = normalizeFilterValue(vendor);
  const normalizedStatus = normalizeFilterValue(status);
  const normalizedOrder = normalizeFilterValue(order);
  const normalizedItemCode = normalizeFilterValue(itemCode);

  if (includeBrand && normalizedBrand) {
    match.brand = normalizedBrand;
  }

  if (includeVendor && normalizedVendor) {
    match.vendor = normalizedVendor;
  }

  if (includeStatus && normalizedStatus) {
    const loweredStatus = normalizedStatus.toLowerCase();

    if (loweredStatus === "pending") {
      match.status = { $nin: ["Partial Shipped", "Shipped"] };
    } else if (loweredStatus !== "delayed") {
      match.status = normalizedStatus;
    }
  }

  if (includeOrder && normalizedOrder) {
    const escaped = escapeRegex(normalizedOrder);
    match.order_id = { $regex: escaped, $options: "i" };
  }

  if (includeItemCode && normalizedItemCode) {
    const escaped = escapeRegex(normalizedItemCode);
    match["item.item_code"] = { $regex: escaped, $options: "i" };
  }

  if (isDelayed) {
    const now = new Date();
    match.$expr = {
      $and: [
        { $ne: [buildEffectiveEtdExpression(), null] },
        { $lt: [buildEffectiveEtdExpression(), now] },
      ],
    };
    match.status = { $nin: ["Shipped"] };
  }

  return match;
};

const buildShipmentMatch = ({
  brand,
  vendor,
  orderId,
  itemCode,
  container,
  status,
  includeBrand = true,
  includeVendor = true,
  includeOrderId = true,
  includeItemCode = true,
  includeContainer = true,
  includeStatus = true,
} = {}) => {
  const match = {
    ...ACTIVE_ORDER_MATCH,
  };

  const normalizedBrand = normalizeFilterValue(brand);
  const normalizedVendor = normalizeFilterValue(vendor);
  const normalizedOrderId = normalizeFilterValue(orderId);
  const normalizedItemCode = normalizeFilterValue(itemCode);
  const normalizedContainer = normalizeFilterValue(container);
  const normalizedStatus = normalizeFilterValue(status);

  if (includeBrand && normalizedBrand) {
    match.brand = normalizedBrand;
  }

  if (includeVendor && normalizedVendor) {
    match.vendor = normalizedVendor;
  }

  if (includeOrderId && normalizedOrderId) {
    const escaped = escapeRegex(normalizedOrderId);
    match.order_id = { $regex: escaped, $options: "i" };
  }

  if (includeItemCode && normalizedItemCode) {
    const escaped = escapeRegex(normalizedItemCode);
    match["item.item_code"] = { $regex: escaped, $options: "i" };
  }

  if (includeContainer && normalizedContainer) {
    const escaped = escapeRegex(normalizedContainer);
    match["shipment.container"] = { $regex: escaped, $options: "i" };
  }

  void includeStatus;
  void normalizedStatus;

  return match;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const parseDateLike = (value) => parseDateOnly(value);

const toUtcDayStart = (value = new Date()) => {
  const parsed = parseDateLike(value);

  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
};

const toISODateString = (value) => toDateOnlyIso(value);

const diffUtcDays = (laterValue, earlierValue) => {
  const later = toUtcDayStart(laterValue);
  const earlier = toUtcDayStart(earlierValue);
  if (!later || !earlier) return 0;
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY);
};

const resolveLaterDate = (currentValue, nextValue) => {
  const currentDate =
    currentValue instanceof Date ? currentValue : parseDateLike(currentValue);
  const nextDate =
    nextValue instanceof Date ? nextValue : parseDateLike(nextValue);

  if (!(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) {
    return nextDate instanceof Date && !Number.isNaN(nextDate.getTime())
      ? nextDate
      : null;
  }

  if (!(nextDate instanceof Date) || Number.isNaN(nextDate.getTime())) {
    return currentDate;
  }

  return nextDate.getTime() > currentDate.getTime() ? nextDate : currentDate;
};

const resolveEarlierDate = (currentValue, nextValue) => {
  const currentDate =
    currentValue instanceof Date ? currentValue : parseDateLike(currentValue);
  const nextDate =
    nextValue instanceof Date ? nextValue : parseDateLike(nextValue);

  if (!(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) {
    return nextDate instanceof Date && !Number.isNaN(nextDate.getTime())
      ? nextDate
      : null;
  }

  if (!(nextDate instanceof Date) || Number.isNaN(nextDate.getTime())) {
    return currentDate;
  }

  return nextDate.getTime() < currentDate.getTime() ? nextDate : currentDate;
};

const resolveEffectiveOrderEtdDate = (order = {}) =>
  parseDateLike(order?.revised_ETD) || parseDateLike(order?.ETD) || null;

const resolveLatestShipmentDate = (shipmentEntries = []) =>
  (Array.isArray(shipmentEntries) ? shipmentEntries : []).reduce(
    (latestDate, shipmentEntry) =>
      resolveLaterDate(latestDate, shipmentEntry?.stuffing_date),
    null,
  );

const resolveLatestInspectionDate = (qcRecord = {}) => {
  let latestDate = resolveLaterDate(null, qcRecord?.last_inspected_date);
  const inspectionDates = Array.isArray(qcRecord?.inspection_dates)
    ? qcRecord.inspection_dates
    : [];

  for (const inspectionDate of inspectionDates) {
    latestDate = resolveLaterDate(latestDate, inspectionDate);
  }

  return latestDate;
};

const isPendingOrderStatus = (statusValue = "") => {
  const normalized = normalizeLooseString(statusValue).toLowerCase();
  return normalized === "pending" || normalized === "under inspection";
};

const isInspectionDoneOrderStatus = (statusValue = "") =>
  normalizeLooseString(statusValue).toLowerCase() === "inspection done";

const isShippedLikeOrderStatus = (statusValue = "") => {
  const normalized = normalizeLooseString(statusValue).toLowerCase();
  return normalized === "partial shipped" || normalized === "shipped";
};

const buildDelayedPoGroupKey = ({
  orderId = "",
  brand = "",
  vendor = "",
} = {}) =>
  [
    normalizeOrderKey(orderId).toLowerCase(),
    normalizeBrandKey(brand),
    normalizeVendorKey(vendor),
  ].join("__");

const resolveDelayedPoLastProgress = (row = {}) => {
  const isFullyShipped =
    Number(row?.pending_count || 0) === 0 &&
    Number(row?.inspection_done_count || 0) === 0 &&
    Number(row?.shipped_count || 0) > 0;

  if (Number(row?.shipped_count || 0) > 0 && row?.last_shipment_date) {
    const shipmentDateDisplay = formatDateDDMMYYYY(row.last_shipment_date, "");
    return {
      type: isFullyShipped ? "shipment_complete" : "shipment",
      value: toISODateString(row.last_shipment_date),
      display: isFullyShipped
        ? `${shipmentDateDisplay} / Complete`
        : shipmentDateDisplay,
    };
  }

  if (Number(row?.inspection_done_count || 0) > 0 && row?.last_inspected_date) {
    return {
      type: "inspection_done",
      value: toISODateString(row.last_inspected_date),
      display: formatDateDDMMYYYY(row.last_inspected_date, ""),
    };
  }

  if (Number(row?.pending_count || 0) > 0) {
    return {
      type: "pending",
      value: "",
      display: "Pending",
    };
  }

  return {
    type: "",
    value: "",
    display: "",
  };
};

const buildEffectiveEtdExpression = (
  revisedEtdField = "$revised_ETD",
  etdField = "$ETD",
) => ({
  $ifNull: [revisedEtdField, etdField],
});

const uploadSourceFileToWasabi = async (file, folder) => {
  if (!file || !file.buffer || !isWasabiConfigured()) return null;

  const storageKey = createStorageKey({
    folder,
    originalName: file.originalname || "upload.bin",
  });

  return uploadBuffer({
    buffer: file.buffer,
    key: storageKey,
    originalName: file.originalname || "upload.bin",
    contentType: file.mimetype || "application/octet-stream",
  });
};

const formatDateDDMMYYYY = (value, fallback = "") =>
  formatDateOnlyDDMMYYYY(value, fallback);

const parseQuantityLike = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsedNumeric = Number(normalized);
  if (Number.isFinite(parsedNumeric)) return parsedNumeric;

  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsedFromMatch = Number(match[0]);
  return Number.isFinite(parsedFromMatch) ? parsedFromMatch : null;
};

const normalizeRectifyText = (value) => normalizeLooseString(value);

const addDaysToUtcDate = (value, daysToAdd = 0) => {
  const parsed = value instanceof Date ? value : parseDateLike(value);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return null;

  const nextDate = new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
  nextDate.setUTCDate(nextDate.getUTCDate() + Number(daysToAdd || 0));
  return nextDate;
};

const deriveRectifyDefaultEtd = (orderDateValue) =>
  addDaysToUtcDate(orderDateValue, RECTIFY_DEFAULT_ETD_OFFSET_DAYS);

const pickRectifyOrderId = (row = {}) =>
  normalizeRectifyText(row?.orderNumber || row?.order_id || row?.PO || "");

const pickRectifyItemCode = (row = {}) =>
  normalizeRectifyText(
    row?.item_code ||
      row?.itemCode ||
      row?.ourItemCode ||
      row?.yourItemCode ||
      "",
  );

const toDateDayKey = (value) => {
  const formatted = formatDateDDMMYYYY(value, "");
  return formatted || "";
};

const parseTimestampLike = (value) => parseDateTime(value);

const toTimestamp = (value) => {
  const parsed = value instanceof Date ? value : parseTimestampLike(value);
  if (!parsed) return 0;
  return parsed.getTime();
};

const normalizeRevisedEtdHistoryEntries = (entries = []) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const revisedEtd =
        entry?.revised_etd instanceof Date
          ? entry.revised_etd
          : parseDateLike(entry?.revised_etd);
      if (!revisedEtd) return null;

      const updatedAt =
        entry?.updated_at instanceof Date
          ? entry.updated_at
          : parseTimestampLike(entry?.updated_at) || revisedEtd;

      return {
        revised_etd: revisedEtd,
        updated_at: updatedAt,
        updated_by: normalizeHistoryActor(entry?.updated_by),
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        toTimestamp(right?.updated_at) - toTimestamp(left?.updated_at),
    );

const buildRevisedEtdHistoryEntry = ({
  revisedEtd = null,
  updatedAt = new Date(),
  user = null,
} = {}) => {
  const parsedRevisedEtd =
    revisedEtd instanceof Date ? revisedEtd : parseDateLike(revisedEtd);
  if (!parsedRevisedEtd) return null;

  const parsedUpdatedAt =
    updatedAt instanceof Date
      ? updatedAt
      : parseTimestampLike(updatedAt) || new Date();
  return {
    revised_etd: parsedRevisedEtd,
    updated_at: parsedUpdatedAt,
    updated_by: buildAuditActor(user),
  };
};

const getOrderRevisedEtdHistoryEntries = (orderEntry = {}) => {
  const normalizedHistory = normalizeRevisedEtdHistoryEntries(
    orderEntry?.revised_etd_history,
  );
  const currentRevisedEtdKey = toDateDayKey(orderEntry?.revised_ETD);

  if (
    currentRevisedEtdKey &&
    !normalizedHistory.some(
      (entry) => toDateDayKey(entry?.revised_etd) === currentRevisedEtdKey,
    )
  ) {
    const fallbackEntry = buildRevisedEtdHistoryEntry({
      revisedEtd: orderEntry?.revised_ETD,
      updatedAt:
        orderEntry?.updatedAt ||
        orderEntry?.createdAt ||
        orderEntry?.revised_ETD,
      user: {
        _id: orderEntry?.updated_by?.user || null,
        name: orderEntry?.updated_by?.name || "",
      },
    });
    if (fallbackEntry) {
      normalizedHistory.unshift(fallbackEntry);
    }
  }

  return normalizedHistory
    .sort(
      (left, right) =>
        toTimestamp(right?.updated_at) - toTimestamp(left?.updated_at),
    )
    .map((entry) => ({
      revised_etd: entry?.revised_etd || null,
      updated_at: entry?.updated_at || null,
      updated_by: {
        user: entry?.updated_by?.user || null,
        name: String(entry?.updated_by?.name || "").trim(),
      },
    }));
};

const applyRevisedEtdUpdateToOrder = ({
  orderDoc,
  nextRevisedEtd = null,
  user = null,
  updatedAt = new Date(),
} = {}) => {
  if (!orderDoc) return;

  const normalizedHistory = normalizeRevisedEtdHistoryEntries(
    orderDoc?.revised_etd_history,
  );
  const currentRevisedEtdKey = toDateDayKey(orderDoc?.revised_ETD);
  const nextRevisedEtdKey = toDateDayKey(nextRevisedEtd);

  if (nextRevisedEtdKey && nextRevisedEtdKey !== currentRevisedEtdKey) {
    const historyEntry = buildRevisedEtdHistoryEntry({
      revisedEtd: nextRevisedEtd,
      updatedAt,
      user,
    });
    if (historyEntry) {
      normalizedHistory.unshift(historyEntry);
    }
  }

  orderDoc.revised_ETD = nextRevisedEtd || null;
  orderDoc.revised_etd_history = normalizedHistory;
  if (user) {
    orderDoc.updated_by = buildAuditActor(user);
  }
};

const normalizeRectifiedPdfRow = (row = {}, { brand, vendor } = {}) => {

  const orderId = pickRectifyOrderId(row);
  const itemCode = pickRectifyItemCode(row);
  const description = normalizeRectifyText(row?.description || "");
  const quantity = parseQuantityLike(row?.quantity);
  const etd = parseDateLike(row?.etd || row?.ETD || "");
  const orderDate = parseDateLike(row?.orderDate || row?.order_date || "");
  const normalizedOrderDate = orderDate || null;
  const normalizedEtd = etd || deriveRectifyDefaultEtd(normalizedOrderDate);

  return {
    order_id: orderId,
    item_code: itemCode,
    description,
    brand: normalizeRectifyText(brand || row?.brand || ""),
    vendor: normalizeRectifyText(vendor || row?.vendor || ""),
    quantity: Number.isFinite(quantity) ? quantity : null,
    ETD: normalizedEtd || null,
    order_date: normalizedOrderDate,
    source: {
      refer: normalizeRectifyText(row?.refer || ""),
      raw_quantity: normalizeRectifyText(row?.quantity || ""),
    },
  };
};

const computeRectifyOpenQuantity = (orderEntry = {}) => {
  const orderQuantity = Math.max(
    0,
    Number(parseQuantityLike(orderEntry?.quantity) || 0),
  );
  const shippedQuantity = Math.max(
    0,
    (Array.isArray(orderEntry?.shipment) ? orderEntry.shipment : []).reduce(
      (sum, shipmentEntry) =>
        sum +
        Math.max(0, Number(parseQuantityLike(shipmentEntry?.quantity) || 0)),
      0,
    ),
  );
  const unshippedQuantity = Math.max(0, orderQuantity - shippedQuantity);

  const inspectionPendingQuantity = Math.max(
    0,
    Number(parseQuantityLike(orderEntry?.qc_record?.quantities?.pending) || 0),
  );
  const boundedInspectionPending = Math.min(
    unshippedQuantity,
    inspectionPendingQuantity,
  );
  const pendingShipmentQuantity = Math.max(
    0,
    unshippedQuantity - boundedInspectionPending,
  );

  return pendingShipmentQuantity + boundedInspectionPending;
};

const buildExactTextQuery = (value) => ({
  $regex: `^${escapeRegex(String(value || "").trim())}$`,
  $options: "i",
});

const loadLinkedQcForOrder = async (orderDoc, { session = null } = {}) => {
  if (!orderDoc?._id) return null;

  if (
    orderDoc.qc_record &&
    mongoose.Types.ObjectId.isValid(orderDoc.qc_record)
  ) {
    return QC.findById(orderDoc.qc_record).session(session);
  }

  return QC.findOne({ order: orderDoc._id }).session(session);
};

const buildPreviousOrderMetrics = ({ orderDoc = null, qcDoc = null } = {}) => {
  const progress = deriveOrderProgress({
    orderEntry: orderDoc,
    qcRecord: qcDoc,
  });

  return {
    order_quantity: progress.order_quantity,
    shipped_quantity: progress.shipped_quantity,
    passed_quantity: progress.passed_quantity,
    pending_quantity: progress.pending_inspection_quantity,
    has_qc_record: Boolean(qcDoc?._id),
  };
};

const isPartialShippedStatus = (statusValue = "") => {
  return normalizeOrderStatus(statusValue) === "Partial Shipped";
};

const buildPreviousOrderResponse = ({ orderDoc = null, qcDoc = null } = {}) => {
  const metrics = buildPreviousOrderMetrics({ orderDoc, qcDoc });
  const derivedStatus = deriveOrderStatus({
    orderEntry: orderDoc,
    qcRecord: qcDoc,
  });
  const isPartialShipped = isPartialShippedStatus(derivedStatus);

  return {
    order: {
      _id: String(orderDoc?._id || "").trim() || null,
      order_id: normalizeOrderKey(orderDoc?.order_id),
      item_code: normalizeRectifyText(orderDoc?.item?.item_code),
      description: normalizeRectifyText(orderDoc?.item?.description),
      brand: normalizeLooseString(orderDoc?.brand),
      vendor: normalizeLooseString(orderDoc?.vendor),
      status: derivedStatus,
      quantity: metrics.order_quantity,
      ETD: orderDoc?.ETD || null,
      order_date: orderDoc?.order_date || null,
    },
    metrics,
    capabilities: {
      can_keep_both: true,
      can_replace_previous: isPartialShipped,
      can_transfer_inspections:
        isPartialShipped && metrics.passed_quantity > 0 && Boolean(qcDoc?._id),
    },
    requirements: {
      requires_partial_shipped: true,
      is_partial_shipped: isPartialShipped,
    },
  };
};

const resolvePreviousOrderReplacementPlan = async ({
  row = {},
  session = null,
} = {}) => {
  const previousOrderAction = normalizePreviousOrderActionInput(
    row?.previous_order_action || row?.previousOrderAction,
  );

  if (
    previousOrderAction.strategy !==
    PREVIOUS_ORDER_ACTION_STRATEGY.REPLACE_PREVIOUS
  ) {
    return {
      action: previousOrderAction,
      mode: PREVIOUS_ORDER_ACTION_STRATEGY.KEEP_BOTH,
      warnings: [],
      previousOrder: null,
      previousQc: null,
    };
  }

  const warnings = [];
  const previousOrderDbId = previousOrderAction.previous_order_db_id;
  const previousOrderOrderId = previousOrderAction.previous_order_order_id;
  const itemCode = normalizeRectifyText(row?.item_code);

  if (!itemCode) {
    warnings.push(
      `Previous-order replacement skipped for ${normalizeOrderKey(row?.order_id) || "UNKNOWN"}/${normalizeRectifyText(row?.item_code) || "UNKNOWN"} because item code is missing.`,
    );
    return {
      action: previousOrderAction,
      mode: PREVIOUS_ORDER_ACTION_STRATEGY.KEEP_BOTH,
      warnings,
      previousOrder: null,
      previousQc: null,
    };
  }

  let previousOrder = null;
  if (previousOrderDbId) {
    previousOrder = await Order.findOne({
      _id: previousOrderDbId,
      ...ACTIVE_ORDER_MATCH,
    }).session(session);
  }

  if (!previousOrder && previousOrderOrderId) {
    previousOrder = await Order.findOne({
      ...ACTIVE_ORDER_MATCH,
      order_id: buildExactTextQuery(previousOrderOrderId),
      "item.item_code": buildExactTextQuery(itemCode),
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .session(session);
  }

  if (!previousOrder) {
    warnings.push(
      `Previous order ${previousOrderOrderId || "UNKNOWN"} was not found for item ${itemCode}. Row will be added without replacing the old order.`,
    );
    return {
      action: previousOrderAction,
      mode: PREVIOUS_ORDER_ACTION_STRATEGY.KEEP_BOTH,
      warnings,
      previousOrder: null,
      previousQc: null,
    };
  }

  const previousOrderItemCode = normalizeRectifyText(
    previousOrder?.item?.item_code,
  );
  if (
    previousOrderItemCode &&
    itemCode &&
    previousOrderItemCode.toLowerCase() !== itemCode.toLowerCase()
  ) {
    warnings.push(
      `Previous order ${normalizeOrderKey(previousOrder?.order_id) || "UNKNOWN"} does not match item ${itemCode}. Row will be added without replacing the old order.`,
    );
    return {
      action: previousOrderAction,
      mode: PREVIOUS_ORDER_ACTION_STRATEGY.KEEP_BOTH,
      warnings,
      previousOrder: null,
      previousQc: null,
    };
  }

  const previousQc = await loadLinkedQcForOrder(previousOrder, { session });
  const previousOrderResponse = buildPreviousOrderResponse({
    orderDoc: previousOrder,
    qcDoc: previousQc,
  });

  if (!previousOrderResponse.capabilities.can_replace_previous) {
    warnings.push(
      `Previous order ${normalizeOrderKey(previousOrder?.order_id) || "UNKNOWN"} is not Partial Shipped, so it was kept instead of being replaced.`,
    );
    return {
      action: previousOrderAction,
      mode: PREVIOUS_ORDER_ACTION_STRATEGY.KEEP_BOTH,
      warnings,
      previousOrder: null,
      previousQc: null,
    };
  }

  if (
    previousOrderAction.transfer_inspection_records &&
    previousOrderResponse.metrics.passed_quantity > Number(row?.quantity || 0)
  ) {
    warnings.push(
      `Transfer skipped for ${normalizeOrderKey(row?.order_id) || "UNKNOWN"}/${itemCode} because new quantity is less than previous passed quantity.`,
    );
    return {
      action: previousOrderAction,
      mode: PREVIOUS_ORDER_ACTION_STRATEGY.KEEP_BOTH,
      warnings,
      previousOrder: null,
      previousQc: null,
    };
  }

  return {
    action: previousOrderAction,
    mode: PREVIOUS_ORDER_ACTION_STRATEGY.REPLACE_PREVIOUS,
    warnings,
    previousOrder,
    previousQc,
    previousOrderResponse,
  };
};

const normalizeOrderComparisonValue = (value) =>
  normalizeRectifyText(value).toLowerCase();

const getRectifiedChangedFields = (incomingRow, existingOrder) => {
  const changedFields = [];

  if (
    normalizeOrderComparisonValue(incomingRow?.brand) !==
    normalizeOrderComparisonValue(existingOrder?.brand)
  ) {
    changedFields.push("brand");
  }

  if (
    normalizeOrderComparisonValue(incomingRow?.vendor) !==
    normalizeOrderComparisonValue(existingOrder?.vendor)
  ) {
    changedFields.push("vendor");
  }

  if (
    normalizeOrderComparisonValue(incomingRow?.description) !==
    normalizeOrderComparisonValue(existingOrder?.item?.description)
  ) {
    changedFields.push("description");
  }

  const incomingQuantity = Number(incomingRow?.quantity);
  const existingQuantity = Number(existingOrder?.quantity);
  if (
    Number.isFinite(incomingQuantity) &&
    Number.isFinite(existingQuantity) &&
    incomingQuantity !== existingQuantity
  ) {
    changedFields.push("quantity");
  }

  if (toDateDayKey(incomingRow?.ETD) !== toDateDayKey(existingOrder?.ETD)) {
    changedFields.push("ETD");
  }

  if (
    toDateDayKey(incomingRow?.order_date) !==
    toDateDayKey(existingOrder?.order_date)
  ) {
    changedFields.push("order_date");
  }

  return changedFields;
};

const getExistingOrderPreviewMeta = (existingOrder = null) => ({
  existing_order_id: String(existingOrder?._id || "").trim() || null,
  existing_order_status: existingOrder
    ? deriveOrderStatus({ orderEntry: existingOrder })
    : null,
});

const buildBrandVendorPairsFromRows = (rows = []) => {
  const pairsByKey = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const brand = normalizeLooseString(row?.brand);
    const vendor = normalizeLooseString(row?.vendor);
    if (!brand || !vendor) continue;
    const brandVendorKey = normalizeBrandVendorKey(brand, vendor);

    if (!pairsByKey.has(brandVendorKey)) {
      pairsByKey.set(brandVendorKey, { brand, vendor });
    }
  }

  return [...pairsByKey.values()];
};

const loadExistingOrdersForBrandVendorPairs = async (pairs = []) => {
  const normalizedPairs = buildBrandVendorPairsFromRows(pairs);
  if (normalizedPairs.length === 0) {
    return {
      existingOrders: [],
      existingByKey: new Map(),
      openOrdersByKey: new Map(),
    };
  }

  const existingOrders = await Order.find({
    ...ACTIVE_ORDER_MATCH,
    $or: normalizedPairs.map((entry) => ({
      brand: entry.brand,
      vendor: entry.vendor,
    })),
  })
    .select(
      "_id order_id item brand vendor quantity ETD order_date status shipment qc_record",
    )
    .populate({
      path: "qc_record",
      select: "quantities request_history",
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const existingByKey = new Map();
  const openOrdersByKey = new Map();

  for (const existingOrder of existingOrders) {
    const key = makeRectifyKey(
      existingOrder?.order_id,
      existingOrder?.item?.item_code,
    );
    if (!key) continue;

    if (!existingByKey.has(key)) {
      existingByKey.set(key, existingOrder);
    }

    if (
      String(existingOrder?.status || "").trim() !== "Shipped" &&
      !openOrdersByKey.has(key)
    ) {
      openOrdersByKey.set(key, existingOrder);
    }
  }

  return {
    existingOrders,
    existingByKey,
    openOrdersByKey,
  };
};

const formatDateForUploadSheet = (value) => formatDateDDMMYYYY(value, "");

const buildRectifyWorkbookBuffer = (rows = []) => {
  const workbookRows = (Array.isArray(rows) ? rows : []).map((entry) => ({
    PO: entry?.order_id || "",
    item_code: entry?.item_code || "",
    description: entry?.description || "",
    brand: entry?.brand || "",
    vendor: entry?.vendor || "",
    quantity: Number(entry?.quantity || 0),
    ETD: formatDateForUploadSheet(entry?.ETD),
    order_date: formatDateForUploadSheet(entry?.order_date),
    change_type: entry?.change_type || "",
    changedType: entry?.change_type || "",
    existing_status: entry?.existing_order_status || "",
    changed_fields: Array.isArray(entry?.changed_fields)
      ? entry.changed_fields.join(", ")
      : "",
    source_refer: entry?.source?.refer || "",
    source_quantity_text: entry?.source?.raw_quantity || "",
  }));

  const sheet = XLSX.utils.json_to_sheet(workbookRows, {
    header: [
      "PO",
      "item_code",
      "description",
      "brand",
      "vendor",
      "quantity",
      "ETD",
      "order_date",
      "change_type",
      "changedType",
      "existing_status",
      "changed_fields",
      "source_refer",
      "source_quantity_text",
    ],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Rectified Orders");

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
};

const parseBooleanInput = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(
    String(value).trim().toLowerCase(),
  );
};

const makeRectifyKey = (orderId, itemCode) =>
  `${normalizeOrderKey(orderId)}__${normalizeRectifyText(itemCode).toUpperCase()}`;

const normalizeRectifyChangeType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "new" ||
    normalized === "modified" ||
    normalized === "closed"
  ) {
    return normalized;
  }
  return "";
};

const normalizeRectifyChangedFields = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  const asString = String(value || "").trim();
  if (!asString) return [];
  return asString
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeRectifiedSelectionRow = (row = {}, defaults = {}) => {
  const normalizedRow = normalizeRectifiedPdfRow(row, defaults);
  const rawChangeType = normalizeRectifyChangeType(
    row?.change_type ?? row?.changedType,
  );
  const fallbackChangeType = row?.existing_order_id ? "modified" : "new";
  const changeType = rawChangeType || fallbackChangeType;
  const changedFields = normalizeRectifyChangedFields(row?.changed_fields);
  const existingOrderId = String(row?.existing_order_id || "").trim();
  const existingOrderStatus = normalizeLooseString(row?.existing_order_status);

  return {
    ...normalizedRow,
    change_type: changeType,
    changed_fields: changedFields,
    existing_order_id: existingOrderId || null,
    existing_order_status: existingOrderStatus || null,
    previous_order_action: normalizePreviousOrderActionInput(
      row?.previous_order_action || row?.previousOrderAction,
    ),
  };
};

const buildRectifyRowsForResponse = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    row_id: makeRectifyKey(row?.order_id, row?.item_code),
    order_id: normalizeOrderKey(row?.order_id),
    item_code: normalizeRectifyText(row?.item_code),
    description: normalizeRectifyText(row?.description),
    brand: normalizeRectifyText(row?.brand),
    vendor: normalizeRectifyText(row?.vendor),
    quantity: Number(parseQuantityLike(row?.quantity) || 0),
    ETD: row?.ETD || null,
    order_date: row?.order_date || null,
    change_type: normalizeRectifyChangeType(row?.change_type),
    changed_fields: normalizeRectifyChangedFields(row?.changed_fields),
    existing_order_id: String(row?.existing_order_id || "").trim() || null,
    existing_order_status:
      normalizeLooseString(row?.existing_order_status) || null,
    previous_order_action: normalizePreviousOrderActionInput(
      row?.previous_order_action || row?.previousOrderAction,
    ),
  }));

const createRectifyUploadLog = async ({
  reqUser = null,
  brand = "",
  vendor = "",
  sourceFilename = "rectify_pdf",
  sourceSizeBytes = 0,
  totalRowsReceived = 0,
  totalRowsUnique = 0,
  invalidEntries = [],
  duplicateInPdfCount = 0,
  rowsEligibleForApply = [],
  changedRows = [],
  applySummary = {},
} = {}) => {
  const appliedDbChangeCount =
    Number(applySummary?.inserted_count || 0) +
    Number(applySummary?.updated_count || 0);
  if (appliedDbChangeCount <= 0) {
    return null;
  }

  const rowsByOrder = new Map();
  for (const row of Array.isArray(rowsEligibleForApply)
    ? rowsEligibleForApply
    : []) {
    const orderId = normalizeOrderKey(row?.order_id);
    if (!orderId) continue;
    rowsByOrder.set(orderId, Number(rowsByOrder.get(orderId) || 0) + 1);
  }

  const uploadedOrderIds = [...rowsByOrder.keys()].sort((a, b) =>
    a.localeCompare(b),
  );
  const missingOpenOrderIds = normalizeDistinctValues(
    (Array.isArray(changedRows) ? changedRows : [])
      .filter(
        (row) => normalizeRectifyChangeType(row?.change_type) === "closed",
      )
      .map((row) => normalizeOrderKey(row?.order_id))
      .filter(Boolean),
  );

  const itemsPerOrder = uploadedOrderIds.map((orderId) => ({
    order_id: orderId,
    items_count: Number(rowsByOrder.get(orderId) || 0),
  }));

  const remarks = [
    `Rectify PDF DB apply: inserted ${Number(applySummary?.inserted_count || 0)}, updated ${Number(applySummary?.updated_count || 0)}.`,
  ];
  if (Number(applySummary?.quantity_skipped_count || 0) > 0) {
    remarks.push(
      `Quantity updates skipped: ${Number(applySummary.quantity_skipped_count || 0)}.`,
    );
  }

  const closedCount = (Array.isArray(changedRows) ? changedRows : []).filter(
    (row) => normalizeRectifyChangeType(row?.change_type) === "closed",
  ).length;
  if (closedCount > 0) {
    remarks.push(
      `Missing open rows in PDF exported as closed (not applied): ${closedCount}.`,
    );
  }

  if (
    Array.isArray(applySummary?.warnings) &&
    applySummary.warnings.length > 0
  ) {
    remarks.push(
      ...applySummary.warnings
        .map((warning) => String(warning || "").trim())
        .filter(Boolean),
    );
  }

  const conflicts = missingOpenOrderIds.map((orderId) => ({
    type: "OPEN_ORDER_MISSING_IN_UPLOAD",
    brand,
    vendor,
    order_id: orderId,
    message: `Brand ${brand} / Vendor ${vendor} has open order ${orderId} in system but it was not present in the rectify PDF.`,
  }));

  const uploadedById =
    reqUser?._id && mongoose.Types.ObjectId.isValid(reqUser._id)
      ? reqUser._id
      : null;

  try {
    const uploadLog = await UploadLog.create({
      uploaded_by: uploadedById,
      uploaded_by_name: String(
        reqUser?.name || reqUser?.username || reqUser?.email || "",
      ).trim(),
      source_filename: String(sourceFilename || "rectify_pdf").trim(),
      source_size_bytes: Number(sourceSizeBytes || 0),
      total_rows_received: Number(totalRowsReceived || 0),
      total_rows_unique: Number(totalRowsUnique || 0),
      inserted_item_rows: appliedDbChangeCount,
      duplicate_count:
        Number(duplicateInPdfCount || 0) +
        (Array.isArray(invalidEntries) ? invalidEntries.length : 0),
      duplicate_entries: (Array.isArray(invalidEntries)
        ? invalidEntries
        : []
      ).map((entry) => ({
        order_id: normalizeOrderKey(
          entry?.source?.orderNumber || entry?.source?.order_id || "",
        ),
        item_code: pickRectifyItemCode(entry?.source || {}),
        reason: String(entry?.reason || "invalid_row").trim(),
      })),
      uploaded_brands: brand ? [brand] : [],
      uploaded_vendors: vendor ? [vendor] : [],
      total_distinct_orders_uploaded: uploadedOrderIds.length,
      vendor_summaries:
        brand && vendor
          ? [
              {
                brand,
                vendor,
                uploaded_order_ids: uploadedOrderIds,
                uploaded_orders_count: uploadedOrderIds.length,
                uploaded_items_count: rowsEligibleForApply.length,
                items_per_order: itemsPerOrder,
                missing_open_order_ids: missingOpenOrderIds,
                missing_open_orders_count: missingOpenOrderIds.length,
                remark:
                  missingOpenOrderIds.length > 0
                    ? "Open orders missing in PDF were exported as closed rows."
                    : "",
              },
            ]
          : [],
      conflicts,
      remarks,
      status: conflicts.length > 0 ? "success_with_conflicts" : "success",
    });

    return uploadLog?._id || null;
  } catch (uploadLogError) {
    console.error("Rectify upload log save failed:", {
      error: uploadLogError?.message || String(uploadLogError),
    });
    return null;
  }
};

const formatShipmentEntriesForUploadLog = (shipmentEntries = []) => {
  const rows = Array.isArray(shipmentEntries) ? shipmentEntries : [];
  if (rows.length === 0) return "None";

  return rows
    .map((entry, index) => {
      const stuffingDate = formatDateDDMMYYYY(entry?.stuffing_date, "Not Set");
      const container = String(entry?.container || "").trim() || "N/A";
      const invoiceNumber = normalizeShipmentInvoiceNumber(
        entry?.invoice_number,
      );
      const quantity = Number(entry?.quantity || 0);
      const pending = Number(entry?.pending || 0);
      const remarks = String(entry?.remaining_remarks || "").trim() || "None";
      return `${index + 1}) ${stuffingDate} | ${container} | invoice ${invoiceNumber} | qty ${Number.isFinite(quantity) ? quantity : 0} | pending ${Number.isFinite(pending) ? pending : 0} | remarks: ${remarks}`;
    })
    .join(" || ");
};

const buildOrderEditLogSnapshot = (orderEntry = {}) => ({
  order_id: normalizeLooseString(orderEntry?.order_id),
  brand: normalizeLooseString(orderEntry?.brand),
  vendor: normalizeLooseString(orderEntry?.vendor),
  item_code: normalizeLooseString(orderEntry?.item?.item_code),
  description: normalizeLooseString(orderEntry?.item?.description),
  order_date: formatDateDDMMYYYY(orderEntry?.order_date, "Not Set"),
  etd: formatDateDDMMYYYY(orderEntry?.ETD, "Not Set"),
  quantity: String(Number(orderEntry?.quantity || 0)),
  revised_ETD: formatDateDDMMYYYY(orderEntry?.revised_ETD, "Not Set"),
  status: normalizeLooseString(orderEntry?.status) || "Not Set",
  archived: Boolean(orderEntry?.archived) ? "Yes" : "No",
  archived_remark:
    normalizeLooseString(orderEntry?.archived_remark) || "Not Set",
  shipment: formatShipmentEntriesForUploadLog(orderEntry?.shipment),
});

const buildOrderEditChanges = (beforeSnapshot = {}, afterSnapshot = {}) => {
  const fields = [
    { key: "order_id", label: "Order ID" },
    { key: "brand", label: "Brand" },
    { key: "vendor", label: "Vendor" },
    { key: "item_code", label: "Item Code" },
    { key: "description", label: "Description" },
    { key: "order_date", label: "Order Date" },
    { key: "etd", label: "ETD" },
    { key: "quantity", label: "Quantity" },
    { key: "revised_ETD", label: "Revised ETD" },
    { key: "shipment", label: "Shipment" },
    { key: "status", label: "Status" },
    { key: "archived", label: "Archived" },
    { key: "archived_remark", label: "Archived Remark" },
  ];

  const toDisplayText = (value) => {
    const normalized = String(value ?? "").trim();
    return normalized || "Not Set";
  };

  return fields.reduce((changes, { key, label }) => {
    const beforeValue = toDisplayText(beforeSnapshot?.[key]);
    const afterValue = toDisplayText(afterSnapshot?.[key]);
    if (beforeValue === afterValue) return changes;
    changes.push({
      field: label,
      before: beforeValue,
      after: afterValue,
    });
    return changes;
  }, []);
};

const createOrderEditLog = async ({
  reqUser = null,
  operationType = "order_edit",
  beforeSnapshot = {},
  afterSnapshot = {},
  calendarSyncResults = [],
  extraRemarks = [],
} = {}) => {
  const orderId = normalizeLooseString(
    afterSnapshot?.order_id || beforeSnapshot?.order_id,
  );
  const brand = normalizeLooseString(
    afterSnapshot?.brand || beforeSnapshot?.brand,
  );
  const vendor = normalizeLooseString(
    afterSnapshot?.vendor || beforeSnapshot?.vendor,
  );
  const itemCode = normalizeLooseString(
    afterSnapshot?.item_code || beforeSnapshot?.item_code,
  );
  const editDetails = buildOrderEditChanges(beforeSnapshot, afterSnapshot);

  const calendarFailures = (
    Array.isArray(calendarSyncResults) ? calendarSyncResults : []
  ).filter((entry) => entry && entry.ok === false);

  const remarks = [
    editDetails.length > 0
      ? `Edited fields: ${editDetails.map((entry) => entry.field).join(", ")}.`
      : "No net changes detected in editable fields.",
    ...(Array.isArray(extraRemarks) ? extraRemarks : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  ];

  if (calendarFailures.length > 0) {
    remarks.push(
      `Calendar sync failed for ${calendarFailures.length} group(s).`,
    );
  }

  const uploadedById =
    reqUser?._id && mongoose.Types.ObjectId.isValid(reqUser._id)
      ? reqUser._id
      : null;

  try {
    await OrderEditLog.create({
      edited_by: uploadedById,
      edited_by_name: String(
        reqUser?.name || reqUser?.username || reqUser?.email || "",
      ).trim(),
      order_id: orderId || "UNKNOWN",
      brand,
      vendor,
      item_code: itemCode,
      operation_type:
        String(operationType || "")
          .trim()
          .toLowerCase() === "order_edit_archive"
          ? "order_edit_archive"
          : "order_edit",
      changed_fields_count: editDetails.length,
      changed_fields: editDetails.map((entry) => entry.field),
      changes: editDetails,
      remarks,
    });
  } catch (orderEditLogError) {
    console.error("Order edit log save failed:", {
      order_id: orderId,
      error: orderEditLogError?.message || String(orderEditLogError),
    });
  }
};

const applyNewOrderRows = async ({
  rows = [],
  reqUser = null,
  actionLabel = "upload",
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length === 0) {
    return {
      inserted_count: 0,
      warnings: [],
    };
  }

  const insertedDocs = [];
  const warnings = [];
  const groupsToSync = new Map();
  const orderLogs = [];

  for (const row of safeRows) {
    let postCommitNewOrder = null;
    let rowWarnings = [];
    const rowGroupsToSync = new Map();
    const rowOrderLogs = [];

    try {
      const replacementPlan = await resolvePreviousOrderReplacementPlan({
        row,
      });

      rowWarnings = [...replacementPlan.warnings];
      const newOrder = new Order({
        order_id: row.order_id,
        item: {
          item_code: row.item_code,
          description: row.description,
        },
        brand: row.brand,
        vendor: row.vendor,
        ETD: row.ETD || undefined,
        order_date: row.order_date || undefined,
        status: "Pending",
        quantity: Number(row.quantity),
        updated_by: buildAuditActor(reqUser),
      });

      const newOrderBeforeSnapshot = {};
      const newOrderGroup = {
        order_id: newOrder.order_id,
        brand: newOrder.brand,
        vendor: newOrder.vendor,
      };
      await newOrder.validate();

      if (
        replacementPlan.mode ===
          PREVIOUS_ORDER_ACTION_STRATEGY.REPLACE_PREVIOUS &&
        replacementPlan.previousOrder
      ) {
        const previousOrder = replacementPlan.previousOrder;
        const previousQc = replacementPlan.previousQc;
        const previousOrderBeforeSnapshot =
          buildOrderEditLogSnapshot(previousOrder);
        const archiveRemark = `Replaced by PO ${normalizeOrderKey(newOrder.order_id) || "UNKNOWN"} during ${actionLabel}.`;

        if (
          replacementPlan.action.transfer_inspection_records &&
          previousQc &&
          Number(previousQc?.quantities?.qc_passed || 0) > 0
        ) {
          const nextQuantity = Math.max(0, Number(newOrder.quantity || 0));
          const clampToDemand = (value) => {
            const parsed = Number(value || 0);
            if (!Number.isFinite(parsed) || parsed < 0) return 0;
            return Math.min(parsed, nextQuantity);
          };

          previousQc.order = newOrder._id;
          previousQc.order_meta = previousQc.order_meta || {};
          previousQc.order_meta.order_id = newOrder.order_id;
          previousQc.order_meta.brand = newOrder.brand;
          previousQc.order_meta.vendor = newOrder.vendor;
          previousQc.item = previousQc.item || {};
          previousQc.item.item_code = newOrder.item.item_code;
          previousQc.item.description = newOrder.item.description;
          previousQc.quantities = previousQc.quantities || {};

          const nextPassed = clampToDemand(previousQc.quantities.qc_passed);
          const nextChecked = Math.max(
            nextPassed,
            clampToDemand(previousQc.quantities.qc_checked),
          );
          const nextRequested = clampToDemand(
            previousQc.quantities.quantity_requested,
          );
          const nextProvision = Math.max(
            nextPassed,
            clampToDemand(previousQc.quantities.vendor_provision),
          );

          previousQc.quantities.client_demand = nextQuantity;
          previousQc.quantities.qc_passed = nextPassed;
          previousQc.quantities.qc_checked = nextChecked;
          previousQc.quantities.quantity_requested = nextRequested;
          previousQc.quantities.vendor_provision = nextProvision;
          previousQc.quantities.pending = Math.max(
            0,
            nextQuantity - nextPassed,
          );
          previousQc.quantities.qc_rejected = Math.max(
            0,
            nextChecked - nextPassed,
          );
          previousQc.updated_by = buildAuditActor(reqUser);

          newOrder.qc_record = previousQc._id;
          newOrder.status = computeOrderStatus({
            orderQuantity: nextQuantity,
            shippedQuantity: 0,
            qcRecord: previousQc,
          });

          previousOrder.qc_record = null;
          await previousQc.save();
        }

        previousOrder.archived = true;
        previousOrder.archived_previous_status =
          normalizeRestorableArchivedStatus(previousOrder.status) || null;
        previousOrder.status = "Cancelled";
        previousOrder.archived_remark = archiveRemark;
        previousOrder.archived_at = new Date();
        previousOrder.archived_by = {
          user:
            reqUser?._id && mongoose.Types.ObjectId.isValid(reqUser._id)
              ? reqUser._id
              : null,
          name: buildArchivedByName(reqUser),
        };
        previousOrder.updated_by = buildAuditActor(reqUser);

        await previousOrder.save();

        const postCommitPreviousOrder = previousOrder.toObject();
        rowOrderLogs.push({
          reqUser,
          operationType: "order_edit_archive",
          beforeSnapshot: previousOrderBeforeSnapshot,
          afterSnapshot: buildOrderEditLogSnapshot(postCommitPreviousOrder),
          extraRemarks: [
            archiveRemark,
            replacementPlan.action.transfer_inspection_records
              ? "Existing QC history was transferred to the new PO."
              : "Previous order was archived and the new PO was kept separate.",
          ],
        });

        const previousGroup = {
          order_id: previousOrder.order_id,
          brand: previousOrder.brand,
          vendor: previousOrder.vendor,
        };
        rowGroupsToSync.set(
          `${previousGroup.order_id}__${previousGroup.brand}__${previousGroup.vendor}`,
          previousGroup,
        );
      }

      await newOrder.save();

      postCommitNewOrder = newOrder.toObject();
      rowGroupsToSync.set(
        `${newOrderGroup.order_id}__${newOrderGroup.brand}__${newOrderGroup.vendor}`,
        newOrderGroup,
      );
      rowOrderLogs.push({
        reqUser,
        operationType: "order_edit",
        beforeSnapshot: newOrderBeforeSnapshot,
        afterSnapshot: buildOrderEditLogSnapshot(postCommitNewOrder),
        extraRemarks: [
          `Order created from ${actionLabel}.`,
          replacementPlan.mode ===
          PREVIOUS_ORDER_ACTION_STRATEGY.REPLACE_PREVIOUS
            ? `Previous order ${normalizeOrderKey(replacementPlan.previousOrder?.order_id) || "UNKNOWN"} was replaced.`
            : "No previous order replacement action was applied.",
        ],
      });
    } catch (error) {
      rowWarnings.push(
        `Failed to create ${normalizeOrderKey(row?.order_id) || "UNKNOWN"}/${normalizeRectifyText(row?.item_code) || "UNKNOWN"} during ${actionLabel}: ${error?.message || String(error)}`,
      );
    }

    if (postCommitNewOrder) {
      insertedDocs.push(postCommitNewOrder);
      for (const [groupKey, groupValue] of rowGroupsToSync.entries()) {
        groupsToSync.set(groupKey, groupValue);
      }
      orderLogs.push(...rowOrderLogs);
    }

    warnings.push(...rowWarnings);
  }

  for (const doc of insertedDocs) {
    try {
      await upsertItemFromOrder(doc);
    } catch (itemSyncError) {
      warnings.push(
        `Item sync failed for ${normalizeOrderKey(doc?.order_id) || "UNKNOWN"}/${normalizeRectifyText(doc?.item?.item_code) || "UNKNOWN"}.`,
      );
      console.error("Item sync after order creation failed:", {
        orderId: doc?.order_id,
        itemCode: doc?.item?.item_code,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }
  }

  const uniqueGroupsToSync = [...groupsToSync.values()];
  const syncBatchSize = 5;
  for (let i = 0; i < uniqueGroupsToSync.length; i += syncBatchSize) {
    const batch = uniqueGroupsToSync.slice(i, i + syncBatchSize);
    await Promise.all(
      batch.map(async (group) => {
        try {
          await syncOrderGroup(group);
        } catch (syncErr) {
          warnings.push(
            `Calendar sync failed for ${normalizeOrderKey(group?.order_id) || "UNKNOWN"} (${group?.brand || "N/A"} / ${group?.vendor || "N/A"}).`,
          );
          console.error("Google Calendar sync failed for order create group:", {
            group,
            error: syncErr?.message || String(syncErr),
          });
        }
      }),
    );
  }

  for (const logEntry of orderLogs) {
    await createOrderEditLog(logEntry);
  }

  return {
    inserted_count: insertedDocs.length,
    warnings,
  };
};

const applyRectifiedOrderRows = async ({
  rows = [],
  existingByKey = new Map(),
  reqUser = null,
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length === 0) {
    return {
      inserted_count: 0,
      updated_count: 0,
      quantity_skipped_count: 0,
      warnings: [],
    };
  }

  const rowsToInsert = [];
  const rowsToUpdate = [];
  const warnings = [];

  for (const row of safeRows) {
    const key = `${normalizeOrderKey(row?.order_id)}__${normalizeRectifyText(
      row?.item_code,
    ).toUpperCase()}`;
    const existing = existingByKey.get(key);
    if (!existing) {
      rowsToInsert.push(row);
    } else {
      rowsToUpdate.push({
        row,
        existingId: existing?._id || null,
      });
    }
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let quantitySkippedCount = 0;
  const groupsToSync = new Map();

  if (rowsToInsert.length > 0) {
    const insertSummary = await applyNewOrderRows({
      rows: rowsToInsert,
      reqUser,
      actionLabel: "rectify",
    });
    insertedCount = insertSummary.inserted_count;
    warnings.push(
      ...(Array.isArray(insertSummary?.warnings) ? insertSummary.warnings : []),
    );
  }

  for (const entry of rowsToUpdate) {
    if (
      !entry?.existingId ||
      !mongoose.Types.ObjectId.isValid(entry.existingId)
    ) {
      continue;
    }

    const orderDoc = await Order.findById(entry.existingId);
    if (!orderDoc) continue;

    const oldGroup = {
      order_id: orderDoc.order_id,
      brand: orderDoc.brand,
      vendor: orderDoc.vendor,
    };

    orderDoc.item = orderDoc.item || {};
    orderDoc.brand = entry.row.brand;
    orderDoc.vendor = entry.row.vendor;
    orderDoc.item.item_code = entry.row.item_code;
    orderDoc.item.description = entry.row.description;
    orderDoc.ETD = entry.row.ETD || null;
    if (entry.row.order_date) {
      orderDoc.order_date = entry.row.order_date;
    }

    const nextQuantity = Number(entry.row.quantity);
    const currentQuantity = Number(orderDoc.quantity);
    if (
      Number.isFinite(nextQuantity) &&
      Number.isFinite(currentQuantity) &&
      nextQuantity !== currentQuantity
    ) {
      const hasShipment =
        Array.isArray(orderDoc.shipment) && orderDoc.shipment.length > 0;
      const hasQcRecord = Boolean(orderDoc.qc_record);
      if (hasShipment || hasQcRecord) {
        quantitySkippedCount += 1;
        warnings.push(
          `Quantity update skipped for ${orderDoc.order_id}/${orderDoc.item.item_code} because shipment or QC exists.`,
        );
      } else {
        orderDoc.quantity = nextQuantity;
      }
    }

    await orderDoc.save();
    updatedCount += 1;

    try {
      await upsertItemFromOrder(orderDoc);
    } catch (itemSyncError) {
      console.error("Item sync after rectify update failed:", {
        orderId: orderDoc.order_id,
        itemCode: orderDoc?.item?.item_code,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    const newGroup = {
      order_id: orderDoc.order_id,
      brand: orderDoc.brand,
      vendor: orderDoc.vendor,
    };

    groupsToSync.set(
      `${oldGroup.order_id}__${oldGroup.brand}__${oldGroup.vendor}`,
      oldGroup,
    );
    groupsToSync.set(
      `${newGroup.order_id}__${newGroup.brand}__${newGroup.vendor}`,
      newGroup,
    );
  }

  const uniqueGroupsToSync = [...groupsToSync.values()];
  const syncBatchSize = 5;
  for (let i = 0; i < uniqueGroupsToSync.length; i += syncBatchSize) {
    const batch = uniqueGroupsToSync.slice(i, i + syncBatchSize);
    await Promise.all(
      batch.map(async (group) => {
        try {
          await syncOrderGroup(group);
        } catch (syncErr) {
          console.error("Google Calendar sync failed for rectify group:", {
            group,
            error: syncErr?.message || String(syncErr),
          });
        }
      }),
    );
  }

  return {
    inserted_count: insertedCount,
    updated_count: updatedCount,
    quantity_skipped_count: quantitySkippedCount,
    warnings,
  };
};

const resolveClientDayRange = (dateValue, tzOffsetValue) => {
  const dateText = String(dateValue ?? "").trim();
  if (!dateText) return null;

  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const utcMidnightMs = Date.UTC(year, month - 1, day);
  const validationDate = new Date(utcMidnightMs);
  if (
    validationDate.getUTCFullYear() !== year ||
    validationDate.getUTCMonth() + 1 !== month ||
    validationDate.getUTCDate() !== day
  ) {
    return null;
  }

  const parsedOffset = Number.parseInt(String(tzOffsetValue ?? ""), 10);
  const fallbackOffset = new Date().getTimezoneOffset();
  const safeOffsetMinutes = Number.isFinite(parsedOffset)
    ? Math.max(-840, Math.min(840, parsedOffset))
    : fallbackOffset;

  const dayStartMs = utcMidnightMs + safeOffsetMinutes * 60 * 1000;
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;

  return {
    dayStart: new Date(dayStartMs),
    dayEnd: new Date(dayEndMs),
  };
};

const resolveDateFilterBounds = (dateValue, tzOffsetValue) => {
  const normalizedDate = normalizeFilterValue(dateValue);
  if (!normalizedDate) return null;

  const clientDayRange = resolveClientDayRange(normalizedDate, tzOffsetValue);
  if (clientDayRange) return clientDayRange;

  const parsedDate = parseDateLike(normalizedDate);
  if (!(parsedDate instanceof Date) || Number.isNaN(parsedDate.getTime())) {
    return INVALID_DATE_RANGE;
  }

  const dayStart = new Date(
    Date.UTC(
      parsedDate.getUTCFullYear(),
      parsedDate.getUTCMonth(),
      parsedDate.getUTCDate(),
    ),
  );
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  return { dayStart, dayEnd };
};

const buildDateRangeQuery = ({
  fromValue,
  toValue,
  tzOffsetValue,
  label,
} = {}) => {
  const hasFrom = normalizeFilterValue(fromValue) !== null;
  const hasTo = normalizeFilterValue(toValue) !== null;

  const fromBounds = hasFrom
    ? resolveDateFilterBounds(fromValue, tzOffsetValue)
    : null;
  if (fromBounds === INVALID_DATE_RANGE) {
    return { error: `${label} from date is invalid` };
  }

  const toBounds = hasTo
    ? resolveDateFilterBounds(toValue, tzOffsetValue)
    : null;
  if (toBounds === INVALID_DATE_RANGE) {
    return { error: `${label} to date is invalid` };
  }

  if (fromBounds && toBounds && fromBounds.dayStart >= toBounds.dayEnd) {
    return { error: `${label} from date must be before or equal to to date` };
  }

  const range = {};
  if (fromBounds) {
    range.$gte = fromBounds.dayStart;
  }
  if (toBounds) {
    range.$lt = toBounds.dayEnd;
  }

  return Object.keys(range).length > 0 ? { range } : { range: null };
};

const getShipmentQuantityTotal = (shipmentEntries = []) =>
  (Array.isArray(shipmentEntries) ? shipmentEntries : []).reduce(
    (sum, entry) => sum + Number(entry?.quantity || 0),
    0,
  );

const normalizeShipmentEntries = (shipmentPayload) => {
  if (!Array.isArray(shipmentPayload)) {
    throw new Error("shipment must be an array");
  }

  return shipmentPayload.map((entry, index) => {
    const container = String(entry?.container ?? "").trim();
    if (!container) {
      throw new Error(`shipment[${index + 1}] container is required`);
    }

    const invoiceNumber = normalizeShipmentInvoiceNumber(
      entry?.invoice_number ?? entry?.invoiceNumber ?? entry?.invoice,
      "",
    );

    const stuffingDate = parseDateLike(entry?.stuffing_date);
    if (!stuffingDate) {
      throw new Error(`shipment[${index + 1}] stuffing_date is invalid`);
    }

    const quantity = Number(entry?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(
        `shipment[${index + 1}] quantity must be a positive number`,
      );
    }

    const remarks = String(entry?.remaining_remarks ?? "").trim();

    return {
      container,
      invoice_number: invoiceNumber,
      stuffing_date: stuffingDate,
      quantity,
      remaining_remarks: remarks,
      updated_at: entry?.updated_at
        ? parseTimestampLike(entry.updated_at)
        : null,
      updated_by: normalizeHistoryActor(entry?.updated_by),
    };
  });
};

const fitShipmentEntriesToOrderQuantity = (
  shipmentEntries = [],
  orderQuantity = 0,
  { user = null, updatedAt = new Date() } = {},
) => {
  const normalizedQuantity = Number(orderQuantity);
  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0)
    return [];

  let cumulativeShipped = 0;
  const nextEntries = [];

  for (const entry of Array.isArray(shipmentEntries) ? shipmentEntries : []) {
    if (cumulativeShipped >= normalizedQuantity) break;

    const rawQuantity = Number(entry?.quantity);
    if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) continue;

    const remaining = Math.max(0, normalizedQuantity - cumulativeShipped);
    const adjustedQuantity = Math.min(rawQuantity, remaining);
    if (adjustedQuantity <= 0) continue;

    cumulativeShipped += adjustedQuantity;
    nextEntries.push({
      container: String(entry?.container ?? "").trim(),
      invoice_number: normalizeShipmentInvoiceNumber(
        entry?.invoice_number,
        "",
      ),
      stuffing_date: parseDateLike(entry?.stuffing_date),
      quantity: adjustedQuantity,
      pending: Math.max(0, normalizedQuantity - cumulativeShipped),
      remaining_remarks: String(entry?.remaining_remarks ?? "").trim(),
      updated_at: user
        ? updatedAt
        : (entry?.updated_at ? parseTimestampLike(entry.updated_at) : null) ||
          updatedAt,
      updated_by: user
        ? buildAuditActor(user)
        : normalizeHistoryActor(entry?.updated_by),
    });
  }

  return nextEntries;
};

const computeOrderStatus = ({ orderQuantity, shippedQuantity, qcRecord }) => {
  return deriveOrderStatus({
    orderQuantity,
    shippedQuantity,
    qcRecord,
    allowCancelledOnZero: true,
  });
};

const normalizePoBucket = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "all" ||
    normalized === "all-orders" ||
    normalized === "all_orders"
  ) {
    return "all";
  }

  if (
    normalized === "inspected" ||
    normalized === "inspected-orders" ||
    normalized === "inspected_orders"
  ) {
    return "inspected";
  }

  if (
    normalized === "shipped" ||
    normalized === "shipped-orders" ||
    normalized === "shipped_orders"
  ) {
    return "shipped";
  }

  return "open";
};

const derivePoLineProgress = ({ orderEntry = {}, qcRecord = null } = {}) => {
  return deriveOrderProgress({ orderEntry, qcRecord });
};

const computeGroupedPoStatus = (statuses = []) =>
  deriveGroupedOrderStatus(statuses);

const computePoBucketFromTotals = (groupedEntry = {}) => {
  const totalQuantity = Math.max(
    0,
    Number(groupedEntry?.total_quantity || 0),
  );
  const totalShippedQuantity = Math.max(
    0,
    Number(groupedEntry?.total_shipped_quantity || 0),
  );
  const totalPendingInspectionQuantity = Math.max(
    0,
    Number(groupedEntry?.total_pending_inspection_quantity || 0),
  );

  if (totalQuantity > 0 && totalShippedQuantity >= totalQuantity) {
    return "shipped";
  }

  if (totalPendingInspectionQuantity > 0) {
    return "open";
  }

  return "inspected";
};

const comparePoBucketRows = (leftRow, rightRow, sortBy = "order_date", sortOrder = "desc") => {
  const direction = sortOrder === "asc" ? 1 : -1;

  const resolveSortValue = (row, key) => {
    if (key === "order_id") {
      return normalizeOrderKey(row?.order_id || "") || "";
    }

    if (key === "ETD") {
      const parsedDate = parseDateLike(row?.ETD);
      return parsedDate ? parsedDate.getTime() : 0;
    }

    if (key === "order_date") {
      const parsedDate = parseDateLike(row?.order_date);
      return parsedDate ? parsedDate.getTime() : 0;
    }

    return normalizeLooseString(row?.[key]);
  };

  const compareValues = (leftValue, rightValue) => {
    if (typeof leftValue === "number" || typeof rightValue === "number") {
      return Number(leftValue || 0) - Number(rightValue || 0);
    }

    return String(leftValue || "").localeCompare(String(rightValue || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  };

  const primaryComparison = compareValues(
    resolveSortValue(leftRow, sortBy),
    resolveSortValue(rightRow, sortBy),
  );
  if (primaryComparison !== 0) {
    return primaryComparison * direction;
  }

  const orderDateComparison = compareValues(
    resolveSortValue(leftRow, "order_date"),
    resolveSortValue(rightRow, "order_date"),
  );
  if (orderDateComparison !== 0) {
    return orderDateComparison * -1;
  }

  return compareValues(
    resolveSortValue(leftRow, "order_id"),
    resolveSortValue(rightRow, "order_id"),
  );
};

const buildPoBucketDataset = async ({
  brand = "",
  vendor = "",
  order = "",
  itemCode = "",
  status = "",
  poBucket = "open",
  sortBy = "order_date",
  sortOrder = "desc",
  orderDateRange = null,
  etdRange = null,
} = {}) => {
  const selectedBucket = normalizePoBucket(poBucket);
  const matchStage = buildOrderListMatch({
    brand,
    vendor,
    order,
    itemCode,
    includeStatus: false,
  });

  if (orderDateRange) {
    matchStage.order_date = orderDateRange;
  }

  if (etdRange) {
    matchStage.ETD = etdRange;
  }

  const sourceOrders = await Order.find(matchStage)
    .select(
      "_id order_id brand vendor ETD revised_ETD order_date quantity item shipment qc_record",
    )
    .populate({
      path: "qc_record",
      select: "order quantities request_history last_inspected_date inspection_dates",
    })
    .sort({ order_date: -1, order_id: 1 })
    .lean();

  const orderObjectIds = [
    ...new Set(
      sourceOrders
        .map((orderEntry) => String(orderEntry?._id || "").trim())
        .filter((value) => mongoose.Types.ObjectId.isValid(value)),
    ),
  ].map((value) => new mongoose.Types.ObjectId(value));

  const fallbackQcRecords = orderObjectIds.length > 0
    ? await QC.find({ order: { $in: orderObjectIds } })
      .select("order quantities request_history last_inspected_date inspection_dates")
      .lean()
    : [];

  const qcByOrderId = fallbackQcRecords.reduce((accumulator, qcRecord) => {
    const orderKey = String(qcRecord?.order || "").trim();
    if (orderKey && !accumulator.has(orderKey)) {
      accumulator.set(orderKey, qcRecord);
    }
    return accumulator;
  }, new Map());

  const groupedOrders = new Map();

  for (const orderEntry of sourceOrders) {
    const orderKey =
      normalizeOrderKey(orderEntry?.order_id) ||
      normalizeLooseString(orderEntry?.order_id) ||
      String(orderEntry?._id || "").trim();
    if (!orderKey) continue;

    const populatedQcRecord =
      orderEntry?.qc_record &&
      typeof orderEntry.qc_record === "object" &&
      !Array.isArray(orderEntry.qc_record)
        ? orderEntry.qc_record
        : null;
    const qcRecord =
      populatedQcRecord ||
      qcByOrderId.get(String(orderEntry?._id || "").trim()) ||
      null;
    const lineProgress = derivePoLineProgress({ orderEntry, qcRecord });

    if (!groupedOrders.has(orderKey)) {
      groupedOrders.set(orderKey, {
        order_id: normalizeLooseString(orderEntry?.order_id) || orderKey,
        brand: normalizeLooseString(orderEntry?.brand) || "N/A",
        vendor: normalizeLooseString(orderEntry?.vendor) || "N/A",
        ETD: null,
        revised_ETD: null,
        effective_ETD: null,
        order_date: null,
        last_inspected_date: null,
        latest_shipment_date: null,
        items: 0,
        statuses: [],
        total_quantity: 0,
        total_shipped_quantity: 0,
        total_inspected_unshipped_quantity: 0,
        total_pending_inspection_quantity: 0,
        item_codes: new Set(),
      });
    }

    const groupedEntry = groupedOrders.get(orderKey);
    groupedEntry.items += 1;
    groupedEntry.statuses.push(lineProgress.status);
    groupedEntry.total_quantity += lineProgress.order_quantity;
    groupedEntry.total_shipped_quantity += lineProgress.shipped_quantity;
    groupedEntry.total_inspected_unshipped_quantity +=
      lineProgress.inspected_unshipped_quantity;
    groupedEntry.total_pending_inspection_quantity +=
      lineProgress.pending_inspection_quantity;
    groupedEntry.order_date = resolveEarlierDate(
      groupedEntry.order_date,
      orderEntry?.order_date,
    );
    groupedEntry.ETD = resolveEarlierDate(groupedEntry.ETD, orderEntry?.ETD);
    groupedEntry.revised_ETD = resolveEarlierDate(
      groupedEntry.revised_ETD,
      orderEntry?.revised_ETD,
    );
    groupedEntry.effective_ETD = resolveEarlierDate(
      groupedEntry.effective_ETD,
      resolveEffectiveOrderEtdDate(orderEntry),
    );
    groupedEntry.last_inspected_date = resolveLaterDate(
      groupedEntry.last_inspected_date,
      resolveLatestInspectionDate(qcRecord),
    );
    groupedEntry.latest_shipment_date = resolveLaterDate(
      groupedEntry.latest_shipment_date,
      resolveLatestShipmentDate(orderEntry?.shipment),
    );

    const itemCodeValue = normalizeLooseString(orderEntry?.item?.item_code);
    if (itemCodeValue) {
      groupedEntry.item_codes.add(itemCodeValue);
    }
  }

  const groupedRows = [...groupedOrders.values()].map((groupedEntry) => {
    const statuses = normalizeStatusList(groupedEntry.statuses);
    const totalStatus = computeGroupedPoStatus(statuses);
    const statusCounts = createPoStatusCounts();
    groupedEntry.statuses.forEach((statusValue) =>
      incrementPoStatusCounts(statusCounts, statusValue));
    return {
      order_id: groupedEntry.order_id,
      items: groupedEntry.items,
      brand: groupedEntry.brand,
      vendor: groupedEntry.vendor,
      ETD: groupedEntry.ETD,
      revised_ETD: groupedEntry.revised_ETD,
      effective_ETD: groupedEntry.effective_ETD,
      order_date: groupedEntry.order_date,
      last_inspected_date: groupedEntry.last_inspected_date,
      latest_shipment_date: groupedEntry.latest_shipment_date,
      statuses,
      status_counts: statusCounts,
      totalStatus,
      po_bucket: computePoBucketFromTotals(groupedEntry),
      total_quantity: groupedEntry.total_quantity,
      total_shipped_quantity: groupedEntry.total_shipped_quantity,
      total_inspected_unshipped_quantity:
        groupedEntry.total_inspected_unshipped_quantity,
      total_pending_inspection_quantity:
        groupedEntry.total_pending_inspection_quantity,
      item_codes: [...groupedEntry.item_codes].sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })),
    };
  });

  const bucketRows = selectedBucket === "all"
    ? groupedRows
    : groupedRows.filter((row) => row.po_bucket === selectedBucket);
  const normalizedStatus = normalizeFilterValue(status);
  const exactStatus = ORDER_STATUS_SEQUENCE.find(
    (statusValue) =>
      statusValue.toLowerCase() === String(normalizedStatus || "").toLowerCase(),
  ) || null;
  const filteredRows = exactStatus
    ? bucketRows.filter((row) => row.totalStatus === exactStatus)
    : bucketRows;

  filteredRows.sort((leftRow, rightRow) =>
    comparePoBucketRows(leftRow, rightRow, sortBy, sortOrder));

  return {
    rows: filteredRows,
    sourceOrders,
    sort: {
      sort_by: sortBy,
      sort_order: sortOrder,
    },
    filters: {
      vendors: normalizeDistinctValues(bucketRows.map((row) => row.vendor)),
      brands: normalizeDistinctValues(bucketRows.map((row) => row.brand)),
      statuses: normalizeStatusList(bucketRows.map((row) => row.totalStatus)),
      order_ids: normalizeDistinctValues(bucketRows.map((row) => row.order_id)),
      item_codes: normalizeDistinctValues(bucketRows.flatMap((row) => row.item_codes)),
    },
  };
};

const resolveShipmentSortConfig = ({
  sortToken = "",
  sortByInput = "",
  sortOrderInput = "",
} = {}) => {
  const sortAliases = {
    po: "order_id",
    order: "order_id",
    orderid: "order_id",
    order_id: "order_id",
    item: "item_code",
    itemcode: "item_code",
    item_code: "item_code",
    vendor: "vendor",
    brand: "brand",
    status: "status",
    stuffingdate: "stuffing_date",
    stuffing_date: "stuffing_date",
    container: "container",
    containernumber: "container",
    container_number: "container",
    invoice: "invoice_number",
    invoicenumber: "invoice_number",
    invoice_number: "invoice_number",
    quantity: "quantity",
    pending: "pending",
    orderquantity: "order_quantity",
    order_quantity: "order_quantity",
  };

  const allowedSortFields = new Set([
    "order_id",
    "item_code",
    "vendor",
    "brand",
    "status",
    "order_quantity",
    "stuffing_date",
    "container",
    "invoice_number",
    "quantity",
    "pending",
  ]);

  const normalizedSortToken = normalizeFilterValue(sortToken);
  const rawSortBy = normalizeFilterValue(sortByInput);
  const sortTokenDirection = String(normalizedSortToken || "").startsWith("-")
    ? "desc"
    : String(normalizedSortToken || "").startsWith("+")
      ? "asc"
      : null;

  const normalizedSortKey = String(
    rawSortBy ||
      String(normalizedSortToken || "").replace(/^[+-]/, "") ||
      "stuffing_date",
  )
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();

  const sortBy = allowedSortFields.has(sortAliases[normalizedSortKey])
    ? sortAliases[normalizedSortKey]
    : "stuffing_date";

  const explicitSortOrder = String(sortOrderInput || "")
    .trim()
    .toLowerCase();

  let sortOrder = "asc";
  if (sortBy === "stuffing_date") {
    sortOrder = "desc";
  }
  if (sortTokenDirection) {
    sortOrder = sortTokenDirection;
  }
  if (explicitSortOrder === "asc" || explicitSortOrder === "desc") {
    sortOrder = explicitSortOrder;
  }

  const sortDirection = sortOrder === "asc" ? 1 : -1;

  return {
    sortBy,
    sortOrder,
    sortDirection,
  };
};

const mapOrdersToShipmentRows = (orders = []) =>
  orders.flatMap((order) => {
    const shipmentEntries = Array.isArray(order?.shipment)
      ? order.shipment
      : [];
    const parsedOrderQuantity = Number(order?.quantity);
    const normalizedOrderQuantity = Number.isFinite(parsedOrderQuantity)
      ? parsedOrderQuantity
      : 0;

    const baseRow = {
      _id: order?._id || null,
      order_id: order?.order_id || "",
      brand: order?.brand || "",
      vendor: order?.vendor || "",
      ETD: order?.ETD || null,
      order_date: order?.order_date || null,
      updatedAt: order?.updatedAt || null,
      item: {
        item_code: order?.item?.item_code || "",
        description: order?.item?.description || "",
      },
      item_code: order?.item?.item_code || "",
      description: order?.item?.description || "",
      order_quantity: normalizedOrderQuantity,
      shipment: shipmentEntries,
      status: order?.status || "",
      passed_quantity: Number(order?.passed_quantity || 0),
      shippable_quantity: Number(order?.shippable_quantity || 0),
    };

    if (shipmentEntries.length === 0) {
      return [
        {
          ...baseRow,
          shipment_id: null,
          stuffing_date: null,
          container: "",
          invoice_number: "N/A",
          quantity: normalizedOrderQuantity,
          pending: normalizedOrderQuantity,
          remaining_remarks: "",
        },
      ];
    }

    return shipmentEntries.map((entry, index) => {
      const parsedShipmentQuantity = Number(entry?.quantity);
      const parsedPending = Number(entry?.pending);

      return {
        ...baseRow,
        shipment_id: entry?._id || `${order?._id || "order"}-${index}`,
        stuffing_date: entry?.stuffing_date || null,
        container: entry?.container || "",
        invoice_number: normalizeShipmentInvoiceNumber(entry?.invoice_number),
        quantity: Number.isFinite(parsedShipmentQuantity)
          ? parsedShipmentQuantity
          : 0,
        pending: Number.isFinite(parsedPending) ? parsedPending : 0,
        remaining_remarks: entry?.remaining_remarks || "",
      };
    });
  });

const toShipmentTimestamp = (value) => {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const toShipmentNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareShipmentValues = (aValue, bValue) => {
  const aIsNumber = typeof aValue === "number";
  const bIsNumber = typeof bValue === "number";
  if (aIsNumber && bIsNumber) return aValue - bValue;
  return String(aValue).localeCompare(String(bValue));
};

const getShipmentSortValue = (row, sortBy) => {
  switch (sortBy) {
    case "order_id":
      return String(row?.order_id || "");
    case "item_code":
      return String(row?.item_code || "");
    case "vendor":
      return String(row?.vendor || "");
    case "brand":
      return String(row?.brand || "");
    case "status": {
      const statusIndex = ORDER_STATUS_SEQUENCE.indexOf(
        String(row?.status || ""),
      );
      return statusIndex === -1 ? ORDER_STATUS_SEQUENCE.length : statusIndex;
    }
    case "order_quantity":
      return toShipmentNumber(row?.order_quantity);
    case "stuffing_date":
      return toShipmentTimestamp(row?.stuffing_date);
    case "container":
      return String(row?.container || "");
    case "invoice_number":
      return normalizeShipmentInvoiceNumber(row?.invoice_number);
    case "quantity":
      return toShipmentNumber(row?.quantity);
    case "pending":
      return toShipmentNumber(row?.pending);
    default:
      return toShipmentTimestamp(row?.stuffing_date);
  }
};

const getShipmentDataset = async ({
  brand,
  vendor,
  orderId,
  itemCode,
  container,
  statusFilter,
  sortToken,
  sortByInput,
  sortOrderInput,
} = {}) => {
  const { sortBy, sortOrder, sortDirection } = resolveShipmentSortConfig({
    sortToken,
    sortByInput,
    sortOrderInput,
  });

  const filterInput = {
    brand,
    vendor,
    orderId,
    itemCode,
    container,
  };

  const orders = await Order.find(buildShipmentMatch(filterInput))
    .select(
      "order_id item brand vendor ETD status quantity shipment order_date updatedAt qc_record",
    )
    .populate({
      path: "qc_record",
      select: "quantities request_history",
    })
    .sort({ order_date: -1, updatedAt: -1, order_id: -1 })
    .lean();

  // Remove duplicate orders by order_id
  const uniqueOrders = orders;

  const derivedOrders = uniqueOrders
    .map((orderEntry) => {
      const progress = deriveOrderProgress({ orderEntry });
      return {
        ...orderEntry,
        status: progress.status,
        passed_quantity: progress.passed_quantity,
        shippable_quantity: Math.max(
          0,
          progress.passed_quantity - progress.shipped_quantity,
        ),
      };
    })
    .filter((orderEntry) => {
      const shipmentEntries = Array.isArray(orderEntry?.shipment)
        ? orderEntry.shipment
        : [];
      return (
        shipmentEntries.length > 0 ||
        SHIPMENT_VISIBLE_STATUSES.includes(orderEntry?.status)
      );
    });

  const rows = mapOrdersToShipmentRows(derivedOrders);

  const normalizedContainer = normalizeFilterValue(container);
  const containerNeedle = normalizedContainer
    ? normalizedContainer.toLowerCase()
    : null;

  const containerFilteredRows = containerNeedle
    ? rows.filter((row) =>
        String(row?.container || "")
          .toLowerCase()
          .includes(containerNeedle),
      )
    : rows;

  const summary = containerFilteredRows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row?.status === "Pending") acc.pending += 1;
      if (row?.status === "Under Inspection") acc.underInspection += 1;
      if (row?.status === "Inspection Done") acc.inspectionDone += 1;
      if (row?.status === "Partial Shipped") acc.partialShipped += 1;
      if (row?.status === "Shipped") acc.shipped += 1;
      return acc;
    },
    {
      total: 0,
      pending: 0,
      underInspection: 0,
      inspectionDone: 0,
      partialShipped: 0,
      shipped: 0,
    },
  );

  const statusScopedRows =
    statusFilter && ORDER_STATUS_SEQUENCE.includes(statusFilter)
      ? containerFilteredRows.filter((row) => row?.status === statusFilter)
      : containerFilteredRows;

  const sortedRows = [...statusScopedRows].sort((a, b) => {
    const primaryComparison = compareShipmentValues(
      getShipmentSortValue(a, sortBy),
      getShipmentSortValue(b, sortBy),
    );
    if (primaryComparison !== 0) {
      return primaryComparison * sortDirection;
    }

    const orderCompare = String(a?.order_id || "").localeCompare(
      String(b?.order_id || ""),
    );
    if (orderCompare !== 0) return orderCompare;

    return String(a?.item_code || "").localeCompare(String(b?.item_code || ""));
  });

  return {
    rows: sortedRows,
    summary,
    sort: {
      sort_by: sortBy,
      sort_order: sortOrder,
    },
    filters: {
      brands: normalizeDistinctValues(derivedOrders.map((row) => row?.brand)),
      vendors: normalizeDistinctValues(derivedOrders.map((row) => row?.vendor)),
      order_ids: normalizeDistinctValues(
        derivedOrders.map((row) => row?.order_id),
      ),
      containers: normalizeDistinctValues(rows.map((row) => row?.container)),
      item_codes: normalizeDistinctValues(
        derivedOrders.map((row) => row?.item?.item_code),
      ),
    },
  };
};

const getContainerDataset = async ({
  brand,
  vendor,
  container,
} = {}) => {
  const shipmentData = await getShipmentDataset({
    brand,
    vendor,
    container,
    sortByInput: "stuffing_date",
    sortOrderInput: "desc",
  });

  const groupedByContainer = new Map();

  for (const row of shipmentData.rows) {
    const containerNumber = String(row?.container || "").trim();
    if (!containerNumber) continue;

    const existingGroup = groupedByContainer.get(containerNumber) || {
      container: containerNumber,
      brandSet: new Set(),
      vendorSet: new Set(),
      shipping_date: null,
      itemKeySet: new Set(),
      total_quantity: 0,
    };

    const brandValue = String(row?.brand || "").trim();
    const vendorValue = String(row?.vendor || "").trim();
    const shippingDate = row?.stuffing_date || null;
    const itemKey = String(
      row?._id || `${row?.order_id || ""}::${row?.item_code || ""}`,
    ).trim();

    existingGroup.total_quantity += Number(row?.quantity || 0);

    if (brandValue) existingGroup.brandSet.add(brandValue);
    if (vendorValue) existingGroup.vendorSet.add(vendorValue);
    if (
      shippingDate
      && (
        !existingGroup.shipping_date
        || toShipmentTimestamp(shippingDate)
          > toShipmentTimestamp(existingGroup.shipping_date)
      )
    ) {
      existingGroup.shipping_date = shippingDate;
    }
    if (itemKey) existingGroup.itemKeySet.add(itemKey);

    groupedByContainer.set(containerNumber, existingGroup);
  }

  const rows = Array.from(groupedByContainer.values())
    .map((group) => ({
      container: group.container,
      brand: normalizeDistinctValues(Array.from(group.brandSet)).join(", ") || "N/A",
      vendor: normalizeDistinctValues(Array.from(group.vendorSet)).join(", ") || "N/A",
      shipping_date: group.shipping_date || null,
      item_count: group.itemKeySet.size,
      total_quantity: group.total_quantity,
    }))
    .sort((left, right) => {
      const dateCompare =
        toShipmentTimestamp(right?.shipping_date) -
        toShipmentTimestamp(left?.shipping_date);
      if (dateCompare !== 0) return dateCompare;
      return String(left?.container || "").localeCompare(
        String(right?.container || ""),
      );
    });

  return {
    rows,
    summary: {
      total: rows.length,
    },
    filters: {
      brands: shipmentData.filters.brands,
      vendors: shipmentData.filters.vendors,
      containers: shipmentData.filters.containers,
    },
  };
};

const makeUploadOrderKey = (orderId, itemCode) =>
  `${normalizeOrderKey(orderId)}__${normalizeLooseString(itemCode).toUpperCase()}`;

const buildUploadOrderRowId = (row = {}, index = 0) => {
  const baseKey = makeUploadOrderKey(
    row?.PO ?? row?.order_id ?? row?.orderId,
    row?.item_code ?? row?.itemCode,
  );
  return baseKey ? `${baseKey}__${index}` : `upload_row__${index}`;
};

const normalizeUploadedSelectionRow = (row = {}, index = 0) => {
  const quantityRaw = row?.quantity;
  const parsedQuantity = Number(quantityRaw);
  const previousOrderAction = normalizePreviousOrderActionInput(
    row?.previous_order_action || row?.previousOrderAction,
  );

  return {
    row_id: String(row?.row_id || buildUploadOrderRowId(row, index)),
    order_id: normalizeLooseString(row?.PO ?? row?.order_id ?? row?.orderId),
    item_code: normalizeLooseString(row?.item_code ?? row?.itemCode),
    description: normalizeLooseString(row?.description),
    brand: normalizeLooseString(row?.brand),
    vendor: normalizeLooseString(row?.vendor),
    quantity: Number.isFinite(parsedQuantity)
      ? parsedQuantity
      : (quantityRaw ?? ""),
    ETD: dateParser(row?.ETD ?? row?.etd),
    order_date: dateParser(row?.order_date ?? row?.orderDate),
    change_type: "",
    reason: "",
    changed_fields: [],
    existing_order_id: String(row?.existing_order_id || "").trim() || null,
    existing_order_status:
      normalizeLooseString(row?.existing_order_status) || null,
    previous_order_action: previousOrderAction,
  };
};

const buildUploadedOrderDocument = (row = {}) => ({
  order_id: row.order_id,
  item: {
    item_code: row.item_code,
    description: row.description,
  },
  brand: row.brand,
  vendor: row.vendor,
  ETD: row.ETD || undefined,
  order_date: row.order_date || undefined,
  status: "Pending",
  quantity: Number(row.quantity),
});

const buildUploadPreviewSummary = ({
  previewRows = [],
  totalRowsReceived = 0,
  totalRowsUnique = 0,
} = {}) => {
  const rows = Array.isArray(previewRows) ? previewRows : [];
  const countByType = (type) =>
    rows.filter(
      (row) =>
        String(row?.change_type || "")
          .trim()
          .toLowerCase() === type,
    ).length;

  return {
    extracted_rows: totalRowsReceived,
    valid_unique_rows: totalRowsUnique,
    selectable_rows: countByType("new"),
    changed_rows:
      countByType("new") + countByType("modified") + countByType("closed"),
    new_rows: countByType("new"),
    modified_rows: countByType("modified"),
    closed_rows: countByType("closed"),
    invalid_rows:
      countByType("missing_required_fields") + countByType("invalid_quantity"),
    duplicate_in_file_rows: countByType("duplicate_in_file"),
    already_exists_rows: countByType("already_exists"),
  };
};

const prepareUploadOrdersFromRows = async (rowsInput = []) => {
  const sourceRows = Array.isArray(rowsInput) ? rowsInput : [];
  const totalRowsReceived = sourceRows.length;
  const duplicateEntries = [];
  const seenKeys = new Set();
  const presentUploadKeys = new Set();

  const previewRows = sourceRows.map((row, index) =>
    normalizeUploadedSelectionRow(row, index),
  );

  const candidateRows = [];

  for (const previewRow of previewRows) {
    const orderId = previewRow.order_id;
    const itemCode = previewRow.item_code;
    const brand = previewRow.brand;
    const vendor = previewRow.vendor;
    const quantity = Number(previewRow.quantity);
    const key = makeUploadOrderKey(orderId, itemCode);

    if (orderId && itemCode && key) {
      presentUploadKeys.add(key);
    }

    if (!orderId || !itemCode || !brand || !vendor) {
      previewRow.change_type = "missing_required_fields";
      previewRow.reason = "missing_required_fields";
      duplicateEntries.push({
        order_id: orderId,
        item_code: itemCode,
        reason: "missing_required_fields",
      });
      continue;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      previewRow.change_type = "invalid_quantity";
      previewRow.reason = "invalid_quantity";
      duplicateEntries.push({
        order_id: orderId,
        item_code: itemCode,
        reason: "invalid_quantity",
      });
      continue;
    }

    if (seenKeys.has(key)) {
      previewRow.change_type = "duplicate_in_file";
      previewRow.reason = "duplicate_in_file";
      duplicateEntries.push({
        order_id: orderId,
        item_code: itemCode,
        reason: "duplicate_in_file",
      });
      continue;
    }

    seenKeys.add(key);
    previewRow.change_type = "new";
    previewRow.reason = "";
    candidateRows.push(previewRow);
  }

  const totalRowsUnique = candidateRows.length;
  const totalDistinctOrdersUploaded = new Set(
    candidateRows.map((row) => normalizeOrderKey(row.order_id)).filter(Boolean),
  ).size;

  const comparisonPairs = buildBrandVendorPairsFromRows(candidateRows);
  const { existingByKey, openOrdersByKey } =
    await loadExistingOrdersForBrandVendorPairs(comparisonPairs);

  const orders = candidateRows.map((row) => buildUploadedOrderDocument(row));
  const newOrders = [];

  for (const previewRow of candidateRows) {
    const key = makeUploadOrderKey(previewRow.order_id, previewRow.item_code);
    const existingOrder = existingByKey.get(key);

    if (!existingOrder) {
      previewRow.change_type = "new";
      previewRow.reason = "";
      previewRow.changed_fields = ["new_order"];
      newOrders.push(buildUploadedOrderDocument(previewRow));
      continue;
    }

    Object.assign(previewRow, getExistingOrderPreviewMeta(existingOrder));

    const changedFields = getRectifiedChangedFields(previewRow, existingOrder);
    if (changedFields.length === 0) {
      previewRow.change_type = "already_exists";
      previewRow.reason = "already_exists";
      duplicateEntries.push({
        order_id: previewRow.order_id,
        item_code: previewRow.item_code,
        reason: "already_exists",
      });
      continue;
    }

    previewRow.change_type = "modified";
    previewRow.reason = "";
    previewRow.changed_fields = changedFields;
  }

  for (const [openKey, openOrder] of openOrdersByKey.entries()) {
    if (presentUploadKeys.has(openKey)) continue;

    const openQuantity = computeRectifyOpenQuantity(openOrder);
    if (!Number.isFinite(openQuantity) || openQuantity <= 0) continue;

    previewRows.push({
      row_id: `${openKey}__closed`,
      order_id: normalizeOrderKey(openOrder?.order_id),
      item_code: normalizeLooseString(openOrder?.item?.item_code),
      description: normalizeLooseString(openOrder?.item?.description),
      brand: normalizeLooseString(openOrder?.brand),
      vendor: normalizeLooseString(openOrder?.vendor),
      quantity: openQuantity,
      ETD:
        openOrder?.ETD ||
        deriveRectifyDefaultEtd(openOrder?.order_date) ||
        null,
      order_date: openOrder?.order_date || null,
      change_type: "closed",
      reason: "",
      changed_fields: ["missing_in_upload"],
      ...getExistingOrderPreviewMeta(openOrder),
    });
  }

  return {
    previewRows,
    orders,
    newOrders,
    duplicateEntries,
    totalRowsReceived,
    totalRowsUnique,
    totalDistinctOrdersUploaded,
    summary: buildUploadPreviewSummary({
      previewRows,
      totalRowsReceived,
      totalRowsUnique,
    }),
  };
};

exports.lookupPreviousOrder = async (req, res) => {
  try {
    const orderId = normalizeOrderKey(
      req.query?.order_id ??
        req.query?.previous_order_id ??
        req.body?.order_id ??
        req.body?.previous_order_id ??
        "",
    );
    const itemCode = normalizeRectifyText(
      req.query?.item_code ?? req.body?.item_code ?? "",
    );

    if (!orderId) {
      return res.status(400).json({ message: "order_id is required" });
    }

    if (!itemCode) {
      return res.status(400).json({ message: "item_code is required" });
    }

    const orderDoc = await Order.findOne({
      ...ACTIVE_ORDER_MATCH,
      order_id: buildExactTextQuery(orderId),
      "item.item_code": buildExactTextQuery(itemCode),
    }).sort({ updatedAt: -1, createdAt: -1 });

    if (!orderDoc) {
      return res.status(404).json({
        message: `No active order found for PO ${orderId} and item ${itemCode}`,
      });
    }

    const qcDoc = await loadLinkedQcForOrder(orderDoc);
    return res.status(200).json({
      success: true,
      ...buildPreviousOrderResponse({
        orderDoc,
        qcDoc,
      }),
    });
  } catch (error) {
    console.error("Lookup Previous Order Error:", error);
    return res.status(500).json({
      message: "Failed to check previous order",
      error: error?.message || String(error),
    });
  }
};

// Upload Orders Controller
exports.uploadOrders = async (req, res) => {
  const uploadedById =
    req.user?._id && mongoose.Types.ObjectId.isValid(req.user._id)
      ? req.user._id
      : null;
  const uploadMeta = {
    uploaded_by: uploadedById,
    uploaded_by_name: String(
      req.user?.name || req.user?.username || req.user?.email || "",
    ).trim(),
    source_filename: String(
      req.file?.originalname || req.body?.source_filename || "",
    ).trim(),
    source_size_bytes: Number(
      req.file?.size || req.body?.source_size_bytes || 0,
    ),
    source_file_storage: null,
  };

  let totalRowsReceived = 0;
  let totalRowsUnique = 0;
  let totalDistinctOrdersUploaded = 0;
  let insertedCount = 0;
  let duplicateEntries = [];
  let uploadedBrands = [];
  let uploadedVendors = [];
  let vendorSummaries = [];
  let conflicts = [];

  try {
    const shouldPreviewOnly = parseBooleanInput(req.body?.preview_only, false);

    let selectedRowsPayload = null;
    if (Array.isArray(req.body?.selected_rows)) {
      selectedRowsPayload = req.body.selected_rows;
    } else {
      const selectedRowsRaw = String(req.body?.selected_rows || "").trim();
      if (selectedRowsRaw) {
        try {
          const parsed = JSON.parse(selectedRowsRaw);
          if (Array.isArray(parsed)) {
            selectedRowsPayload = parsed;
          } else {
            return res
              .status(400)
              .json({ message: "selected_rows must be an array" });
          }
        } catch {
          return res
            .status(400)
            .json({ message: "selected_rows must be valid JSON array" });
        }
      }
    }

    let sourceRows = [];
    if (Array.isArray(selectedRowsPayload) && selectedRowsPayload.length > 0) {
      sourceRows = selectedRowsPayload;
    } else {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      uploadMeta.source_file_storage = await uploadSourceFileToWasabi(
        req.file,
        "orders/uploads",
      );
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    const preparedUpload = await prepareUploadOrdersFromRows(sourceRows);
    const orders = preparedUpload.orders;
    const newRowsToInsert = preparedUpload.previewRows.filter(
      (row) =>
        String(row?.change_type || "")
          .trim()
          .toLowerCase() === "new",
    );
    const applyWarnings = [];

    totalRowsReceived = preparedUpload.totalRowsReceived;
    totalRowsUnique = preparedUpload.totalRowsUnique;
    totalDistinctOrdersUploaded = preparedUpload.totalDistinctOrdersUploaded;
    duplicateEntries = preparedUpload.duplicateEntries;

    if (shouldPreviewOnly) {
      return res.status(200).json({
        message: "Upload preview ready",
        summary: preparedUpload.summary,
        preview_rows: preparedUpload.previewRows,
      });
    }

    const normalizeValue = (value) => normalizeLooseString(value);

    const brandVendorUploadMap = new Map();

    for (const order of orders) {
      const brand = normalizeValue(order.brand);
      const brandKey = normalizeBrandKey(brand);
      const vendor = normalizeValue(order.vendor);
      const vendorKey = normalizeVendorKey(vendor);
      const brandVendorKey = normalizeBrandVendorKey(brand, vendor);
      const orderId = normalizeValue(order.order_id);
      const orderKey = normalizeOrderKey(orderId);

      if (!brandKey || !vendorKey || !orderKey) continue;

      if (!brandVendorUploadMap.has(brandVendorKey)) {
        brandVendorUploadMap.set(brandVendorKey, {
          brand_vendor_key: brandVendorKey,
          brand_key: brandKey,
          brand,
          vendor_key: vendorKey,
          vendor,
          uploaded_order_ids: new Set(),
          uploaded_order_keys: new Set(),
          items_per_order_count: new Map(),
        });
      }

      const brandVendorBucket = brandVendorUploadMap.get(brandVendorKey);
      brandVendorBucket.uploaded_order_ids.add(orderId);
      brandVendorBucket.uploaded_order_keys.add(orderKey);
      brandVendorBucket.items_per_order_count.set(
        orderId,
        Number(brandVendorBucket.items_per_order_count.get(orderId) || 0) + 1,
      );
    }

    uploadedBrands = [...brandVendorUploadMap.values()]
      .map((entry) => entry.brand)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    uploadedBrands = normalizeDistinctValues(uploadedBrands);

    uploadedVendors = [...brandVendorUploadMap.values()]
      .map((entry) => entry.vendor)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    uploadedVendors = normalizeDistinctValues(uploadedVendors);

    const uploadedBrandVendorPairs = [...brandVendorUploadMap.values()].map(
      (entry) => ({
        brand: entry.brand,
        vendor: entry.vendor,
      }),
    );

    const openOrders =
      uploadedBrandVendorPairs.length > 0
        ? await Order.find({
            ...ACTIVE_ORDER_MATCH,
            status: { $nin: ["Shipped"] },
            $or: uploadedBrandVendorPairs.map((entry) => ({
              brand: entry.brand,
              vendor: entry.vendor,
            })),
          })
            .select("brand vendor order_id")
            .lean()
        : [];

    const openBrandVendorOrderMap = new Map();
    for (const openOrder of openOrders) {
      const brand = normalizeValue(openOrder?.brand);
      const brandKey = normalizeBrandKey(brand);
      const vendor = normalizeValue(openOrder?.vendor);
      const vendorKey = normalizeVendorKey(vendor);
      const brandVendorKey = normalizeBrandVendorKey(brand, vendor);
      const orderId = normalizeValue(openOrder?.order_id);
      const orderKey = normalizeOrderKey(orderId);

      if (
        !brandKey ||
        !vendorKey ||
        !orderKey ||
        !brandVendorUploadMap.has(brandVendorKey)
      ) {
        continue;
      }

      if (!openBrandVendorOrderMap.has(brandVendorKey)) {
        openBrandVendorOrderMap.set(brandVendorKey, new Map());
      }

      const orderMap = openBrandVendorOrderMap.get(brandVendorKey);
      if (!orderMap.has(orderKey)) {
        orderMap.set(orderKey, orderId);
      }
    }

    conflicts = [];
    vendorSummaries = [...brandVendorUploadMap.values()]
      .sort((a, b) => {
        const brandCompare = a.brand.localeCompare(b.brand);
        if (brandCompare !== 0) return brandCompare;
        return a.vendor.localeCompare(b.vendor);
      })
      .map((vendorEntry) => {
        const uploadedOrderIds = [...vendorEntry.uploaded_order_ids].sort(
          (a, b) => a.localeCompare(b),
        );
        const perOrderCounts = vendorEntry.items_per_order_count;

        const itemsPerOrder = uploadedOrderIds.map((orderId) => ({
          order_id: orderId,
          items_count: Number(perOrderCounts.get(orderId) || 0),
        }));

        const uploadedItemsCount = itemsPerOrder.reduce(
          (sum, entry) => sum + Number(entry?.items_count || 0),
          0,
        );

        const openOrderMap =
          openBrandVendorOrderMap.get(vendorEntry.brand_vendor_key) ||
          new Map();
        const missingOpenOrderIds = [...openOrderMap.entries()]
          .filter(
            ([orderKey]) => !vendorEntry.uploaded_order_keys.has(orderKey),
          )
          .map(([, orderId]) => orderId)
          .sort((a, b) => a.localeCompare(b));

        const remark =
          missingOpenOrderIds.length > 0
            ? `You were uploading orders for brand ${vendorEntry.brand} and vendor ${vendorEntry.vendor}; these open orders are missing in this upload: ${missingOpenOrderIds.join(", ")}.`
            : "";

        missingOpenOrderIds.forEach((orderId) => {
          conflicts.push({
            type: "OPEN_ORDER_MISSING_IN_UPLOAD",
            brand: vendorEntry.brand,
            vendor: vendorEntry.vendor,
            order_id: orderId,
            message: `Brand ${vendorEntry.brand} / Vendor ${vendorEntry.vendor} has open order ${orderId} in system but it was not present in the current upload.`,
          });
        });

        return {
          brand: vendorEntry.brand,
          vendor: vendorEntry.vendor,
          uploaded_order_ids: uploadedOrderIds,
          uploaded_orders_count: uploadedOrderIds.length,
          uploaded_items_count: uploadedItemsCount,
          items_per_order: itemsPerOrder,
          missing_open_order_ids: missingOpenOrderIds,
          missing_open_orders_count: missingOpenOrderIds.length,
          remark,
        };
      });

    insertedCount = 0;

    if (newRowsToInsert.length > 0) {
      const insertSummary = await applyNewOrderRows({
        rows: newRowsToInsert,
        reqUser: req.user,
        actionLabel: "upload",
      });
      insertedCount = insertSummary.inserted_count;
      applyWarnings.push(
        ...(Array.isArray(insertSummary?.warnings)
          ? insertSummary.warnings
          : []),
      );
    }

    const remarks = [
      ...vendorSummaries
        .map((entry) => String(entry?.remark || "").trim())
        .filter(Boolean),
    ];
    const missingOpenOrderIds = normalizeDistinctValues(
      conflicts.map((entry) => String(entry?.order_id || "").trim()),
    );

    if (duplicateEntries.length > 0) {
      remarks.push(
        `${duplicateEntries.length} row(s) were skipped due to duplicates, missing fields, or invalid quantity.`,
      );
    }

    if (missingOpenOrderIds.length > 0) {
      remarks.push(
        `Open orders missing in this upload: ${missingOpenOrderIds.join(", ")}.`,
      );
    }
    if (applyWarnings.length > 0) {
      remarks.push(...applyWarnings);
    }

    const uploadLog = await UploadLog.create({
      ...uploadMeta,
      total_rows_received: totalRowsReceived,
      total_rows_unique: totalRowsUnique,
      inserted_item_rows: insertedCount,
      duplicate_count: duplicateEntries.length,
      duplicate_entries: duplicateEntries,
      uploaded_brands: uploadedBrands,
      uploaded_vendors: uploadedVendors,
      total_distinct_orders_uploaded: totalDistinctOrdersUploaded,
      vendor_summaries: vendorSummaries,
      conflicts,
      remarks,
      status: conflicts.length > 0 ? "success_with_conflicts" : "success",
    });

    const hasConflicts = conflicts.length > 0;
    const hasDuplicates = duplicateEntries.length > 0;
    const hasInsertions = insertedCount > 0;

    let responseMessage = "No new orders to upload";
    if (hasInsertions) {
      responseMessage = hasDuplicates
        ? "Orders uploaded with duplicates skipped"
        : "Orders uploaded successfully";
    }
    if (hasConflicts) {
      responseMessage = `${responseMessage}. Open-order conflicts were detected for this upload.`;
    }

    res.status(201).json({
      message: responseMessage,
      inserted_count: insertedCount,
      duplicate_count: duplicateEntries.length,
      duplicate_entries: duplicateEntries,
      total_distinct_orders_uploaded: totalDistinctOrdersUploaded,
      vendor_summaries: vendorSummaries,
      conflict_count: conflicts.length,
      missing_open_orders_count: missingOpenOrderIds.length,
      missing_open_order_ids: missingOpenOrderIds,
      conflicts,
      warnings: applyWarnings,
      upload_log_id: uploadLog?._id || null,
    });
  } catch (error) {
    console.error(error);

    try {
      await UploadLog.create({
        ...uploadMeta,
        total_rows_received: totalRowsReceived,
        total_rows_unique: totalRowsUnique,
        inserted_item_rows: insertedCount,
        duplicate_count: duplicateEntries.length,
        duplicate_entries: duplicateEntries,
        uploaded_brands: uploadedBrands,
        uploaded_vendors: uploadedVendors,
        total_distinct_orders_uploaded: totalDistinctOrdersUploaded,
        vendor_summaries: vendorSummaries,
        conflicts,
        status: "failed",
        error_message: error?.message || String(error),
      });
    } catch (uploadLogError) {
      console.error("Upload log save failed:", {
        error: uploadLogError?.message || String(uploadLogError),
      });
    }

    res.status(500).json({
      message: "Upload failed",
      error: error.message,
    });
  }
};

exports.createOrdersManually = async (req, res) => {
  const uploadedById =
    req.user?._id && mongoose.Types.ObjectId.isValid(req.user._id)
      ? req.user._id
      : null;
  const uploadMeta = {
    uploaded_by: uploadedById,
    uploaded_by_name: String(
      req.user?.name || req.user?.username || req.user?.email || "",
    ).trim(),
    source_filename: "manual_entry",
    source_size_bytes: 0,
  };

  let totalRowsReceived = 0;
  let totalRowsUnique = 0;
  let totalDistinctOrdersUploaded = 0;
  let insertedCount = 0;
  let duplicateEntries = [];
  let uploadedBrands = [];
  let uploadedVendors = [];
  let vendorSummaries = [];

  try {
    const rows = Array.isArray(req.body?.orders) ? req.body.orders : [];
    if (!rows.length) {
      return res.status(400).json({ message: "orders array is required" });
    }

    totalRowsReceived = rows.length;

    const normalizeValue = (value) => normalizeLooseString(value);
    const normalizeKey = (orderId, itemCode) =>
      `${normalizeOrderKey(orderId)}__${normalizeValue(itemCode).toUpperCase()}`;
    const isProvided = (value) =>
      !(
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "")
      );

    duplicateEntries = [];
    const seenKeys = new Set();
    const draftRows = rows.map((row) => ({
      orderId: normalizeValue(row?.order_id ?? row?.orderId ?? row?.PO),
      itemCode: normalizeValue(row?.item_code ?? row?.itemCode),
      brand: normalizeValue(row?.brand),
      vendor: normalizeValue(row?.vendor),
      description: normalizeValue(row?.description),
      quantity: Number(row?.quantity),
      etdInput: row?.ETD ?? row?.etd,
      orderDateInput: row?.order_date ?? row?.orderDate,
    }));

    const uniqueItemCodes = [
      ...new Set(
        draftRows.map((row) => normalizeValue(row?.itemCode)).filter(Boolean),
      ),
    ];

    let itemDetailsByCodeKey = new Map();
    if (uniqueItemCodes.length > 0) {
      const itemDocs = await Item.find({
        $or: uniqueItemCodes.map((itemCode) => ({
          code: {
            $regex: `^${escapeRegex(itemCode)}$`,
            $options: "i",
          },
        })),
      })
        .select("code description name brand brand_name brands vendors")
        .lean();

      itemDetailsByCodeKey = new Map(
        itemDocs.map((itemDoc) => {
          const normalizedCodeKey = normalizeLooseString(
            itemDoc?.code,
          ).toLowerCase();
          const normalizedDescription = normalizeLooseString(
            itemDoc?.description || itemDoc?.name || "",
          );
          const normalizedBrand = normalizeLooseString(
            itemDoc?.brand ||
              itemDoc?.brand_name ||
              (Array.isArray(itemDoc?.brands) ? itemDoc.brands[0] : "") ||
              "",
          );
          const normalizedVendors = normalizeDistinctValues(
            Array.isArray(itemDoc?.vendors) ? itemDoc.vendors : [],
          );

          return [
            normalizedCodeKey,
            {
              description: normalizedDescription,
              brand: normalizedBrand,
              vendors: normalizedVendors,
            },
          ];
        }),
      );
    }

    const orders = draftRows
      .map((draftRow) => {
        const orderId = draftRow.orderId;
        const itemCode = draftRow.itemCode;
        const brand = draftRow.brand;
        const vendor = draftRow.vendor;
        const description = draftRow.description;
        const quantity = draftRow.quantity;
        const existingItemDetails =
          itemDetailsByCodeKey.get(
            normalizeLooseString(itemCode).toLowerCase(),
          ) || null;
        const existingDescription = normalizeLooseString(
          existingItemDetails?.description || "",
        );
        const existingBrand = normalizeLooseString(
          existingItemDetails?.brand || "",
        );
        const existingVendor = normalizeLooseString(
          Array.isArray(existingItemDetails?.vendors) &&
            existingItemDetails.vendors.length > 0
            ? existingItemDetails.vendors[0]
            : "",
        );
        const resolvedBrand = brand || existingBrand;
        const resolvedVendor = vendor || existingVendor;
        const resolvedDescription = existingDescription || description;

        if (!orderId || !itemCode || !resolvedBrand || !resolvedVendor) {
          duplicateEntries.push({
            order_id: orderId,
            item_code: itemCode,
            reason: "missing_required_fields",
          });
          return null;
        }

        if (!Number.isFinite(quantity) || quantity <= 0) {
          duplicateEntries.push({
            order_id: orderId,
            item_code: itemCode,
            reason: "invalid_quantity",
          });
          return null;
        }

        if (!resolvedDescription) {
          duplicateEntries.push({
            order_id: orderId,
            item_code: itemCode,
            reason: "description_required_for_new_item",
          });
          return null;
        }

        const parsedEtd = isProvided(draftRow.etdInput)
          ? parseDateLike(draftRow.etdInput)
          : null;
        if (isProvided(draftRow.etdInput) && !parsedEtd) {
          duplicateEntries.push({
            order_id: orderId,
            item_code: itemCode,
            reason: "invalid_etd",
          });
          return null;
        }

        const parsedOrderDate = isProvided(draftRow.orderDateInput)
          ? parseDateLike(draftRow.orderDateInput)
          : null;
        if (isProvided(draftRow.orderDateInput) && !parsedOrderDate) {
          duplicateEntries.push({
            order_id: orderId,
            item_code: itemCode,
            reason: "invalid_order_date",
          });
          return null;
        }

        const key = normalizeKey(orderId, itemCode);
        if (seenKeys.has(key)) {
          duplicateEntries.push({
            order_id: orderId,
            item_code: itemCode,
            reason: "duplicate_in_payload",
          });
          return null;
        }

        seenKeys.add(key);

        return {
          order_id: orderId,
          item: {
            item_code: itemCode,
            description: resolvedDescription,
          },
          brand: resolvedBrand,
          vendor: resolvedVendor,
          ETD: parsedEtd || undefined,
          order_date: parsedOrderDate || undefined,
          status: "Pending",
          quantity,
        };
      })
      .filter(Boolean);

    totalRowsUnique = orders.length;
    totalDistinctOrdersUploaded = new Set(
      orders.map((order) => normalizeOrderKey(order.order_id)).filter(Boolean),
    ).size;

    const brandVendorUploadMap = new Map();
    for (const order of orders) {
      const brand = normalizeValue(order.brand);
      const brandKey = normalizeBrandKey(brand);
      const vendor = normalizeValue(order.vendor);
      const vendorKey = normalizeVendorKey(vendor);
      const brandVendorKey = normalizeBrandVendorKey(brand, vendor);
      const orderId = normalizeValue(order.order_id);
      const orderKey = normalizeOrderKey(orderId);

      if (!brandKey || !vendorKey || !orderKey) continue;

      if (!brandVendorUploadMap.has(brandVendorKey)) {
        brandVendorUploadMap.set(brandVendorKey, {
          brand_vendor_key: brandVendorKey,
          brand_key: brandKey,
          brand,
          vendor_key: vendorKey,
          vendor,
          uploaded_order_ids: new Set(),
          items_per_order_count: new Map(),
        });
      }

      const brandVendorBucket = brandVendorUploadMap.get(brandVendorKey);
      brandVendorBucket.uploaded_order_ids.add(orderId);
      brandVendorBucket.items_per_order_count.set(
        orderId,
        Number(brandVendorBucket.items_per_order_count.get(orderId) || 0) + 1,
      );
    }

    uploadedBrands = [...brandVendorUploadMap.values()]
      .map((entry) => entry.brand)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    uploadedBrands = normalizeDistinctValues(uploadedBrands);

    uploadedVendors = [...brandVendorUploadMap.values()]
      .map((entry) => entry.vendor)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    uploadedVendors = normalizeDistinctValues(uploadedVendors);

    vendorSummaries = [...brandVendorUploadMap.values()]
      .sort((a, b) => {
        const brandCompare = a.brand.localeCompare(b.brand);
        if (brandCompare !== 0) return brandCompare;
        return a.vendor.localeCompare(b.vendor);
      })
      .map((brandVendorEntry) => {
        const uploadedOrderIds = [...brandVendorEntry.uploaded_order_ids].sort(
          (a, b) => a.localeCompare(b),
        );
        const itemsPerOrder = uploadedOrderIds.map((orderId) => ({
          order_id: orderId,
          items_count: Number(
            brandVendorEntry.items_per_order_count.get(orderId) || 0,
          ),
        }));

        return {
          brand: brandVendorEntry.brand,
          vendor: brandVendorEntry.vendor,
          uploaded_order_ids: uploadedOrderIds,
          uploaded_orders_count: uploadedOrderIds.length,
          uploaded_items_count: itemsPerOrder.reduce(
            (sum, entry) => sum + Number(entry?.items_count || 0),
            0,
          ),
          items_per_order: itemsPerOrder,
          missing_open_order_ids: [],
          missing_open_orders_count: 0,
          remark: "",
        };
      });

    let newOrders = orders;
    if (orders.length > 0) {
      const existing = await Order.find({
        ...ACTIVE_ORDER_MATCH,
        $or: orders.map((order) => ({
          order_id: order.order_id,
          "item.item_code": order.item.item_code,
        })),
      }).select("order_id item.item_code");

      const existingKeys = new Set(
        existing.map((order) =>
          normalizeKey(order.order_id, order.item.item_code),
        ),
      );

      newOrders = orders.filter((order) => {
        const key = normalizeKey(order.order_id, order.item.item_code);
        if (existingKeys.has(key)) {
          duplicateEntries.push({
            order_id: order.order_id,
            item_code: order.item.item_code,
            reason: "already_exists",
          });
          return false;
        }
        return true;
      });
    }

    insertedCount = newOrders.length;

    if (newOrders.length > 0) {
      await Order.insertMany(newOrders);

      try {
        await upsertItemsFromOrders(newOrders);
      } catch (itemSyncError) {
        console.error("Item sync after manual add failed:", {
          error: itemSyncError?.message || String(itemSyncError),
        });
      }

      const groups = new Map();
      for (const order of newOrders) {
        const key = `${order.order_id}__${order.brand}__${order.vendor}`;
        groups.set(key, {
          order_id: order.order_id,
          brand: order.brand,
          vendor: order.vendor,
        });
      }

      const uniqueGroups = [...groups.values()];
      const concurrency = 5;
      for (let i = 0; i < uniqueGroups.length; i += concurrency) {
        const batch = uniqueGroups.slice(i, i + concurrency);
        await Promise.all(
          batch.map(async (group) => {
            try {
              await syncOrderGroup(group);
            } catch (syncErr) {
              console.error(
                "Google Calendar sync failed for manual order group:",
                {
                  group,
                  error: syncErr?.message || String(syncErr),
                },
              );
            }
          }),
        );
      }
    }

    const remarks = [];
    if (duplicateEntries.length > 0) {
      remarks.push(
        `${duplicateEntries.length} row(s) were skipped due to duplicates, missing fields, missing description for new item codes, invalid quantity, or invalid dates.`,
      );
    }

    const uploadLog = await UploadLog.create({
      ...uploadMeta,
      total_rows_received: totalRowsReceived,
      total_rows_unique: totalRowsUnique,
      inserted_item_rows: insertedCount,
      duplicate_count: duplicateEntries.length,
      duplicate_entries: duplicateEntries,
      uploaded_brands: uploadedBrands,
      uploaded_vendors: uploadedVendors,
      total_distinct_orders_uploaded: totalDistinctOrdersUploaded,
      vendor_summaries: vendorSummaries,
      conflicts: [],
      remarks,
      status: "success",
    });

    const hasInsertions = newOrders.length > 0;
    const hasDuplicates = duplicateEntries.length > 0;
    const responseMessage = hasInsertions
      ? hasDuplicates
        ? "Orders added with duplicates skipped"
        : "Orders added successfully"
      : "No new orders to add";

    return res.status(hasInsertions ? 201 : 200).json({
      message: responseMessage,
      inserted_count: insertedCount,
      duplicate_count: duplicateEntries.length,
      duplicate_entries: duplicateEntries,
      total_distinct_orders_uploaded: totalDistinctOrdersUploaded,
      vendor_summaries: vendorSummaries,
      upload_log_id: uploadLog?._id || null,
    });
  } catch (error) {
    console.error("Manual order add failed:", error);

    try {
      await UploadLog.create({
        ...uploadMeta,
        total_rows_received: totalRowsReceived,
        total_rows_unique: totalRowsUnique,
        inserted_item_rows: insertedCount,
        duplicate_count: duplicateEntries.length,
        duplicate_entries: duplicateEntries,
        uploaded_brands: uploadedBrands,
        uploaded_vendors: uploadedVendors,
        total_distinct_orders_uploaded: totalDistinctOrdersUploaded,
        vendor_summaries: vendorSummaries,
        conflicts: [],
        remarks: [],
        status: "failed",
        error_message: error?.message || String(error),
      });
    } catch (uploadLogError) {
      console.error("Manual upload log save failed:", {
        error: uploadLogError?.message || String(uploadLogError),
      });
    }

    return res.status(500).json({
      message: "Manual order add failed",
      error: error.message,
    });
  }
};

exports.rectifyPdfOrders = async (req, res) => {
  try {
    const brandInput = normalizeRectifyText(req.body?.brand);
    const vendorInput = normalizeRectifyText(req.body?.vendor);
    const shouldApplyChanges = parseBooleanInput(req.body?.apply_changes, true);

    let selectedRowsPayload = null;
    if (Array.isArray(req.body?.selected_rows)) {
      selectedRowsPayload = req.body.selected_rows;
    } else {
      const selectedRowsRaw = String(req.body?.selected_rows || "").trim();
      if (selectedRowsRaw) {
        try {
          const parsed = JSON.parse(selectedRowsRaw);
          if (Array.isArray(parsed)) {
            selectedRowsPayload = parsed;
          } else {
            return res
              .status(400)
              .json({ message: "selected_rows must be an array" });
          }
        } catch {
          return res
            .status(400)
            .json({ message: "selected_rows must be valid JSON array" });
        }
      }
    }

    if (Array.isArray(selectedRowsPayload) && selectedRowsPayload.length > 0) {
      const invalidEntries = [];
      const dedupedRows = [];
      const seenKeys = new Set();
      let duplicateInSelectionCount = 0;

      for (let index = 0; index < selectedRowsPayload.length; index += 1) {
        const normalizedRow = normalizeRectifiedSelectionRow(
          selectedRowsPayload[index],
          { brand: brandInput, vendor: vendorInput },
        );

        if (!normalizedRow.order_id || !normalizedRow.item_code) {
          invalidEntries.push({
            row_index: index + 1,
            reason: "missing_order_or_item_code",
            source: selectedRowsPayload[index],
          });
          continue;
        }

        if (!normalizedRow.description) {
          invalidEntries.push({
            row_index: index + 1,
            reason: "missing_description",
            source: selectedRowsPayload[index],
          });
          continue;
        }

        if (!normalizedRow.brand || !normalizedRow.vendor) {
          invalidEntries.push({
            row_index: index + 1,
            reason: "missing_brand_or_vendor",
            source: selectedRowsPayload[index],
          });
          continue;
        }

        if (
          !Number.isFinite(Number(normalizedRow.quantity)) ||
          Number(normalizedRow.quantity) <= 0
        ) {
          invalidEntries.push({
            row_index: index + 1,
            reason: "invalid_quantity",
            source: selectedRowsPayload[index],
          });
          continue;
        }

        const key = makeRectifyKey(
          normalizedRow.order_id,
          normalizedRow.item_code,
        );
        if (seenKeys.has(key)) {
          duplicateInSelectionCount += 1;
          continue;
        }
        seenKeys.add(key);
        dedupedRows.push(normalizedRow);
      }

      if (dedupedRows.length === 0) {
        return res.status(400).json({
          message: "No valid selected rows were provided",
          invalid_entries: invalidEntries.slice(0, 100),
        });
      }

      const existingOrders = await Order.find({
        ...ACTIVE_ORDER_MATCH,
        $or: dedupedRows.map((row) => ({
          order_id: row.order_id,
          "item.item_code": row.item_code,
        })),
      })
        .select(
          "_id order_id item brand vendor quantity ETD order_date shipment qc_record",
        )
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

      const existingByKey = new Map();
      for (const existingOrder of existingOrders) {
        const key = makeRectifyKey(
          existingOrder?.order_id,
          existingOrder?.item?.item_code,
        );
        if (!existingByKey.has(key)) {
          existingByKey.set(key, existingOrder);
        }
      }

      const rowsEligibleForApply = dedupedRows.filter(
        (row) => normalizeRectifyChangeType(row?.change_type) !== "closed",
      );

      let applySummary = {
        inserted_count: 0,
        updated_count: 0,
        quantity_skipped_count: 0,
        skipped_closed_count: dedupedRows.length - rowsEligibleForApply.length,
        warnings: [],
      };

        if (shouldApplyChanges && rowsEligibleForApply.length > 0) {
          applySummary = await applyRectifiedOrderRows({
            rows: rowsEligibleForApply,
            existingByKey,
            reqUser: req.user,
          });
          applySummary.skipped_closed_count =
              dedupedRows.length - rowsEligibleForApply.length;
        }

      const fallbackBrand =
        brandInput || normalizeRectifyText(dedupedRows[0]?.brand || "");
      const fallbackVendor =
        vendorInput || normalizeRectifyText(dedupedRows[0]?.vendor || "");

      const uploadLogId = shouldApplyChanges
        ? await createRectifyUploadLog({
            reqUser: req.user,
            brand: fallbackBrand,
            vendor: fallbackVendor,
            sourceFilename:
              normalizeRectifyText(req.body?.source_filename) ||
              "rectify_selection",
            sourceSizeBytes: 0,
            totalRowsReceived: selectedRowsPayload.length,
            totalRowsUnique: dedupedRows.length,
            invalidEntries,
            duplicateInPdfCount: duplicateInSelectionCount,
            rowsEligibleForApply,
            changedRows: dedupedRows,
            applySummary,
          })
        : null;

      const newCount = dedupedRows.filter(
        (row) => normalizeRectifyChangeType(row?.change_type) === "new",
      ).length;
      const modifiedCount = dedupedRows.filter(
        (row) => normalizeRectifyChangeType(row?.change_type) === "modified",
      ).length;
      const closedCount = dedupedRows.filter(
        (row) => normalizeRectifyChangeType(row?.change_type) === "closed",
      ).length;

      return res.status(200).json({
        success: true,
        message: shouldApplyChanges
          ? "Checked rows updated in DB"
          : "Selected rows validated",
        summary: {
          extracted_rows: selectedRowsPayload.length,
          valid_rows: dedupedRows.length,
          invalid_rows: invalidEntries.length,
          duplicate_keys_in_pdf: duplicateInSelectionCount,
          unchanged_rows: 0,
          changed_rows: dedupedRows.length,
          new_rows: newCount,
          modified_rows: modifiedCount,
          closed_rows: closedCount,
        },
        apply: {
          applied: shouldApplyChanges,
          ...applySummary,
        },
        upload_log_id: uploadLogId,
        changed_rows_data: buildRectifyRowsForResponse(dedupedRows),
        invalid_entries: invalidEntries.slice(0, 100),
      });
    }

    if (!req.file) {
      return res.status(400).json({ message: "PDF file is required" });
    }

    if (!brandInput) {
      return res.status(400).json({ message: "brand is required" });
    }
    if (!vendorInput) {
      return res.status(400).json({ message: "vendor is required" });
    }

    const isPdfFile =
      String(req.file?.mimetype || "")
        .toLowerCase()
        .includes("pdf") ||
      String(req.file?.originalname || "")
        .toLowerCase()
        .endsWith(".pdf");
    if (!isPdfFile) {
      return res.status(400).json({ message: "Only PDF files are supported" });
    }

    const sourceFileStorage = await uploadSourceFileToWasabi(
      req.file,
      "orders/rectify-pdf",
    );
    const pdfBuffer = req.file.buffer;
    const extractedRows = extractTableRowsFromPdfBuffer(pdfBuffer);

    const invalidEntries = [];
    const dedupedRows = [];
    const seenPdfKeys = new Set();
    const presentPdfKeys = new Set();
    let duplicateInPdfCount = 0;

    for (let index = 0; index < extractedRows.length; index += 1) {
      const normalizedRow = normalizeRectifiedPdfRow(extractedRows[index], {
        brand: brandInput,
        vendor: vendorInput,
      });

      if (!normalizedRow.order_id || !normalizedRow.item_code) {
        invalidEntries.push({
          row_index: index + 1,
          reason: "missing_order_or_item_code",
          source: extractedRows[index],
        });
        continue;
      }

      const key = makeRectifyKey(
        normalizedRow.order_id,
        normalizedRow.item_code,
      );
      presentPdfKeys.add(key);

      if (!normalizedRow.description) {
        invalidEntries.push({
          row_index: index + 1,
          reason: "missing_description",
          source: extractedRows[index],
        });
        continue;
      }

      if (
        !Number.isFinite(Number(normalizedRow.quantity)) ||
        Number(normalizedRow.quantity) <= 0
      ) {
        invalidEntries.push({
          row_index: index + 1,
          reason: "invalid_quantity",
          source: extractedRows[index],
        });
        continue;
      }

      if (seenPdfKeys.has(key)) {
        duplicateInPdfCount += 1;
        continue;
      }
      seenPdfKeys.add(key);
      dedupedRows.push(normalizedRow);
    }

    const { existingByKey, openOrdersByKey } =
      await loadExistingOrdersForBrandVendorPairs([
        { brand: brandInput, vendor: vendorInput },
      ]);

    const changedRows = [];
    let unchangedCount = 0;
    let newCount = 0;
    let modifiedCount = 0;
    let closedCount = 0;

    for (const row of dedupedRows) {
      const key = makeRectifyKey(row.order_id, row.item_code);
      const existing = existingByKey.get(key);

      if (!existing) {
        newCount += 1;
        changedRows.push({
          ...row,
          change_type: "new",
          changed_fields: ["new_order"],
          ...getExistingOrderPreviewMeta(null),
        });
        continue;
      }

      const changedFields = getRectifiedChangedFields(row, existing);
      if (changedFields.length === 0) {
        unchangedCount += 1;
        continue;
      }

      modifiedCount += 1;
      changedRows.push({
        ...row,
        change_type: "modified",
        changed_fields: changedFields,
        ...getExistingOrderPreviewMeta(existing),
      });
    }

    for (const [openKey, openOrder] of openOrdersByKey.entries()) {
      if (presentPdfKeys.has(openKey)) continue;

      const openQuantity = computeRectifyOpenQuantity(openOrder);
      if (!Number.isFinite(openQuantity) || openQuantity <= 0) continue;

      closedCount += 1;
      changedRows.push({
        order_id: normalizeOrderKey(openOrder?.order_id),
        item_code: normalizeRectifyText(openOrder?.item?.item_code),
        description: normalizeRectifyText(openOrder?.item?.description),
        brand: normalizeRectifyText(openOrder?.brand),
        vendor: normalizeRectifyText(openOrder?.vendor),
        quantity: openQuantity,
        ETD:
          openOrder?.ETD ||
          deriveRectifyDefaultEtd(openOrder?.order_date) ||
          null,
        order_date: openOrder?.order_date || null,
        change_type: "closed",
        changed_fields: ["missing_in_pdf"],
        ...getExistingOrderPreviewMeta(openOrder),
        source: {
          refer: "",
          raw_quantity: "",
        },
      });
    }

    const workbookBuffer = buildRectifyWorkbookBuffer(changedRows);
    const sanitizeFileNamePart = (value) =>
      String(value || "")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const safeBrandForFile = sanitizeFileNamePart(brandInput) || "Brand";
    const safeVendorForFile = sanitizeFileNamePart(vendorInput) || "Vendor";
    const outputFileName = `${safeBrandForFile} + ${safeVendorForFile}_rectified.xlsx`;

    let applySummary = {
      inserted_count: 0,
      updated_count: 0,
      quantity_skipped_count: 0,
      skipped_closed_count: 0,
      warnings: [],
    };

    const rowsEligibleForApply = changedRows.filter(
      (row) => row?.change_type !== "closed",
    );
    applySummary.skipped_closed_count =
      changedRows.length - rowsEligibleForApply.length;

    if (shouldApplyChanges && rowsEligibleForApply.length > 0) {
      applySummary = await applyRectifiedOrderRows({
        rows: rowsEligibleForApply,
        existingByKey,
        reqUser: req.user,
      });
      applySummary.skipped_closed_count =
        changedRows.length - rowsEligibleForApply.length;
    }

    const uploadLogId = shouldApplyChanges
      ? await createRectifyUploadLog({
          reqUser: req.user,
          brand: brandInput,
          vendor: vendorInput,
          sourceFilename: String(
            req.file?.originalname || "rectify_pdf",
          ).trim(),
          sourceSizeBytes: Number(req.file?.size || 0),
          totalRowsReceived: extractedRows.length,
          totalRowsUnique: dedupedRows.length,
          invalidEntries,
          duplicateInPdfCount,
          rowsEligibleForApply,
          changedRows,
          applySummary,
        })
      : null;

    const message =
      changedRows.length === 0
        ? "No new or modified entries found in this PDF"
        : shouldApplyChanges
          ? "PDF rectified, changed entries exported, and DB updates processed"
          : "PDF rectified and changed entries exported";

    return res.status(200).json({
      success: true,
      message,
      summary: {
        extracted_rows: extractedRows.length,
        valid_rows: dedupedRows.length,
        invalid_rows: invalidEntries.length,
        duplicate_keys_in_pdf: duplicateInPdfCount,
        unchanged_rows: unchangedCount,
        changed_rows: changedRows.length,
        new_rows: newCount,
        modified_rows: modifiedCount,
        closed_rows: closedCount,
      },
      apply: {
        applied: shouldApplyChanges,
        ...applySummary,
      },
      upload_log_id: uploadLogId,
      file_name: outputFileName,
      file_base64: workbookBuffer.toString("base64"),
      changed_rows_data: buildRectifyRowsForResponse(changedRows),
      invalid_entries: invalidEntries.slice(0, 100),
    });
  } catch (error) {
    console.error("Rectify PDF Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to rectify PDF",
      error: error?.message || String(error),
    });
  }
};

exports.getUploadLogs = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(100, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const brand = normalizeFilterValue(req.query.brand);
    const vendor = normalizeFilterValue(req.query.vendor);
    const status = normalizeFilterValue(req.query.status);
    const orderId = normalizeFilterValue(
      req.query.order_id ?? req.query.orderId,
    );

    const match = {
      source_filename: { $nin: ["order_edit", "order_edit_archive"] },
    };

    if (brand) {
      match.uploaded_brands = brand;
    }

    if (vendor) {
      match.uploaded_vendors = vendor;
    }

    if (status) {
      match.status = status;
    }

    if (orderId) {
      const escaped = escapeRegex(orderId);
      match.$or = [
        {
          "vendor_summaries.uploaded_order_ids": {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          "vendor_summaries.items_per_order.order_id": {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          "conflicts.order_id": {
            $regex: escaped,
            $options: "i",
          },
        },
      ];
    }

    const [
      logs,
      totalRecords,
      brandsRaw,
      vendorsRaw,
      statusesRaw,
      statusCountsRaw,
    ] = await Promise.all([
      UploadLog.find(match)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UploadLog.countDocuments(match),
      UploadLog.distinct("uploaded_brands"),
      UploadLog.distinct("uploaded_vendors"),
      UploadLog.distinct("status"),
      UploadLog.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const summary = {
      total: totalRecords,
      success: 0,
      success_with_conflicts: 0,
      failed: 0,
    };

    statusCountsRaw.forEach((entry) => {
      const key = String(entry?._id || "").trim();
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(summary, key)) {
        summary[key] = Number(entry?.count || 0);
      }
    });

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        brands: normalizeDistinctValues(brandsRaw),
        vendors: normalizeDistinctValues(vendorsRaw),
        statuses: normalizeDistinctValues(statusesRaw),
      },
      summary,
    });
  } catch (error) {
    console.error("Get Upload Logs Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch upload logs",
      error: error?.message || String(error),
    });
  }
};

exports.getOrderEditLogs = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(100, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const brand = normalizeFilterValue(req.query.brand);
    const vendor = normalizeFilterValue(req.query.vendor);
    const orderId = normalizeFilterValue(
      req.query.order_id ?? req.query.orderId,
    );
    const operationType = normalizeFilterValue(
      req.query.operation_type ?? req.query.operationType,
    );

    const match = {};

    if (brand) {
      match.brand = brand;
    }

    if (vendor) {
      match.vendor = vendor;
    }

    if (orderId) {
      const escaped = escapeRegex(orderId);
      match.order_id = { $regex: escaped, $options: "i" };
    }

    if (
      operationType &&
      ["order_edit", "order_edit_archive"].includes(operationType)
    ) {
      match.operation_type = operationType;
    }

    const [
      logs,
      totalRecords,
      brandsRaw,
      vendorsRaw,
      operationsRaw,
      totalsRaw,
    ] = await Promise.all([
      OrderEditLog.find(match)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      OrderEditLog.countDocuments(match),
      OrderEditLog.distinct("brand", match),
      OrderEditLog.distinct("vendor", match),
      OrderEditLog.distinct("operation_type", match),
      OrderEditLog.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total_logs: { $sum: 1 },
            total_field_changes: { $sum: "$changed_fields_count" },
          },
        },
      ]),
    ]);

    const totals =
      Array.isArray(totalsRaw) && totalsRaw.length > 0 ? totalsRaw[0] : null;

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        brands: normalizeDistinctValues(brandsRaw),
        vendors: normalizeDistinctValues(vendorsRaw),
        operation_types: normalizeDistinctValues(operationsRaw),
      },
      summary: {
        total_logs: Number(totals?.total_logs || 0),
        total_field_changes: Number(totals?.total_field_changes || 0),
      },
    });
  } catch (error) {
    console.error("Get Order Edit Logs Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch order edit logs",
      error: error?.message || String(error),
    });
  }
};

// Get Orders (Pagination + Sorting)
exports.getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, brand } = req.query;

    const skip = (page - 1) * limit;
    const match = { ...ACTIVE_ORDER_MATCH };
    if (brand) {
      match.brand = brand;
    }

    const orders = await Order.find(match)
      .populate({
        path: "qc_record",
        populate: {
          path: "inspector",
          select: "name role",
        },
      })
      .sort({ order_id: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Order.countDocuments(match);

    res.json({
      data: orders.map((orderEntry) => {
        const orderDoc = typeof orderEntry?.toObject === "function"
          ? orderEntry.toObject()
          : orderEntry;
        return {
          ...orderDoc,
          status: deriveOrderStatus({ orderEntry: orderDoc }),
        };
      }),
      pagination: {
        page: Number(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.getPoStatusReport = async (req, res) => {
  try {
    const selectedBrand = normalizeFilterValue(req.query.brand);
    const selectedVendor = normalizeFilterValue(req.query.vendor);
    const selectedStatus = normalizePoStatusReportStatus(req.query.status);
    const activeMatch = { ...ACTIVE_ORDER_MATCH };
    const reportMatch = { ...activeMatch };

    if (selectedBrand) {
      reportMatch.brand = selectedBrand;
    }
    if (selectedVendor) {
      reportMatch.vendor = selectedVendor;
    }

    const [brandOptionsRaw, vendorOptionsRaw, reportOrdersRaw] = await Promise.all([
      Order.distinct("brand", activeMatch),
      Order.distinct("vendor", activeMatch),
      Order.find(reportMatch)
        .select("_id brand vendor order_id status quantity order_date ETD revised_ETD item qc_record shipment")
        .populate({
          path: "qc_record",
          select: "quantities request_history",
        })
        .lean(),
    ]);

    const poEntryMap = new Map();

    for (const orderEntry of reportOrdersRaw) {
      const vendorName = normalizeLooseString(orderEntry?.vendor || "") || "N/A";
      const brandName = normalizeLooseString(orderEntry?.brand || "") || "N/A";
      const orderId = normalizeOrderKey(orderEntry?.order_id || "") || "N/A";
      const effectiveEtd = resolveEffectiveOrderEtdDate(orderEntry);
      const poKey = buildDelayedPoGroupKey({
        orderId,
        brand: brandName,
        vendor: vendorName,
      });

      if (!poEntryMap.has(poKey)) {
        poEntryMap.set(poKey, {
          key: poKey,
          vendor: vendorName,
          brand: brandName,
          order_id: orderId,
          order_date: orderEntry?.order_date || null,
          effective_etd: effectiveEtd || null,
          item_counts: createPoStatusCounts(),
          status_items: [],
          inspected_items: [],
        });
      }

      const poEntry = poEntryMap.get(poKey);
      poEntry.order_date = resolveEarlierDate(
        poEntry.order_date,
        orderEntry?.order_date,
      );
      poEntry.effective_etd = resolveLaterDate(
        poEntry.effective_etd,
        effectiveEtd,
      );

      const tooltipItem = buildPoStatusTooltipItem(orderEntry);
      incrementPoStatusCounts(poEntry.item_counts, tooltipItem.status);
      poEntry.status_items.push(tooltipItem);

      if (!isPendingOrderStatus(tooltipItem.status)) {
        poEntry.inspected_items.push({ ...tooltipItem });
      }
    }

    const allPoEntries = Array.from(poEntryMap.values()).map((poEntry) => {
      const statusItems = Array.isArray(poEntry.status_items)
        ? [...poEntry.status_items]
        : [];
      const inspectedItems = Array.isArray(poEntry.inspected_items)
        ? [...poEntry.inspected_items]
        : [];
      statusItems.sort((left, right) => {
        const leftStatus = normalizeLooseString(left?.status || "").toLowerCase();
        const rightStatus = normalizeLooseString(right?.status || "").toLowerCase();
        const leftStatusRank = ORDER_STATUS_SEQUENCE.findIndex(
          (status) => status.toLowerCase() === leftStatus,
        );
        const rightStatusRank = ORDER_STATUS_SEQUENCE.findIndex(
          (status) => status.toLowerCase() === rightStatus,
        );
        if (leftStatusRank !== rightStatusRank) {
          return leftStatusRank - rightStatusRank;
        }

        const leftItemCode = normalizeLooseString(left?.item_code || "");
        const rightItemCode = normalizeLooseString(right?.item_code || "");
        return leftItemCode.localeCompare(rightItemCode, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
      inspectedItems.sort((left, right) => {
        const leftStatus = normalizeLooseString(left?.status || "").toLowerCase();
        const rightStatus = normalizeLooseString(right?.status || "").toLowerCase();
        const leftStatusRank = ORDER_STATUS_SEQUENCE.findIndex(
          (status) => status.toLowerCase() === leftStatus,
        );
        const rightStatusRank = ORDER_STATUS_SEQUENCE.findIndex(
          (status) => status.toLowerCase() === rightStatus,
        );
        if (leftStatusRank !== rightStatusRank) {
          return leftStatusRank - rightStatusRank;
        }

        const leftItemCode = normalizeLooseString(left?.item_code || "");
        const rightItemCode = normalizeLooseString(right?.item_code || "");
        return leftItemCode.localeCompare(rightItemCode, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

      return {
        ...poEntry,
        item_counts: { ...poEntry.item_counts },
        status_items: statusItems,
        inspected_items: inspectedItems,
        total_items_count:
          getPoOpenItemsCount(poEntry.item_counts) +
          getPoProgressedItemsCount(poEntry.item_counts),
        open_items_count: getPoOpenItemsCount(poEntry.item_counts),
        progressed_items_count: getPoProgressedItemsCount(poEntry.item_counts),
      };
    });

    const filteredPoEntries = allPoEntries
      .filter((poEntry) => {
        const openItemsCount = getPoOpenItemsCount(poEntry.item_counts);
        const progressedItemsCount = getPoProgressedItemsCount(poEntry.item_counts);
        const shippedItemsCount = Number(poEntry?.item_counts?.shipped || 0);
        const totalItemsCount = Number(poEntry?.total_items_count || 0);

        if (selectedStatus === "Inspection Done") {
          return (
            openItemsCount === 0 &&
            progressedItemsCount > 0 &&
            shippedItemsCount < totalItemsCount
          );
        }

        return openItemsCount > 0 && progressedItemsCount > 0;
      })
      .sort((left, right) => {
        const leftVendor = normalizeLooseString(left?.vendor || "N/A");
        const rightVendor = normalizeLooseString(right?.vendor || "N/A");
        const vendorComparison = leftVendor.localeCompare(rightVendor, undefined, {
          sensitivity: "base",
        });
        if (vendorComparison !== 0) return vendorComparison;

        const leftBrand = normalizeLooseString(left?.brand || "N/A");
        const rightBrand = normalizeLooseString(right?.brand || "N/A");
        const brandComparison = leftBrand.localeCompare(rightBrand, undefined, {
          sensitivity: "base",
        });
        if (brandComparison !== 0) return brandComparison;

        const leftOrderId = normalizeLooseString(left?.order_id || "");
        const rightOrderId = normalizeLooseString(right?.order_id || "");
        return leftOrderId.localeCompare(rightOrderId, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

    const vendorsMap = new Map();
    const summaryCounts = createPoStatusCounts();

    for (const poEntry of filteredPoEntries) {
      const vendorName = normalizeLooseString(poEntry?.vendor || "") || "N/A";

      if (!vendorsMap.has(vendorName)) {
        vendorsMap.set(vendorName, {
          vendor: vendorName,
          po_count: 0,
          status_counts: createPoStatusCounts(),
          pos: [],
        });
      }

      const vendorEntry = vendorsMap.get(vendorName);
      vendorEntry.po_count += 1;
      sumPoStatusCounts(vendorEntry.status_counts, poEntry.item_counts);
      vendorEntry.pos.push(poEntry);

      sumPoStatusCounts(summaryCounts, poEntry.item_counts);
    }

    const vendors = Array.from(vendorsMap.values());

    return res.status(200).json({
      success: true,
      filters: {
        brand: selectedBrand || "",
        vendor: selectedVendor || "",
        status: selectedStatus,
        brand_options: normalizeDistinctValues(brandOptionsRaw),
        vendor_options: normalizeDistinctValues(vendorOptionsRaw),
        status_options: [...PO_STATUS_REPORT_STATUS_OPTIONS],
      },
      summary: {
        vendors_count: vendors.length,
        po_count: filteredPoEntries.length,
        pending_count: summaryCounts.pending,
        under_inspection_count: summaryCounts.under_inspection,
        inspection_done_count: summaryCounts.inspection_done,
        partially_shipped_count: summaryCounts.partially_shipped,
        shipped_count: summaryCounts.shipped,
        open_items_count: getPoOpenItemsCount(summaryCounts),
        progressed_items_count: getPoProgressedItemsCount(summaryCounts),
      },
      vendors,
    });
  } catch (error) {
    console.error("PO Status Report Error:", error);
    return res.status(500).json({
      message: error?.message || "Failed to fetch PO status report",
    });
  }
};

// Get Order by ID
exports.getOrderById = async (req, res) => {
  try {
    const orders = await Order.find({
      ...ACTIVE_ORDER_MATCH,
      order_id: req.params.id,
    })
      .populate({
        path: "qc_record",
        populate: {
          path: "inspector",
          select: "name role",
        },
      })
      .lean();

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    const itemCodes = [
      ...new Set(
        orders
          .map((orderRow) => normalizeLooseString(orderRow?.item?.item_code))
          .filter(Boolean),
      ),
    ];
    const itemDocs = itemCodes.length > 0
      ? await Item.find({ code: { $in: itemCodes } })
        .select(
          [
            "code",
            "cbm",
            "inspected_item_LBH",
            "inspected_item_top_LBH",
            "inspected_item_bottom_LBH",
            "inspected_box_LBH",
            "inspected_box_top_LBH",
            "inspected_box_bottom_LBH",
            "inspected_top_LBH",
            "inspected_bottom_LBH",
            "pis_item_LBH",
            "pis_item_top_LBH",
            "pis_item_bottom_LBH",
            "pis_box_LBH",
            "pis_box_top_LBH",
            "pis_box_bottom_LBH",
          ].join(" "),
        )
        .lean()
      : [];
    const itemMap = new Map(
      itemDocs.map((itemDoc) => [
        normalizeLooseString(itemDoc?.code).toLowerCase(),
        itemDoc,
      ]),
    );

    const enrichedOrders = orders.map((orderRow) => {
      const itemCodeKey = normalizeLooseString(orderRow?.item?.item_code).toLowerCase();
      const itemDoc = itemMap.get(itemCodeKey) || null;
      return {
        ...orderRow,
        status: deriveOrderStatus({ orderEntry: orderRow }),
        cbm_summary: resolveOrderRowCbmSummary(itemDoc, orderRow?.quantity),
      };
    });

    res.status(200).json(enrichedOrders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRevisedEtdHistory = async (req, res) => {
  try {
    const orderId = normalizeOrderKey(req.query.order_id ?? req.query.orderId);
    const itemCode = String(
      req.query.item_code ?? req.query.itemCode ?? "",
    ).trim();

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "order_id is required",
      });
    }

    const match = {
      ...ACTIVE_ORDER_MATCH,
      order_id: {
        $regex: `^${escapeRegex(orderId)}$`,
        $options: "i",
      },
    };

    if (itemCode) {
      match["item.item_code"] = {
        $regex: `^${escapeRegex(itemCode)}$`,
        $options: "i",
      };
    }

    const orders = await Order.find(match)
      .select(
        "order_id item revised_ETD revised_etd_history updatedAt createdAt",
      )
      .sort({ "item.item_code": 1, updatedAt: -1 })
      .lean();

    const items = (Array.isArray(orders) ? orders : []).map((orderDoc) => ({
      id: String(orderDoc?._id || ""),
      order_id: String(orderDoc?.order_id || "").trim(),
      item_code: String(orderDoc?.item?.item_code || "").trim(),
      description: String(orderDoc?.item?.description || "").trim(),
      current_revised_etd: orderDoc?.revised_ETD || null,
      history: getOrderRevisedEtdHistoryEntries(orderDoc),
    }));

    return res.status(200).json({
      success: true,
      order_id: orderId,
      item_code: itemCode,
      items,
      total_entries: items.reduce(
        (sum, entry) =>
          sum + (Array.isArray(entry?.history) ? entry.history.length : 0),
        0,
      ),
    });
  } catch (error) {
    console.error("Get Revised ETD History Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch revised ETD history",
      error: error.message,
    });
  }
};

exports.getVendorSummaryByBrand = async (req, res) => {
  try {
    const { brand } = req.params;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dataset = await buildPoBucketDataset({
      brand,
      poBucket: "all",
      sortBy: "order_date",
      sortOrder: "desc",
    });

    const vendorMap = new Map();

    for (const row of dataset.rows) {
      const vendorName = normalizeLooseString(row?.vendor) || "N/A";
      const vendorKey = normalizeVendorKey(vendorName);
      if (!vendorMap.has(vendorKey)) {
        vendorMap.set(vendorKey, {
          vendor: vendorName,
          orders: new Set(),
          delayedOrders: new Set(),
          pendingOrders: new Set(),
          partialShippedOrders: new Set(),
          shippedOrders: new Set(),
          onTimeOrders: new Set(),
        });
      }

      const vendorEntry = vendorMap.get(vendorKey);
      const orderId = normalizeOrderKey(row?.order_id) || row?.order_id;
      const totalStatus = normalizeOrderStatus(row?.totalStatus) || "Pending";
      const originalEtd = parseDateLike(row?.ETD);
      const isActiveOrder = totalStatus !== "Shipped";

      vendorEntry.orders.add(orderId);

      if (["Pending", "Under Inspection", "Inspection Done"].includes(totalStatus)) {
        vendorEntry.pendingOrders.add(orderId);
      } else if (totalStatus === "Partial Shipped") {
        vendorEntry.partialShippedOrders.add(orderId);
      } else if (totalStatus === "Shipped") {
        vendorEntry.shippedOrders.add(orderId);
      }

      if (isActiveOrder && originalEtd instanceof Date && !Number.isNaN(originalEtd.getTime())) {
        if (originalEtd.getTime() < today.getTime()) {
          vendorEntry.delayedOrders.add(orderId);
        } else {
          vendorEntry.onTimeOrders.add(orderId);
        }
      }
    }

    const result = Array.from(vendorMap.values())
      .map((entry) => ({
        vendor: entry.vendor,
        orders: [...entry.orders],
        delayedOrders: [...entry.delayedOrders],
        totalOrders: entry.orders.size,
        totalDelayedOrders: entry.delayedOrders.size,
        totalPending: entry.pendingOrders.size,
        totalPartialShipped: entry.partialShippedOrders.size,
        totalShipped: entry.shippedOrders.size,
        totalOnTime: entry.onTimeOrders.size,
      }))
      .sort((left, right) => {
        const delayedCompare =
          Number(right?.totalDelayedOrders || 0) -
          Number(left?.totalDelayedOrders || 0);
        if (delayedCompare !== 0) return delayedCompare;
        return String(left?.vendor || "").localeCompare(String(right?.vendor || ""));
      });

    if (!result.length) {
      return res.status(404).json({
        message: "No vendors found for this brand",
      });
    }

    res.status(200).json({
      message: "Distinct vendor orders retrieved successfully",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
exports.getTodayEtdOrdersByBrand = async (req, res) => {
  try {
    const brand = normalizeFilterValue(req.params.brand ?? req.query.brand);
    const normalizedSortToken = normalizeFilterValue(req.query.sort);
    const rawSortBy = normalizeFilterValue(
      req.query.sort_by ?? req.query.sortBy,
    );
    const sortTokenDirection = String(normalizedSortToken || "").startsWith("-")
      ? "desc"
      : String(normalizedSortToken || "").startsWith("+")
        ? "asc"
        : null;
    const normalizedSortKey = String(
      rawSortBy ||
        String(normalizedSortToken || "").replace(/^[+-]/, "") ||
        "ETD",
    )
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, "")
      .toLowerCase();
    const sortAliases = {
      po: "order_id",
      order: "order_id",
      orderid: "order_id",
      order_id: "order_id",
      etd: "ETD",
      date: "ETD",
    };
    const sortBy = sortAliases[normalizedSortKey] || "ETD";

    const explicitSortOrder = String(
      req.query.sort_order ?? req.query.sortOrder ?? "",
    )
      .trim()
      .toLowerCase();

    let sortOrder = sortBy === "order_id" ? "asc" : "desc";
    if (sortTokenDirection) {
      sortOrder = sortTokenDirection;
    }
    if (explicitSortOrder === "asc" || explicitSortOrder === "desc") {
      sortOrder = explicitSortOrder;
    }
    const sortDirection = sortOrder === "asc" ? 1 : -1;
    const clientDayRange = resolveClientDayRange(
      req.query.date,
      req.query.tz_offset_minutes ?? req.query.tzOffset ?? req.query.tz_offset,
    );
    let dayStart;
    let dayEnd;
    if (clientDayRange) {
      dayStart = clientDayRange.dayStart;
      dayEnd = clientDayRange.dayEnd;
    } else {
      dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
    }

    const dataset = await buildPoBucketDataset({
      brand,
      poBucket: "all",
      sortBy,
      sortOrder,
    });

    const resolveTodaySortValue = (row, key) => {
      if (key === "order_id") {
        return normalizeOrderKey(row?.order_id || "") || "";
      }

      if (key === "ETD") {
        const parsedDate = parseDateLike(row?.ETD);
        return parsedDate ? parsedDate.getTime() : 0;
      }

      return parseDateLike(row?.order_date)?.getTime() || 0;
    };

    const compareTodayValues = (leftValue, rightValue) => {
      if (typeof leftValue === "number" || typeof rightValue === "number") {
        return Number(leftValue || 0) - Number(rightValue || 0);
      }

      return String(leftValue || "").localeCompare(
        String(rightValue || ""),
        undefined,
        { numeric: true },
      );
    };

    const data = dataset.rows
      .filter((row) => {
        const etdDate = parseDateLike(row?.ETD);
        if (!(etdDate instanceof Date) || Number.isNaN(etdDate.getTime())) {
          return false;
        }

        return etdDate.getTime() >= dayStart.getTime() && etdDate.getTime() < dayEnd.getTime();
      })
      .map((row) => ({
        order_id: row.order_id,
        brand: row.brand,
        vendor: row.vendor,
        ETD: row.ETD,
        revised_ETD: row.revised_ETD,
        effective_ETD: row.effective_ETD,
        itemCount: Number(row?.items || 0),
        status: row.totalStatus,
        inspectionDoneCount: Number(row?.status_counts?.inspection_done || 0),
        partialShippedCount: Number(row?.status_counts?.partially_shipped || 0),
        shippedCount: Number(row?.status_counts?.shipped || 0),
        pendingCount: Number(row?.status_counts?.pending || 0),
        underInspectionCount: Number(row?.status_counts?.under_inspection || 0),
        latestUpdatedAt:
          row.latest_shipment_date || row.last_inspected_date || row.order_date || null,
        order_date: row.order_date,
      }))
      .sort((left, right) => {
        const primaryComparison = compareTodayValues(
          resolveTodaySortValue(left, sortBy),
          resolveTodaySortValue(right, sortBy),
        );
        if (primaryComparison !== 0) {
          return primaryComparison * sortDirection;
        }

        const orderCompare = String(left?.order_id || "").localeCompare(
          String(right?.order_id || ""),
          undefined,
          { numeric: true },
        );
        if (orderCompare !== 0) return orderCompare;

        return (parseDateLike(right?.latestUpdatedAt)?.getTime() || 0)
          - (parseDateLike(left?.latestUpdatedAt)?.getTime() || 0);
      })
      .map(({ order_date, ...row }) => row);

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
      sort: {
        sort_by: sortBy,
        sort_order: sortOrder,
      },
    });
  } catch (error) {
    console.error("Get Today ETD Orders By Brand Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch today's ETD orders list",
      error: error.message,
    });
  }
};

exports.getOrdersByBrandAndStatus = async (req, res) => {
  try {
    const normalizeFilterValue = (value) => {
      if (value === undefined || value === null) return null;
      const cleaned = String(value).trim();
      if (!cleaned) return null;
      const lowered = cleaned.toLowerCase();
      if (lowered === "all" || lowered === "undefined" || lowered === "null") {
        return null;
      }
      return cleaned;
    };

    const brand = normalizeFilterValue(req.query.brand ?? req.params.brand);
    const vendor = normalizeFilterValue(req.query.vendor ?? req.params.vendor);
    const status = normalizeFilterValue(req.query.status ?? req.params.status);
    const { isDelayed } = req.query;
    const normalizedSortToken = normalizeFilterValue(req.query.sort);
    const rawSortBy = normalizeFilterValue(
      req.query.sort_by ?? req.query.sortBy,
    );
    const sortTokenDirection = String(normalizedSortToken || "").startsWith("-")
      ? "desc"
      : String(normalizedSortToken || "").startsWith("+")
        ? "asc"
        : null;
    const normalizedSortKey = String(
      rawSortBy ||
        String(normalizedSortToken || "").replace(/^[+-]/, "") ||
        "order_date",
    )
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, "")
      .toLowerCase();
    const sortAliases = {
      po: "order_id",
      order: "order_id",
      orderid: "order_id",
      order_id: "order_id",
      orderdate: "order_date",
      order_date: "order_date",
      etd: "ETD",
      revisedetd: "revised_ETD",
      revised_etd: "revised_ETD",
      date: "order_date",
    };
    const sortBy = sortAliases[normalizedSortKey] || "order_date";
    const explicitSortOrder = String(
      req.query.sort_order ?? req.query.sortOrder ?? "",
    )
      .trim()
      .toLowerCase();
    let sortOrder = sortBy === "order_id" ? "asc" : "desc";
    if (sortTokenDirection) {
      sortOrder = sortTokenDirection;
    }
    if (explicitSortOrder === "asc" || explicitSortOrder === "desc") {
      sortOrder = explicitSortOrder;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const normalizedStatus = String(status || "")
      .trim()
      .toLowerCase();
    const isOnTimeStatus =
      normalizedStatus === "on-time" ||
      normalizedStatus === "on time" ||
      normalizedStatus === "ontime";
    const isDelayedStatus = normalizedStatus === "delayed";
    const isDelayedFilter =
      String(isDelayed || "")
        .trim()
        .toLowerCase() === "true" || isDelayedStatus;
    const exactOrderStatus =
      ORDER_STATUS_SEQUENCE.find(
        (statusValue) => statusValue.toLowerCase() === normalizedStatus,
      ) || null;

    const dataset = await buildPoBucketDataset({
      brand,
      vendor,
      poBucket: "all",
      sortBy,
      sortOrder,
    });

    const orders = dataset.rows.filter((row) => {
      const totalStatus = normalizeOrderStatus(row?.totalStatus) || "Pending";
      const effectiveEtd = parseDateLike(row?.effective_ETD);
      const hasEffectiveEtd =
        effectiveEtd instanceof Date && !Number.isNaN(effectiveEtd.getTime());

      if (normalizedStatus === "pending") {
        if (!["Pending", "Under Inspection", "Inspection Done"].includes(totalStatus)) {
          return false;
        }
      } else if (exactOrderStatus && totalStatus !== exactOrderStatus) {
        return false;
      }

      if (isOnTimeStatus) {
        return totalStatus !== "Shipped" && hasEffectiveEtd && effectiveEtd >= today;
      }

      if (isDelayedFilter) {
        return totalStatus !== "Shipped" && hasEffectiveEtd && effectiveEtd < today;
      }

      return true;
    });

    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
      sort: {
        sort_by: sortBy,
        sort_order: sortOrder,
      },
    });
  } catch (error) {
    console.error("Get Orders Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
};

exports.getOrdersByFiltersDb = async (req, res) => {
  try {
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const status = req.query.status;
    const order = req.query.order ?? req.query.order_id;
    const itemCode = req.query.item_code ?? req.query.itemCode;
    const poBucket = req.query.po_bucket ?? req.query.poBucket;

    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;
    const normalizedSortToken = normalizeFilterValue(req.query.sort);
    const rawSortBy = normalizeFilterValue(
      req.query.sort_by ?? req.query.sortBy,
    );
    const sortTokenDirection = String(normalizedSortToken || "").startsWith("-")
      ? "desc"
      : String(normalizedSortToken || "").startsWith("+")
        ? "asc"
        : null;
    const normalizedSortKey = String(
      rawSortBy ||
        String(normalizedSortToken || "").replace(/^[+-]/, "") ||
        "order_date",
    )
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, "")
      .toLowerCase();
    const sortAliases = {
      po: "order_id",
      order: "order_id",
      orderid: "order_id",
      order_id: "order_id",
      orderdate: "order_date",
      order_date: "order_date",
      etd: "ETD",
      date: "order_date",
    };
    const sortBy = sortAliases[normalizedSortKey] || "order_date";
    const explicitSortOrder = String(
      req.query.sort_order ?? req.query.sortOrder ?? "",
    )
      .trim()
      .toLowerCase();
    let sortOrder = sortBy === "order_id" ? "asc" : "desc";
    if (sortTokenDirection) {
      sortOrder = sortTokenDirection;
    }
    if (explicitSortOrder === "asc" || explicitSortOrder === "desc") {
      sortOrder = explicitSortOrder;
    }
    const sortDirection = sortOrder === "asc" ? 1 : -1;
    const sortStage = {
      [sortBy]: sortDirection,
      ...(sortBy !== "order_date" ? { order_date: -1 } : {}),
      ...(sortBy !== "order_id" ? { order_id: 1 } : {}),
    };

    const dataset = await buildPoBucketDataset({
      brand,
      vendor,
      status,
      order,
      itemCode,
      poBucket,
      sortBy,
      sortOrder,
    });
    const totalRecords = dataset.rows.length;
    const data = dataset.rows.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      sort: {
        sort_by: sortBy,
        sort_order: sortOrder,
      },
      filters: dataset.filters,
    });
  } catch (error) {
    console.error("Get Orders By Filters DB Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch filtered orders",
      error: error.message,
    });
  }
};

exports.exportOrdersDb = async (req, res) => {
  try {
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const status = req.query.status;
    const order = req.query.order ?? req.query.order_id;
    const itemCode = req.query.item_code ?? req.query.itemCode;
    const poBucket = req.query.po_bucket ?? req.query.poBucket;
    const orderDateFrom = req.query.order_date_from ?? req.query.orderDateFrom;
    const orderDateTo = req.query.order_date_to ?? req.query.orderDateTo;
    const etdFrom = req.query.etd_from ?? req.query.etdFrom;
    const etdTo = req.query.etd_to ?? req.query.etdTo;
    const tzOffsetValue =
      req.query.tz_offset_minutes ?? req.query.tzOffset ?? req.query.tz_offset;
    const exportFormat =
      String(req.query.format || "")
        .trim()
        .toLowerCase() === "csv"
        ? "csv"
        : "xlsx";

    const normalizedSortToken = normalizeFilterValue(req.query.sort);
    const rawSortBy = normalizeFilterValue(
      req.query.sort_by ?? req.query.sortBy,
    );
    const sortTokenDirection = String(normalizedSortToken || "").startsWith("-")
      ? "desc"
      : String(normalizedSortToken || "").startsWith("+")
        ? "asc"
        : null;
    const normalizedSortKey = String(
      rawSortBy ||
        String(normalizedSortToken || "").replace(/^[+-]/, "") ||
        "order_date",
    )
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, "")
      .toLowerCase();
    const sortAliases = {
      po: "order_id",
      order: "order_id",
      orderid: "order_id",
      order_id: "order_id",
      orderdate: "order_date",
      order_date: "order_date",
      etd: "ETD",
      date: "order_date",
    };
    const sortBy = sortAliases[normalizedSortKey] || "order_date";
    const explicitSortOrder = String(
      req.query.sort_order ?? req.query.sortOrder ?? "",
    )
      .trim()
      .toLowerCase();
    let sortOrder = sortBy === "order_id" ? "asc" : "desc";
    if (sortTokenDirection) {
      sortOrder = sortTokenDirection;
    }
    if (explicitSortOrder === "asc" || explicitSortOrder === "desc") {
      sortOrder = explicitSortOrder;
    }
    const sortDirection = sortOrder === "asc" ? 1 : -1;
    const sortStage = {
      [sortBy]: sortDirection,
      ...(sortBy !== "order_date" ? { order_date: -1 } : {}),
      ...(sortBy !== "order_id" ? { order_id: 1 } : {}),
    };

    const orderDateRangeQuery = buildDateRangeQuery({
      fromValue: orderDateFrom,
      toValue: orderDateTo,
      tzOffsetValue,
      label: "Order date",
    });
    if (orderDateRangeQuery.error) {
      return res.status(400).json({
        success: false,
        message: orderDateRangeQuery.error,
      });
    }

    const etdRangeQuery = buildDateRangeQuery({
      fromValue: etdFrom,
      toValue: etdTo,
      tzOffsetValue,
      label: "ETD",
    });
    if (etdRangeQuery.error) {
      return res.status(400).json({
        success: false,
        message: etdRangeQuery.error,
      });
    }

    let orders = [];

    if (normalizeFilterValue(poBucket)) {
      const dataset = await buildPoBucketDataset({
        brand,
        vendor,
        status,
        order,
        itemCode,
        poBucket,
        sortBy,
        sortOrder,
        orderDateRange: orderDateRangeQuery.range,
        etdRange: etdRangeQuery.range,
      });

      const visibleOrderIds = new Set(
        dataset.rows.map((row) =>
          normalizeOrderKey(row?.order_id) || normalizeLooseString(row?.order_id)),
      );
      const visibleSourceOrderIds = [
        ...new Set(
          dataset.sourceOrders
            .filter((orderEntry) =>
              visibleOrderIds.has(
                normalizeOrderKey(orderEntry?.order_id) ||
                  normalizeLooseString(orderEntry?.order_id),
              ))
            .map((orderEntry) => String(orderEntry?._id || "").trim())
            .filter((value) => mongoose.Types.ObjectId.isValid(value)),
        ),
      ];

      orders = visibleSourceOrderIds.length > 0
        ? await Order.find({ _id: { $in: visibleSourceOrderIds } })
          .select(
            "order_id brand vendor ETD order_date status quantity item shipment qc_record",
          )
          .populate({
            path: "qc_record",
            select:
              "request_date request_type last_inspected_date item inspector cbm inspection_dates request_history inspection_record labels quantities remarks",
            populate: {
              path: "inspector",
              select: "name email role",
            },
          })
          .sort(sortStage)
          .lean()
        : [];
    } else {
      const matchStage = buildOrderListMatch({
        brand,
        vendor,
        status,
        order,
        itemCode,
      });

      if (orderDateRangeQuery.range) {
        matchStage.order_date = orderDateRangeQuery.range;
      }

      if (etdRangeQuery.range) {
        matchStage.ETD = etdRangeQuery.range;
      }

      orders = await Order.find(matchStage)
        .select(
          "order_id brand vendor ETD order_date status quantity item shipment qc_record",
        )
        .populate({
          path: "qc_record",
          select:
            "request_date request_type last_inspected_date item inspector cbm inspection_dates request_history inspection_record labels quantities remarks",
          populate: {
            path: "inspector",
            select: "name email role",
          },
        })
        .sort(sortStage)
        .lean();
    }

    const toSafeNumber = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const normalizeText = (value) => String(value ?? "").trim();

    const resolveInspectorLabel = (inspectorValue) => {
      if (!inspectorValue) return "";
      if (typeof inspectorValue === "string") return inspectorValue.trim();
      return normalizeText(
        inspectorValue?.name || inspectorValue?.email || inspectorValue?._id,
      );
    };

    const stringifyList = (values = []) =>
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeText(value))
        .filter(Boolean)
        .join(" | ");

    const stringifyRequestHistory = (history = []) =>
      (Array.isArray(history) ? history : [])
        .map((entry) => {
          const requestDate = normalizeText(entry?.request_date);
          const requestType = normalizeText(entry?.request_type);
          const quantityRequested = toSafeNumber(entry?.quantity_requested);
          const statusText = normalizeText(entry?.status);
          return [
            requestDate,
            requestType,
            `qty ${quantityRequested}`,
            statusText,
          ]
            .filter(Boolean)
            .join(" / ");
        })
        .filter(Boolean)
        .join(" | ");

    const columns = [
      { key: "order_id", header: "Order ID" },
      { key: "brand", header: "Brand" },
      { key: "vendor", header: "Vendor" },
      { key: "status", header: "Order Status" },
      { key: "order_quantity", header: "Order Quantity" },
      { key: "order_date", header: "Order Date" },
      { key: "etd", header: "ETD" },
      { key: "item_code", header: "Item Code" },
      { key: "item_description", header: "Item Description" },
      { key: "qc_item_code", header: "QC Item Code" },
      { key: "qc_item_description", header: "QC Item Description" },
      { key: "qc_available", header: "QC Available" },
      { key: "qc_request_date", header: "QC Request Date" },
      { key: "qc_request_type", header: "QC Request Type" },
      { key: "qc_last_inspected_date", header: "QC Last Inspected Date" },
      { key: "qc_inspector", header: "QC Inspector" },
      { key: "qc_client_demand", header: "QC Client Demand" },
      { key: "qc_quantity_requested", header: "QC Quantity Requested" },
      { key: "qc_vendor_provision", header: "QC Vendor Provision" },
      { key: "qc_checked", header: "QC Checked" },
      { key: "qc_passed", header: "QC Passed" },
      { key: "qc_pending", header: "QC Pending" },
      { key: "qc_rejected", header: "QC Rejected" },
      { key: "qc_labels", header: "QC Labels" },
      { key: "qc_inspection_dates", header: "QC Inspection Dates" },
      { key: "qc_request_history", header: "QC Request History" },
      {
        key: "qc_inspection_records_count",
        header: "QC Inspection Records Count",
      },
      { key: "qc_cbm_top", header: "QC CBM Top" },
      { key: "qc_cbm_bottom", header: "QC CBM Bottom" },
      { key: "qc_cbm_total", header: "QC CBM Total" },
      { key: "qc_remarks", header: "QC Remarks" },
      { key: "shipment_count", header: "Shipment Count" },
      { key: "total_shipped_quantity", header: "Total Shipped Quantity" },
      { key: "shipping_pending_quantity", header: "Shipping Pending Quantity" },
      { key: "shipment_index", header: "Shipment Index" },
      { key: "shipment_stuffing_date", header: "Shipment Stuffing Date" },
      { key: "shipment_container", header: "Shipment Container" },
      { key: "shipment_invoice_number", header: "Shipment Invoice Number" },
      { key: "shipment_quantity", header: "Shipment Quantity" },
      { key: "shipment_pending", header: "Shipment Pending" },
      { key: "shipment_remarks", header: "Shipment Remarks" },
    ];

    const exportRows = orders.flatMap((orderEntry) => {
      const orderQuantity = Math.max(0, toSafeNumber(orderEntry?.quantity));
      const shipmentEntries = Array.isArray(orderEntry?.shipment)
        ? orderEntry.shipment
        : [];
      const totalShippedQuantity = shipmentEntries.reduce(
        (sum, shipmentEntry) =>
          sum + Math.max(0, toSafeNumber(shipmentEntry?.quantity)),
        0,
      );
      const shippingPendingQuantity = Math.max(
        0,
        orderQuantity - totalShippedQuantity,
      );
      const qcRecord = orderEntry?.qc_record || null;
      const hasQcRecord = Boolean(qcRecord);
      const qcQuantities = qcRecord?.quantities || {};
      const inspectionDates = stringifyList(qcRecord?.inspection_dates);
      const requestHistory = stringifyRequestHistory(qcRecord?.request_history);
      const qcLabels = (Array.isArray(qcRecord?.labels) ? qcRecord.labels : [])
        .map((labelValue) => Number(labelValue))
        .filter((labelValue) => Number.isFinite(labelValue))
        .join(", ");

      const baseRow = {
        order_id: normalizeText(orderEntry?.order_id),
        brand: normalizeText(orderEntry?.brand),
        vendor: normalizeText(orderEntry?.vendor),
        status: deriveOrderStatus({ orderEntry, qcRecord }),
        order_quantity: orderQuantity,
        order_date: formatDateDDMMYYYY(orderEntry?.order_date, ""),
        etd: formatDateDDMMYYYY(orderEntry?.ETD, ""),
        item_code: normalizeText(orderEntry?.item?.item_code),
        item_description: normalizeText(orderEntry?.item?.description),
        qc_item_code: normalizeText(qcRecord?.item?.item_code),
        qc_item_description: normalizeText(qcRecord?.item?.description),
        qc_available: hasQcRecord ? "Yes" : "No",
        qc_request_date: normalizeText(qcRecord?.request_date),
        qc_request_type: normalizeText(qcRecord?.request_type),
        qc_last_inspected_date: normalizeText(qcRecord?.last_inspected_date),
        qc_inspector: resolveInspectorLabel(qcRecord?.inspector),
        qc_client_demand: hasQcRecord
          ? toSafeNumber(qcQuantities?.client_demand)
          : "",
        qc_quantity_requested: hasQcRecord
          ? toSafeNumber(qcQuantities?.quantity_requested)
          : "",
        qc_vendor_provision: hasQcRecord
          ? toSafeNumber(qcQuantities?.vendor_provision)
          : "",
        qc_checked: hasQcRecord ? toSafeNumber(qcQuantities?.qc_checked) : "",
        qc_passed: hasQcRecord ? toSafeNumber(qcQuantities?.qc_passed) : "",
        qc_pending: hasQcRecord ? toSafeNumber(qcQuantities?.pending) : "",
        qc_rejected: hasQcRecord ? toSafeNumber(qcQuantities?.qc_rejected) : "",
        qc_labels: qcLabels,
        qc_inspection_dates: inspectionDates,
        qc_request_history: requestHistory,
        qc_inspection_records_count: hasQcRecord
          ? Array.isArray(qcRecord?.inspection_record)
            ? qcRecord.inspection_record.length
            : 0
          : "",
        qc_cbm_top: normalizeText(qcRecord?.cbm?.top),
        qc_cbm_bottom: normalizeText(qcRecord?.cbm?.bottom),
        qc_cbm_total: normalizeText(qcRecord?.cbm?.total),
        qc_remarks: normalizeText(qcRecord?.remarks),
        shipment_count: shipmentEntries.length,
        total_shipped_quantity: totalShippedQuantity,
        shipping_pending_quantity: shippingPendingQuantity,
      };

      if (shipmentEntries.length === 0) {
        return [
          {
            ...baseRow,
            shipment_index: "",
            shipment_stuffing_date: "",
            shipment_container: "",
            shipment_invoice_number: "N/A",
            shipment_quantity: 0,
            shipment_pending: shippingPendingQuantity,
            shipment_remarks: "",
          },
        ];
      }

      let cumulativeShipped = 0;
      return shipmentEntries.map((shipmentEntry, shipmentIndex) => {
        const shipmentQuantity = Math.max(
          0,
          toSafeNumber(shipmentEntry?.quantity),
        );
        cumulativeShipped += shipmentQuantity;
        const pendingValue = toSafeNumber(shipmentEntry?.pending);
        const pendingFromOrder = Math.max(0, orderQuantity - cumulativeShipped);

        return {
          ...baseRow,
          shipment_index: shipmentIndex + 1,
          shipment_stuffing_date: formatDateDDMMYYYY(
            shipmentEntry?.stuffing_date,
            "",
          ),
          shipment_container: normalizeText(shipmentEntry?.container),
          shipment_invoice_number: normalizeShipmentInvoiceNumber(
            shipmentEntry?.invoice_number,
          ),
          shipment_quantity: shipmentQuantity,
          shipment_pending: Number.isFinite(Number(shipmentEntry?.pending))
            ? pendingValue
            : pendingFromOrder,
          shipment_remarks: normalizeText(shipmentEntry?.remaining_remarks),
        };
      });
    });

    const headerRow = columns.map((column) => column.header);
    const dataRows = exportRows.map((row) =>
      columns.map((column) => row[column.key] ?? ""),
    );

    const fileDate = new Date().toISOString().slice(0, 10);
    const baseFileName = `orders-${fileDate}`;

    if (exportFormat === "csv") {
      const escapeCsvValue = (value) => {
        const normalized = String(value ?? "")
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");
        if (/["\n,]/.test(normalized)) {
          return `"${normalized.replace(/"/g, '""')}"`;
        }
        return normalized;
      };

      const csvLines = [headerRow, ...dataRows].map((row) =>
        row.map((cell) => escapeCsvValue(cell)).join(","),
      );
      const csvContent = `\uFEFF${csvLines.join("\r\n")}`;
      const fileName = `${baseFileName}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      return res.status(200).send(csvContent);
    }

    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    worksheet["!cols"] = columns.map((column, columnIndex) => {
      const maxDataLength = Math.max(
        ...dataRows.map((row) => String(row[columnIndex] ?? "").length),
        column.header.length,
      );
      return { wch: Math.min(50, Math.max(12, maxDataLength + 2)) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Orders Details");
    const fileBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    const fileName = `${baseFileName}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Export Orders DB Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export orders",
      error: error.message,
    });
  }
};

const buildDelayedPoReportDataset = async ({
  brand = "",
  vendor = "",
  etdRange = null,
  fromDate = "",
  toDate = "",
} = {}) => {
  const selectedBrand = normalizeFilterValue(brand) || "";
  const selectedVendor = normalizeFilterValue(vendor) || "";
  const todayUtc = toUtcDayStart(new Date());
  const normalizedFromDate = fromDate ? toISODateString(fromDate) : "";
  const normalizedToDate = toDate ? toISODateString(toDate) : "";

  const orders = await Order.find(ACTIVE_ORDER_MATCH)
    .select(
      "order_id item brand vendor quantity status ETD revised_ETD order_date shipment qc_record",
    )
    .populate({
      path: "qc_record",
      select: "quantities request_history last_inspected_date inspection_dates",
    })
    .sort({ vendor: 1, brand: 1, order_id: 1, order_date: -1 })
    .lean();

  const groupedOrders = new Map();

  for (const orderEntry of orders) {
    const orderId =
      normalizeOrderKey(orderEntry?.order_id) ||
      normalizeLooseString(orderEntry?.order_id) ||
      "N/A";
    const vendorName = normalizeLooseString(orderEntry?.vendor) || "N/A";
    const brandName = normalizeLooseString(orderEntry?.brand) || "N/A";
    const groupKey = buildDelayedPoGroupKey({
      orderId,
      brand: brandName,
      vendor: vendorName,
    });

    if (!groupedOrders.has(groupKey)) {
      groupedOrders.set(groupKey, {
        order_id: orderId,
        brand: brandName,
        vendor: vendorName,
        order_date: null,
        etd: null,
        revised_etd: null,
        pending_count: 0,
        inspection_done_count: 0,
        shipped_count: 0,
        total_items: 0,
        total_quantity: 0,
        item_codes: new Set(),
        pending_item_codes: new Set(),
        inspection_done_item_codes: new Set(),
        shipped_item_codes: new Set(),
        last_shipment_date: null,
        last_inspected_date: null,
      });
    }

    const groupedEntry = groupedOrders.get(groupKey);
    const status = deriveOrderStatus({ orderEntry });
    const itemCode = normalizeLooseString(orderEntry?.item?.item_code);
    const quantity = Math.max(
      0,
      Number(parseQuantityLike(orderEntry?.quantity) || 0),
    );
    const orderDate = parseDateLike(orderEntry?.order_date);
    const etdDate = parseDateLike(orderEntry?.ETD);
    const revisedEtdDate = parseDateLike(orderEntry?.revised_ETD);
    const latestShipmentDate = resolveLatestShipmentDate(orderEntry?.shipment);
    const latestInspectionDate = resolveLatestInspectionDate(
      orderEntry?.qc_record,
    );

    groupedEntry.order_date = resolveEarlierDate(
      groupedEntry.order_date,
      orderDate,
    );
    groupedEntry.etd = resolveEarlierDate(groupedEntry.etd, etdDate);
    groupedEntry.revised_etd = resolveEarlierDate(
      groupedEntry.revised_etd,
      revisedEtdDate,
    );
    groupedEntry.last_shipment_date = resolveLaterDate(
      groupedEntry.last_shipment_date,
      latestShipmentDate,
    );
    groupedEntry.last_inspected_date = resolveLaterDate(
      groupedEntry.last_inspected_date,
      latestInspectionDate,
    );
    groupedEntry.total_items += 1;
    groupedEntry.total_quantity += quantity;

    if (itemCode) {
      groupedEntry.item_codes.add(itemCode);
    }

    if (isShippedLikeOrderStatus(status)) {
      groupedEntry.shipped_count += 1;
      if (itemCode) {
        groupedEntry.shipped_item_codes.add(itemCode);
      }
    } else if (isInspectionDoneOrderStatus(status)) {
      groupedEntry.inspection_done_count += 1;
      if (itemCode) {
        groupedEntry.inspection_done_item_codes.add(itemCode);
      }
    } else if (isPendingOrderStatus(status)) {
      groupedEntry.pending_count += 1;
      if (itemCode) {
        groupedEntry.pending_item_codes.add(itemCode);
      }
    } else {
      groupedEntry.pending_count += 1;
      if (itemCode) {
        groupedEntry.pending_item_codes.add(itemCode);
      }
    }
  }

  const allRows = Array.from(groupedOrders.values())
    .map((groupedEntry) => {
      const originalEtd = groupedEntry.etd;
      if (!originalEtd || !todayUtc) {
        return null;
      }

      const hasOpenItems =
        groupedEntry.pending_count > 0 ||
        groupedEntry.inspection_done_count > 0;
      const isFullyShipped =
        groupedEntry.pending_count === 0 &&
        groupedEntry.inspection_done_count === 0 &&
        groupedEntry.shipped_count > 0;
      const etdCrossed = originalEtd.getTime() < todayUtc.getTime();
      const isWithinSelectedEtdWindow =
        !etdRange ||
        (
          (!etdRange.$gte || originalEtd.getTime() >= etdRange.$gte.getTime()) &&
          (!etdRange.$lt || originalEtd.getTime() < etdRange.$lt.getTime())
        );

      if (isFullyShipped || !(hasOpenItems && etdCrossed) || !isWithinSelectedEtdWindow) {
        return null;
      }

      const delayDays = Math.max(0, diffUtcDays(todayUtc, originalEtd));
      const lastProgress = resolveDelayedPoLastProgress(groupedEntry);

      return {
        order_id: groupedEntry.order_id,
        brand: groupedEntry.brand,
        vendor: groupedEntry.vendor,
        order_date: toISODateString(groupedEntry.order_date),
        etd: toISODateString(groupedEntry.etd),
        revised_etd: toISODateString(groupedEntry.revised_etd),
        delay_days: delayDays,
        pending_count: groupedEntry.pending_count,
        inspection_done_count: groupedEntry.inspection_done_count,
        shipped_count: groupedEntry.shipped_count,
        total_items: groupedEntry.total_items,
        total_quantity: groupedEntry.total_quantity,
        item_codes: Array.from(groupedEntry.item_codes).sort((a, b) =>
          a.localeCompare(b),
        ),
        pending_item_codes: Array.from(groupedEntry.pending_item_codes).sort(
          (a, b) => a.localeCompare(b),
        ),
        inspection_done_item_codes: Array.from(
          groupedEntry.inspection_done_item_codes,
        ).sort((a, b) => a.localeCompare(b)),
        shipped_item_codes: Array.from(groupedEntry.shipped_item_codes).sort(
          (a, b) => a.localeCompare(b),
        ),
        last_shipment_date: toISODateString(groupedEntry.last_shipment_date),
        last_inspected_date: toISODateString(groupedEntry.last_inspected_date),
        last_progress: lastProgress.display,
        last_progress_type: lastProgress.type,
        last_progress_value: lastProgress.value,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const vendorCompare = String(left?.vendor || "").localeCompare(
        String(right?.vendor || ""),
      );
      if (vendorCompare !== 0) return vendorCompare;

      const delayCompare =
        Number(right?.delay_days || 0) - Number(left?.delay_days || 0);
      if (delayCompare !== 0) return delayCompare;

      const etdCompare =
        (parseDateLike(left?.etd)?.getTime() || 0) -
        (parseDateLike(right?.etd)?.getTime() || 0);
      if (etdCompare !== 0) return etdCompare;

      return String(left?.order_id || "").localeCompare(
        String(right?.order_id || ""),
      );
    });

  const brandOptions = normalizeDistinctValues(
    allRows.map((row) => row?.brand || ""),
  );
  const vendorOptions = normalizeDistinctValues(
    allRows.map((row) => row?.vendor || ""),
  );

  const filteredRows = allRows.filter((row) => {
    if (selectedBrand && row?.brand !== selectedBrand) return false;
    if (selectedVendor && row?.vendor !== selectedVendor) return false;
    return true;
  });

  const vendorMap = new Map();
  let totalDelayDays = 0;
  let totalPendingCount = 0;
  let totalInspectionDoneCount = 0;
  let totalShippedCount = 0;

  for (const row of filteredRows) {
    const vendorKey = normalizeVendorKey(row?.vendor);
    if (!vendorMap.has(vendorKey)) {
      vendorMap.set(vendorKey, {
        vendor: row.vendor,
        brands: new Set(),
        delayed_po_count: 0,
        pending_count: 0,
        inspection_done_count: 0,
        shipped_count: 0,
        total_delay_days: 0,
        rows: [],
      });
    }

    const vendorEntry = vendorMap.get(vendorKey);
    vendorEntry.brands.add(row.brand);
    vendorEntry.delayed_po_count += 1;
    vendorEntry.pending_count += Number(row.pending_count || 0);
    vendorEntry.inspection_done_count += Number(row.inspection_done_count || 0);
    vendorEntry.shipped_count += Number(row.shipped_count || 0);
    vendorEntry.total_delay_days += Number(row.delay_days || 0);
    vendorEntry.rows.push(row);

    totalDelayDays += Number(row.delay_days || 0);
    totalPendingCount += Number(row.pending_count || 0);
    totalInspectionDoneCount += Number(row.inspection_done_count || 0);
    totalShippedCount += Number(row.shipped_count || 0);
  }

  const vendors = Array.from(vendorMap.values())
    .map((vendorEntry) => ({
      vendor: vendorEntry.vendor,
      brands: Array.from(vendorEntry.brands).sort((a, b) =>
        String(a || "").localeCompare(String(b || "")),
      ),
      delayed_po_count: vendorEntry.delayed_po_count,
      pending_count: vendorEntry.pending_count,
      inspection_done_count: vendorEntry.inspection_done_count,
      shipped_count: vendorEntry.shipped_count,
      total_delay_days: vendorEntry.total_delay_days,
      average_delay_days:
        vendorEntry.delayed_po_count > 0
          ? Number(
              (
                vendorEntry.total_delay_days / vendorEntry.delayed_po_count
              ).toFixed(2),
            )
          : 0,
      rows: vendorEntry.rows,
    }))
    .sort((left, right) =>
      String(left?.vendor || "").localeCompare(String(right?.vendor || "")),
    );

  return {
    filters: {
      brand: selectedBrand,
      vendor: selectedVendor,
      brand_options: brandOptions,
      vendor_options: vendorOptions,
      from_date: normalizedFromDate,
      to_date: normalizedToDate,
      report_date: toISODateString(todayUtc),
    },
    summary: {
      delayed_po_count: filteredRows.length,
      vendors_count: vendors.length,
      pending_count: totalPendingCount,
      inspection_done_count: totalInspectionDoneCount,
      shipped_count: totalShippedCount,
      total_delay_days: totalDelayDays,
      average_delay_days:
        filteredRows.length > 0
          ? Number((totalDelayDays / filteredRows.length).toFixed(2))
          : 0,
    },
    vendors,
    rows: filteredRows,
  };
};

const resolveDelayedPoReportFilterParams = (req = {}) => {
  const fromDate =
    req.query.from_date ??
    req.query.fromDate ??
    req.query.start_date ??
    req.query.startDate;
  const toDate =
    req.query.to_date ??
    req.query.toDate ??
    req.query.end_date ??
    req.query.endDate;

  const etdRangeResult = buildDateRangeQuery({
    fromValue: fromDate,
    toValue: toDate,
    tzOffsetValue: req.query.tz_offset ?? req.query.tzOffset,
    label: "ETD",
  });

  if (etdRangeResult.error) {
    return { error: etdRangeResult.error };
  }

  return {
    brand: req.query.brand,
    vendor: req.query.vendor,
    fromDate,
    toDate,
    etdRange: etdRangeResult.range,
  };
};

const buildUpcomingEtdReportDataset = async ({
  brand = "",
  vendor = "",
  toDate = "",
} = {}) => {
  const selectedBrand = normalizeFilterValue(brand) || "";
  const selectedVendor = normalizeFilterValue(vendor) || "";
  const todayUtc = toUtcDayStart(new Date());
  const defaultRangeEnd = todayUtc
    ? new Date(todayUtc.getTime() + 15 * MS_PER_DAY)
    : null;
  const reportEndDateUtc = toUtcDayStart(toDate) || defaultRangeEnd;

  const orders = await Order.find(ACTIVE_ORDER_MATCH)
    .select(
      "order_id item brand vendor quantity status ETD revised_ETD order_date shipment qc_record",
    )
    .populate({
      path: "qc_record",
      select: "quantities request_history last_inspected_date inspection_dates",
    })
    .sort({ vendor: 1, brand: 1, order_id: 1, order_date: -1 })
    .lean();

  const groupedOrders = new Map();

  for (const orderEntry of orders) {
    const orderId =
      normalizeOrderKey(orderEntry?.order_id) ||
      normalizeLooseString(orderEntry?.order_id) ||
      "N/A";
    const vendorName = normalizeLooseString(orderEntry?.vendor) || "N/A";
    const brandName = normalizeLooseString(orderEntry?.brand) || "N/A";
    const groupKey = buildDelayedPoGroupKey({
      orderId,
      brand: brandName,
      vendor: vendorName,
    });

    if (!groupedOrders.has(groupKey)) {
      groupedOrders.set(groupKey, {
        order_id: orderId,
        brand: brandName,
        vendor: vendorName,
        order_date: null,
        etd: null,
        revised_etd: null,
        effective_etd: null,
        pending_count: 0,
        inspection_done_count: 0,
        shipped_count: 0,
        total_items: 0,
        total_quantity: 0,
        item_codes: new Set(),
        pending_item_codes: new Set(),
        inspection_done_item_codes: new Set(),
        shipped_item_codes: new Set(),
        last_shipment_date: null,
        last_inspected_date: null,
      });
    }

    const groupedEntry = groupedOrders.get(groupKey);
    const status = deriveOrderStatus({ orderEntry });
    const itemCode = normalizeLooseString(orderEntry?.item?.item_code);
    const quantity = Math.max(
      0,
      Number(parseQuantityLike(orderEntry?.quantity) || 0),
    );
    const orderDate = parseDateLike(orderEntry?.order_date);
    const etdDate = parseDateLike(orderEntry?.ETD);
    const revisedEtdDate = parseDateLike(orderEntry?.revised_ETD);
    const effectiveEtdDate = resolveEffectiveOrderEtdDate(orderEntry);
    const latestShipmentDate = resolveLatestShipmentDate(orderEntry?.shipment);
    const latestInspectionDate = resolveLatestInspectionDate(
      orderEntry?.qc_record,
    );

    groupedEntry.order_date = resolveEarlierDate(
      groupedEntry.order_date,
      orderDate,
    );
    groupedEntry.etd = resolveEarlierDate(groupedEntry.etd, etdDate);
    groupedEntry.revised_etd = resolveEarlierDate(
      groupedEntry.revised_etd,
      revisedEtdDate,
    );
    groupedEntry.effective_etd = resolveEarlierDate(
      groupedEntry.effective_etd,
      effectiveEtdDate,
    );
    groupedEntry.last_shipment_date = resolveLaterDate(
      groupedEntry.last_shipment_date,
      latestShipmentDate,
    );
    groupedEntry.last_inspected_date = resolveLaterDate(
      groupedEntry.last_inspected_date,
      latestInspectionDate,
    );
    groupedEntry.total_items += 1;
    groupedEntry.total_quantity += quantity;

    if (itemCode) {
      groupedEntry.item_codes.add(itemCode);
    }

    if (isShippedLikeOrderStatus(status)) {
      groupedEntry.shipped_count += 1;
      if (itemCode) {
        groupedEntry.shipped_item_codes.add(itemCode);
      }
    } else if (isInspectionDoneOrderStatus(status)) {
      groupedEntry.inspection_done_count += 1;
      if (itemCode) {
        groupedEntry.inspection_done_item_codes.add(itemCode);
      }
    } else if (isPendingOrderStatus(status)) {
      groupedEntry.pending_count += 1;
      if (itemCode) {
        groupedEntry.pending_item_codes.add(itemCode);
      }
    } else {
      groupedEntry.pending_count += 1;
      if (itemCode) {
        groupedEntry.pending_item_codes.add(itemCode);
      }
    }
  }

  const allRows = Array.from(groupedOrders.values())
    .map((groupedEntry) => {
      const effectiveEtd = groupedEntry.effective_etd;
      if (!effectiveEtd || !todayUtc || !reportEndDateUtc) {
        return null;
      }

      const hasOpenItems =
        groupedEntry.pending_count > 0 ||
        groupedEntry.inspection_done_count > 0;
      const isFullyShipped =
        groupedEntry.pending_count === 0 &&
        groupedEntry.inspection_done_count === 0 &&
        groupedEntry.shipped_count > 0;
      const isWithinUpcomingWindow =
        effectiveEtd.getTime() >= todayUtc.getTime() &&
        effectiveEtd.getTime() <= reportEndDateUtc.getTime();

      if (isFullyShipped || !(hasOpenItems && isWithinUpcomingWindow)) {
        return null;
      }

      const daysUntilEtd = Math.max(0, diffUtcDays(effectiveEtd, todayUtc));
      const lastProgress = resolveDelayedPoLastProgress(groupedEntry);

      return {
        order_id: groupedEntry.order_id,
        brand: groupedEntry.brand,
        vendor: groupedEntry.vendor,
        order_date: toISODateString(groupedEntry.order_date),
        etd: toISODateString(groupedEntry.etd),
        revised_etd: toISODateString(groupedEntry.revised_etd),
        effective_etd: toISODateString(groupedEntry.effective_etd),
        days_until_etd: daysUntilEtd,
        pending_count: groupedEntry.pending_count,
        inspection_done_count: groupedEntry.inspection_done_count,
        shipped_count: groupedEntry.shipped_count,
        total_items: groupedEntry.total_items,
        total_quantity: groupedEntry.total_quantity,
        item_codes: Array.from(groupedEntry.item_codes).sort((a, b) =>
          a.localeCompare(b),
        ),
        pending_item_codes: Array.from(groupedEntry.pending_item_codes).sort(
          (a, b) => a.localeCompare(b),
        ),
        inspection_done_item_codes: Array.from(
          groupedEntry.inspection_done_item_codes,
        ).sort((a, b) => a.localeCompare(b)),
        shipped_item_codes: Array.from(groupedEntry.shipped_item_codes).sort(
          (a, b) => a.localeCompare(b),
        ),
        last_shipment_date: toISODateString(groupedEntry.last_shipment_date),
        last_inspected_date: toISODateString(groupedEntry.last_inspected_date),
        last_progress: lastProgress.display,
        last_progress_type: lastProgress.type,
        last_progress_value: lastProgress.value,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const vendorCompare = String(left?.vendor || "").localeCompare(
        String(right?.vendor || ""),
      );
      if (vendorCompare !== 0) return vendorCompare;

      const daysCompare =
        Number(left?.days_until_etd || 0) - Number(right?.days_until_etd || 0);
      if (daysCompare !== 0) return daysCompare;

      const etdCompare =
        (parseDateLike(left?.effective_etd)?.getTime() || 0) -
        (parseDateLike(right?.effective_etd)?.getTime() || 0);
      if (etdCompare !== 0) return etdCompare;

      return String(left?.order_id || "").localeCompare(
        String(right?.order_id || ""),
      );
    });

  const brandOptions = normalizeDistinctValues(
    allRows.map((row) => row?.brand || ""),
  );
  const vendorOptions = normalizeDistinctValues(
    allRows.map((row) => row?.vendor || ""),
  );

  const filteredRows = allRows.filter((row) => {
    if (selectedBrand && row?.brand !== selectedBrand) return false;
    if (selectedVendor && row?.vendor !== selectedVendor) return false;
    return true;
  });

  const vendorMap = new Map();
  let totalDaysUntilEtd = 0;
  let totalPendingCount = 0;
  let totalInspectionDoneCount = 0;
  let totalShippedCount = 0;

  for (const row of filteredRows) {
    const vendorKey = normalizeVendorKey(row?.vendor);
    if (!vendorMap.has(vendorKey)) {
      vendorMap.set(vendorKey, {
        vendor: row.vendor,
        brands: new Set(),
        upcoming_po_count: 0,
        pending_count: 0,
        inspection_done_count: 0,
        shipped_count: 0,
        total_days_until_etd: 0,
        rows: [],
      });
    }

    const vendorEntry = vendorMap.get(vendorKey);
    vendorEntry.brands.add(row.brand);
    vendorEntry.upcoming_po_count += 1;
    vendorEntry.pending_count += Number(row.pending_count || 0);
    vendorEntry.inspection_done_count += Number(row.inspection_done_count || 0);
    vendorEntry.shipped_count += Number(row.shipped_count || 0);
    vendorEntry.total_days_until_etd += Number(row.days_until_etd || 0);
    vendorEntry.rows.push(row);

    totalDaysUntilEtd += Number(row.days_until_etd || 0);
    totalPendingCount += Number(row.pending_count || 0);
    totalInspectionDoneCount += Number(row.inspection_done_count || 0);
    totalShippedCount += Number(row.shipped_count || 0);
  }

  const vendors = Array.from(vendorMap.values())
    .map((vendorEntry) => ({
      vendor: vendorEntry.vendor,
      brands: Array.from(vendorEntry.brands).sort((a, b) =>
        String(a || "").localeCompare(String(b || "")),
      ),
      upcoming_po_count: vendorEntry.upcoming_po_count,
      pending_count: vendorEntry.pending_count,
      inspection_done_count: vendorEntry.inspection_done_count,
      shipped_count: vendorEntry.shipped_count,
      total_days_until_etd: vendorEntry.total_days_until_etd,
      average_days_until_etd:
        vendorEntry.upcoming_po_count > 0
          ? Number(
              (
                vendorEntry.total_days_until_etd / vendorEntry.upcoming_po_count
              ).toFixed(2),
            )
          : 0,
      rows: vendorEntry.rows,
    }))
    .sort((left, right) =>
      String(left?.vendor || "").localeCompare(String(right?.vendor || "")),
    );

  return {
    filters: {
      brand: selectedBrand,
      vendor: selectedVendor,
      brand_options: brandOptions,
      vendor_options: vendorOptions,
      report_start_date: toISODateString(todayUtc),
      report_end_date: toISODateString(reportEndDateUtc),
    },
    summary: {
      upcoming_po_count: filteredRows.length,
      vendors_count: vendors.length,
      pending_count: totalPendingCount,
      inspection_done_count: totalInspectionDoneCount,
      shipped_count: totalShippedCount,
      total_days_until_etd: totalDaysUntilEtd,
      average_days_until_etd:
        filteredRows.length > 0
          ? Number((totalDaysUntilEtd / filteredRows.length).toFixed(2))
          : 0,
    },
    vendors,
    rows: filteredRows,
  };
};

exports.getDelayedPoReport = async (req, res) => {
  try {
    const filters = resolveDelayedPoReportFilterParams(req);
    if (filters.error) {
      return res.status(400).json({
        success: false,
        message: filters.error,
      });
    }

    const dataset = await buildDelayedPoReportDataset(filters);

    return res.status(200).json(dataset);
  } catch (error) {
    console.error("Get Delayed PO Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load delayed PO report",
      error: error.message,
    });
  }
};

exports.getUpcomingEtdReport = async (req, res) => {
  try {
    const dataset = await buildUpcomingEtdReportDataset({
      brand: req.query.brand,
      vendor: req.query.vendor,
      toDate:
        req.query.to_date ??
        req.query.toDate ??
        req.query.date ??
        req.query.end_date ??
        req.query.endDate,
    });

    return res.status(200).json(dataset);
  } catch (error) {
    console.error("Get Upcoming ETD Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load upcoming ETD report",
      error: error.message,
    });
  }
};

exports.exportUpcomingEtdReport = async (req, res) => {
  try {
    const dataset = await buildUpcomingEtdReportDataset({
      brand: req.query.brand,
      vendor: req.query.vendor,
      toDate:
        req.query.to_date ??
        req.query.toDate ??
        req.query.date ??
        req.query.end_date ??
        req.query.endDate,
    });

    const columns = [
      { key: "vendor", header: "Vendor" },
      { key: "order_id", header: "PO" },
      { key: "brand", header: "Brand" },
      { key: "order_date", header: "Order Date" },
      { key: "etd", header: "ETD" },
      { key: "days_until_etd", header: "Days Until ETD" },
      { key: "pending_count", header: "Pending" },
      { key: "inspection_done_count", header: "Inspection Done" },
      { key: "shipped_count", header: "Shipped" },
      { key: "last_progress", header: "Last Progress" },
    ];

    const exportRows = [];

    if (Array.isArray(dataset?.vendors)) {
      dataset.vendors.forEach((vendorEntry) => {
        const vendorName = String(vendorEntry?.vendor || "").trim();
        const rows = Array.isArray(vendorEntry?.rows) ? vendorEntry.rows : [];

        rows.forEach((row) => {
          exportRows.push({
            vendor: vendorName,
            order_id: String(row?.order_id || "").trim(),
            brand: String(row?.brand || "").trim(),
            order_date: formatDateDDMMYYYY(row?.order_date, ""),
            etd: formatDateDDMMYYYY(row?.effective_etd, ""),
            days_until_etd: Number(row?.days_until_etd || 0),
            pending_count: Number(row?.pending_count || 0),
            inspection_done_count: Number(row?.inspection_done_count || 0),
            shipped_count: Number(row?.shipped_count || 0),
            last_progress: String(row?.last_progress || "").trim(),
          });
        });
      });
    }

    const headerRow = columns.map((column) => column.header);
    const dataRows = exportRows.map((row) =>
      columns.map((column) => row[column.key] ?? ""),
    );
    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

    worksheet["!cols"] = columns.map((column, columnIndex) => {
      const maxDataLength = Math.max(
        ...dataRows.map((row) => String(row[columnIndex] ?? "").length),
        column.header.length,
      );
      return { wch: Math.min(40, Math.max(12, maxDataLength + 2)) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Upcoming ETD Report");
    const fileBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    const fileDate = new Date().toISOString().slice(0, 10);
    const fileName = `upcoming-etd-report-${fileDate}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Export Upcoming ETD Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export upcoming ETD report",
      error: error.message,
    });
  }
};

exports.exportDelayedPoReport = async (req, res) => {
  try {
    const filters = resolveDelayedPoReportFilterParams(req);
    if (filters.error) {
      return res.status(400).json({
        success: false,
        message: filters.error,
      });
    }

    const dataset = await buildDelayedPoReportDataset(filters);
    const columns = [
      { key: "order_id", header: "PO" },
      { key: "brand", header: "Brand" },
      { key: "vendor", header: "Vendor" },
      { key: "order_date", header: "Order Date" },
      { key: "etd", header: "ETD" },
      { key: "delay_days", header: "Delay Days" },
      { key: "pending_count", header: "Pending Count" },
      { key: "inspection_done_count", header: "Inspection Done Count" },
      { key: "shipped_count", header: "Shipped Count" },
      { key: "last_progress", header: "Last Progress" },
      { key: "last_shipment_date", header: "Last Shipment Date" },
      { key: "last_inspected_date", header: "Last Inspected Date" },
      { key: "total_items", header: "Item Count" },
      { key: "total_quantity", header: "Total Quantity" },
      { key: "pending_item_codes", header: "Pending Item Codes" },
      {
        key: "inspection_done_item_codes",
        header: "Inspection Done Item Codes",
      },
      { key: "shipped_item_codes", header: "Shipped Item Codes" },
    ];

    const exportRows = dataset.rows.map((row) => ({
      order_id: String(row?.order_id || "").trim(),
      brand: String(row?.brand || "").trim(),
      vendor: String(row?.vendor || "").trim(),
      order_date: formatDateDDMMYYYY(row?.order_date, ""),
      etd: formatDateDDMMYYYY(row?.etd, ""),
      delay_days: Number(row?.delay_days || 0),
      pending_count: Number(row?.pending_count || 0),
      inspection_done_count: Number(row?.inspection_done_count || 0),
      shipped_count: Number(row?.shipped_count || 0),
      last_progress: String(row?.last_progress || "").trim(),
      last_shipment_date: formatDateDDMMYYYY(row?.last_shipment_date, ""),
      last_inspected_date: formatDateDDMMYYYY(row?.last_inspected_date, ""),
      total_items: Number(row?.total_items || 0),
      total_quantity: Number(row?.total_quantity || 0),
      pending_item_codes: Array.isArray(row?.pending_item_codes)
        ? row.pending_item_codes.join(", ")
        : "",
      inspection_done_item_codes: Array.isArray(row?.inspection_done_item_codes)
        ? row.inspection_done_item_codes.join(", ")
        : "",
      shipped_item_codes: Array.isArray(row?.shipped_item_codes)
        ? row.shipped_item_codes.join(", ")
        : "",
    }));

    const headerRow = columns.map((column) => column.header);
    const dataRows = exportRows.map((row) =>
      columns.map((column) => row[column.key] ?? ""),
    );
    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

    worksheet["!cols"] = columns.map((column, columnIndex) => {
      const maxDataLength = Math.max(
        ...dataRows.map((row) => String(row[columnIndex] ?? "").length),
        column.header.length,
      );
      return { wch: Math.min(40, Math.max(12, maxDataLength + 2)) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Delayed PO Report");
    const fileBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    const fileDate = new Date().toISOString().slice(0, 10);
    const fileName = `delayed-po-report-${fileDate}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Export Delayed PO Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export delayed PO report",
      error: error.message,
    });
  }
};

exports.getOrdersByFilters = async (req, res) => {
  try {
    const normalizeFilterValue = (value) => {
      if (value === undefined || value === null) return null;
      const cleaned = String(value).trim();
      if (!cleaned) return null;
      const lowered = cleaned.toLowerCase();
      if (lowered === "all" || lowered === "undefined" || lowered === "null") {
        return null;
      }
      return cleaned;
    };

    const parsePositiveInt = (value, fallback) => {
      const parsedValue = Number.parseInt(value, 10);
      if (Number.isNaN(parsedValue) || parsedValue < 1) {
        return fallback;
      }
      return parsedValue;
    };

    const vendor = normalizeFilterValue(req.query.vendor);
    const brand = normalizeFilterValue(req.query.brand);
    const status = normalizeFilterValue(req.query.status);

    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 20);
    const skip = (page - 1) * limit;

    const matchStage = { ...ACTIVE_ORDER_MATCH };

    if (vendor) {
      matchStage.vendor = vendor;
    }

    if (brand) {
      matchStage.brand = brand;
    }

    if (status) {
      matchStage.status = status;
    }

    const [orders, totalRecords] = await Promise.all([
      Order.find(matchStage)
        .populate({
          path: "qc_record",
          populate: {
            path: "inspector",
            select: "name role",
          },
        })
        .sort({ order_date: -1, order_id: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Order.countDocuments(matchStage),
    ]);

    return res.status(200).json({
      success: true,
      data: orders,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
    });
  } catch (error) {
    console.error("Get Orders By Filters Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch filtered orders",
      error: error.message,
    });
  }
};

exports.getOrderSummary = async (req, res) => {
  try {
    const [vendors, brands] = await Promise.all([
      Order.distinct("vendor", ACTIVE_ORDER_MATCH),
      Order.distinct("brand", ACTIVE_ORDER_MATCH),
    ]);

    const normalizeList = (values) =>
      values
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0)
        .sort((a, b) => a.localeCompare(b));

    return res.status(200).json({
      vendors: normalizeList(vendors),
      brands: normalizeList(brands),
    });
  } catch (error) {
    console.error("Get Order Summary Error:", error);
    return res.status(500).json({
      message: "Failed to fetch order summary",
      error: error.message,
    });
  }
};

exports.getShipmentsDb = async (req, res) => {
  try {
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const orderId = req.query.order_id ?? req.query.order;
    const itemCode = req.query.item_code;
    const container = req.query.container ?? req.query.container_number;
    const statusFilter = normalizeFilterValue(req.query.status);
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const shipmentData = await getShipmentDataset({
      brand,
      vendor,
      orderId,
      itemCode,
      container,
      statusFilter,
      sortToken: req.query.sort,
      sortByInput: req.query.sort_by ?? req.query.sortBy,
      sortOrderInput: req.query.sort_order ?? req.query.sortOrder,
    });
    const totalRecords = shipmentData.rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;
    const paginatedData = shipmentData.rows.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      count: totalRecords,
      page_count: paginatedData.length,
      total_count: totalRecords,
      data: paginatedData,
      pagination: {
        page: safePage,
        limit,
        totalPages,
        totalRecords,
      },
      sort: shipmentData.sort,
      summary: shipmentData.summary,
      filters: shipmentData.filters,
    });
  } catch (error) {
    console.error("Get Shipments DB Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch shipment list",
      error: error.message,
    });
  }
};

exports.exportShipmentsDb = async (req, res) => {
  try {
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const orderId = req.query.order_id ?? req.query.order;
    const itemCode = req.query.item_code;
    const container = req.query.container ?? req.query.container_number;
    const statusFilter = normalizeFilterValue(req.query.status);
    const exportFormat =
      String(req.query.format || "")
        .trim()
        .toLowerCase() === "csv"
        ? "csv"
        : "xlsx";

    const shipmentData = await getShipmentDataset({
      brand,
      vendor,
      orderId,
      itemCode,
      container,
      statusFilter,
      sortToken: req.query.sort,
      sortByInput: req.query.sort_by ?? req.query.sortBy,
      sortOrderInput: req.query.sort_order ?? req.query.sortOrder,
    });

    const columns = [
      { key: "order_id", header: "PO" },
      { key: "brand", header: "Brand" },
      { key: "vendor", header: "Vendor" },
      { key: "item_code", header: "Item Code" },
      { key: "description", header: "Description" },
      { key: "status", header: "Status" },
      { key: "order_quantity", header: "Order Quantity" },
      { key: "order_date", header: "Order Date" },
      { key: "etd", header: "ETD" },
      { key: "stuffing_date", header: "Stuffing Date" },
      { key: "container", header: "Container Number" },
      { key: "invoice_number", header: "Invoice Number" },
      { key: "quantity", header: "Shipment Quantity" },
      { key: "pending", header: "Pending" },
      { key: "remaining_remarks", header: "Remarks" },
    ];

    const exportRows = shipmentData.rows.map((row) => ({
      order_id: String(row?.order_id || "").trim(),
      brand: String(row?.brand || "").trim(),
      vendor: String(row?.vendor || "").trim(),
      item_code: String(row?.item_code || "").trim(),
      description: String(row?.description || "").trim(),
      status: String(row?.status || "").trim(),
      order_quantity: Number(row?.order_quantity || 0),
      order_date: formatDateDDMMYYYY(row?.order_date, ""),
      etd: formatDateDDMMYYYY(row?.ETD, ""),
      stuffing_date: formatDateDDMMYYYY(row?.stuffing_date, ""),
      container: String(row?.container || "").trim(),
      invoice_number: normalizeShipmentInvoiceNumber(row?.invoice_number),
      quantity: Number(row?.quantity || 0),
      pending: Number(row?.pending || 0),
      remaining_remarks: String(row?.remaining_remarks || "").trim(),
    }));

    const headerRow = columns.map((column) => column.header);
    const dataRows = exportRows.map((row) =>
      columns.map((column) => row[column.key] ?? ""),
    );

    const fileDate = new Date().toISOString().slice(0, 10);
    const baseFileName = `shipments-${fileDate}`;

    if (exportFormat === "csv") {
      const escapeCsvValue = (value) => {
        const normalized = String(value ?? "")
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");
        if (/["\n,]/.test(normalized)) {
          return `"${normalized.replace(/"/g, '""')}"`;
        }
        return normalized;
      };

      const csvLines = [headerRow, ...dataRows].map((row) =>
        row.map((cell) => escapeCsvValue(cell)).join(","),
      );
      const csvContent = `\uFEFF${csvLines.join("\r\n")}`;
      const fileName = `${baseFileName}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      return res.status(200).send(csvContent);
    }

    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    worksheet["!cols"] = columns.map((column, columnIndex) => {
      const maxDataLength = Math.max(
        ...dataRows.map((row) => String(row[columnIndex] ?? "").length),
        column.header.length,
      );
      return { wch: Math.min(50, Math.max(12, maxDataLength + 2)) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Shipments");
    const fileBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    const fileName = `${baseFileName}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Export Shipments DB Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export shipment list",
      error: error.message,
    });
  }
};

exports.getContainersDb = async (req, res) => {
  try {
    const containerData = await getContainerDataset({
      brand: req.query.brand,
      vendor: req.query.vendor,
      container: req.query.container ?? req.query.container_number,
    });

    return res.status(200).json({
      success: true,
      count: containerData.rows.length,
      data: containerData.rows,
      summary: containerData.summary,
      filters: containerData.filters,
    });
  } catch (error) {
    console.error("Get Containers DB Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch containers list",
      error: error.message,
    });
  }
};

exports.getShipments = async (req, res) => {
  try {
    const statusesToInclude = ["Inspection Done", "Partial Shipped", "Shipped"];

    const orders = await Order.find({
      ...ACTIVE_ORDER_MATCH,
      status: { $in: statusesToInclude },
    })
      .select(
        "order_id item brand vendor status quantity shipment order_date updatedAt",
      )
      .sort({ order_date: -1, updatedAt: -1, order_id: -1 })
      .lean();

    const data = orders.flatMap((order) => {
      const shipmentEntries = Array.isArray(order?.shipment)
        ? order.shipment
        : [];
      const parsedOrderQuantity = Number(order?.quantity);
      const normalizedOrderQuantity = Number.isFinite(parsedOrderQuantity)
        ? parsedOrderQuantity
        : 0;

      const baseRow = {
        _id: order?._id || null,
        order_id: order?.order_id || "",
        brand: order?.brand || "",
        vendor: order?.vendor || "",
        item: {
          item_code: order?.item?.item_code || "",
          description: order?.item?.description || "",
        },
        item_code: order?.item?.item_code || "",
        description: order?.item?.description || "",
        order_quantity: normalizedOrderQuantity,
        shipment: shipmentEntries,
        status: order?.status || "",
      };

      if (shipmentEntries.length === 0) {
        return [
          {
            ...baseRow,
            shipment_id: null,
            stuffing_date: null,
            container: "",
            invoice_number: "N/A",
            quantity: normalizedOrderQuantity,
            pending: normalizedOrderQuantity,
            remaining_remarks: "",
          },
        ];
      }

      return shipmentEntries.map((entry, index) => {
        const parsedShipmentQuantity = Number(entry?.quantity);
        const parsedPending = Number(entry?.pending);

        return {
          ...baseRow,
          shipment_id: entry?._id || `${order?._id || "order"}-${index}`,
          stuffing_date: entry?.stuffing_date || null,
          container: entry?.container || "",
          invoice_number: normalizeShipmentInvoiceNumber(entry?.invoice_number),
          quantity: Number.isFinite(parsedShipmentQuantity)
            ? parsedShipmentQuantity
            : 0,
          pending: Number.isFinite(parsedPending) ? parsedPending : 0,
          remaining_remarks: entry?.remaining_remarks || "",
        };
      });
    });

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Get Shipments Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch shipment list",
      error: error.message,
    });
  }
};

exports.editOrder = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await Order.findOne({ _id: id, ...ACTIVE_ORDER_MATCH });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const payload = req.body || {};
    const oldGroup = {
      order_id: order.order_id,
      brand: order.brand,
      vendor: order.vendor,
    };

    const hasBrand = hasOwn(payload, "brand");
    const hasVendor = hasOwn(payload, "vendor");
    const hasItemCode = hasOwn(payload, "item_code");
    const hasDescription = hasOwn(payload, "description");
    const hasQuantity = hasOwn(payload, "quantity");
    const hasShipment = hasOwn(payload, "shipment");
    const hasRevisedEtd =
      hasOwn(payload, "revised_ETD") ||
      hasOwn(payload, "revised_etd") ||
      hasOwn(payload, "revisedEtd");
    const requestedEditFields = [
      hasBrand ? "brand" : "",
      hasVendor ? "vendor" : "",
      hasItemCode ? "item_code" : "",
      hasDescription ? "description" : "",
      hasQuantity ? "quantity" : "",
      hasShipment ? "shipment" : "",
      hasRevisedEtd ? "revised_ETD" : "",
    ].filter(Boolean);
    const requesterRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const isRequesterAdmin = requesterRole === "admin";
    const archiveRemarkInput = String(
      payload.archive_remark ?? payload.archiveRemark ?? "",
    ).trim();
    const editRemarkInput = String(
      payload.edit_remark ?? payload.editRemark ?? payload.remark ?? "",
    ).trim();
    const beforeEditSnapshot = buildOrderEditLogSnapshot(order);

    if ((hasQuantity || hasShipment) && !isRequesterAdmin) {
      return res.status(403).json({
        message: "Only admin can edit shipping details or final quantity",
      });
    }

    const nextBrand = hasBrand
      ? String(payload.brand ?? "").trim()
      : String(order.brand || "").trim();
    const nextVendor = hasVendor
      ? String(payload.vendor ?? "").trim()
      : String(order.vendor || "").trim();
    const nextItemCode = hasItemCode
      ? String(payload.item_code ?? "").trim()
      : String(order?.item?.item_code || "").trim();
    const nextDescription = hasDescription
      ? String(payload.description ?? "").trim()
      : String(order?.item?.description || "").trim();
    const nextQuantity = hasQuantity
      ? Number(payload.quantity)
      : Number(order.quantity || 0);
    const rawRevisedEtd = hasOwn(payload, "revised_ETD")
      ? payload.revised_ETD
      : hasOwn(payload, "revised_etd")
        ? payload.revised_etd
        : payload.revisedEtd;

    if (!nextBrand) {
      return res.status(400).json({ message: "brand is required" });
    }

    if (!nextVendor) {
      return res.status(400).json({ message: "vendor is required" });
    }

    if (!nextItemCode) {
      return res.status(400).json({ message: "item_code is required" });
    }

    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
      return res.status(400).json({
        message: "quantity must be a valid non-negative number",
      });
    }

    let nextRevisedEtd = order.revised_ETD || null;
    if (hasRevisedEtd) {
      const revisedEtdInput = String(rawRevisedEtd ?? "").trim();
      if (!revisedEtdInput) {
        nextRevisedEtd = null;
      } else {
        const parsedRevisedEtd = parseDateLike(revisedEtdInput);
        if (!parsedRevisedEtd) {
          return res.status(400).json({
            message: "revised_ETD must be a valid date",
          });
        }
        nextRevisedEtd = parsedRevisedEtd;
      }
    }

    if (
      nextItemCode !== String(order?.item?.item_code || "").trim() &&
      (await Order.exists({
        _id: { $ne: order._id },
        ...ACTIVE_ORDER_MATCH,
        order_id: order.order_id,
        "item.item_code": nextItemCode,
      }))
    ) {
      return res.status(400).json({
        message:
          "Another item with the same order_id and item_code already exists",
      });
    }

    if (nextQuantity === 0) {
      if (!isRequesterAdmin) {
        return res.status(403).json({
          message: "Only admin can archive an order by setting quantity to 0",
        });
      }

      if (!archiveRemarkInput) {
        return res.status(400).json({
          message: "archive remark is required when quantity is 0",
        });
      }

      order.item = order.item || {};
      order.brand = nextBrand;
      order.vendor = nextVendor;
      order.item.item_code = nextItemCode;
      order.item.description = nextDescription;
      order.quantity = 0;
      order.shipment = [];
      order.archived_previous_status =
        normalizeRestorableArchivedStatus(order.status) || null;
      order.status = "Cancelled";
      order.archived = true;
      order.archived_remark = archiveRemarkInput;
      order.archived_at = new Date();
      order.archived_by = {
        user: req.user?._id || null,
        name: buildArchivedByName(req.user),
      };
      order.updated_by = buildAuditActor(req.user);
      await order.save();

      const archiveCalendarSync = [];
      try {
        const syncResult = await syncOrderGroup(oldGroup);
        archiveCalendarSync.push({
          group: oldGroup,
          ok: true,
          result: syncResult,
        });
      } catch (syncErr) {
        archiveCalendarSync.push({
          group: oldGroup,
          ok: false,
          error: syncErr?.message || String(syncErr),
        });
        console.error("Google Calendar sync failed after archiving via edit:", {
          group: oldGroup,
          error: syncErr?.message || String(syncErr),
        });
      }

      await createOrderEditLog({
        reqUser: req.user,
        operationType: "order_edit_archive",
        beforeSnapshot: beforeEditSnapshot,
        afterSnapshot: buildOrderEditLogSnapshot(order),
        calendarSyncResults: archiveCalendarSync,
        extraRemarks: [
          "Order archived through edit-order route (quantity set to 0).",
          editRemarkInput ? `Edit remark: ${editRemarkInput}` : "",
          requestedEditFields.length > 0
            ? `Requested fields: ${requestedEditFields.join(", ")}.`
            : "",
        ],
      });

      return res.status(200).json({
        message: "Order archived successfully",
        archived: true,
        data: order,
      });
    }

    const updatedAt = new Date();
    const shouldRebuildShipment = hasShipment || hasQuantity;
    let adjustedShipment = Array.isArray(order.shipment) ? order.shipment : [];
    if (shouldRebuildShipment) {
      const shipmentSource = hasShipment
        ? payload.shipment
        : order.shipment || [];
      const normalizedShipmentSource = normalizeShipmentEntries(shipmentSource);
      adjustedShipment = fitShipmentEntriesToOrderQuantity(
        normalizedShipmentSource,
        nextQuantity,
        {
          user: req.user,
          updatedAt,
        },
      );
    }
    const shippedQuantity = getShipmentQuantityTotal(adjustedShipment);

    let qcRecord = null;
    if (order.qc_record && mongoose.Types.ObjectId.isValid(order.qc_record)) {
      qcRecord = await QC.findById(order.qc_record);
    }
    if (!qcRecord) {
      qcRecord = await QC.findOne({ order: order._id });
    }

    if (qcRecord) {
      qcRecord.item = qcRecord.item || {};
      qcRecord.order_meta = qcRecord.order_meta || {};
      qcRecord.quantities = qcRecord.quantities || {};

      qcRecord.item.item_code = nextItemCode;
      qcRecord.item.description = nextDescription;
      qcRecord.order_meta.brand = nextBrand;
      qcRecord.order_meta.vendor = nextVendor;

      if (hasQuantity) {
        const clampToDemand = (value) => {
          const parsed = Number(value || 0);
          if (!Number.isFinite(parsed) || parsed < 0) return 0;
          return Math.min(parsed, nextQuantity);
        };

        const nextPassed = clampToDemand(qcRecord.quantities.qc_passed);
        const nextCheckedRaw = clampToDemand(qcRecord.quantities.qc_checked);
        const nextChecked = Math.max(nextPassed, nextCheckedRaw);
        const nextRequested = clampToDemand(
          qcRecord.quantities.quantity_requested,
        );
        const nextProvision = clampToDemand(
          qcRecord.quantities.vendor_provision,
        );

        qcRecord.quantities.client_demand = nextQuantity;
        qcRecord.quantities.qc_passed = nextPassed;
        qcRecord.quantities.qc_checked = nextChecked;
        qcRecord.quantities.quantity_requested = nextRequested;
        qcRecord.quantities.vendor_provision = nextProvision;
        qcRecord.quantities.pending = Math.max(0, nextQuantity - nextPassed);
        qcRecord.quantities.qc_rejected = Math.max(0, nextChecked - nextPassed);
      }
    }

    order.item = order.item || {};
    order.brand = nextBrand;
    order.vendor = nextVendor;
    order.quantity = nextQuantity;
    order.item.item_code = nextItemCode;
    order.item.description = nextDescription;
    applyRevisedEtdUpdateToOrder({
      orderDoc: order,
      nextRevisedEtd,
      user: req.user,
      updatedAt,
    });
    if (shouldRebuildShipment) {
      order.shipment = adjustedShipment;
    }
    order.updated_by = buildAuditActor(req.user);

    order.status = computeOrderStatus({
      orderQuantity: nextQuantity,
      shippedQuantity,
      qcRecord,
    });

    if (qcRecord && !order.qc_record) {
      order.qc_record = qcRecord._id;
    }

    await order.save();
    if (qcRecord) {
      await qcRecord.save();
    }

    try {
      await upsertItemFromOrder(order);
    } catch (itemSyncError) {
      console.error("Item sync after order edit failed:", {
        orderId: order.order_id,
        itemCode: order?.item?.item_code,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    const newGroup = {
      order_id: order.order_id,
      brand: order.brand,
      vendor: order.vendor,
    };

    const groupMap = new Map();
    groupMap.set(
      `${oldGroup.order_id}__${oldGroup.brand}__${oldGroup.vendor}`,
      oldGroup,
    );
    groupMap.set(
      `${newGroup.order_id}__${newGroup.brand}__${newGroup.vendor}`,
      newGroup,
    );
    const groupsToSync = [...groupMap.values()];

    const syncSettled = await Promise.allSettled(
      groupsToSync.map((group) => syncOrderGroup(group)),
    );

    const calendar_sync = syncSettled.map((entry, index) => {
      const group = groupsToSync[index];
      if (entry.status === "fulfilled") {
        return { group, ok: true, result: entry.value };
      }
      return {
        group,
        ok: false,
        error: entry.reason?.message || String(entry.reason),
      };
    });

    await createOrderEditLog({
      reqUser: req.user,
      operationType: "order_edit",
      beforeSnapshot: beforeEditSnapshot,
      afterSnapshot: buildOrderEditLogSnapshot(order),
      calendarSyncResults: calendar_sync,
      extraRemarks:
        [
          requestedEditFields.length > 0
            ? `Requested fields: ${requestedEditFields.join(", ")}.`
            : "",
          editRemarkInput ? `Edit remark: ${editRemarkInput}` : "",
        ].filter(Boolean),
    });

    return res.status(200).json({
      message: "Order updated successfully",
      data: order,
      calendar_sync,
    });
  } catch (error) {
    console.error("Edit Order Error:", error);
    return res.status(500).json({
      message: "Failed to update order",
      error: error.message,
    });
  }
};

exports.bulkUpdateRevisedEtd = async (req, res) => {
  try {
    const payload = req.body || {};
    const orderIds = [
      ...new Set(
        (Array.isArray(payload.order_ids) ? payload.order_ids : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ];
    const rawRevisedEtd = hasOwn(payload, "revised_ETD")
      ? payload.revised_ETD
      : hasOwn(payload, "revised_etd")
        ? payload.revised_etd
        : payload.revisedEtd;

    if (orderIds.length === 0) {
      return res.status(400).json({
        message: "At least one order id is required",
      });
    }

    const invalidOrderIds = orderIds.filter(
      (value) => !mongoose.Types.ObjectId.isValid(value),
    );
    if (invalidOrderIds.length > 0) {
      return res.status(400).json({
        message: "One or more order ids are invalid",
      });
    }

    let nextRevisedEtd = null;
    const revisedEtdInput = String(rawRevisedEtd ?? "").trim();
    if (revisedEtdInput) {
      nextRevisedEtd = parseDateLike(revisedEtdInput);
      if (!nextRevisedEtd) {
        return res.status(400).json({
          message: "revised_ETD must be a valid date",
        });
      }
    }

    const orders = await Order.find({
      _id: { $in: orderIds },
      ...ACTIVE_ORDER_MATCH,
    });

    if (orders.length !== orderIds.length) {
      return res.status(404).json({
        message: "One or more selected orders were not found",
      });
    }

    const updatedAt = new Date();
    const updatedRows = [];

    for (const orderDoc of orders) {
      const beforeSnapshot = buildOrderEditLogSnapshot(orderDoc);
      applyRevisedEtdUpdateToOrder({
        orderDoc,
        nextRevisedEtd,
        user: req.user,
        updatedAt,
      });
      orderDoc.updated_by = buildAuditActor(req.user);
      await orderDoc.save();

      await createOrderEditLog({
        reqUser: req.user,
        operationType: "order_edit",
        beforeSnapshot,
        afterSnapshot: buildOrderEditLogSnapshot(orderDoc),
        extraRemarks: [
          `Bulk revised ETD update applied to ${orders.length} row(s).`,
        ],
      });

      updatedRows.push({
        id: String(orderDoc?._id || ""),
        order_id: String(orderDoc?.order_id || "").trim(),
        item_code: String(orderDoc?.item?.item_code || "").trim(),
        revised_ETD: orderDoc?.revised_ETD || null,
      });
    }

    return res.status(200).json({
      message: `Revised ETD updated for ${updatedRows.length} item(s).`,
      count: updatedRows.length,
      data: updatedRows,
    });
  } catch (error) {
    console.error("Bulk Update Revised ETD Error:", error);
    return res.status(500).json({
      message: "Failed to bulk update revised ETD",
      error: error.message,
    });
  }
};

exports.editCompleteOrder = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const anchorOrder = await Order.findOne({ _id: id, ...ACTIVE_ORDER_MATCH });
    if (!anchorOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    const payload = req.body || {};
    const hasOrderId = hasOwn(payload, "order_id");
    const hasBrand = hasOwn(payload, "brand");
    const hasVendor = hasOwn(payload, "vendor");
    const hasOrderDate =
      hasOwn(payload, "order_date") || hasOwn(payload, "orderDate");
    const hasEtd = hasOwn(payload, "ETD") || hasOwn(payload, "etd");
    const requestedEditFields = [
      hasOrderId ? "order_id" : "",
      hasBrand ? "brand" : "",
      hasVendor ? "vendor" : "",
      hasOrderDate ? "order_date" : "",
      hasEtd ? "ETD" : "",
    ].filter(Boolean);

    const nextOrderId = hasOrderId
      ? normalizeOrderKey(payload.order_id)
      : normalizeOrderKey(anchorOrder.order_id);
    const nextBrand = hasBrand
      ? String(payload.brand ?? "").trim()
      : String(anchorOrder.brand || "").trim();
    const nextVendor = hasVendor
      ? String(payload.vendor ?? "").trim()
      : String(anchorOrder.vendor || "").trim();

    const rawOrderDate = hasOwn(payload, "order_date")
      ? payload.order_date
      : payload.orderDate;
    const rawEtd = hasOwn(payload, "ETD") ? payload.ETD : payload.etd;

    if (!nextOrderId) {
      return res.status(400).json({ message: "order_id is required" });
    }
    if (!nextBrand) {
      return res.status(400).json({ message: "brand is required" });
    }
    if (!nextVendor) {
      return res.status(400).json({ message: "vendor is required" });
    }

    let nextOrderDate = anchorOrder.order_date || null;
    if (hasOrderDate) {
      const orderDateInput = String(rawOrderDate ?? "").trim();
      if (!orderDateInput) {
        return res.status(400).json({ message: "order_date is required" });
      }
      const parsedOrderDate = parseDateLike(orderDateInput);
      if (!parsedOrderDate) {
        return res
          .status(400)
          .json({ message: "order_date must be a valid date" });
      }
      nextOrderDate = parsedOrderDate;
    }

    let nextEtd = anchorOrder.ETD || null;
    if (hasEtd) {
      const etdInput = String(rawEtd ?? "").trim();
      if (!etdInput) {
        return res.status(400).json({ message: "ETD is required" });
      }
      const parsedEtd = parseDateLike(etdInput);
      if (!parsedEtd) {
        return res.status(400).json({ message: "ETD must be a valid date" });
      }
      nextEtd = parsedEtd;
    }

    const groupOrders = await Order.find({
      order_id: anchorOrder.order_id,
      ...ACTIVE_ORDER_MATCH,
    });
    if (groupOrders.length === 0) {
      return res
        .status(404)
        .json({ message: "No active orders found for this PO" });
    }

    const groupOrderIds = groupOrders.map((orderDoc) => orderDoc._id);
    const beforeSnapshotsById = new Map(
      groupOrders.map((orderDoc) => [
        String(orderDoc._id),
        buildOrderEditLogSnapshot(orderDoc),
      ]),
    );

    const groupItemCodes = normalizeDistinctValues(
      groupOrders.map((orderDoc) => orderDoc?.item?.item_code || ""),
    );
    if (groupItemCodes.length > 0) {
      const conflictingOrder = await Order.findOne({
        _id: { $nin: groupOrderIds },
        ...ACTIVE_ORDER_MATCH,
        order_id: nextOrderId,
        "item.item_code": { $in: groupItemCodes },
      })
        .select("order_id item.item_code")
        .lean();

      if (conflictingOrder) {
        return res.status(400).json({
          message: `Another active order already exists with PO ${nextOrderId} and item ${String(conflictingOrder?.item?.item_code || "").trim() || "N/A"}`,
        });
      }
    }

    const qcRecords = await QC.find({ order: { $in: groupOrderIds } });
    const qcRecordsByOrderId = qcRecords.reduce((accumulator, qcRecord) => {
      const orderKey = String(qcRecord?.order || "").trim();
      if (!accumulator.has(orderKey)) {
        accumulator.set(orderKey, []);
      }
      accumulator.get(orderKey).push(qcRecord);
      return accumulator;
    }, new Map());

    const oldGroupMap = new Map();
    for (const orderDoc of groupOrders) {
      const oldGroup = {
        order_id: String(orderDoc?.order_id || "").trim(),
        brand: String(orderDoc?.brand || "").trim(),
        vendor: String(orderDoc?.vendor || "").trim(),
      };
      oldGroupMap.set(
        `${oldGroup.order_id}__${oldGroup.brand}__${oldGroup.vendor}`,
        oldGroup,
      );

      orderDoc.order_id = nextOrderId;
      orderDoc.brand = nextBrand;
      orderDoc.vendor = nextVendor;
      orderDoc.order_date = nextOrderDate;
      orderDoc.ETD = nextEtd;
      orderDoc.updated_by = buildAuditActor(req.user);

      const linkedQcRecords =
        qcRecordsByOrderId.get(String(orderDoc._id)) || [];
      for (const qcRecord of linkedQcRecords) {
        qcRecord.order_meta = qcRecord.order_meta || {};
        qcRecord.order_meta.order_id = nextOrderId;
        qcRecord.order_meta.brand = nextBrand;
        qcRecord.order_meta.vendor = nextVendor;
      }
    }

    await Promise.all(groupOrders.map((orderDoc) => orderDoc.save()));
    await Promise.all(qcRecords.map((qcRecord) => qcRecord.save()));

    try {
      await Promise.all(
        groupOrders.map((orderDoc) => upsertItemFromOrder(orderDoc)),
      );
    } catch (itemSyncError) {
      console.error("Item sync after complete order edit failed:", {
        orderId: nextOrderId,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    const newGroup = {
      order_id: nextOrderId,
      brand: nextBrand,
      vendor: nextVendor,
    };
    const groupMap = new Map(oldGroupMap);
    groupMap.set(
      `${newGroup.order_id}__${newGroup.brand}__${newGroup.vendor}`,
      newGroup,
    );
    const groupsToSync = [...groupMap.values()];
    const syncSettled = await Promise.allSettled(
      groupsToSync.map((group) => syncOrderGroup(group)),
    );
    const calendar_sync = syncSettled.map((entry, index) => {
      const group = groupsToSync[index];
      if (entry.status === "fulfilled") {
        return { group, ok: true, result: entry.value };
      }
      return {
        group,
        ok: false,
        error: entry.reason?.message || String(entry.reason),
      };
    });

    for (const orderDoc of groupOrders) {
      await createOrderEditLog({
        reqUser: req.user,
        operationType: "order_edit",
        beforeSnapshot: beforeSnapshotsById.get(String(orderDoc._id)) || {},
        afterSnapshot: buildOrderEditLogSnapshot(orderDoc),
        calendarSyncResults: calendar_sync,
        extraRemarks: [
          `Complete order update applied to ${groupOrders.length} row(s) in this PO.`,
          requestedEditFields.length > 0
            ? `Requested fields: ${requestedEditFields.join(", ")}.`
            : "",
        ],
      });
    }

    return res.status(200).json({
      message: "Complete order updated successfully",
      rows_updated: groupOrders.length,
      group: newGroup,
      data: groupOrders,
      calendar_sync,
    });
  } catch (error) {
    console.error("Edit Complete Order Error:", error);
    return res.status(500).json({
      message: "Failed to update complete order",
      error: error.message,
    });
  }
};

exports.archiveOrder = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const remark = String(
      req.body?.remark ??
        req.body?.archive_remark ??
        req.body?.archiveRemark ??
        "",
    ).trim();
    if (!remark) {
      return res.status(400).json({ message: "archive remark is required" });
    }

    const order = await Order.findOne({ _id: id, ...ACTIVE_ORDER_MATCH });
    if (!order) {
      return res
        .status(404)
        .json({ message: "Order not found or already archived" });
    }

    const group = {
      order_id: order.order_id,
      brand: order.brand,
      vendor: order.vendor,
    };
    const beforeSnapshot = buildOrderEditLogSnapshot(order);

    order.archived = true;
    order.archived_previous_status =
      normalizeRestorableArchivedStatus(order.status) || null;
    order.status = "Cancelled";
    order.archived_remark = remark;
    order.archived_at = new Date();
    order.archived_by = {
      user: req.user?._id || null,
      name: buildArchivedByName(req.user),
    };
    order.updated_by = buildAuditActor(req.user);
    await order.save();

    try {
      await syncOrderGroup(group);
    } catch (syncErr) {
      console.error("Google Calendar sync failed after archiving order:", {
        group,
        error: syncErr?.message || String(syncErr),
      });
    }

    await createOrderEditLog({
      reqUser: req.user,
      operationType: "order_edit_archive",
      beforeSnapshot,
      afterSnapshot: buildOrderEditLogSnapshot(order),
      extraRemarks: ["Order archived through archive-order route."],
    });

    return res.status(200).json({
      success: true,
      message: "Order archived successfully",
      data: order,
    });
  } catch (error) {
    console.error("Archive Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to archive order",
      error: error.message,
    });
  }
};

exports.unarchiveOrder = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await Order.findOne({ _id: id, archived: true });
    if (!order) {
      return res.status(404).json({ message: "Archived order not found" });
    }

    if (Number(order.quantity || 0) <= 0) {
      return res.status(400).json({
        message: "Zero-quantity archived orders cannot be unarchived",
      });
    }

    const [orderWithRestoreStatus] = await attachArchivedRestoreStatus([
      order.toObject(),
    ]);
    const restoredStatus = normalizeRestorableArchivedStatus(
      orderWithRestoreStatus?.restore_status,
    );
    if (!restoredStatus) {
      return res.status(400).json({
        message: "Original status could not be determined for this archived order",
      });
    }

    const group = {
      order_id: order.order_id,
      brand: order.brand,
      vendor: order.vendor,
    };
    const beforeSnapshot = buildOrderEditLogSnapshot(order);

    order.archived = false;
    order.status = restoredStatus;
    order.archived_remark = "";
    order.archived_at = null;
    order.archived_previous_status = null;
    order.archived_by = {
      user: null,
      name: "",
    };
    order.updated_by = buildAuditActor(req.user);
    await order.save();

    try {
      await syncOrderGroup(group);
    } catch (syncErr) {
      console.error("Google Calendar sync failed after unarchiving order:", {
        group,
        error: syncErr?.message || String(syncErr),
      });
    }

    await createOrderEditLog({
      reqUser: req.user,
      operationType: "order_edit",
      beforeSnapshot,
      afterSnapshot: buildOrderEditLogSnapshot(order),
      extraRemarks: [
        `Order unarchived through archived-orders page. Restored status to ${restoredStatus}.`,
      ],
    });

    return res.status(200).json({
      success: true,
      message: `Order unarchived successfully. Restored status to ${restoredStatus}.`,
      restored_status: restoredStatus,
      data: order,
    });
  } catch (error) {
    console.error("Unarchive Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to unarchive order",
      error: error.message,
    });
  }
};

exports.getArchivedOrders = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const vendor = normalizeFilterValue(req.query.vendor);
    const brand = normalizeFilterValue(req.query.brand);
    const orderId = normalizeFilterValue(req.query.order_id ?? req.query.order);

    const match = { archived: true };
    if (vendor) {
      match.vendor = vendor;
    }
    if (brand) {
      match.brand = brand;
    }
    if (orderId) {
      const escaped = escapeRegex(orderId);
      match.order_id = { $regex: escaped, $options: "i" };
    }

    const [rows, totalRecords, vendorsRaw, brandsRaw] = await Promise.all([
      Order.find(match)
        .select(
          "order_id item brand vendor quantity archived archived_remark archived_at archived_by archived_previous_status updatedAt",
        )
        .sort({ archived_at: -1, updatedAt: -1, order_id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(match),
      Order.distinct("vendor", { archived: true }),
      Order.distinct("brand", { archived: true }),
    ]);
    const rowsWithRestoreStatus = await attachArchivedRestoreStatus(rows);

    return res.status(200).json({
      success: true,
      data: rowsWithRestoreStatus,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        vendors: normalizeDistinctValues(vendorsRaw),
        brands: normalizeDistinctValues(brandsRaw),
      },
    });
  } catch (error) {
    console.error("Get Archived Orders Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch archived orders",
      error: error.message,
    });
  }
};

exports.syncZeroQuantityOrdersArchive = async (req, res) => {
  try {
    const remarkInput = String(
      req.body?.remark ?? req.query?.remark ?? "",
    ).trim();
    const remark = remarkInput || "Auto-archived by sync route: quantity <= 0";
    const actorName = buildArchivedByName(req.user) || "System";
    const now = new Date();

    const archiveFilter = {
      quantity: { $lte: 0 },
      archived: { $ne: true },
    };

    const candidates = await Order.find(archiveFilter)
      .select("_id order_id brand vendor status")
      .lean();

    if (candidates.length === 0) {
      const [remarkBackfillResult, statusBackfillResult] = await Promise.all([
        Order.updateMany(
          {
            quantity: { $lte: 0 },
            archived: true,
            $or: [
              { archived_remark: { $exists: false } },
              { archived_remark: null },
              { archived_remark: "" },
            ],
          },
          {
            $set: {
              archived_remark: remark,
            },
          },
        ),
        Order.updateMany(
          {
            quantity: { $lte: 0 },
            archived: true,
            status: { $ne: "Cancelled" },
          },
          {
            $set: {
              status: "Cancelled",
            },
          },
        ),
      ]);

      return res.status(200).json({
        success: true,
        message: "No active zero-quantity orders found to archive",
        archived_count: 0,
        remark_backfilled_count: Number(
          remarkBackfillResult?.modifiedCount || 0,
        ),
        status_backfilled_count: Number(
          statusBackfillResult?.modifiedCount || 0,
        ),
        calendar_sync: [],
      });
    }

    const archiveResult = await Order.bulkWrite(
      candidates.map((entry) => ({
        updateOne: {
          filter: { _id: entry._id },
          update: {
            $set: {
              archived: true,
              status: "Cancelled",
              archived_previous_status:
                normalizeRestorableArchivedStatus(entry.status) || null,
              archived_remark: remark,
              archived_at: now,
              archived_by: {
                user: req.user?._id || null,
                name: actorName,
              },
              updated_by: {
                user: req.user?._id || null,
                name: actorName,
              },
            },
          },
        },
      })),
    );

    const groupMap = new Map();
    for (const order of candidates) {
      const key = `${order.order_id}__${order.brand}__${order.vendor}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          order_id: order.order_id,
          brand: order.brand,
          vendor: order.vendor,
        });
      }
    }
    const groupsToSync = [...groupMap.values()];
    const syncSettled = await Promise.allSettled(
      groupsToSync.map((group) => syncOrderGroup(group)),
    );
    const calendar_sync = syncSettled.map((entry, index) => {
      const group = groupsToSync[index];
      if (entry.status === "fulfilled") {
        return { group, ok: true, result: entry.value };
      }
      return {
        group,
        ok: false,
        error: entry.reason?.message || String(entry.reason),
      };
    });

    return res.status(200).json({
      success: true,
      message: "Zero-quantity orders archived successfully",
      archived_count: Number(archiveResult?.modifiedCount || 0),
      remark,
      calendar_sync,
    });
  } catch (error) {
    console.error("Sync Zero Quantity Archive Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to sync zero-quantity archived orders",
      error: error.message,
    });
  }
};

exports.finalizeOrder = async (req, res) => {
  try {
    const {
      stuffing_date,
      container,
      quantity,
      remarks,
      invoice_number,
      invoiceNumber,
      invoice,
    } = req.body;

    const order = await Order.findOne({
      _id: req.params.id,
      ...ACTIVE_ORDER_MATCH,
    });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.status === "Shipped" || order.status === "Cancelled") {
      return res.status(400).json({
        message: "Order is already closed",
      });
    }

    if (
      !stuffing_date ||
      container === undefined ||
      quantity === undefined
    ) {
      return res.status(400).json({
        message: "stuffing_date, container and quantity are required",
      });
    }

    const parsedStuffingDate = parseDateLike(stuffing_date);
    if (!parsedStuffingDate) {
      return res.status(400).json({ message: "Invalid stuffing date" });
    }

    const parsedContainer = String(container).trim();
    if (!parsedContainer) {
      return res.status(400).json({
        message: "container must be a valid non-empty string",
      });
    }

    const parsedInvoiceNumber = normalizeShipmentInvoiceNumber(
      invoice_number ?? invoiceNumber ?? invoice,
      "",
    );

    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({
        message: "quantity must be a valid positive number",
      });
    }

    const qcRecord = order?.qc_record
      ? await QC.findById(order.qc_record).select("quantities.qc_passed")
      : await QC.findOne({ order: order._id }).select("quantities.qc_passed");
    const beforeSnapshot = buildOrderEditLogSnapshot(order);
    const updatedAt = new Date();

    const passedQuantity = Number(qcRecord?.quantities?.qc_passed || 0);

    const shippedAlready = (order.shipment || []).reduce(
      (sum, entry) => sum + Number(entry?.quantity || 0),
      0,
    );

    const orderQuantity = Number(order.quantity || 0);
    const remainingQuantity = Math.max(0, orderQuantity - shippedAlready);
    const pending = Math.max(0, remainingQuantity - parsedQuantity);

    if (parsedQuantity > remainingQuantity) {
      return res.status(400).json({
        message: "shipping quantity cannot exceed remaining quantity",
      });
    }

    const shippableFromPassed = Math.max(0, passedQuantity - shippedAlready);
    if (shippableFromPassed <= 0) {
      return res.status(400).json({
        message: "No qc passed quantity is available for shipment",
      });
    }

    if (parsedQuantity > shippableFromPassed) {
      return res.status(400).json({
        message: "shipping quantity cannot exceed available qc passed quantity",
      });
    }

    order.shipment = order.shipment || [];
    order.shipment.push({
      container: parsedContainer,
      invoice_number: parsedInvoiceNumber,
      stuffing_date: parsedStuffingDate,
      quantity: parsedQuantity,
      pending,
      remaining_remarks: remarks,
      updated_at: updatedAt,
      updated_by: buildAuditActor(req.user),
    });

    const shippedAfter = shippedAlready + parsedQuantity;
    order.status = computeOrderStatus({
      orderQuantity,
      shippedQuantity: shippedAfter,
      qcRecord,
    });
    order.updated_by = buildAuditActor(req.user);

    await order.save();

    await createOrderEditLog({
      reqUser: req.user,
      operationType: "order_edit",
      beforeSnapshot,
      afterSnapshot: buildOrderEditLogSnapshot(order),
      extraRemarks: ["Shipment entry added through finalize-order route."],
    });

    return res.status(200).json({
      message: "Order shipment updated successfully",
      data: order,
      shipping_summary: {
        total_quantity: orderQuantity,
        shipped_quantity: shippedAfter,
        remaining_quantity: Math.max(0, orderQuantity - shippedAfter),
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to finalize order shipment",
      error: error.message,
    });
  }
};
exports.reSync = async (req, res) => {
  try {
    const batchSize = Math.min(20, parsePositiveInt(req.query.batchSize, 5));
    const timeoutMs = Math.min(
      1200000,
      parsePositiveInt(req.query.timeoutMs, 300000),
    );

    const purgeSummary = await withTimeout(
      purgeOmsEventsForConfiguredBrandCalendars(),
      timeoutMs,
      "purge existing OMS calendar events",
    );

    await Order.updateMany(ACTIVE_ORDER_MATCH, {
      $set: {
        "gcal.calendarId": null,
        "gcal.eventId": null,
        "gcal.lastSyncedAt": null,
        "gcal.lastSyncError": null,
      },
    });

    const groups = await Order.aggregate([
      {
        $match: ACTIVE_ORDER_MATCH,
      },
      {
        $group: {
          _id: { order_id: "$order_id", brand: "$brand", vendor: "$vendor" },
        },
      },
      {
        $project: {
          _id: 0,
          order_id: "$_id.order_id",
          brand: "$_id.brand",
          vendor: "$_id.vendor",
        },
      },
      { $sort: { order_id: 1, brand: 1, vendor: 1 } },
    ]);

    if (groups.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No order groups found to sync",
        purge: purgeSummary,
        groups: 0,
        processed: 0,
        successCount: 0,
        failureCount: 0,
        results: [],
      });
    }

    const results = [];
    let processed = 0;
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < groups.length; i += batchSize) {
      const batch = groups.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (group) => {
          try {
            const syncResult = await withTimeout(
              syncOrderGroup(group),
              timeoutMs,
              `reSync group ${group.order_id}/${group.brand}/${group.vendor}`,
            );
            successCount += 1;
            return { group, ok: true, result: syncResult };
          } catch (error) {
            failureCount += 1;
            const errorMessage = error?.message || String(error);
            console.error("reSync group failed:", {
              group,
              error: errorMessage,
            });
            await Order.updateMany(
              { ...group, ...ACTIVE_ORDER_MATCH },
              {
                $set: {
                  "gcal.lastSyncedAt": new Date(),
                  "gcal.lastSyncError": errorMessage,
                },
              },
            );
            return { group, ok: false, error: errorMessage };
          }
        }),
      );
      processed += batch.length;
      results.push(...batchResults);
    }

    return res.status(200).json({
      success: failureCount === 0,
      message:
        failureCount === 0
          ? "Calendar re-sync completed"
          : "Calendar re-sync completed with some failures",
      purge: purgeSummary,
      groups: groups.length,
      processed,
      successCount,
      failureCount,
      batchSize,
      timeoutMs,
      results,
    });
  } catch (error) {
    const getErrInfo = (error) => ({
      message: error?.message,
      code: error?.code,
      status: error?.response?.status,
      data: error?.response?.data,
      errors: error?.errors,
      stack: error?.stack,
    });
    console.error("reSync failed:", getErrInfo(error));
    return res.status(500).json({
      success: false,
      message: "Calendar re-sync failed",
      error: getErrInfo(error),
    });
  }
};

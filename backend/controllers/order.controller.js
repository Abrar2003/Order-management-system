const XLSX = require("xlsx");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const UploadLog = require("../models/uploadLog.model");
const mongoose = require("mongoose");
const dateParser = require("../helpers/dateparsser");
const deleteFile = require("../helpers/fileCleanup");
const {
  syncOrderGroup,
  purgeOmsEventsForConfiguredBrandCalendars,
} = require("../services/gcalSync");
const {
  upsertItemsFromOrders,
  upsertItemFromOrder,
} = require("../services/itemSync");


const ORDER_STATUS_SEQUENCE = [
  "Pending",
  "Under Inspection",
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

const SHIPMENT_VISIBLE_STATUSES = [
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];
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

const normalizeVendorKey = (value) => normalizeLooseString(value).toLowerCase();

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

const ACTIVE_ORDER_MATCH = {
  $and: [
    { archived: { $ne: true } },
    { status: { $ne: "Cancelled" } },
  ],
};

const buildArchivedByName = (user) =>
  String(user?.name || user?.username || user?.email || "").trim();

const buildOrderListMatch = ({
  brand,
  vendor,
  status,
  order,
  isDelayed = false,
  includeBrand = true,
  includeVendor = true,
  includeStatus = true,
  includeOrder = true,
} = {}) => {
  const match = { ...ACTIVE_ORDER_MATCH };
  const normalizedBrand = normalizeFilterValue(brand);
  const normalizedVendor = normalizeFilterValue(vendor);
  const normalizedStatus = normalizeFilterValue(status);
  const normalizedOrder = normalizeFilterValue(order);

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

  if (isDelayed) {
    match.ETD = { $lt: new Date() };
    match.status = { $nin: ["Shipped"] };
  }

  return match;
};

const buildShipmentMatch = ({
  vendor,
  orderId,
  itemCode,
  container,
  status,
  includeVendor = true,
  includeOrderId = true,
  includeItemCode = true,
  includeContainer = true,
  includeStatus = true,
} = {}) => {
  const match = {
    ...ACTIVE_ORDER_MATCH,
    status: { $in: SHIPMENT_VISIBLE_STATUSES },
  };

  const normalizedVendor = normalizeFilterValue(vendor);
  const normalizedOrderId = normalizeFilterValue(orderId);
  const normalizedItemCode = normalizeFilterValue(itemCode);
  const normalizedContainer = normalizeFilterValue(container);
  const normalizedStatus = normalizeFilterValue(status);

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

  if (
    includeStatus
    && normalizedStatus
    && SHIPMENT_VISIBLE_STATUSES.includes(normalizedStatus)
  ) {
    match.status = normalizedStatus;
  }

  return match;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const parseDateLike = (value) => {
  const asString = String(value ?? "").trim();
  if (!asString) return null;

  const parseFromParts = (year, month, day) => {
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsed.getTime())) return null;
    if (
      parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() + 1 !== month
      || parsed.getUTCDate() !== day
    ) {
      return null;
    }
    return parsed;
  };

  const ymd = asString.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (ymd) {
    return parseFromParts(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }

  const dmySlash = asString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) {
    return parseFromParts(
      Number(dmySlash[3]),
      Number(dmySlash[2]),
      Number(dmySlash[1]),
    );
  }

  const dmyDash = asString.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyDash) {
    return parseFromParts(
      Number(dmyDash[3]),
      Number(dmyDash[2]),
      Number(dmyDash[1]),
    );
  }

  const shouldTryNativeParse =
    /[a-zA-Z]/.test(asString) || asString.includes(",") || asString.includes(" ");
  if (!shouldTryNativeParse) return null;

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const formatDateDDMMYYYY = (value, fallback = "") => {
  if (value === undefined || value === null || value === "") return fallback;

  const parsed = value instanceof Date ? value : parseDateLike(value);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const year = String(parsed.getUTCFullYear());
  return `${day}/${month}/${year}`;
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
    validationDate.getUTCFullYear() !== year
    || validationDate.getUTCMonth() + 1 !== month
    || validationDate.getUTCDate() !== day
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

    const stuffingDate = parseDateLike(entry?.stuffing_date);
    if (!stuffingDate) {
      throw new Error(`shipment[${index + 1}] stuffing_date is invalid`);
    }

    const quantity = Number(entry?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`shipment[${index + 1}] quantity must be a positive number`);
    }

    const remarks = String(entry?.remaining_remarks ?? "").trim();

    return {
      container,
      stuffing_date: stuffingDate,
      quantity,
      remaining_remarks: remarks,
    };
  });
};

const fitShipmentEntriesToOrderQuantity = (shipmentEntries = [], orderQuantity = 0) => {
  const normalizedQuantity = Number(orderQuantity);
  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) return [];

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
      stuffing_date: parseDateLike(entry?.stuffing_date),
      quantity: adjustedQuantity,
      pending: Math.max(0, normalizedQuantity - cumulativeShipped),
      remaining_remarks: String(entry?.remaining_remarks ?? "").trim(),
    });
  }

  return nextEntries;
};

const computeOrderStatus = ({ orderQuantity, shippedQuantity, qcRecord }) => {
  if (orderQuantity <= 0) {
    return "Cancelled";
  }

  if (shippedQuantity >= orderQuantity && orderQuantity > 0) {
    return "Shipped";
  }

  if (shippedQuantity > 0) {
    return "Partial Shipped";
  }

  if (!qcRecord) {
    return "Pending";
  }

  const passedQuantity = Number(qcRecord?.quantities?.qc_passed || 0);
  const clientDemandQuantity = Number(qcRecord?.quantities?.client_demand || 0);

  if (clientDemandQuantity > 0 && passedQuantity >= clientDemandQuantity) {
    return "Inspection Done";
  }

  return "Under Inspection";
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
    rawSortBy
      || String(normalizedSortToken || "").replace(/^[+-]/, "")
      || "stuffing_date",
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
    };

    if (shipmentEntries.length === 0) {
      return [
        {
          ...baseRow,
          shipment_id: null,
          stuffing_date: null,
          container: "",
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
    case "quantity":
      return toShipmentNumber(row?.quantity);
    case "pending":
      return toShipmentNumber(row?.pending);
    default:
      return toShipmentTimestamp(row?.stuffing_date);
  }
};

const getShipmentDataset = async ({
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
    vendor,
    orderId,
    itemCode,
    container,
  };

  const [orders, vendorsRaw, orderIdsRaw, containersRaw, itemCodesRaw] =
    await Promise.all([
      Order.find(buildShipmentMatch(filterInput))
        .select(
          "order_id item brand vendor ETD status quantity shipment order_date updatedAt",
        )
        .sort({ order_date: -1, updatedAt: -1, order_id: -1 })
        .lean(),
      Order.distinct(
        "vendor",
        buildShipmentMatch({
          ...filterInput,
          includeVendor: false,
          includeContainer: false,
          includeStatus: false,
        }),
      ),
      Order.distinct(
        "order_id",
        buildShipmentMatch({
          ...filterInput,
          includeOrderId: false,
          includeContainer: false,
          includeStatus: false,
        }),
      ),
      Order.distinct(
        "shipment.container",
        buildShipmentMatch({
          ...filterInput,
          includeContainer: false,
          includeStatus: false,
        }),
      ),
      Order.distinct(
        "item.item_code",
        buildShipmentMatch({
          ...filterInput,
          includeItemCode: false,
          includeContainer: false,
          includeStatus: false,
        }),
      ),
    ]);

  const rows = mapOrdersToShipmentRows(orders);

  const normalizedContainer = normalizeFilterValue(container);
  const containerNeedle = normalizedContainer
    ? normalizedContainer.toLowerCase()
    : null;

  const containerFilteredRows = containerNeedle
    ? rows.filter((row) =>
        String(row?.container || "").toLowerCase().includes(containerNeedle),
      )
    : rows;

  const summary = containerFilteredRows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row?.status === "Inspection Done") acc.inspectionDone += 1;
      if (row?.status === "Partial Shipped") acc.partialShipped += 1;
      if (row?.status === "Shipped") acc.shipped += 1;
      return acc;
    },
    {
      total: 0,
      inspectionDone: 0,
      partialShipped: 0,
      shipped: 0,
    },
  );

  const statusScopedRows =
    statusFilter && SHIPMENT_VISIBLE_STATUSES.includes(statusFilter)
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
      vendors: normalizeDistinctValues(vendorsRaw),
      order_ids: normalizeDistinctValues(orderIdsRaw),
      containers: normalizeDistinctValues(containersRaw),
      item_codes: normalizeDistinctValues(itemCodesRaw),
    },
  };
};

// Upload Orders Controller
exports.uploadOrders = async (req, res) => {
  const uploadedById = req.user?._id && mongoose.Types.ObjectId.isValid(req.user._id)
    ? req.user._id
    : null;
  const uploadMeta = {
    uploaded_by: uploadedById,
    uploaded_by_name: String(
      req.user?.name || req.user?.username || req.user?.email || "",
    ).trim(),
    source_filename: String(req.file?.originalname || "").trim(),
    source_size_bytes: Number(req.file?.size || 0),
  };

  let totalRowsReceived = 0;
  let totalRowsUnique = 0;
  let totalDistinctOrdersUploaded = 0;
  let insertedCount = 0;
  let duplicateEntries = [];
  let uploadedVendors = [];
  let vendorSummaries = [];
  let conflicts = [];

  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    totalRowsReceived = Array.isArray(sheetData) ? sheetData.length : 0;

    const normalizeValue = (value) => normalizeLooseString(value);
    const normalizeKey = (orderId, itemCode) =>
      `${normalizeOrderKey(orderId)}__${normalizeValue(itemCode).toUpperCase()}`;

    duplicateEntries = [];
    const seenKeys = new Set();

    // Transform rows to Order schema (dedupe within file)
    const orders = sheetData
      .map((row) => {
        const orderId = normalizeValue(row.PO);
        const itemCode = normalizeValue(row.item_code);
        const brand = normalizeValue(row.brand);
        const vendor = normalizeValue(row.vendor);
        const description = normalizeValue(row.description);
        const quantity = Number(row.quantity);

        if (!orderId || !itemCode || !brand || !vendor) {
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

        const key = normalizeKey(orderId, itemCode);

        if (seenKeys.has(key)) {
          duplicateEntries.push({
            order_id: orderId,
            item_code: itemCode,
            reason: "duplicate_in_file",
          });
          return null;
        }

        seenKeys.add(key);

        return {
          order_id: orderId,
          item: {
            item_code: itemCode,
            description,
          },
          brand,
          vendor,
          ETD: dateParser(row.ETD),
          order_date: dateParser(row.order_date),
          status: "Pending",
          quantity,
        };
      })
      .filter(Boolean);

    totalRowsUnique = orders.length;
    totalDistinctOrdersUploaded = new Set(
      orders.map((order) => normalizeOrderKey(order.order_id)).filter(Boolean),
    ).size;

    const vendorUploadMap = new Map();

    for (const order of orders) {
      const vendor = normalizeValue(order.vendor);
      const vendorKey = normalizeVendorKey(vendor);
      const orderId = normalizeValue(order.order_id);
      const orderKey = normalizeOrderKey(orderId);

      if (!vendorKey || !orderKey) continue;

      if (!vendorUploadMap.has(vendorKey)) {
        vendorUploadMap.set(vendorKey, {
          vendor_key: vendorKey,
          vendor,
          uploaded_order_ids: new Set(),
          uploaded_order_keys: new Set(),
          items_per_order_count: new Map(),
        });
      }

      const vendorBucket = vendorUploadMap.get(vendorKey);
      vendorBucket.uploaded_order_ids.add(orderId);
      vendorBucket.uploaded_order_keys.add(orderKey);
      vendorBucket.items_per_order_count.set(
        orderId,
        Number(vendorBucket.items_per_order_count.get(orderId) || 0) + 1,
      );
    }

    uploadedVendors = [...vendorUploadMap.values()]
      .map((entry) => entry.vendor)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const openOrders = uploadedVendors.length > 0
      ? await Order.find({
        ...ACTIVE_ORDER_MATCH,
        status: { $nin: ["Shipped"] },
      })
        .select("vendor order_id")
        .lean()
      : [];

    const openVendorOrderMap = new Map();
    for (const openOrder of openOrders) {
      const vendor = normalizeValue(openOrder?.vendor);
      const vendorKey = normalizeVendorKey(vendor);
      const orderId = normalizeValue(openOrder?.order_id);
      const orderKey = normalizeOrderKey(orderId);

      if (!vendorKey || !orderKey || !vendorUploadMap.has(vendorKey)) continue;

      if (!openVendorOrderMap.has(vendorKey)) {
        openVendorOrderMap.set(vendorKey, new Map());
      }

      const orderMap = openVendorOrderMap.get(vendorKey);
      if (!orderMap.has(orderKey)) {
        orderMap.set(orderKey, orderId);
      }
    }

    conflicts = [];
    vendorSummaries = [...vendorUploadMap.values()]
      .sort((a, b) => a.vendor.localeCompare(b.vendor))
      .map((vendorEntry) => {
        const uploadedOrderIds = [...vendorEntry.uploaded_order_ids].sort((a, b) =>
          a.localeCompare(b),
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

        const openOrderMap = openVendorOrderMap.get(vendorEntry.vendor_key) || new Map();
        const missingOpenOrderIds = [...openOrderMap.entries()]
          .filter(([orderKey]) => !vendorEntry.uploaded_order_keys.has(orderKey))
          .map(([, orderId]) => orderId)
          .sort((a, b) => a.localeCompare(b));

        const remark = missingOpenOrderIds.length > 0
          ? `You were uploading orders for vendor ${vendorEntry.vendor}; these open orders are missing in this upload: ${missingOpenOrderIds.join(", ")}.`
          : "";

        missingOpenOrderIds.forEach((orderId) => {
          conflicts.push({
            type: "OPEN_ORDER_MISSING_IN_UPLOAD",
            vendor: vendorEntry.vendor,
            order_id: orderId,
            message: `Vendor ${vendorEntry.vendor} has open order ${orderId} in system but it was not present in the current upload.`,
          });
        });

        return {
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
        console.error("Item sync after upload failed:", {
          error: itemSyncError?.message || String(itemSyncError),
        });
      }

      // sync unique groups
      const groups = new Map();
      for (const o of newOrders) {
        const k = `${o.order_id}__${o.brand}__${o.vendor}`;
        groups.set(k, {
          order_id: o.order_id,
          brand: o.brand,
          vendor: o.vendor,
        });
      }

      // run with small concurrency
      const arr = [...groups.values()];
      const limit = 5;

      for (let i = 0; i < arr.length; i += limit) {
        const batch = arr.slice(i, i + limit);
        await Promise.all(
          batch.map(async (g) => {
            try {
              await syncOrderGroup(g);
            } catch (syncErr) {
              console.error("Google Calendar sync failed for uploaded group:", {
                group: g,
                error: syncErr?.message || String(syncErr),
              });
            }
          }),
        );
      }
    }

    const remarks = [
      ...vendorSummaries.map((entry) => String(entry?.remark || "").trim()).filter(Boolean),
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

    const uploadLog = await UploadLog.create({
      ...uploadMeta,
      total_rows_received: totalRowsReceived,
      total_rows_unique: totalRowsUnique,
      inserted_item_rows: insertedCount,
      duplicate_count: duplicateEntries.length,
      duplicate_entries: duplicateEntries,
      uploaded_vendors: uploadedVendors,
      total_distinct_orders_uploaded: totalDistinctOrdersUploaded,
      vendor_summaries: vendorSummaries,
      conflicts,
      remarks,
      status: conflicts.length > 0 ? "success_with_conflicts" : "success",
    });

    const hasConflicts = conflicts.length > 0;
    const hasDuplicates = duplicateEntries.length > 0;
    const hasInsertions = newOrders.length > 0;

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
      inserted_count: newOrders.length,
      duplicate_count: duplicateEntries.length,
      duplicate_entries: duplicateEntries,
      total_distinct_orders_uploaded: totalDistinctOrdersUploaded,
      vendor_summaries: vendorSummaries,
      conflict_count: conflicts.length,
      missing_open_orders_count: missingOpenOrderIds.length,
      missing_open_order_ids: missingOpenOrderIds,
      conflicts,
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
  } finally {
    // Cleanup uploaded file
    deleteFile(req.file?.path);
  }
};

exports.createOrdersManually = async (req, res) => {
  const uploadedById = req.user?._id && mongoose.Types.ObjectId.isValid(req.user._id)
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
        value === undefined
        || value === null
        || (typeof value === "string" && value.trim() === "")
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
      ...new Set(draftRows.map((row) => normalizeValue(row?.itemCode)).filter(Boolean)),
    ];

    let itemDescriptionsByCodeKey = new Map();
    if (uniqueItemCodes.length > 0) {
      const itemDocs = await Item.find({
        $or: uniqueItemCodes.map((itemCode) => ({
          code: {
            $regex: `^${escapeRegex(itemCode)}$`,
            $options: "i",
          },
        })),
      })
        .select("code description name")
        .lean();

      itemDescriptionsByCodeKey = new Map(
        itemDocs.map((itemDoc) => [
          normalizeLooseString(itemDoc?.code).toLowerCase(),
          normalizeLooseString(itemDoc?.description || itemDoc?.name || ""),
        ]),
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
        const existingDescription = normalizeLooseString(
          itemDescriptionsByCodeKey.get(normalizeLooseString(itemCode).toLowerCase()) || "",
        );
        const resolvedDescription = existingDescription || description;

        if (!orderId || !itemCode || !brand || !vendor) {
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
          brand,
          vendor,
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

    const vendorUploadMap = new Map();
    for (const order of orders) {
      const vendor = normalizeValue(order.vendor);
      const vendorKey = normalizeVendorKey(vendor);
      const orderId = normalizeValue(order.order_id);
      const orderKey = normalizeOrderKey(orderId);

      if (!vendorKey || !orderKey) continue;

      if (!vendorUploadMap.has(vendorKey)) {
        vendorUploadMap.set(vendorKey, {
          vendor,
          uploaded_order_ids: new Set(),
          items_per_order_count: new Map(),
        });
      }

      const vendorBucket = vendorUploadMap.get(vendorKey);
      vendorBucket.uploaded_order_ids.add(orderId);
      vendorBucket.items_per_order_count.set(
        orderId,
        Number(vendorBucket.items_per_order_count.get(orderId) || 0) + 1,
      );
    }

    uploadedVendors = [...vendorUploadMap.values()]
      .map((entry) => entry.vendor)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    vendorSummaries = [...vendorUploadMap.values()]
      .sort((a, b) => a.vendor.localeCompare(b.vendor))
      .map((vendorEntry) => {
        const uploadedOrderIds = [...vendorEntry.uploaded_order_ids].sort((a, b) =>
          a.localeCompare(b),
        );
        const itemsPerOrder = uploadedOrderIds.map((orderId) => ({
          order_id: orderId,
          items_count: Number(vendorEntry.items_per_order_count.get(orderId) || 0),
        }));

        return {
          vendor: vendorEntry.vendor,
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
              console.error("Google Calendar sync failed for manual order group:", {
                group,
                error: syncErr?.message || String(syncErr),
              });
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

exports.getUploadLogs = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(100, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const vendor = normalizeFilterValue(req.query.vendor);
    const status = normalizeFilterValue(req.query.status);
    const orderId = normalizeFilterValue(req.query.order_id ?? req.query.orderId);

    const match = {};

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

    const [logs, totalRecords, vendorsRaw, statusesRaw, statusCountsRaw] =
      await Promise.all([
        UploadLog.find(match)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        UploadLog.countDocuments(match),
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
      data: orders,
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

// Get Order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.find({
      ...ACTIVE_ORDER_MATCH,
      order_id: req.params.id,
    }).populate({
      path: "qc_record",
      populate: {
        path: "inspector",
        select: "name role",
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Not found" });
    }

    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getVendorSummaryByBrand = async (req, res) => {
  try {
    const { brand } = req.params;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await Order.aggregate([
      {
        $match: {
          ...ACTIVE_ORDER_MATCH,
          brand,
        },
      },
      {
        $addFields: {
          statusRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$status", "Pending"] }, then: 0 },
                { case: { $eq: ["$status", "Under Inspection"] }, then: 1 },
                { case: { $eq: ["$status", "Inspection Done"] }, then: 2 },
                { case: { $eq: ["$status", "Partial Shipped"] }, then: 3 },
                { case: { $eq: ["$status", "Shipped"] }, then: 4 },
              ],
              default: 99,
            },
          },
        },
      },
      {
        $group: {
          _id: {
            vendor: "$vendor",
            order_id: "$order_id",
          },
          vendor: { $first: "$vendor" },
          order_id: { $first: "$order_id" },
          etd: { $min: "$ETD" },
          minStatusRank: { $min: "$statusRank" },
        },
      },
      {
        $addFields: {
          // "Pending" bucket on Home combines pre-shipment states.
          isPendingOrder: { $in: ["$minStatusRank", [0, 1, 2]] },
          isPartialShippedOrder: { $eq: ["$minStatusRank", 3] },
          isShippedOrder: {
            $eq: ["$minStatusRank", 4],
          },
          isActiveOrder: { $not: [{ $in: ["$minStatusRank", [4]] }] },
        },
      },
      {
        $addFields: {
          isDelayedOrder: {
            $and: [
              "$isActiveOrder",
              { $ne: ["$etd", null] },
              { $lt: ["$etd", today] },
            ],
          },
          isOnTimeOrder: {
            $and: [
              "$isActiveOrder",
              { $ne: ["$etd", null] },
              { $gte: ["$etd", today] },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$vendor",
          orders: {
            $addToSet: "$order_id",
          },
          delayedOrders: {
            $addToSet: {
              $cond: ["$isDelayedOrder", "$order_id", "$$REMOVE"],
            },
          },
          pendingOrders: {
            $addToSet: {
              $cond: ["$isPendingOrder", "$order_id", "$$REMOVE"],
            },
          },
          partialShippedOrders: {
            $addToSet: {
              $cond: ["$isPartialShippedOrder", "$order_id", "$$REMOVE"],
            },
          },
          shippedOrders: {
            $addToSet: {
              $cond: ["$isShippedOrder", "$order_id", "$$REMOVE"],
            },
          },
          onTimeOrders: {
            $addToSet: {
              $cond: ["$isOnTimeOrder", "$order_id", "$$REMOVE"],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          vendor: "$_id",
          orders: 1,
          delayedOrders: 1,
          totalOrders: { $size: "$orders" },
          totalDelayedOrders: { $size: "$delayedOrders" },
          totalPending: { $size: "$pendingOrders" },
          totalPartialShipped: { $size: "$partialShippedOrders" },
          totalShipped: { $size: "$shippedOrders" },
          totalOnTime: { $size: "$onTimeOrders" },
        },
      },
      {
        $sort: { totalDelayedOrders: -1, vendor: 1 },
      },
    ]);

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
      rawSortBy
      || String(normalizedSortToken || "").replace(/^[+-]/, "")
      || "ETD",
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
    const sortStage = {
      [sortBy]: sortDirection,
      ...(sortBy !== "order_id" ? { order_id: 1 } : {}),
      latestUpdatedAt: -1,
    };

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

    const matchStage = {
      ...ACTIVE_ORDER_MATCH,
      ETD: {
        $gte: dayStart,
        $lt: dayEnd,
      },
    };

    if (brand) {
      matchStage.brand = brand;
    }

    const data = await Order.aggregate([
      {
        $match: matchStage,
      },
      {
        $addFields: {
          statusRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$status", "Pending"] }, then: 0 },
                { case: { $eq: ["$status", "Under Inspection"] }, then: 1 },
                { case: { $eq: ["$status", "Inspection Done"] }, then: 2 },
                { case: { $eq: ["$status", "Partial Shipped"] }, then: 3 },
                { case: { $eq: ["$status", "Shipped"] }, then: 4 },
              ],
              default: 99,
            },
          },
        },
      },
      {
        $group: {
          _id: "$order_id",
          order_id: { $first: "$order_id" },
          brand: { $first: "$brand" },
          ETD: { $first: "$ETD" },
          itemCount: { $sum: 1 },
          pendingCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "Pending"] }, 1, 0],
            },
          },
          underInspectionCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "Under Inspection"] }, 1, 0],
            },
          },
          inspectionDoneCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "Inspection Done"] }, 1, 0],
            },
          },
          partialShippedCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "Partial Shipped"] }, 1, 0],
            },
          },
          shippedCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "Shipped"] }, 1, 0],
            },
          },
          minStatusRank: { $min: "$statusRank" },
          latestUpdatedAt: { $max: "$updatedAt" },
        },
      },
      {
        $addFields: {
          status: {
            $switch: {
              branches: [
                { case: { $eq: ["$minStatusRank", 0] }, then: "Pending" },
                { case: { $eq: ["$minStatusRank", 1] }, then: "Under Inspection" },
                { case: { $eq: ["$minStatusRank", 2] }, then: "Inspection Done" },
                { case: { $eq: ["$minStatusRank", 3] }, then: "Partial Shipped" },
                { case: { $eq: ["$minStatusRank", 4] }, then: "Shipped" },
              ],
              default: "Pending",
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          order_id: 1,
          brand: 1,
          ETD: 1,
          itemCount: 1,
          status: 1,
          inspectionDoneCount: 1,
          partialShippedCount: 1,
          shippedCount: 1,
          pendingCount: 1,
          underInspectionCount: 1,
          latestUpdatedAt: 1,
        },
      },
      {
        $sort: {
          ...sortStage,
        },
      },
    ]);

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
      rawSortBy
      || String(normalizedSortToken || "").replace(/^[+-]/, "")
      || "order_date",
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
    const sortDirection = sortOrder === "asc" ? 1 : -1;
    const sortStage = {
      [sortBy]: sortDirection,
      ...(sortBy !== "order_date" ? { order_date: -1 } : {}),
      ...(sortBy !== "order_id" ? { order_id: 1 } : {}),
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const normalizedStatus = String(status || "").trim().toLowerCase();
    const isOnTimeStatus =
      normalizedStatus === "on-time"
      || normalizedStatus === "on time"
      || normalizedStatus === "ontime";
    const isDelayedStatus = normalizedStatus === "delayed";
    const isDelayedFilter =
      String(isDelayed || "")
        .trim()
        .toLowerCase() === "true" || isDelayedStatus;
    const exactOrderStatus =
      ORDER_STATUS_SEQUENCE.find(
        (statusValue) => statusValue.toLowerCase() === normalizedStatus,
      ) || null;

    const matchStage = { ...ACTIVE_ORDER_MATCH };

    if (brand) {
      matchStage.brand = brand;
    }

    if (vendor) {
      matchStage.vendor = vendor;
    }

    const postGroupMatch = {};
    if (normalizedStatus === "pending") {
      postGroupMatch.totalStatus = {
        $in: ["Pending", "Under Inspection", "Inspection Done", "Partial Shipped"],
      };
    } else if (exactOrderStatus) {
      postGroupMatch.totalStatus = exactOrderStatus;
    }

    if (isOnTimeStatus) {
      postGroupMatch.ETD = { $ne: null, $gte: today };
      postGroupMatch.totalStatus = { $nin: ["Shipped"] };
    }

    if (isDelayedFilter) {
      postGroupMatch.ETD = { $ne: null, $lt: today };
      postGroupMatch.totalStatus = { $nin: ["Shipped"] };
    }

    const aggregationPipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$order_id",
          items: { $sum: 1 },
          brand: { $first: "$brand" },
          vendor: { $first: "$vendor" },
          ETD: { $min: "$ETD" },
          revised_ETD: { $min: "$revised_ETD" },
          order_date: { $first: "$order_date" },
          statuses: { $addToSet: "$status" },
        },
      },
      {
        $addFields: {
          hasPendingStatus: { $in: ["Pending", "$statuses"] },
          hasUnderInspectionStatus: { $in: ["Under Inspection", "$statuses"] },
          hasInspectionDoneStatus: { $in: ["Inspection Done", "$statuses"] },
          hasPartialShippedStatus: { $in: ["Partial Shipped", "$statuses"] },
          minStatusRank: {
            $min: {
              $map: {
                input: "$statuses",
                as: "statusValue",
                in: {
                  $switch: {
                    branches: [
                      { case: { $eq: ["$$statusValue", "Pending"] }, then: 0 },
                      { case: { $eq: ["$$statusValue", "Under Inspection"] }, then: 1 },
                      { case: { $eq: ["$$statusValue", "Inspection Done"] }, then: 2 },
                      { case: { $eq: ["$$statusValue", "Partial Shipped"] }, then: 3 },
                      { case: { $eq: ["$$statusValue", "Shipped"] }, then: 4 },
                    ],
                    default: 99,
                  },
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          totalStatus: {
            $switch: {
              branches: [
                {
                  case: {
                    $and: [
                      "$hasPartialShippedStatus",
                      "$hasInspectionDoneStatus",
                      { $not: ["$hasPendingStatus"] },
                      { $not: ["$hasUnderInspectionStatus"] },
                    ],
                  },
                  then: "Partial Shipped",
                },
                { case: { $eq: ["$minStatusRank", 0] }, then: "Pending" },
                { case: { $eq: ["$minStatusRank", 1] }, then: "Under Inspection" },
                { case: { $eq: ["$minStatusRank", 2] }, then: "Inspection Done" },
                { case: { $eq: ["$minStatusRank", 3] }, then: "Partial Shipped" },
                { case: { $eq: ["$minStatusRank", 4] }, then: "Shipped" },
              ],
              default: "Pending",
            },
          },
        },
      },
      ...(Object.keys(postGroupMatch).length > 0
        ? [{ $match: postGroupMatch }]
        : []),
      {
        $project: {
          _id: 0,
          order_id: "$_id",
          items: 1,
          brand: 1,
          vendor: 1,
          ETD: 1,
          revised_ETD: 1,
          order_date: 1,
          statuses: 1,
          totalStatus: 1,
        },
      },
      { $sort: sortStage },
    ];

    const orders = await Order.aggregate(aggregationPipeline);

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
    const isDelayed =
      String(req.query.isDelayed || "")
        .trim()
        .toLowerCase() === "true";

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
      rawSortBy
      || String(normalizedSortToken || "").replace(/^[+-]/, "")
      || "order_date",
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

    const filterInput = {
      brand,
      vendor,
      status,
      order,
      isDelayed,
    };

    const matchStage = buildOrderListMatch(filterInput);

    const [result, vendorsRaw, brandsRaw, statusesRaw, orderIdsRaw] =
      await Promise.all([
        Order.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: "$order_id",
              items: { $sum: 1 },
              brand: { $first: "$brand" },
              vendor: { $first: "$vendor" },
              ETD: { $first: "$ETD" },
              order_date: { $first: "$order_date" },
              statuses: { $addToSet: "$status" },
            },
          },
          {
            $project: {
              _id: 0,
              order_id: "$_id",
              items: 1,
              brand: 1,
              vendor: 1,
              ETD: 1,
              order_date: 1,
              statuses: 1,
            },
          },
          { $sort: sortStage },
          {
            $facet: {
              data: [{ $skip: skip }, { $limit: limit }],
              totalCount: [{ $count: "count" }],
            },
          },
        ]),
        Order.distinct(
          "vendor",
          buildOrderListMatch({ ...filterInput, includeVendor: false }),
        ),
        Order.distinct(
          "brand",
          buildOrderListMatch({ ...filterInput, includeBrand: false }),
        ),
        Order.distinct(
          "status",
          buildOrderListMatch({ ...filterInput, includeStatus: false }),
        ),
        Order.distinct(
          "order_id",
          buildOrderListMatch({ ...filterInput, includeOrder: false }),
        ),
      ]);

    const data = result?.[0]?.data || [];
    const totalRecords = result?.[0]?.totalCount?.[0]?.count || 0;

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
      filters: {
        vendors: normalizeDistinctValues(vendorsRaw),
        brands: normalizeDistinctValues(brandsRaw),
        statuses: normalizeStatusList(statusesRaw),
        order_ids: normalizeDistinctValues(orderIdsRaw),
      },
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
    const orderDateFrom = req.query.order_date_from ?? req.query.orderDateFrom;
    const orderDateTo = req.query.order_date_to ?? req.query.orderDateTo;
    const etdFrom = req.query.etd_from ?? req.query.etdFrom;
    const etdTo = req.query.etd_to ?? req.query.etdTo;
    const tzOffsetValue =
      req.query.tz_offset_minutes ?? req.query.tzOffset ?? req.query.tz_offset;
    const exportFormat =
      String(req.query.format || "").trim().toLowerCase() === "csv"
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
      rawSortBy
      || String(normalizedSortToken || "").replace(/^[+-]/, "")
      || "order_date",
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

    const matchStage = buildOrderListMatch({
      brand,
      vendor,
      status,
      order,
    });

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
    if (orderDateRangeQuery.range) {
      matchStage.order_date = orderDateRangeQuery.range;
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
    if (etdRangeQuery.range) {
      matchStage.ETD = etdRangeQuery.range;
    }

    const orders = await Order.find(matchStage)
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
          return [requestDate, requestType, `qty ${quantityRequested}`, statusText]
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
      { key: "qc_inspection_records_count", header: "QC Inspection Records Count" },
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
        status: normalizeText(orderEntry?.status),
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
          return `"${normalized.replace(/"/g, "\"\"")}"`;
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
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`,
    );
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
    const vendor = req.query.vendor;
    const orderId = req.query.order_id ?? req.query.order;
    const itemCode = req.query.item_code;
    const container = req.query.container ?? req.query.container_number;
    const statusFilter = normalizeFilterValue(req.query.status);
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const shipmentData = await getShipmentDataset({
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
    const vendor = req.query.vendor;
    const orderId = req.query.order_id ?? req.query.order;
    const itemCode = req.query.item_code;
    const container = req.query.container ?? req.query.container_number;
    const statusFilter = normalizeFilterValue(req.query.status);
    const exportFormat = String(req.query.format || "").trim().toLowerCase() === "csv"
      ? "csv"
      : "xlsx";

    const shipmentData = await getShipmentDataset({
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
          return `"${normalized.replace(/"/g, "\"\"")}"`;
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
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`,
    );
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
      hasOwn(payload, "revised_ETD")
      || hasOwn(payload, "revised_etd")
      || hasOwn(payload, "revisedEtd");
    const requesterRole = String(req.user?.role || "").trim().toLowerCase();
    const isRequesterAdmin = requesterRole === "admin";
    const archiveRemarkInput = String(
      payload.archive_remark ?? payload.archiveRemark ?? "",
    ).trim();

    if ((hasQuantity || hasShipment) && !isRequesterAdmin) {
      return res.status(403).json({
        message: "Only admin can edit shipping details or final quantity",
      });
    }

    const nextBrand = hasBrand ? String(payload.brand ?? "").trim() : String(order.brand || "").trim();
    const nextVendor = hasVendor ? String(payload.vendor ?? "").trim() : String(order.vendor || "").trim();
    const nextItemCode = hasItemCode
      ? String(payload.item_code ?? "").trim()
      : String(order?.item?.item_code || "").trim();
    const nextDescription = hasDescription
      ? String(payload.description ?? "").trim()
      : String(order?.item?.description || "").trim();
    const nextQuantity = hasQuantity ? Number(payload.quantity) : Number(order.quantity || 0);
    const rawRevisedEtd = hasOwn(payload, "revised_ETD")
      ? payload.revised_ETD
      : (hasOwn(payload, "revised_etd")
        ? payload.revised_etd
        : payload.revisedEtd);

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
      nextItemCode !== String(order?.item?.item_code || "").trim()
      && (await Order.exists({
        _id: { $ne: order._id },
        ...ACTIVE_ORDER_MATCH,
        order_id: order.order_id,
        "item.item_code": nextItemCode,
      }))
    ) {
      return res.status(400).json({
        message: "Another item with the same order_id and item_code already exists",
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
      order.status = "Cancelled";
      order.archived = true;
      order.archived_remark = archiveRemarkInput;
      order.archived_at = new Date();
      order.archived_by = {
        user: req.user?._id || null,
        name: buildArchivedByName(req.user),
      };
      await order.save();

      try {
        await syncOrderGroup(oldGroup);
      } catch (syncErr) {
        console.error("Google Calendar sync failed after archiving via edit:", {
          group: oldGroup,
          error: syncErr?.message || String(syncErr),
        });
      }

      return res.status(200).json({
        message: "Order archived successfully",
        archived: true,
        data: order,
      });
    }

    const shouldRebuildShipment = hasShipment || hasQuantity;
    let adjustedShipment = Array.isArray(order.shipment) ? order.shipment : [];
    if (shouldRebuildShipment) {
      const shipmentSource = hasShipment ? payload.shipment : order.shipment || [];
      const normalizedShipmentSource = normalizeShipmentEntries(shipmentSource);
      adjustedShipment = fitShipmentEntriesToOrderQuantity(
        normalizedShipmentSource,
        nextQuantity,
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
        const nextRequested = clampToDemand(qcRecord.quantities.quantity_requested);
        const nextProvision = clampToDemand(qcRecord.quantities.vendor_provision);

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
    order.revised_ETD = nextRevisedEtd;
    if (shouldRebuildShipment) {
      order.shipment = adjustedShipment;
    }

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
    groupMap.set(`${oldGroup.order_id}__${oldGroup.brand}__${oldGroup.vendor}`, oldGroup);
    groupMap.set(`${newGroup.order_id}__${newGroup.brand}__${newGroup.vendor}`, newGroup);
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

exports.archiveOrder = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const remark = String(
      req.body?.remark ?? req.body?.archive_remark ?? req.body?.archiveRemark ?? "",
    ).trim();
    if (!remark) {
      return res.status(400).json({ message: "archive remark is required" });
    }

    const order = await Order.findOne({ _id: id, ...ACTIVE_ORDER_MATCH });
    if (!order) {
      return res.status(404).json({ message: "Order not found or already archived" });
    }

    const group = {
      order_id: order.order_id,
      brand: order.brand,
      vendor: order.vendor,
    };

    order.archived = true;
    order.status = "Cancelled";
    order.archived_remark = remark;
    order.archived_at = new Date();
    order.archived_by = {
      user: req.user?._id || null,
      name: buildArchivedByName(req.user),
    };

    await order.save();

    try {
      await syncOrderGroup(group);
    } catch (syncErr) {
      console.error("Google Calendar sync failed after archiving order:", {
        group,
        error: syncErr?.message || String(syncErr),
      });
    }

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
          "order_id item brand vendor quantity archived archived_remark archived_at archived_by updatedAt",
        )
        .sort({ archived_at: -1, updatedAt: -1, order_id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(match),
      Order.distinct("vendor", { archived: true }),
      Order.distinct("brand", { archived: true }),
    ]);

    return res.status(200).json({
      success: true,
      data: rows,
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
      .select("_id order_id brand vendor")
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
        remark_backfilled_count: Number(remarkBackfillResult?.modifiedCount || 0),
        status_backfilled_count: Number(statusBackfillResult?.modifiedCount || 0),
        calendar_sync: [],
      });
    }

    const candidateIds = candidates.map((entry) => entry._id);
    const archiveResult = await Order.updateMany(
      { _id: { $in: candidateIds } },
      {
        $set: {
          archived: true,
          status: "Cancelled",
          archived_remark: remark,
          archived_at: now,
          archived_by: {
            user: req.user?._id || null,
            name: actorName,
          },
        },
      },
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
    const { stuffing_date, container, quantity, remarks } = req.body;

    const order = await Order.findOne({ _id: req.params.id, ...ACTIVE_ORDER_MATCH });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.status === "Shipped" || order.status === "Cancelled") {
      return res.status(400).json({
        message: "Order is already closed",
      });
    }

    if (!stuffing_date || container === undefined || quantity === undefined) {
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

    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({
        message: "quantity must be a valid positive number",
      });
    }

    const qcRecord = order?.qc_record
      ? await QC.findById(order.qc_record).select("quantities.qc_passed")
      : await QC.findOne({ order: order._id }).select("quantities.qc_passed");

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
      stuffing_date: parsedStuffingDate,
      quantity: parsedQuantity,
      pending,
      remaining_remarks: remarks,
    });

    const shippedAfter = shippedAlready + parsedQuantity;
    order.status =
      shippedAfter >= orderQuantity ? "Shipped" : "Partial Shipped";

    await order.save();

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
    const timeoutMs = Math.min(1200000, parsePositiveInt(req.query.timeoutMs, 300000));

    const purgeSummary = await withTimeout(
      purgeOmsEventsForConfiguredBrandCalendars(),
      timeoutMs,
      "purge existing OMS calendar events",
    );

    await Order.updateMany(
      ACTIVE_ORDER_MATCH,
      {
        $set: {
          "gcal.calendarId": null,
          "gcal.eventId": null,
          "gcal.lastSyncedAt": null,
          "gcal.lastSyncError": null,
        },
      },
    );

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
            await Order.updateMany({ ...group, ...ACTIVE_ORDER_MATCH }, {
              $set: {
                "gcal.lastSyncedAt": new Date(),
                "gcal.lastSyncError": errorMessage,
              },
            });
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
    console.error("reSync failed:", error);
    return res.status(500).json({
      success: false,
      message: "Calendar re-sync failed",
      error: error?.message || String(error),
    });
  }
};

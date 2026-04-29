const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const Inspector = require("../models/inspector.model");
const User = require("../models/user.model");
const Item = require("../models/item.model");
const Finish = require("../models/finish.model");
const QcEditLog = require("../models/qcEditLog.model");
const OrderEditLog = require("../models/orderEditLog.model");
const XLSX = require("xlsx");
const path = require("path");

const Order = require("../models/order.model");
const mongoose = require("mongoose");
const { upsertItemFromQc } = require("../services/itemSync");
const {
  applyTotalPoCbmToOrder,
  syncTotalPoCbmForItem,
} = require("../services/orderCbm.service");
const {
  getSignedObjectUrl,
  isConfigured: isWasabiConfigured,
  deleteObject,
} = require("../services/wasabiStorage.service");
const {
  formatDateOnlyDDMMYYYY,
  parseDateOnly,
  toDateOnlyIso,
} = require("../helpers/dateOnly");
const {
  LABEL_EXEMPT_QC_ALLOWED_PAST_DAYS,
  isLabelExemptUser,
} = require("../helpers/labelExemptUsers");
const {
  BOX_PACKAGING_MODES,
  BOX_SIZE_REMARK_OPTIONS,
  buildBoxLegacyFieldsFromEntries,
  buildBoxMeasurementCbmSummary,
  calculateEffectiveBoxEntriesCbmTotal,
  detectBoxPackagingMode,
  normalizeStoredBoxEntries,
} = require("../helpers/boxMeasurement");
const {
  deriveGroupedOrderStatus,
  deriveOrderProgress,
  deriveOrderStatus,
  normalizeOrderStatus,
} = require("../helpers/orderStatus");
const {
  QC_IMAGE_UPLOAD_MODES,
  MAX_QC_IMAGE_UPLOAD_COUNT,
} = require("../config/qcImageUpload.config");
const {
  flattenUploadedFiles,
  buildStoredQcImageEntry,
  prepareSingleQcImageUpload,
  uploadPreparedQcImage,
  cleanupLocalQcImageFiles,
  processQcImageBatch,
} = require("../services/qcImageUpload.service");

const normalizeLabels = (labels = []) => {
  if (!Array.isArray(labels)) return [];
  const numericLabels = labels
    .map((label) => Number(label))
    .filter((label) => Number.isFinite(label));
  return [...new Set(numericLabels)].sort((a, b) => a - b);
};

const buildLabelRangesFromLabels = (labels = []) => {
  const normalizedLabels = normalizeLabels(labels);
  if (normalizedLabels.length === 0) return [];

  const ranges = [];
  let start = normalizedLabels[0];
  let end = normalizedLabels[0];

  for (let index = 1; index < normalizedLabels.length; index += 1) {
    const label = normalizedLabels[index];
    if (label === end + 1) {
      end = label;
      continue;
    }

    ranges.push({ start, end });
    start = label;
    end = label;
  }

  ranges.push({ start, end });
  return ranges;
};

const parseTransferLabelsInput = (value) => {
  if (Array.isArray(value)) {
    return normalizeLabels(value);
  }

  const normalized = String(value || "").trim();
  if (!normalized) return [];

  const labels = [];
  const segments = normalized.split(",").map((segment) => segment.trim()).filter(Boolean);
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      labels.push(Number(segment));
      continue;
    }

    const rangeMatch = segment.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!rangeMatch) {
      throw new Error(
        "labels must be a comma-separated list like 101,102 or ranges like 101-105",
      );
    }

    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      throw new Error("labels contains an invalid range");
    }

    for (let label = start; label <= end; label += 1) {
      labels.push(label);
    }
  }

  return normalizeLabels(labels);
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};
const INSPECTED_WEIGHT_FIELD_KEYS = Object.freeze([
  "top_net",
  "top_gross",
  "bottom_net",
  "bottom_gross",
  "total_net",
  "total_gross",
]);
const LEGACY_WEIGHT_FALLBACK_BY_KEY = Object.freeze({
  total_net: "net",
  total_gross: "gross",
});
const getWeightFieldValue = (weight = {}, fieldKey = "", fallback = 0) => {
  const normalizedFieldKey = String(fieldKey || "").trim();
  if (!normalizedFieldKey) return fallback;

  const legacyFieldKey = LEGACY_WEIGHT_FALLBACK_BY_KEY[normalizedFieldKey];
  const rawValue =
    weight?.[normalizedFieldKey] ??
    (legacyFieldKey ? weight?.[legacyFieldKey] : undefined);

  return toNonNegativeNumber(rawValue, fallback);
};
const toNormalizedCbmString = (value) => {
  const safe = toNonNegativeNumber(value, 0);
  if (safe <= 0) return "0";
  const fixed = safe.toFixed(6);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const normalizeText = (value) => String(value ?? "").trim();
const pad2 = (value) => String(value).padStart(2, "0");
const QC_REQUEST_TYPES = Object.freeze({
  FULL: "FULL",
  AQL: "AQL",
});
const REQUEST_HISTORY_STATUS = Object.freeze({
  OPEN: "open",
  INSPECTED: "inspected",
  REJECTED: "rejected",
  TRANSFERRED: "transfered",
});
const INSPECTION_RECORD_STATUS = Object.freeze({
  PENDING: "pending",
  DONE: "Inspection Done",
  GOODS_NOT_READY: "goods not ready",
  REJECTED: "rejected",
  TRANSFERRED: "transfered",
});
const QC_INSPECTION_STATUS_LABEL = Object.freeze({
  PENDING: "Pending",
  DONE: "Inspection Done",
  GOODS_NOT_READY: "Goods Not Ready",
  REJECTED: "Rejected",
  TRANSFERRED: "Transferred",
});
const CLOSED_ORDER_STATUSES = ["Shipped", "Cancelled"];
const MANAGER_ALLOWED_PAST_DAYS = 2;
const QC_ALLOWED_PAST_DAYS = 1;
const UPDATE_QC_PAST_DAYS_OVERRIDE_BY_USER = Object.freeze({
  "6993ff47473290fa1cf76b65": 3,
});
const ACTIVE_ORDER_MATCH = {
  archived: { $ne: true },
  status: { $ne: "Cancelled" },
};
const EMPTY_LBH = Object.freeze({
  L: 0,
  B: 0,
  H: 0,
});
const SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  "top",
  "base",
  "item1",
  "item2",
  "item3",
  "item4",
]);
const resolveQcOrderStatus = (qcDoc = null, orderDoc = null) => {
  const resolvedOrder = orderDoc || qcDoc?.order || null;
  if (!resolvedOrder) return "Pending";

  return deriveOrderStatus({
    orderEntry: resolvedOrder,
    qcRecord: qcDoc,
  });
};

const applyQcOrderStatus = (qcDoc = null, orderDoc = null) => {
  const resolvedOrder = orderDoc || qcDoc?.order || null;
  if (!resolvedOrder) return "Pending";

  const nextStatus = resolveQcOrderStatus(qcDoc, resolvedOrder);
  resolvedOrder.status = nextStatus;
  return nextStatus;
};

const applyQcOrderPoCbm = async (orderDoc = null) => {
  if (!orderDoc) return null;
  try {
    return await applyTotalPoCbmToOrder(orderDoc);
  } catch (error) {
    console.error("Order total_po_cbm recalculation failed:", {
      orderId: orderDoc?._id,
      order_id: orderDoc?.order_id,
      item_code: orderDoc?.item?.item_code,
      error: error?.message || String(error),
    });
    return null;
  }
};

const isQcOrderInspectionDone = (qcDoc = null, orderDoc = null) =>
  normalizeOrderStatus(resolveQcOrderStatus(qcDoc, orderDoc)) ===
  "Inspection Done";

const buildActiveOrderLookupStage = (asField = "order") => ({
  $lookup: {
    from: "orders",
    let: { orderId: "$order" },
    pipeline: [
      {
        $match: {
          $expr: { $eq: ["$_id", "$$orderId"] },
        },
      },
      {
        $match: ACTIVE_ORDER_MATCH,
      },
    ],
    as: asField,
  },
});
const normalizeQcRequestType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === QC_REQUEST_TYPES.AQL) return QC_REQUEST_TYPES.AQL;
  return QC_REQUEST_TYPES.FULL;
};
const getEffectiveRequestPassedQuantity = ({
  requestType = "",
  samplePassed = 0,
  requestedQuantity = 0,
}) => {
  const safeSamplePassed = toNonNegativeNumber(samplePassed, 0);
  if (normalizeQcRequestType(requestType) !== QC_REQUEST_TYPES.AQL) {
    return safeSamplePassed;
  }

  return safeSamplePassed > 0
    ? toNonNegativeNumber(requestedQuantity, 0)
    : 0;
};

const resolveInspectionRequestGroupKey = (record = {}, fallbackKey = "") => {
  const requestHistoryId = String(record?.request_history_id || "").trim();
  if (requestHistoryId) return `request:${requestHistoryId}`;

  const requestedDateKey = toISODateString(
    record?.requested_date || record?.inspection_date || record?.createdAt,
  );
  const inspectorId = String(
    record?.inspector?._id || record?.inspector || "",
  ).trim();
  if (requestedDateKey && inspectorId) {
    return `date:${requestedDateKey}:inspector:${inspectorId}`;
  }
  if (requestedDateKey) {
    return `date:${requestedDateKey}`;
  }

  const recordId = String(record?._id || "").trim();
  if (recordId) return `record:${recordId}`;
  return fallbackKey || "record:unknown";
};

const calculateQcAggregateMetrics = (qcDoc, inspectionRecords = []) => {
  const safeInspectionRecords = Array.isArray(inspectionRecords)
    ? inspectionRecords
    : [];
  const requestHistoryQuantityById = new Map(
    (Array.isArray(qcDoc?.request_history) ? qcDoc.request_history : [])
      .map((entry) => [
        String(entry?._id || "").trim(),
        toNonNegativeNumber(entry?.quantity_requested, 0),
      ])
      .filter(([requestHistoryId]) => requestHistoryId),
  );
  const requestType = normalizeQcRequestType(qcDoc?.request_type);
  const fallbackRequestedQuantity = resolveRequestedQuantityFromQc(qcDoc);
  const requestGroupMetrics = new Map();

  const totalChecked = safeInspectionRecords.reduce(
    (sum, record) => sum + toNonNegativeNumber(record?.checked, 0),
    0,
  );
  const totalVendorOffered = safeInspectionRecords.reduce(
    (sum, record) => sum + toNonNegativeNumber(record?.vendor_offered, 0),
    0,
  );
  const totalSamplePassed = safeInspectionRecords.reduce(
    (sum, record) => sum + toNonNegativeNumber(record?.passed, 0),
    0,
  );

  safeInspectionRecords.forEach((record, index) => {
    const requestGroupKey = resolveInspectionRequestGroupKey(
      record,
      `fallback:${index}`,
    );
    const requestHistoryId = String(record?.request_history_id || "").trim();
    const recordRequestedQuantity = toNonNegativeNumber(
      record?.vendor_requested,
      0,
    );
    const historyRequestedQuantity = requestHistoryId
      ? toNonNegativeNumber(requestHistoryQuantityById.get(requestHistoryId), 0)
      : 0;
    const requestMetrics = requestGroupMetrics.get(requestGroupKey) || {
      requestedQuantity: 0,
      samplePassed: 0,
    };

    requestMetrics.requestedQuantity = Math.max(
      requestMetrics.requestedQuantity,
      recordRequestedQuantity,
      historyRequestedQuantity,
    );
    requestMetrics.samplePassed += toNonNegativeNumber(record?.passed, 0);
    requestGroupMetrics.set(requestGroupKey, requestMetrics);
  });

  const totalEffectivePassed = Array.from(requestGroupMetrics.values()).reduce(
    (sum, requestMetrics) =>
      sum +
      getEffectiveRequestPassedQuantity({
        requestType,
        samplePassed: requestMetrics.samplePassed,
        requestedQuantity:
          requestMetrics.requestedQuantity > 0
            ? requestMetrics.requestedQuantity
            : fallbackRequestedQuantity,
      }),
    0,
  );

  return {
    totalChecked,
    totalVendorOffered,
    totalSamplePassed,
    totalEffectivePassed,
  };
};

const getQcLabelRequirement = ({
  totalPassed = 0,
  boxSizesCount = 0,
}) => {
  const safePassed = toNonNegativeNumber(totalPassed, 0);
  const safeBoxSizesCount = toNonNegativeNumber(boxSizesCount, 0);

  return {
    requiredCount: safePassed * safeBoxSizesCount,
    basisQuantity: safePassed,
    boxSizesCount: safeBoxSizesCount,
  };
};

const buildQcLabelRequirementMessage = ({
  totalPassed = 0,
  boxSizesCount = 0,
  actualCount = 0,
}) => {
  const requirement = getQcLabelRequirement({
    totalPassed,
    boxSizesCount,
  });

  return `Total labels must equal passed quantity × box sizes count (${requirement.requiredCount}). Actual total labels: ${toNonNegativeNumber(actualCount, 0)}. Expected: ${requirement.basisQuantity} × ${requirement.boxSizesCount}.`;
};

const normalizeInspectionStatus = (value) =>
  String(value || "").trim().toLowerCase();

const isInspectionStatusMatching = (value, expectedStatus) =>
  normalizeInspectionStatus(value) === normalizeInspectionStatus(expectedStatus);

const isGoodsNotReadyMarked = (
  goodsNotReady = null,
  explicitStatus = "",
) => {
  if (isInspectionStatusMatching(explicitStatus, INSPECTION_RECORD_STATUS.GOODS_NOT_READY)) {
    return true;
  }

  if (typeof goodsNotReady === "boolean") {
    return goodsNotReady;
  }

  if (typeof goodsNotReady === "string") {
    return normalizeActionBoolean(goodsNotReady, false);
  }

  if (!goodsNotReady || typeof goodsNotReady !== "object") {
    return false;
  }

  if (goodsNotReady.ready !== undefined) {
    return normalizeActionBoolean(goodsNotReady.ready, false);
  }

  return Boolean(normalizeText(goodsNotReady.reason || ""));
};

const getGoodsNotReadyReason = (goodsNotReady = null, fallback = "") => {
  if (goodsNotReady && typeof goodsNotReady === "object") {
    const reason = normalizeText(goodsNotReady.reason || "");
    if (reason) return reason;
  }

  return normalizeText(fallback || "");
};

const normalizeRequestHistoryStatus = (value) =>
  String(value || "").trim().toLowerCase();

const normalizeActionBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;

  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
};

const buildAuditActor = (user = null, fallbackName = "") => ({
  user:
    user?._id && mongoose.Types.ObjectId.isValid(user._id)
      ? user._id
      : null,
  name: normalizeText(
    user?.name || user?.username || user?.email || fallbackName || "",
  ),
});

const stampRequestHistoryEntry = (
  entry,
  { user = null, updatedAt = new Date(), fallbackName = "" } = {},
) => {
  if (!entry) return;
  entry.updatedAt = updatedAt;
  entry.updated_by = buildAuditActor(user, fallbackName);
};

const hasInspectionRecordActivity = ({
  checked = 0,
  passed = 0,
  vendorOffered = 0,
  labelsAdded = [],
  labelRanges = [],
  goodsNotReady = null,
  status = "",
} = {}) =>
  isInspectionStatusMatching(status, INSPECTION_RECORD_STATUS.REJECTED) ||
  isInspectionStatusMatching(status, INSPECTION_RECORD_STATUS.GOODS_NOT_READY) ||
  isInspectionStatusMatching(status, INSPECTION_RECORD_STATUS.DONE) ||
  isGoodsNotReadyMarked(goodsNotReady, status) ||
  toNonNegativeNumber(checked, 0) > 0 ||
  toNonNegativeNumber(passed, 0) > 0 ||
  toNonNegativeNumber(vendorOffered, 0) > 0 ||
  (Array.isArray(labelsAdded) && labelsAdded.length > 0) ||
  (Array.isArray(labelRanges) && labelRanges.length > 0);

const resolveInspectionRecordStatus = ({
  checked = 0,
  goodsNotReady = null,
  explicitStatus = "",
} = {}) => {
  if (isInspectionStatusMatching(explicitStatus, INSPECTION_RECORD_STATUS.TRANSFERRED)) {
    return INSPECTION_RECORD_STATUS.TRANSFERRED;
  }

  if (isInspectionStatusMatching(explicitStatus, INSPECTION_RECORD_STATUS.REJECTED)) {
    return INSPECTION_RECORD_STATUS.REJECTED;
  }

  if (isGoodsNotReadyMarked(goodsNotReady, explicitStatus)) {
    return INSPECTION_RECORD_STATUS.GOODS_NOT_READY;
  }

  if (
    toNonNegativeNumber(checked, 0) > 0 ||
    isInspectionStatusMatching(explicitStatus, INSPECTION_RECORD_STATUS.DONE)
  ) {
    return INSPECTION_RECORD_STATUS.DONE;
  }

  return INSPECTION_RECORD_STATUS.PENDING;
};

const syncQcRequestHistoryStatuses = (
  qcDoc,
  inspectionRecords = [],
  { user = null, updatedAt = new Date(), fallbackName = "" } = {},
) => {
  if (!Array.isArray(qcDoc?.request_history)) return false;

  const statusPriority = {
    [REQUEST_HISTORY_STATUS.OPEN]: 0,
    [REQUEST_HISTORY_STATUS.INSPECTED]: 1,
    [REQUEST_HISTORY_STATUS.REJECTED]: 2,
    [REQUEST_HISTORY_STATUS.TRANSFERRED]: 3,
  };
  const mergeRequestHistoryStatus = (currentStatus, nextStatus) => {
    const normalizedCurrent = normalizeRequestHistoryStatus(
      currentStatus || REQUEST_HISTORY_STATUS.OPEN,
    );
    const normalizedNext = normalizeRequestHistoryStatus(
      nextStatus || REQUEST_HISTORY_STATUS.OPEN,
    );

    return (statusPriority[normalizedNext] || 0) >= (statusPriority[normalizedCurrent] || 0)
      ? normalizedNext
      : normalizedCurrent;
  };
  const inspectionStatusByRequestId = new Map();
  const inspectionStatusByRequestKey = new Map();
  for (const record of Array.isArray(inspectionRecords) ? inspectionRecords : []) {
    const requestHistoryId = String(record?.request_history_id || "").trim();
    const requestedDateKey = toISODateString(
      record?.requested_date || record?.inspection_date || record?.createdAt,
    );
    const inspectorId = String(record?.inspector?._id || record?.inspector || "").trim();
    const resolvedInspectionStatus = resolveInspectionRecordStatus({
      checked: record?.checked,
      goodsNotReady: record?.goods_not_ready,
      explicitStatus: record?.status,
    });

    const hasActivity = hasInspectionRecordActivity({
      checked: record?.checked,
      passed: record?.passed,
      vendorOffered: record?.vendor_offered,
      labelsAdded: record?.labels_added,
      labelRanges: record?.label_ranges,
      goodsNotReady: record?.goods_not_ready,
      status: resolvedInspectionStatus,
    });
    const nextRequestHistoryStatus =
      normalizeInspectionStatus(resolvedInspectionStatus) ===
      normalizeInspectionStatus(INSPECTION_RECORD_STATUS.TRANSFERRED)
        ? REQUEST_HISTORY_STATUS.TRANSFERRED
        : normalizeInspectionStatus(resolvedInspectionStatus) ===
            normalizeInspectionStatus(INSPECTION_RECORD_STATUS.REJECTED)
          ? REQUEST_HISTORY_STATUS.REJECTED
        : hasActivity
          ? REQUEST_HISTORY_STATUS.INSPECTED
          : REQUEST_HISTORY_STATUS.OPEN;

    if (requestHistoryId) {
      inspectionStatusByRequestId.set(
        requestHistoryId,
        mergeRequestHistoryStatus(
          inspectionStatusByRequestId.get(requestHistoryId),
          nextRequestHistoryStatus,
        ),
      );
    }

    if (requestedDateKey && !requestHistoryId) {
      const dateOnlyKey = `date:${requestedDateKey}`;
      const dateInspectorKey = inspectorId
        ? `${dateOnlyKey}:inspector:${inspectorId}`
        : "";
      inspectionStatusByRequestKey.set(
        dateOnlyKey,
        mergeRequestHistoryStatus(
          inspectionStatusByRequestKey.get(dateOnlyKey),
          nextRequestHistoryStatus,
        ),
      );
      if (dateInspectorKey) {
        inspectionStatusByRequestKey.set(
          dateInspectorKey,
          mergeRequestHistoryStatus(
            inspectionStatusByRequestKey.get(dateInspectorKey),
            nextRequestHistoryStatus,
          ),
        );
      }
    }
  }

  let hasChanges = false;
  for (const entry of qcDoc.request_history) {
    const requestId = String(entry?._id || "").trim();
    if (!requestId) continue;

    const requestDateKey = toISODateString(entry?.request_date);
    const requestInspectorId = String(
      entry?.inspector?._id || entry?.inspector || "",
    ).trim();
    const fallbackStatus = requestDateKey
      ? inspectionStatusByRequestKey.get(
          requestInspectorId
            ? `date:${requestDateKey}:inspector:${requestInspectorId}`
            : `date:${requestDateKey}`,
        ) ?? inspectionStatusByRequestKey.get(`date:${requestDateKey}`)
      : REQUEST_HISTORY_STATUS.OPEN;
    const nextStatus =
      inspectionStatusByRequestId.get(requestId) ||
      fallbackStatus ||
      REQUEST_HISTORY_STATUS.OPEN;
    if (normalizeRequestHistoryStatus(entry?.status || "") !== nextStatus) {
      entry.status = nextStatus;
      stampRequestHistoryEntry(entry, {
        user,
        updatedAt,
        fallbackName,
      });
      hasChanges = true;
    }
  }

  return hasChanges;
};

const toISODateString = (value) => toDateOnlyIso(value);

const parseIsoDateToUtcDate = (isoDate) => {
  return parseDateOnly(isoDate);
};

const isIsoDateWithinPastDaysInclusive = (isoDate, daysBack = 0) => {
  const target = parseIsoDateToUtcDate(isoDate);
  if (!target) return false;

  const todayUtc = toUtcDayStart(new Date());
  if (!todayUtc) return false;
  const minAllowedUtc = new Date(todayUtc);
  minAllowedUtc.setUTCDate(
    minAllowedUtc.getUTCDate() - Math.max(0, Number(daysBack) || 0),
  );

  return target >= minAllowedUtc && target <= todayUtc;
};

const getUpdateQcPastDaysLimit = (role = "", userId = "") => {
  const normalizedUserId = String(userId || "").trim();
  if (isLabelExemptUser(normalizedUserId)) {
    return LABEL_EXEMPT_QC_ALLOWED_PAST_DAYS;
  }

  const override = UPDATE_QC_PAST_DAYS_OVERRIDE_BY_USER[normalizedUserId];
  if (Number.isInteger(override) && override >= 0) {
    return override;
  }

  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "manager") return MANAGER_ALLOWED_PAST_DAYS;
  if (normalizedRole === "qc") return QC_ALLOWED_PAST_DAYS;
  return 0;
};

const buildUpdateQcPastDaysMessage = (role = "", daysBack = 0) => {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const actorLabel = normalizedRole === "manager" ? "Manager" : "QC";
  const safeDaysBack =
    Number.isInteger(daysBack) && daysBack >= 0 ? daysBack : 0;
  const dayLabel = safeDaysBack === 1 ? "day" : "days";
  return `${actorLabel} can update QC only for today and previous ${safeDaysBack} ${dayLabel}`;
};

const buildQcUserUpdateDateMessage = (daysBack = QC_ALLOWED_PAST_DAYS) =>
  buildUpdateQcPastDaysMessage("qc", daysBack);

const formatDateDDMMYYYY = (value, fallback = "") =>
  formatDateOnlyDDMMYYYY(value, fallback);

const formatAuditBoolean = (value) => (value ? "Yes" : "No");

const formatAuditList = (values = []) => {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join(", ") : "None";
};

const formatRequestHistoryForAudit = (entries = []) => {
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) return "None";

  return rows
    .map((entry, index) => {
      const requestDate = formatDateDDMMYYYY(entry?.request_date, "Not Set");
      const requestType = normalizeText(entry?.request_type) || "Not Set";
      const quantityRequested = toNonNegativeNumber(
        entry?.quantity_requested,
        0,
      );
      const inspectorName =
        normalizeText(entry?.inspector?.name || entry?.updated_by?.name || "") ||
        "Not Set";
      const status = normalizeText(entry?.status) || "open";
      const remarks = normalizeText(entry?.remarks) || "None";
      return `${index + 1}) ${requestDate} | ${requestType} | qty ${quantityRequested} | inspector ${inspectorName} | ${status} | remarks: ${remarks}`;
    })
    .join(" || ");
};

const formatInspectionRecordsForAudit = (entries = []) => {
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) return "None";

  return rows
    .map((entry, index) => {
      const inspectionDate = formatDateDDMMYYYY(
        entry?.inspection_date || entry?.createdAt,
        "Not Set",
      );
      const status = normalizeText(entry?.status) || "pending";
      const checked = toNonNegativeNumber(entry?.checked, 0);
      const passed = toNonNegativeNumber(entry?.passed, 0);
      const offered = toNonNegativeNumber(entry?.vendor_offered, 0);
      const remarks = normalizeText(entry?.remarks) || "None";
      return `${index + 1}) ${inspectionDate} | offered ${offered} | checked ${checked} | passed ${passed} | ${status} | remarks: ${remarks}`;
    })
    .join(" || ");
};

const buildQcEditLogSnapshot = (qcDoc = {}, inspectionRecords = []) => ({
  order_id: normalizeText(qcDoc?.order_meta?.order_id),
  brand: normalizeText(qcDoc?.order_meta?.brand),
  vendor: normalizeText(qcDoc?.order_meta?.vendor),
  item_code: normalizeText(qcDoc?.item?.item_code),
  inspector:
    normalizeText(qcDoc?.inspector?.name || qcDoc?.inspector?.email || "") ||
    normalizeText(qcDoc?.inspector),
  request_type: normalizeText(qcDoc?.request_type) || "Not Set",
  request_date: formatDateDDMMYYYY(qcDoc?.request_date, "Not Set"),
  last_inspected_date: formatDateDDMMYYYY(
    qcDoc?.last_inspected_date,
    "Not Set",
  ),
  client_demand: String(toNonNegativeNumber(qcDoc?.quantities?.client_demand, 0)),
  quantity_requested: String(
    toNonNegativeNumber(qcDoc?.quantities?.quantity_requested, 0),
  ),
  vendor_provision: String(
    toNonNegativeNumber(qcDoc?.quantities?.vendor_provision, 0),
  ),
  qc_checked: String(toNonNegativeNumber(qcDoc?.quantities?.qc_checked, 0)),
  qc_passed: String(toNonNegativeNumber(qcDoc?.quantities?.qc_passed, 0)),
  pending: String(toNonNegativeNumber(qcDoc?.quantities?.pending, 0)),
  qc_rejected: String(toNonNegativeNumber(qcDoc?.quantities?.qc_rejected, 0)),
  barcode: [
    `master ${toNonNegativeNumber(qcDoc?.master_barcode ?? qcDoc?.barcode, 0)}`,
    `inner ${toNonNegativeNumber(qcDoc?.inner_barcode, 0)}`,
  ].join(" | "),
  packed_size: formatAuditBoolean(qcDoc?.packed_size),
  finishing: formatAuditBoolean(qcDoc?.finishing),
  branding: formatAuditBoolean(qcDoc?.branding),
  cbm: (() => {
    const cbmSnapshot = buildNormalizedCbmSnapshot(qcDoc?.cbm);
    return [
      `box1 ${normalizeText(cbmSnapshot?.box1) || "0"}`,
      `box2 ${normalizeText(cbmSnapshot?.box2) || "0"}`,
      `box3 ${normalizeText(cbmSnapshot?.box3) || "0"}`,
      `total ${normalizeText(cbmSnapshot?.total) || "0"}`,
    ].join(" | ");
  })(),
  labels: formatAuditList(qcDoc?.labels),
  remarks: normalizeText(qcDoc?.remarks) || "None",
  request_history: formatRequestHistoryForAudit(qcDoc?.request_history),
  inspection_record: formatInspectionRecordsForAudit(inspectionRecords),
});

const buildAuditChanges = (
  beforeSnapshot = {},
  afterSnapshot = {},
  fields = [],
) => {
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

const createQcEditLog = async ({
  reqUser = null,
  qcDoc = null,
  beforeSnapshot = {},
  afterSnapshot = {},
  operationType = "qc_update",
  extraRemarks = [],
} = {}) => {
  const changes = buildAuditChanges(beforeSnapshot, afterSnapshot, [
    { key: "inspector", label: "Inspector" },
    { key: "request_type", label: "Request Type" },
    { key: "request_date", label: "Request Date" },
    { key: "last_inspected_date", label: "Last Inspected Date" },
    { key: "client_demand", label: "Client Demand" },
    { key: "quantity_requested", label: "Quantity Requested" },
    { key: "vendor_provision", label: "Vendor Provision" },
    { key: "qc_checked", label: "QC Checked" },
    { key: "qc_passed", label: "QC Passed" },
    { key: "pending", label: "Pending" },
    { key: "qc_rejected", label: "QC Rejected" },
    { key: "barcode", label: "Barcode" },
    { key: "packed_size", label: "Packed Size" },
    { key: "finishing", label: "Finishing" },
    { key: "branding", label: "Branding" },
    { key: "cbm", label: "CBM" },
    { key: "labels", label: "Labels" },
    { key: "remarks", label: "Remarks" },
    { key: "request_history", label: "Request History" },
    { key: "inspection_record", label: "Inspection Record" },
  ]);

  const remarks = [
    changes.length > 0
      ? `Edited fields: ${changes.map((entry) => entry.field).join(", ")}.`
      : "No net changes detected in audited QC fields.",
    ...(Array.isArray(extraRemarks) ? extraRemarks : [])
      .map((entry) => normalizeText(entry))
      .filter(Boolean),
  ];

  if (changes.length === 0) {
    return;
  }

  try {
    await QcEditLog.create({
      edited_by:
        reqUser?._id && mongoose.Types.ObjectId.isValid(reqUser._id)
          ? reqUser._id
          : null,
      edited_by_name: normalizeText(
        reqUser?.name || reqUser?.username || reqUser?.email || "",
      ),
      qc: qcDoc?._id || null,
      order: qcDoc?.order?._id || qcDoc?.order || null,
      order_id: afterSnapshot?.order_id || beforeSnapshot?.order_id || "",
      brand: afterSnapshot?.brand || beforeSnapshot?.brand || "",
      vendor: afterSnapshot?.vendor || beforeSnapshot?.vendor || "",
      item_code: afterSnapshot?.item_code || beforeSnapshot?.item_code || "",
      operation_type: operationType,
      changed_fields_count: changes.length,
      changed_fields: changes.map((entry) => entry.field),
      changes,
      remarks,
    });
  } catch (error) {
    console.error("QC edit log save failed:", {
      qcId: qcDoc?._id,
      error: error?.message || String(error),
    });
  }
};

const buildOrderAuditSnapshotForQc = (orderDoc = {}) => ({
  order_id: normalizeText(orderDoc?.order_id),
  brand: normalizeText(orderDoc?.brand),
  vendor: normalizeText(orderDoc?.vendor),
  item_code: normalizeText(orderDoc?.item?.item_code),
  status: normalizeText(orderDoc?.status) || "Not Set",
  qc_record: normalizeText(orderDoc?.qc_record) || "Not Set",
});

const recalculateInspectorUsedLabels = async (inspectorIds = []) => {
  const normalizedInspectorIds = [...new Set(
    (Array.isArray(inspectorIds) ? inspectorIds : [])
      .map((value) => String(value || "").trim())
      .filter((value) => mongoose.Types.ObjectId.isValid(value)),
  )];

  for (const inspectorUserId of normalizedInspectorIds) {
    const inspectorDoc = await Inspector.findOne({ user: inspectorUserId });
    if (!inspectorDoc) continue;

    const labelUsageRecords = await Inspection.find({
      inspector: inspectorUserId,
    })
      .select("qc request_history_id inspection_date labels_added createdAt updatedAt")
      .populate("qc", "order_meta item request_date last_inspected_date")
      .lean();

    inspectorDoc.used_labels = normalizeLabels(
      labelUsageRecords.flatMap((entry) =>
        Array.isArray(entry?.labels_added) ? entry.labels_added : [],
      ),
    );
    inspectorDoc.label_used_history = labelUsageRecords
      .map((entry) => {
        const labels = normalizeLabels(entry?.labels_added || []);
        if (labels.length === 0) return null;
        const qcDoc = entry?.qc && typeof entry.qc === "object" ? entry.qc : null;

        return {
          labels,
          inspection_record: entry?._id,
          qc: qcDoc?._id || entry?.qc || null,
          request_history_id: entry?.request_history_id || null,
          qc_meta: {
            order_id: String(qcDoc?.order_meta?.order_id || ""),
            brand: String(qcDoc?.order_meta?.brand || ""),
            vendor: String(qcDoc?.order_meta?.vendor || ""),
            item_code: String(qcDoc?.item?.item_code || ""),
            description: String(qcDoc?.item?.description || ""),
          },
          inspection_date: String(entry?.inspection_date || ""),
          used_at: entry?.createdAt || new Date(),
          updated_at: entry?.updatedAt || entry?.createdAt || new Date(),
        };
      })
      .filter(Boolean)
      .sort(
        (left, right) =>
          new Date(right?.used_at || 0) - new Date(left?.used_at || 0),
      );
    await inspectorDoc.save();
  }
};

const refreshQcAggregateState = async (qcDoc, reqUser) => {
  if (!qcDoc?._id) return [];

  const refreshedInspections = await Inspection.find({ qc: qcDoc._id })
    .select(
      "inspection_date requested_date request_history_id inspector checked passed vendor_requested vendor_offered labels_added label_ranges goods_not_ready status createdAt",
    )
    .lean();

  const mergedLabels = normalizeLabels(
    refreshedInspections.flatMap((record) =>
      Array.isArray(record?.labels_added) ? record.labels_added : [],
    ),
  );

  recalculateQcAggregateQuantities(qcDoc, refreshedInspections);
  qcDoc.labels = mergedLabels;
  syncQcRequestHistoryStatuses(qcDoc, refreshedInspections, {
    user: reqUser,
  });
  syncQcCurrentRequestFieldsFromHistory(qcDoc, refreshedInspections);

  if (refreshedInspections.length > 0) {
    const latestRecord = [...refreshedInspections].sort((a, b) => {
      const aTime = Math.max(
        toSortableTimestamp(a?.inspection_date),
        toSortableTimestamp(a?.createdAt),
      );
      const bTime = Math.max(
        toSortableTimestamp(b?.inspection_date),
        toSortableTimestamp(b?.createdAt),
      );
      return bTime - aTime;
    })[0];

    qcDoc.last_inspected_date = String(
      latestRecord?.inspection_date ||
        toDateInputValue(latestRecord?.createdAt) ||
        qcDoc.request_date ||
        qcDoc.last_inspected_date ||
        "",
    );
  } else {
    qcDoc.last_inspected_date = String(
      qcDoc.request_date || qcDoc.last_inspected_date || "",
    );
  }

  qcDoc.updated_by = buildAuditActor(reqUser);
  await qcDoc.save();

  return refreshedInspections;
};

const createOrderEditLogFromQc = async ({
  reqUser = null,
  orderDoc = null,
  beforeSnapshot = {},
  afterSnapshot = {},
  extraRemarks = [],
} = {}) => {
  const changes = buildAuditChanges(beforeSnapshot, afterSnapshot, [
    { key: "status", label: "Status" },
    { key: "qc_record", label: "QC Record" },
  ]);

  if (changes.length === 0) {
    return;
  }

  const remarks = [
    changes.length > 0
      ? `Edited fields: ${changes.map((entry) => entry.field).join(", ")}.`
      : "No net changes detected in audited order fields.",
    ...(Array.isArray(extraRemarks) ? extraRemarks : [])
      .map((entry) => normalizeText(entry))
      .filter(Boolean),
  ];

  try {
    await OrderEditLog.create({
      edited_by:
        reqUser?._id && mongoose.Types.ObjectId.isValid(reqUser._id)
          ? reqUser._id
          : null,
      edited_by_name: normalizeText(
        reqUser?.name || reqUser?.username || reqUser?.email || "",
      ),
      order_id: afterSnapshot?.order_id || beforeSnapshot?.order_id || "UNKNOWN",
      brand: afterSnapshot?.brand || beforeSnapshot?.brand || "",
      vendor: afterSnapshot?.vendor || beforeSnapshot?.vendor || "",
      item_code: afterSnapshot?.item_code || beforeSnapshot?.item_code || "",
      operation_type: "order_edit",
      changed_fields_count: changes.length,
      changed_fields: changes.map((entry) => entry.field),
      changes,
      remarks,
    });
  } catch (error) {
    console.error("Order edit log save failed from QC flow:", {
      orderId: afterSnapshot?.order_id || beforeSnapshot?.order_id,
      error: error?.message || String(error),
    });
  }
};

const formatLbh = (dimensions = {}) => {
  const L = toNonNegativeNumber(dimensions?.L, 0);
  const B = toNonNegativeNumber(dimensions?.B, 0);
  const H = toNonNegativeNumber(dimensions?.H, 0);
  if (L === 0 && B === 0 && H === 0) return "";
  return `${L} x ${B} x ${H}`;
};

const calculateCbmFromLbh = (dimensions = {}) => {
  const L = toNonNegativeNumber(dimensions?.L, 0);
  const B = toNonNegativeNumber(dimensions?.B, 0);
  const H = toNonNegativeNumber(dimensions?.H, 0);
  if (L <= 0 || B <= 0 || H <= 0) return "0";

  const cubicMeters = (L * B * H) / 1000000;
  return toNormalizedCbmString(cubicMeters);
};

const hasCompletePositiveLbh = (dimensions = {}) => {
  const L = toNonNegativeNumber(dimensions?.L, 0);
  const B = toNonNegativeNumber(dimensions?.B, 0);
  const H = toNonNegativeNumber(dimensions?.H, 0);
  return L > 0 && B > 0 && H > 0;
};

const normalizeStoredSizeEntries = (entries = [], { weightKey = "" } = {}) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const L = toNonNegativeNumber(entry?.L, 0);
      const B = toNonNegativeNumber(entry?.B, 0);
      const H = toNonNegativeNumber(entry?.H, 0);
      const weightValue = weightKey
        ? toNonNegativeNumber(entry?.[weightKey], 0)
        : 0;
      const remark = normalizeText(entry?.remark || entry?.type || "").toLowerCase();
      return {
        L,
        B,
        H,
        remark,
        ...(weightKey ? { [weightKey]: weightValue } : {}),
      };
    })
    .filter((entry) => hasCompletePositiveLbh(entry))
    .slice(0, SIZE_ENTRY_LIMIT);

const buildSizeEntriesFromLegacy = ({
  sizes = [],
  singleLbh = null,
  topLbh = null,
  bottomLbh = null,
  totalWeight = 0,
  topWeight = 0,
  bottomWeight = 0,
  weightKey = "",
  topRemark = "top",
  bottomRemark = "base",
} = {}) => {
  const normalizedSizes = normalizeStoredSizeEntries(sizes, { weightKey });
  if (normalizedSizes.length > 0) {
    return normalizedSizes;
  }

  const legacyEntries = [];
  if (hasCompletePositiveLbh(topLbh)) {
    legacyEntries.push({
      ...topLbh,
      remark: topRemark,
      ...(weightKey ? { [weightKey]: toNonNegativeNumber(topWeight, 0) } : {}),
    });
  }
  if (hasCompletePositiveLbh(bottomLbh)) {
    legacyEntries.push({
      ...bottomLbh,
      remark: bottomRemark,
      ...(weightKey ? { [weightKey]: toNonNegativeNumber(bottomWeight, 0) } : {}),
    });
  }
  if (legacyEntries.length > 0) {
    return legacyEntries.slice(0, SIZE_ENTRY_LIMIT);
  }

  if (!hasCompletePositiveLbh(singleLbh)) {
    return [];
  }

  return [
    {
      ...singleLbh,
      remark: "",
      ...(weightKey ? { [weightKey]: toNonNegativeNumber(totalWeight, 0) } : {}),
    },
  ];
};

const sortSizeEntriesByRemark = (entries = [], remarkOptions = []) =>
  [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftIndex = remarkOptions.indexOf(
      normalizeText(left?.remark).toLowerCase(),
    );
    const rightIndex = remarkOptions.indexOf(
      normalizeText(right?.remark).toLowerCase(),
    );
    const safeLeftIndex = leftIndex >= 0 ? leftIndex : SIZE_ENTRY_LIMIT + 1;
    const safeRightIndex = rightIndex >= 0 ? rightIndex : SIZE_ENTRY_LIMIT + 1;
    return safeLeftIndex - safeRightIndex;
  });

const calculateSizeEntriesCbmTotal = (entries = []) =>
  normalizeStoredSizeEntries(entries).reduce(
    (sum, entry) => sum + toPositiveCbmNumber(calculateCbmFromLbh(entry)),
    0,
  );

const sumSizeEntriesWeight = (entries = [], weightKey = "") =>
  normalizeStoredSizeEntries(entries, { weightKey }).reduce(
    (sum, entry) => sum + toNonNegativeNumber(entry?.[weightKey], 0),
    0,
  );

const getPrimaryLbhFromSizeEntries = (entries = [], fallback = {}) => {
  const normalizedEntries = normalizeStoredSizeEntries(entries);
  if (normalizedEntries.length > 0) {
    const firstEntry = normalizedEntries[0];
    return {
      L: firstEntry.L,
      B: firstEntry.B,
      H: firstEntry.H,
    };
  }
  return fallback || {};
};

const normalizeItemCodeKey = (value) => normalizeText(value).toLowerCase();
const getItemInspectedCbmTotal = (itemDoc = {}) =>
  normalizeText(
    itemDoc?.cbm?.calculated_inspected_total ??
      itemDoc?.cbm?.inspected_total ??
      itemDoc?.cbm?.calculated_total ??
      itemDoc?.cbm?.qc_total ??
      itemDoc?.cbm?.total ??
      "",
  );
const getItemWeightNet = (itemDoc = {}) =>
  toNonNegativeNumber(
    sumSizeEntriesWeight(itemDoc?.inspected_item_sizes, "net_weight") ||
      sumSizeEntriesWeight(itemDoc?.pis_item_sizes, "net_weight") ||
      getWeightFieldValue(itemDoc?.inspected_weight, "total_net", NaN) ||
      getWeightFieldValue(itemDoc?.pis_weight, "total_net", NaN) ||
      itemDoc?.weight?.net,
    0,
  );
const getItemWeightGross = (itemDoc = {}) =>
  toNonNegativeNumber(
    sumSizeEntriesWeight(itemDoc?.inspected_box_sizes, "gross_weight") ||
      sumSizeEntriesWeight(itemDoc?.pis_box_sizes, "gross_weight") ||
      getWeightFieldValue(itemDoc?.inspected_weight, "total_gross", NaN) ||
      getWeightFieldValue(itemDoc?.pis_weight, "total_gross", NaN) ||
      itemDoc?.weight?.gross,
    0,
  );
const getItemItemLbh = (itemDoc = {}) =>
  getPrimaryLbhFromSizeEntries(
    itemDoc?.inspected_item_sizes || itemDoc?.pis_item_sizes,
    itemDoc?.inspected_item_LBH ||
      itemDoc?.pis_item_LBH ||
      itemDoc?.item_LBH ||
      {},
  );
const getItemBoxLbh = (itemDoc = {}) =>
  detectBoxPackagingMode(itemDoc?.inspected_box_mode, itemDoc?.inspected_box_sizes) ===
  BOX_PACKAGING_MODES.CARTON
    ? itemDoc?.inspected_box_LBH || itemDoc?.pis_box_LBH || itemDoc?.box_LBH || {}
    : getPrimaryLbhFromSizeEntries(
        itemDoc?.inspected_box_sizes || itemDoc?.pis_box_sizes,
        itemDoc?.inspected_box_LBH || itemDoc?.pis_box_LBH || itemDoc?.box_LBH || {},
      );

const buildSignedItemFile = async (file = {}, { logLabel = "Item file" } = {}) => {
  const key = normalizeText(file?.key || file?.public_id || "");
  const originalName = normalizeText(file?.originalName || "");
  const contentType = normalizeText(file?.contentType || "");
  const size = toNonNegativeNumber(file?.size, 0);
  const legacyUrl = normalizeText(file?.url || file?.link || "");

  if (key) {
    try {
      return {
        key,
        originalName,
        contentType,
        size,
        url: await getSignedObjectUrl(key, {
          expiresIn: 24 * 60 * 60,
          filename: originalName,
        }),
      };
    } catch (error) {
      console.error(`${logLabel} signed URL generation failed:`, {
        key,
        error: error?.message || String(error),
      });
    }
  }

  if (legacyUrl) {
    return {
      key: "",
      originalName,
      contentType,
      size,
      url: legacyUrl,
    };
  }

  return null;
};

const buildSignedItemImage = async (image = {}) =>
  buildSignedItemFile(image, { logLabel: "Item image" });

const buildSignedQcImage = async (image = {}) =>
  buildSignedItemFile(image, { logLabel: "QC image" });

const buildFinishImagePublicUrl = (finishEntry = {}) => {
  const uniqueCode = String(finishEntry?.unique_code || "").trim().toUpperCase();
  if (!uniqueCode) return null;
  
  return {
    key: "",
    originalName: "",
    contentType: "",
    size: 0,
    url: `/finishes/public/image?unique_code=${encodeURIComponent(uniqueCode)}`,
  };
};

const recalculateQcAggregateQuantities = (qcDoc, inspectionRecords = []) => {
  if (!qcDoc?.quantities) return;

  const {
    totalChecked,
    totalVendorOffered,
    totalSamplePassed,
    totalEffectivePassed,
  } = calculateQcAggregateMetrics(qcDoc, inspectionRecords);
  const clientDemandQty = toNonNegativeNumber(qcDoc?.quantities?.client_demand, 0);

  qcDoc.quantities.qc_checked = totalChecked;
  qcDoc.quantities.qc_passed = totalEffectivePassed;
  qcDoc.quantities.vendor_provision = totalVendorOffered;
  qcDoc.quantities.pending = Math.max(0, clientDemandQty - totalEffectivePassed);
  qcDoc.quantities.qc_rejected = Math.max(0, totalChecked - totalSamplePassed);
};

const toPositiveCbmNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric;
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

const buildNormalizedCbmSnapshot = (value = {}) => {
  const box1 = toPositiveCbmNumber(value?.box1 ?? value?.top);
  const box2 = toPositiveCbmNumber(value?.box2 ?? value?.bottom);
  const box3 = toPositiveCbmNumber(value?.box3);
  const totalFromBoxes = box1 + box2 + box3;
  const explicitTotal = toPositiveCbmNumber(value?.total);
  const total =
    explicitTotal > 0
      ? explicitTotal
      : totalFromBoxes > 0
      ? totalFromBoxes
      : toPositiveCbmNumber(value?.total);

  return {
    box1: toNormalizedCbmString(box1),
    box2: toNormalizedCbmString(box2),
    box3: toNormalizedCbmString(box3),
    total: toNormalizedCbmString(total),
  };
};

const buildSingleBoxCbmSnapshot = (total = 0) => {
  const normalizedTotal = toPositiveCbmNumber(total);
  return buildNormalizedCbmSnapshot({
    box1: normalizedTotal,
    box2: 0,
    box3: 0,
    total: normalizedTotal,
  });
};

const getNormalizedCbmTotalNumber = (value = {}) =>
  toPositiveCbmNumber(buildNormalizedCbmSnapshot(value).total);

const hasExplicitCbmBoxInput = (value = {}) =>
  value?.box1 !== undefined ||
  value?.box2 !== undefined ||
  value?.box3 !== undefined ||
  value?.top !== undefined ||
  value?.bottom !== undefined;

const buildCbmSnapshotFromBoxSizeSource = ({
  sizes = [],
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  singleLbh = null,
  topLbh = null,
  bottomLbh = null,
} = {}) => {
  const summary = buildBoxMeasurementCbmSummary({
    sizes,
    mode,
    singleLbh,
    topLbh,
    bottomLbh,
  });
  return buildNormalizedCbmSnapshot({
    box1: summary.first,
    box2: summary.second,
    box3: summary.third,
    total: summary.total,
  });
};

const buildItemInspectedBoxCbmSnapshot = (itemDoc = null) =>
  buildCbmSnapshotFromBoxSizeSource({
    sizes: itemDoc?.inspected_box_sizes,
    mode: detectBoxPackagingMode(
      itemDoc?.inspected_box_mode,
      itemDoc?.inspected_box_sizes,
    ),
    singleLbh: itemDoc?.inspected_box_LBH || itemDoc?.box_LBH,
    topLbh: itemDoc?.inspected_box_top_LBH || itemDoc?.inspected_top_LBH,
    bottomLbh:
      itemDoc?.inspected_box_bottom_LBH || itemDoc?.inspected_bottom_LBH,
  });

const resolveItemInspectedCbmPerUnit = (itemDoc = null) => {
  return getNormalizedCbmTotalNumber(buildItemInspectedBoxCbmSnapshot(itemDoc));
};

const resolveItemStoredCbmPerUnit = (itemDoc = null) =>
  [
    itemDoc?.cbm?.calculated_inspected_total,
    itemDoc?.cbm?.inspected_total,
    itemDoc?.cbm?.calculated_total,
    itemDoc?.cbm?.qc_total,
    itemDoc?.cbm?.total,
  ]
    .map((value) => toPositiveCbmNumber(value))
    .find((value) => value > 0) || 0;

const resolveWeeklySummaryCbmPerUnit = (itemDoc = null, qcDoc = null) => {
  const sizeDerivedCbm = resolveItemInspectedCbmPerUnit(itemDoc);
  if (sizeDerivedCbm > 0) {
    return sizeDerivedCbm;
  }

  const qcCbmTotal = getNormalizedCbmTotalNumber(qcDoc?.cbm);
  if (qcCbmTotal > 0) {
    return qcCbmTotal;
  }

  return resolveItemStoredCbmPerUnit(itemDoc);
};

const resolveItemReportCbmPerUnit = (
  itemDoc = null,
  inspection = null,
  { allowPlainInspectionFallback = true } = {},
) => {
  const inspectedStoredCbm = [
    itemDoc?.cbm?.calculated_inspected_total,
    itemDoc?.cbm?.inspected_total,
  ]
    .map((value) => toPositiveCbmNumber(value))
    .find((value) => value > 0);
  if (inspectedStoredCbm) {
    return inspectedStoredCbm;
  }

  const pisTopCbm = toPositiveCbmNumber(itemDoc?.cbm?.top);
  const pisBottomCbm = toPositiveCbmNumber(itemDoc?.cbm?.bottom);
  if (pisTopCbm > 0 && pisBottomCbm > 0) {
    return pisTopCbm + pisBottomCbm;
  }

  const pisStoredCbm = [
    itemDoc?.cbm?.calculated_pis_total,
    itemDoc?.cbm?.total,
  ]
    .map((value) => toPositiveCbmNumber(value))
    .find((value) => value > 0);
  if (pisStoredCbm) {
    return pisStoredCbm;
  }

  const inspectedSizeEntriesCbm =
    calculateSizeEntriesCbmTotal(itemDoc?.inspected_box_sizes) ||
    calculateSizeEntriesCbmTotal(itemDoc?.inspected_item_sizes);
  if (inspectedSizeEntriesCbm > 0) {
    return inspectedSizeEntriesCbm;
  }

  const pisSizeEntriesCbm =
    calculateSizeEntriesCbmTotal(itemDoc?.pis_box_sizes) ||
    calculateSizeEntriesCbmTotal(itemDoc?.pis_item_sizes);
  if (pisSizeEntriesCbm > 0) {
    return pisSizeEntriesCbm;
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
    singleLbh: itemDoc?.inspected_box_LBH || itemDoc?.inspected_item_LBH,
  });
  if (inspectedLbhCbm > 0) {
    return inspectedLbhCbm;
  }

  const pisLbhCbm = resolveSplitOrSingleLbhCbmTotal({
    topLbh: itemDoc?.pis_box_top_LBH || itemDoc?.pis_item_top_LBH,
    bottomLbh: itemDoc?.pis_box_bottom_LBH || itemDoc?.pis_item_bottom_LBH,
    singleLbh: itemDoc?.pis_box_LBH || itemDoc?.pis_item_LBH,
  });
  if (pisLbhCbm > 0) {
    return pisLbhCbm;
  }

  if (!allowPlainInspectionFallback) {
    return 0;
  }

  return getNormalizedCbmTotalNumber(inspection?.cbm);
};

const hasMeaningfulItemQcDetails = (itemDoc) => {
  if (!itemDoc || typeof itemDoc !== "object") return false;

  const itemDescription = normalizeText(
    itemDoc?.description || itemDoc?.name || "",
  );
  const cbmTotal = getItemInspectedCbmTotal(itemDoc);
  const itemQc = itemDoc?.qc || {};
  const barcode = Number(itemQc?.master_barcode || itemQc?.barcode || 0);
  const innerBarcode = Number(itemQc?.inner_barcode || 0);
  const lastInspectedDate = normalizeText(itemQc?.last_inspected_date || "");

  return Boolean(
    itemDescription ||
    (cbmTotal && cbmTotal !== "0") ||
    barcode > 0 ||
    innerBarcode > 0 ||
    itemQc?.packed_size === true ||
    itemQc?.finishing === true ||
    itemQc?.branding === true ||
    lastInspectedDate,
  );
};

const buildQcItemDetailsPatch = ({
  qcSnapshot,
  itemDoc,
  onlyUpdatedItems = true,
} = {}) => {
  if (!qcSnapshot || !itemDoc) {
    return { set: null, reason: "missing_qc_or_item" };
  }

  if (onlyUpdatedItems && !hasMeaningfulItemQcDetails(itemDoc)) {
    return { set: null, reason: "item_details_not_updated" };
  }

  const set = {};
  const itemDescription = normalizeText(
    itemDoc?.description || itemDoc?.name || "",
  );
  const itemCode = normalizeText(
    itemDoc?.code || qcSnapshot?.item?.item_code || "",
  );
  const cbmTotal = getItemInspectedCbmTotal(itemDoc);
  const itemQc = itemDoc?.qc || {};
  const barcode = Math.max(0, Number(itemQc?.master_barcode || itemQc?.barcode || 0));
  const innerBarcode = Math.max(0, Number(itemQc?.inner_barcode || 0));
  const lastInspectedDate = normalizeText(itemQc?.last_inspected_date || "");

  if (
    itemDescription &&
    normalizeText(qcSnapshot?.item?.description) !== itemDescription
  ) {
    set["item.description"] = itemDescription;
  }

  if (itemCode && normalizeText(qcSnapshot?.item?.item_code) !== itemCode) {
    set["item.item_code"] = itemCode;
  }

  if (
    cbmTotal &&
    cbmTotal !== "0" &&
    normalizeText(qcSnapshot?.cbm?.total) !== cbmTotal
  ) {
    set["cbm.total"] = cbmTotal;
  }

  if (barcode > 0 && Number(qcSnapshot?.barcode || 0) !== barcode) {
    set.barcode = barcode;
  }
  if (barcode > 0 && Number(qcSnapshot?.master_barcode || 0) !== barcode) {
    set.master_barcode = barcode;
  }
  if (innerBarcode > 0 && Number(qcSnapshot?.inner_barcode || 0) !== innerBarcode) {
    set.inner_barcode = innerBarcode;
  }

  if (itemQc?.packed_size === true && qcSnapshot?.packed_size !== true) {
    set.packed_size = true;
  }

  if (itemQc?.finishing === true && qcSnapshot?.finishing !== true) {
    set.finishing = true;
  }

  if (itemQc?.branding === true && qcSnapshot?.branding !== true) {
    set.branding = true;
  }

  if (
    lastInspectedDate &&
    normalizeText(qcSnapshot?.last_inspected_date) !== lastInspectedDate
  ) {
    set.last_inspected_date = lastInspectedDate;
  }

  if (Object.keys(set).length === 0) {
    return { set: null, reason: "no_changes" };
  }

  return { set, reason: "updated" };
};

const applyQcItemDetailsPatch = (qcDoc, patch = {}) => {
  if (
    !qcDoc ||
    typeof qcDoc.set !== "function" ||
    !patch ||
    typeof patch !== "object"
  ) {
    return;
  }

  for (const [path, value] of Object.entries(patch)) {
    qcDoc.set(path, value);
  }
};

const resolveLatestRequestEntry = (requestHistory = []) => {
  if (!Array.isArray(requestHistory) || requestHistory.length === 0)
    return null;
  return requestHistory[requestHistory.length - 1] || null;
};

const resolveLatestInspectionRecordForRequestEntry = (
  inspectionRecords = [],
  requestEntry = null,
) => {
  if (!requestEntry) return null;

  const requestHistoryId = String(
    requestEntry?._id ||
      requestEntry?.request_history_id ||
      requestEntry?.id ||
      "",
  ).trim();
  const requestDateKey = toISODateString(
    requestEntry?.request_date || requestEntry?.requested_date,
  );
  const requestInspectorId = String(
    requestEntry?.inspector?._id ||
      requestEntry?.inspector ||
      requestEntry?.inspector_id ||
      "",
  ).trim();
  const canUseDateFallbackRecord = (record = {}) => {
    const linkedRequestHistoryId = String(record?.request_history_id || "").trim();
    if (!requestHistoryId || !linkedRequestHistoryId) return true;
    if (linkedRequestHistoryId === requestHistoryId) return true;
    if (
      isInspectionStatusMatching(
        record?.status,
        INSPECTION_RECORD_STATUS.TRANSFERRED,
      )
    ) {
      return false;
    }
    return toNonNegativeNumber(record?.checked, 0) <= 0;
  };

  const findLatestMatchingRecord = (matcher) => {
    let latestRecord = null;
    let latestTimestamp = 0;

    for (const record of Array.isArray(inspectionRecords) ? inspectionRecords : []) {
      if (!matcher(record)) continue;

      const recordTimestamp = Math.max(
        toSortableTimestamp(record?.inspection_date),
        toSortableTimestamp(record?.requested_date),
        toSortableTimestamp(record?.createdAt),
      );
      if (!latestRecord || recordTimestamp >= latestTimestamp) {
        latestRecord = record;
        latestTimestamp = recordTimestamp;
      }
    }

    return latestRecord;
  };

  const candidateRecords = [];

  if (requestHistoryId) {
    const exactRequestHistoryMatch = findLatestMatchingRecord(
      (record) =>
        String(record?.request_history_id || "").trim() === requestHistoryId,
    );
    if (exactRequestHistoryMatch) {
      return exactRequestHistoryMatch;
    }
  }

  if (requestDateKey) {
    candidateRecords.push(
      findLatestMatchingRecord((record) => {
        if (!canUseDateFallbackRecord(record)) return false;

        const recordRequestedDate = toISODateString(
          record?.requested_date || record?.inspection_date || record?.createdAt,
        );
        if (recordRequestedDate !== requestDateKey) return false;

        if (!requestInspectorId) return true;

        const recordInspectorId = String(
          record?.inspector?._id || record?.inspector || "",
        ).trim();
        return !recordInspectorId || recordInspectorId === requestInspectorId;
      }),
    );
    candidateRecords.push(
      findLatestMatchingRecord((record) => {
        if (!canUseDateFallbackRecord(record)) return false;

        const recordRequestedDate = toISODateString(
          record?.requested_date || record?.inspection_date || record?.createdAt,
        );
        return recordRequestedDate === requestDateKey;
      }),
    );
  }

  let latestRecord = null;
  let latestTimestamp = 0;
  for (const candidate of candidateRecords) {
    if (!candidate) continue;

    const candidateTimestamp = Math.max(
      toSortableTimestamp(candidate?.inspection_date),
      toSortableTimestamp(candidate?.requested_date),
      toSortableTimestamp(candidate?.createdAt),
    );
    if (!latestRecord || candidateTimestamp >= latestTimestamp) {
      latestRecord = candidate;
      latestTimestamp = candidateTimestamp;
    }
  }

  return latestRecord;
};

const resolveRequestedQuantityFromQc = (qcDoc = {}) => {
  const requestHistory = Array.isArray(qcDoc?.request_history)
    ? qcDoc.request_history
    : [];
  const latestRequestEntry = resolveLatestRequestEntry(requestHistory);
  const latestRequestedQuantity = Number(latestRequestEntry?.quantity_requested);
  if (Number.isFinite(latestRequestedQuantity) && latestRequestedQuantity > 0) {
    return latestRequestedQuantity;
  }

  const storedRequestedQuantity = Number(qcDoc?.quantities?.quantity_requested);
  if (Number.isFinite(storedRequestedQuantity) && storedRequestedQuantity > 0) {
    return storedRequestedQuantity;
  }

  for (let index = requestHistory.length - 1; index >= 0; index -= 1) {
    const historicalQuantity = Number(requestHistory[index]?.quantity_requested);
    if (Number.isFinite(historicalQuantity) && historicalQuantity > 0) {
      return historicalQuantity;
    }
  }

  if (Number.isFinite(latestRequestedQuantity) && latestRequestedQuantity >= 0) {
    return latestRequestedQuantity;
  }

  if (Number.isFinite(storedRequestedQuantity) && storedRequestedQuantity >= 0) {
    return storedRequestedQuantity;
  }

  const clientDemandQuantity = Number(qcDoc?.quantities?.client_demand);
  if (Number.isFinite(clientDemandQuantity) && clientDemandQuantity > 0) {
    return clientDemandQuantity;
  }

  return 0;
};

const getInspectionRecordsForRequestEntry = (
  inspectionRecords = [],
  requestEntry = null,
) => {
  if (!requestEntry) return [];

  const records = Array.isArray(inspectionRecords) ? inspectionRecords : [];
  const requestHistoryId = String(
    requestEntry?._id ||
      requestEntry?.request_history_id ||
      requestEntry?.id ||
      "",
  ).trim();
  const requestDateKey = toISODateString(
    requestEntry?.request_date || requestEntry?.requested_date,
  );
  const requestInspectorId = String(
    requestEntry?.inspector?._id ||
      requestEntry?.inspector ||
      requestEntry?.inspector_id ||
      "",
  ).trim();

  if (requestHistoryId) {
    const exactMatches = records.filter(
      (record) => String(record?.request_history_id || "").trim() === requestHistoryId,
    );
    if (exactMatches.length > 0) return exactMatches;
  }

  if (!requestDateKey) return [];

  return records.filter((record) => {
    const linkedRequestHistoryId = String(record?.request_history_id || "").trim();
    if (requestHistoryId && linkedRequestHistoryId && linkedRequestHistoryId !== requestHistoryId) {
      return false;
    }

    const recordRequestedDate = toISODateString(
      record?.requested_date || record?.inspection_date || record?.createdAt,
    );
    if (recordRequestedDate !== requestDateKey) return false;

    if (!requestInspectorId) return true;

    const recordInspectorId = String(
      record?.inspector?._id || record?.inspector || "",
    ).trim();
    return !recordInspectorId || recordInspectorId === requestInspectorId;
  });
};

const resolveLatestInspectionRecordFromList = (inspectionRecords = []) => {
  let latestRecord = null;
  let latestTimestamp = 0;

  for (const record of Array.isArray(inspectionRecords) ? inspectionRecords : []) {
    const recordTimestamp = Math.max(
      toSortableTimestamp(record?.inspection_date),
      toSortableTimestamp(record?.requested_date),
      toSortableTimestamp(record?.createdAt),
      toSortableTimestamp(record?.updatedAt),
    );
    if (!latestRecord || recordTimestamp >= latestTimestamp) {
      latestRecord = record;
      latestTimestamp = recordTimestamp;
    }
  }

  return latestRecord;
};

const getQcUserLatestRequestAvailability = (
  qcDoc = {},
  inspectionRecords = [],
  { currentUserId = "", inspectionDate = "" } = {},
) => {
  const qcUserPastDaysLimit = getUpdateQcPastDaysLimit("qc", currentUserId);
  const latestRequestEntry = resolveLatestRequestEntry(qcDoc?.request_history || []);
  if (!latestRequestEntry) {
    return {
      isAvailable: false,
      latestRequestEntry: null,
      latestInspectionRecord: null,
      reason: "A new QC request is required before QC can update this record.",
    };
  }

  const requestDateIso = toISODateString(
    latestRequestEntry?.request_date || qcDoc?.request_date || "",
  );
  if (!requestDateIso) {
    return {
      isAvailable: false,
      latestRequestEntry,
      latestInspectionRecord: null,
      reason: "QC request date is invalid.",
    };
  }

  if (!isIsoDateWithinPastDaysInclusive(requestDateIso, qcUserPastDaysLimit)) {
    return {
      isAvailable: false,
      latestRequestEntry,
      latestInspectionRecord: null,
      reason: buildQcUserUpdateDateMessage(qcUserPastDaysLimit),
    };
  }

  const submittedInspectionDateIso = toISODateString(inspectionDate);
  if (
    inspectionDate &&
    (!submittedInspectionDateIso ||
      !isIsoDateWithinPastDaysInclusive(
        submittedInspectionDateIso,
        qcUserPastDaysLimit,
      ))
  ) {
    return {
      isAvailable: false,
      latestRequestEntry,
      latestInspectionRecord: null,
      reason: buildQcUserUpdateDateMessage(qcUserPastDaysLimit),
    };
  }

  const requestInspectorId = String(
    latestRequestEntry?.inspector?._id ||
      latestRequestEntry?.inspector ||
      qcDoc?.inspector?._id ||
      qcDoc?.inspector ||
      "",
  ).trim();
  const normalizedCurrentUserId = String(currentUserId || "").trim();
  if (!normalizedCurrentUserId) {
    return {
      isAvailable: false,
      latestRequestEntry,
      latestInspectionRecord: null,
      reason: "Unauthorized",
      statusCode: 401,
    };
  }

  if (!requestInspectorId || requestInspectorId !== normalizedCurrentUserId) {
    return {
      isAvailable: false,
      latestRequestEntry,
      latestInspectionRecord: null,
      reason: "Only the inspector assigned to this QC request can update it.",
    };
  }

  const latestRequestStatus = normalizeRequestHistoryStatus(
    latestRequestEntry?.status || REQUEST_HISTORY_STATUS.OPEN,
  );
  if (latestRequestStatus !== REQUEST_HISTORY_STATUS.OPEN) {
    return {
      isAvailable: false,
      latestRequestEntry,
      latestInspectionRecord: null,
      reason: "This QC request is already closed and cannot be updated again.",
    };
  }

  const requestInspectionRecords = getInspectionRecordsForRequestEntry(
    inspectionRecords,
    latestRequestEntry,
  );
  const latestInspectionRecord =
    resolveLatestInspectionRecordFromList(requestInspectionRecords);
  const latestRequestHasActivity = requestInspectionRecords.some((record) =>
    hasInspectionRecordActivity({
      checked: record?.checked,
      passed: record?.passed,
      vendorOffered: record?.vendor_offered,
      labelsAdded: record?.labels_added,
      labelRanges: record?.label_ranges,
      goodsNotReady: record?.goods_not_ready,
      status: record?.status,
    }),
  );

  if (latestRequestHasActivity) {
    return {
      isAvailable: false,
      latestRequestEntry,
      latestInspectionRecord,
      reason:
        "This QC request has already been inspected and cannot be updated again.",
    };
  }

  return {
    isAvailable: true,
    latestRequestEntry,
    latestInspectionRecord,
    reason: "",
  };
};

const syncQcCurrentRequestFieldsFromHistory = (
  qcDoc,
  inspectionRecords = [],
) => {
  if (!qcDoc) return false;

  let latestRequestEntry = resolveLatestRequestEntry(qcDoc?.request_history || []);

  if (!latestRequestEntry) {
    const latestInspection = [...(Array.isArray(inspectionRecords) ? inspectionRecords : [])]
      .sort((left, right) => {
        const leftTime = Math.max(
          toSortableTimestamp(left?.requested_date),
          toSortableTimestamp(left?.inspection_date),
          toSortableTimestamp(left?.createdAt),
        );
        const rightTime = Math.max(
          toSortableTimestamp(right?.requested_date),
          toSortableTimestamp(right?.inspection_date),
          toSortableTimestamp(right?.createdAt),
        );
        return rightTime - leftTime;
      })[0];

    if (!latestInspection) return false;

    latestRequestEntry = {
      request_date:
        latestInspection?.requested_date ||
        latestInspection?.inspection_date ||
        qcDoc?.request_date ||
        "",
      request_type: qcDoc?.request_type || QC_REQUEST_TYPES.FULL,
      quantity_requested:
        latestInspection?.vendor_requested ??
        qcDoc?.quantities?.quantity_requested ??
        0,
      inspector: latestInspection?.inspector || qcDoc?.inspector || null,
      remarks: qcDoc?.remarks || "",
    };
  }

  let hasChanges = false;
  const nextRequestDate = normalizeText(
    latestRequestEntry?.request_date || qcDoc?.request_date || "",
  );
  if (nextRequestDate && String(qcDoc?.request_date || "") !== nextRequestDate) {
    qcDoc.request_date = nextRequestDate;
    hasChanges = true;
  }

  const nextRequestType = normalizeQcRequestType(
    latestRequestEntry?.request_type || qcDoc?.request_type,
  );
  if (String(qcDoc?.request_type || "") !== nextRequestType) {
    qcDoc.request_type = nextRequestType;
    hasChanges = true;
  }

  const currentInspectorId = String(
    qcDoc?.inspector?._id || qcDoc?.inspector || "",
  ).trim();
  const nextInspectorId = String(
    latestRequestEntry?.inspector?._id || latestRequestEntry?.inspector || "",
  ).trim();
  if (nextInspectorId !== currentInspectorId) {
    qcDoc.inspector = nextInspectorId || null;
    hasChanges = true;
  }

  const currentRequestedQty = toNonNegativeNumber(
    qcDoc?.quantities?.quantity_requested,
    0,
  );
  const nextRequestedQty = toNonNegativeNumber(
    latestRequestEntry?.quantity_requested,
    currentRequestedQty,
  );
  if (currentRequestedQty !== nextRequestedQty && qcDoc?.quantities) {
    qcDoc.quantities.quantity_requested = nextRequestedQty;
    hasChanges = true;
  }

  const nextRemarks = String(latestRequestEntry?.remarks || "");
  if (String(qcDoc?.remarks || "") !== nextRemarks) {
    qcDoc.remarks = nextRemarks;
    hasChanges = true;
  }

  return hasChanges;
};

const upsertInspectionRecordForRequest = async ({
  qcDoc,
  inspectorId,
  requestDate,
  requestHistoryId = null,
  requestedQuantity = 0,
  inspectionDate = "",
  remarks = "",
  createdBy,
  auditUser = null,
  addChecked = 0,
  addPassed = 0,
  addProvision = 0,
  appendLabelRanges = [],
  appendLabels = [],
  replaceCbmSnapshot = false,
  allowRequestedDateFallback = true,
  goodsNotReady = null,
  explicitStatus = "",
}) => {
  if (!qcDoc?._id) return null;

  const resolvedInspectorId = String(inspectorId || "").trim();
  const resolvedRequestDate = String(requestDate || "").trim();
  const resolvedInspectionDate = String(
    inspectionDate || resolvedRequestDate,
  ).trim();

  if (
    !resolvedInspectorId ||
    !resolvedRequestDate ||
    !resolvedInspectionDate ||
    !createdBy
  ) {
    return null;
  }

  let inspectionRecord = null;
  if (requestHistoryId && mongoose.Types.ObjectId.isValid(requestHistoryId)) {
    inspectionRecord = await Inspection.findOne({
      qc: qcDoc._id,
      request_history_id: requestHistoryId,
    }).sort({ createdAt: -1 });
  }

  if (!inspectionRecord && allowRequestedDateFallback) {
    inspectionRecord = await Inspection.findOne({
      qc: qcDoc._id,
      requested_date: resolvedRequestDate,
    }).sort({ createdAt: -1 });
  }

  const requestedQty = toNonNegativeNumber(requestedQuantity, 0);
  const pendingAfter = toNonNegativeNumber(
    qcDoc?.quantities?.pending ??
      (qcDoc?.quantities?.client_demand || 0) -
        (qcDoc?.quantities?.qc_passed || 0),
    0,
  );
  const labelRangesToAppend = Array.isArray(appendLabelRanges)
    ? appendLabelRanges
    : [];
  const labelsToAppend = normalizeLabels(appendLabels);
  const normalizedGoodsNotReady =
    goodsNotReady && typeof goodsNotReady === "object"
      ? {
          ready: Boolean(goodsNotReady.ready),
          reason: String(goodsNotReady.reason || "").trim(),
        }
      : null;
  const normalizedExplicitStatus = normalizeText(explicitStatus);
  const qcCbmSnapshot = buildNormalizedCbmSnapshot(qcDoc?.cbm);

  if (!inspectionRecord) {
    inspectionRecord = await Inspection.create({
      qc: qcDoc._id,
      inspector: resolvedInspectorId,
      inspection_date: resolvedInspectionDate,
      status: resolveInspectionRecordStatus({
        checked: addChecked,
        passed: addPassed,
        vendorOffered: addProvision,
        labelsAdded: labelsToAppend,
        labelRanges: labelRangesToAppend,
        goodsNotReady: normalizedGoodsNotReady,
        explicitStatus: normalizedExplicitStatus,
        requestType: qcDoc?.request_type,
      }),
      request_history_id: requestHistoryId || null,
      requested_date: resolvedRequestDate,
      checked: toNonNegativeNumber(addChecked, 0),
      passed: toNonNegativeNumber(addPassed, 0),
      vendor_requested: requestedQty,
      vendor_offered: toNonNegativeNumber(addProvision, 0),
      pending_after: pendingAfter,
      cbm: qcCbmSnapshot,
      label_ranges: labelRangesToAppend,
      labels_added: labelsToAppend,
      ...(normalizedGoodsNotReady
        ? { goods_not_ready: normalizedGoodsNotReady }
        : {}),
      remarks: String(remarks || "").trim(),
      createdBy,
      updated_by: buildAuditActor(auditUser),
    });

    qcDoc.inspection_record = qcDoc.inspection_record || [];
    if (
      !qcDoc.inspection_record.some(
        (entry) => String(entry) === String(inspectionRecord._id),
      )
    ) {
      qcDoc.inspection_record.push(inspectionRecord._id);
    }

    if (labelsToAppend.length > 0) {
      await recalculateInspectorUsedLabels([resolvedInspectorId]);
    }

    return inspectionRecord;
  }

  inspectionRecord.inspector = resolvedInspectorId;
  inspectionRecord.requested_date = resolvedRequestDate;
  inspectionRecord.request_history_id =
    requestHistoryId || inspectionRecord.request_history_id || null;
  inspectionRecord.inspection_date = resolvedInspectionDate;
  inspectionRecord.vendor_requested = requestedQty;

  const nextChecked =
    toNonNegativeNumber(inspectionRecord.checked, 0) +
    toNonNegativeNumber(addChecked, 0);
  const nextPassed =
    toNonNegativeNumber(inspectionRecord.passed, 0) +
    toNonNegativeNumber(addPassed, 0);
  const nextOffered =
    toNonNegativeNumber(inspectionRecord.vendor_offered, 0) +
    toNonNegativeNumber(addProvision, 0);

  inspectionRecord.checked = nextChecked;
  inspectionRecord.passed = nextPassed;
  inspectionRecord.vendor_offered = nextOffered;
  inspectionRecord.pending_after = pendingAfter;

  if (replaceCbmSnapshot) {
    inspectionRecord.cbm = qcCbmSnapshot;
  }

  if (labelRangesToAppend.length > 0) {
    const existingRanges = Array.isArray(inspectionRecord.label_ranges)
      ? inspectionRecord.label_ranges
      : [];
    const rangeKeys = new Set(
      existingRanges.map(
        (range) => `${Number(range?.start)}-${Number(range?.end)}`,
      ),
    );
    for (const range of labelRangesToAppend) {
      const start = Number(range?.start);
      const end = Number(range?.end);
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
      const key = `${start}-${end}`;
      if (rangeKeys.has(key)) continue;
      existingRanges.push({ start, end });
      rangeKeys.add(key);
    }
    inspectionRecord.label_ranges = existingRanges;
  }

  if (labelsToAppend.length > 0) {
    const existingLabels = normalizeLabels(inspectionRecord.labels_added || []);
    inspectionRecord.labels_added = normalizeLabels([
      ...existingLabels,
      ...labelsToAppend,
    ]);
  }

  if (normalizedGoodsNotReady) {
    inspectionRecord.goods_not_ready = normalizedGoodsNotReady;
  }

  inspectionRecord.status = resolveInspectionRecordStatus({
    checked: nextChecked,
    passed: nextPassed,
    vendorOffered: nextOffered,
    labelsAdded: inspectionRecord.labels_added,
    labelRanges: inspectionRecord.label_ranges,
    goodsNotReady: inspectionRecord.goods_not_ready,
    explicitStatus: normalizedExplicitStatus,
    requestType: qcDoc?.request_type,
  });

  if (String(remarks || "").trim()) {
    inspectionRecord.remarks = String(remarks || "").trim();
  }
  inspectionRecord.updated_by = buildAuditActor(auditUser);

  await inspectionRecord.save();

  qcDoc.inspection_record = qcDoc.inspection_record || [];
  if (
    !qcDoc.inspection_record.some(
      (entry) => String(entry) === String(inspectionRecord._id),
    )
  ) {
    qcDoc.inspection_record.push(inspectionRecord._id);
  }

  if (labelsToAppend.length > 0) {
    await recalculateInspectorUsedLabels([resolvedInspectorId]);
  }

  return inspectionRecord;
};

const findTransferTargetOrderAndQc = async ({
  poNumber = "",
  itemCode = "",
  sourceOrderId = "",
} = {}) => {
  const normalizedPoNumber = normalizeText(poNumber);
  const normalizedItemCode = normalizeText(itemCode);
  if (!normalizedPoNumber || !normalizedItemCode) {
    return {
      targetOrder: null,
      targetQc: null,
      openQuantity: 0,
    };
  }

  const targetOrder = await Order.findOne({
    ...ACTIVE_ORDER_MATCH,
    ...(sourceOrderId && mongoose.Types.ObjectId.isValid(sourceOrderId)
      ? { _id: { $ne: new mongoose.Types.ObjectId(sourceOrderId) } }
      : {}),
    order_id: {
      $regex: `^${escapeRegex(normalizedPoNumber)}$`,
      $options: "i",
    },
    "item.item_code": {
      $regex: `^${escapeRegex(normalizedItemCode)}$`,
      $options: "i",
    },
  });

  if (!targetOrder) {
    return {
      targetOrder: null,
      targetQc: null,
      openQuantity: 0,
    };
  }

  let targetQc = null;
  if (targetOrder.qc_record && mongoose.Types.ObjectId.isValid(targetOrder.qc_record)) {
    targetQc = await QC.findById(targetOrder.qc_record);
  }
  if (!targetQc) {
    targetQc = await QC.findOne({ order: targetOrder._id });
  }

  const orderProgress = deriveOrderProgress({
    orderEntry: targetOrder,
    qcRecord: targetQc,
  });

  return {
    targetOrder,
    targetQc,
    openQuantity: toNonNegativeNumber(orderProgress?.pending_inspection_quantity, 0),
  };
};

/**
 * GET /qclist
 * Fetch all QC records (pagination optional)
 */
const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toDateInputValue = (value = new Date()) => toISODateString(value) || null;

const resolveReportDate = (value) => {
  const asString = String(value || "").trim();
  if (!asString) return toDateInputValue(new Date());
  return toISODateString(asString) || null;
};

const toSortableTimestamp = (value) => {
  const asString = String(value || "").trim();
  if (!asString) return 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    const parsed = new Date(`${asString}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(asString)) {
    const parts = asString.split(/[/-]/);
    const parsed = new Date(
      Date.UTC(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])),
    );
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REPORT_TIMELINE_DAYS = Object.freeze({
  "1m": 30,
  "3m": 90,
  "6m": 180,
});

const toUtcDayStart = (value = new Date()) => parseDateOnly(value);

const addUtcDays = (date, days = 0) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const cloned = new Date(date);
  cloned.setUTCDate(cloned.getUTCDate() + Number(days || 0));
  return cloned;
};

const parseCustomDaysInput = (value, fallback = 30) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 3650);
};

const resolveTimelineRange = ({ timeline = "1m", customDays = "" } = {}) => {
  const normalizedTimelineInput = String(timeline || "")
    .trim()
    .toLowerCase();
  const timelineKey = Object.prototype.hasOwnProperty.call(
    REPORT_TIMELINE_DAYS,
    normalizedTimelineInput,
  )
    ? normalizedTimelineInput
    : normalizedTimelineInput === "custom"
      ? "custom"
      : "1m";

  const days =
    timelineKey === "custom"
      ? parseCustomDaysInput(customDays, 30)
      : REPORT_TIMELINE_DAYS[timelineKey];

  const todayStart = toUtcDayStart(new Date());
  if (!todayStart) return null;

  const fromDateUtc = addUtcDays(todayStart, -(Math.max(1, days) - 1));
  const toDateExclusiveUtc = addUtcDays(todayStart, 1);
  if (!fromDateUtc || !toDateExclusiveUtc) return null;

  const toDateInclusiveUtc = addUtcDays(toDateExclusiveUtc, -1);
  if (!toDateInclusiveUtc) return null;

  return {
    timeline: timelineKey,
    days,
    from_date_iso: toISODateString(fromDateUtc),
    to_date_iso: toISODateString(toDateInclusiveUtc),
    from_date_utc: fromDateUtc,
    to_date_exclusive_utc: toDateExclusiveUtc,
  };
};

const resolveExplicitDateRange = ({ fromDate = "", toDate = "" } = {}) => {
  const normalizedFrom = toISODateString(fromDate);
  const normalizedTo = toISODateString(toDate);

  if (!normalizedFrom && !normalizedTo) {
    return null;
  }

  const fromDateIso = normalizedFrom || normalizedTo;
  const toDateIso = normalizedTo || normalizedFrom;
  const fromDateUtc = parseIsoDateToUtcDate(fromDateIso);
  const toDateInclusiveUtc = parseIsoDateToUtcDate(toDateIso);
  if (!fromDateUtc || !toDateInclusiveUtc) return null;
  if (fromDateUtc.getTime() > toDateInclusiveUtc.getTime()) return null;

  const toDateExclusiveUtc = addUtcDays(toDateInclusiveUtc, 1);
  if (!toDateExclusiveUtc) return null;

  return {
    timeline: null,
    days: null,
    from_date_iso: fromDateIso,
    to_date_iso: toDateIso,
    from_date_utc: fromDateUtc,
    to_date_exclusive_utc: toDateExclusiveUtc,
  };
};

const resolveInspectorReportRange = ({
  fromDate = "",
  toDate = "",
  timeline = "1m",
  customDays = "",
} = {}) => {
  const explicitRange = resolveExplicitDateRange({ fromDate, toDate });
  if (explicitRange) return explicitRange;
  return resolveTimelineRange({ timeline, customDays });
};

const toUtcDateOnly = (value) => {
  if (!value) return null;
  const asIso = toISODateString(value);
  if (asIso) {
    return parseIsoDateToUtcDate(asIso);
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return toUtcDayStart(parsed);
};

const resolveEffectiveOrderEtdUtc = (order = {}) => {
  const revisedEtdUtc = toUtcDateOnly(order?.revised_ETD);
  if (revisedEtdUtc) return revisedEtdUtc;
  return toUtcDateOnly(order?.ETD);
};

const getWeekStartIsoDate = (value) => {
  const dayStart = toUtcDateOnly(value);
  if (!dayStart) return "";

  const dayOfWeek = dayStart.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = addUtcDays(dayStart, diffToMonday);
  return monday ? toISODateString(monday) : "";
};

const getWeekEndIsoDate = (weekStartValue) => {
  const weekStart = toUtcDateOnly(weekStartValue);
  if (!weekStart) return "";

  const sunday = addUtcDays(weekStart, 6);
  return sunday ? toISODateString(sunday) : "";
};

const resolveInspectionReportDateIso = (inspection = {}) =>
  toISODateString(inspection?.inspection_date) ||
  toISODateString(inspection?.createdAt) ||
  "";

const isIsoDateWithinInclusiveRange = (
  isoDate = "",
  fromDateIso = "",
  toDateIso = "",
) => {
  const normalizedIso = toISODateString(isoDate);
  if (!normalizedIso || !fromDateIso || !toDateIso) return false;
  return normalizedIso >= fromDateIso && normalizedIso <= toDateIso;
};

const getPreviousUtcWeekRange = (referenceDate = new Date()) => {
  const todayStart = toUtcDayStart(referenceDate);
  if (!todayStart) return null;

  const yesterdayUtc = addUtcDays(todayStart, -1);
  const startUtc = addUtcDays(yesterdayUtc, -6);
  const toDateExclusiveUtc = addUtcDays(yesterdayUtc, 1);

  if (!yesterdayUtc || !startUtc || !toDateExclusiveUtc) {
    return null;
  }

  return {
    label: "Yesterday - 6 days to Yesterday",
    from_date_utc: startUtc,
    to_date_exclusive_utc: toDateExclusiveUtc,
    from_date_iso: toISODateString(startUtc),
    to_date_iso: toISODateString(yesterdayUtc),
  };
};

const toRoundedNumber = (value, decimals = 3) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const precision = 10 ** Math.max(0, Number(decimals) || 0);
  return Math.round(numeric * precision) / precision;
};

const resolveOrderStatusFromSet = (statuses = []) => {
  return deriveGroupedOrderStatus(statuses);
};

const normalizeOptionalReportFilter = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return "";
  }
  return normalized;
};

const resolveWeeklySummaryRange = ({ fromDate = "", toDate = "" } = {}) => {
  const explicitRange = resolveExplicitDateRange({ fromDate, toDate });
  if (explicitRange) return explicitRange;
  return getPreviousUtcWeekRange(new Date());
};

const buildWeeklySummaryPoKey = ({
  orderId = "",
  vendor = "",
  brand = "",
} = {}) =>
  [
    normalizeText(orderId).toLowerCase(),
    normalizeText(vendor).toLowerCase(),
    normalizeText(brand).toLowerCase(),
  ].join("__");

const resolveWeeklySummaryPoMeta = (qcDoc = {}) => ({
  order_id: normalizeText(qcDoc?.order_meta?.order_id || qcDoc?.order?.order_id || ""),
  vendor: normalizeText(qcDoc?.order_meta?.vendor || qcDoc?.order?.vendor || ""),
  brand: normalizeText(qcDoc?.order_meta?.brand || qcDoc?.order?.brand || ""),
});

const buildStringDateToDateExpression = (fieldPath) => ({
  $let: {
    vars: {
      rawDate: {
        $trim: {
          input: { $toString: { $ifNull: [fieldPath, ""] } },
        },
      },
    },
    in: {
      $switch: {
        branches: [
          {
            case: {
              $regexMatch: {
                input: "$$rawDate",
                regex: /^\d{4}-\d{2}-\d{2}$/,
              },
            },
            then: {
              $dateFromString: {
                dateString: "$$rawDate",
                format: "%Y-%m-%d",
                onError: null,
                onNull: null,
              },
            },
          },
          {
            case: {
              $regexMatch: {
                input: "$$rawDate",
                regex: /^\d{2}\/\d{2}\/\d{4}$/,
              },
            },
            then: {
              $dateFromString: {
                dateString: "$$rawDate",
                format: "%d/%m/%Y",
                onError: null,
                onNull: null,
              },
            },
          },
          {
            case: {
              $regexMatch: {
                input: "$$rawDate",
                regex: /^\d{2}-\d{2}-\d{4}$/,
              },
            },
            then: {
              $dateFromString: {
                dateString: "$$rawDate",
                format: "%d-%m-%Y",
                onError: null,
                onNull: null,
              },
            },
          },
        ],
        default: {
          $convert: {
            input: "$$rawDate",
            to: "date",
            onError: null,
            onNull: null,
          },
        },
      },
    },
  },
});

const requestDateToDateExpression =
  buildStringDateToDateExpression("$request_date");
const inspectionDateToDateExpression =
  buildStringDateToDateExpression("$inspection_date");
const lastInspectedDateToDateExpression = buildStringDateToDateExpression(
  "$last_inspected_date",
);

const normalizeDistinctValues = (values = []) =>
  [
    ...new Set(
      values.map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

const buildQcListMatch = ({
  inspector = "",
  vendor = "",
  brand = "",
  order = "",
  search = "",
  from = "",
  to = "",
  includeVendor = true,
  includeOrder = true,
  includeSearch = true,
} = {}) => {
  const match = {};

  const inspectorId = String(inspector || "").trim();
  const vendorValue = String(vendor || "").trim();
  const brandValue = String(brand || "").trim();
  const orderValue = String(order || "").trim();
  const searchValue = String(search || "").trim();
  const fromDate = toISODateString(from);
  const toDate = toISODateString(to);

  if (inspectorId) {
    match.inspector = new mongoose.Types.ObjectId(inspectorId);
  }

  if (includeVendor && vendorValue) {
    match["order_meta.vendor"] = vendorValue;
  }

  if (brandValue) {
    match["order_meta.brand"] = brandValue;
  }

  if (includeOrder && orderValue) {
    const q = escapeRegex(orderValue);
    match["order_meta.order_id"] = { $regex: `^${q}`, $options: "i" };
  }

  if (includeSearch && searchValue) {
    const q = escapeRegex(searchValue);
    match["item.item_code"] = { $regex: q, $options: "i" };
  }

  if (fromDate || toDate) {
    match.request_date = {};
    if (fromDate) match.request_date.$gte = fromDate;
    if (toDate) match.request_date.$lte = toDate;
  }

  return match;
};

const resolveQcListSortConfig = ({
  sortToken = "",
  sortByInput = "",
  sortOrderInput = "",
} = {}) => {
  const normalizedSortToken = String(sortToken || "").trim();
  const rawSortBy = String(sortByInput || "").trim();
  const sortTokenDirection = normalizedSortToken.startsWith("-")
    ? "desc"
    : normalizedSortToken.startsWith("+")
      ? "asc"
      : null;
  const normalizedSortKey = String(
    rawSortBy || normalizedSortToken.replace(/^[+-]/, "") || "request_date",
  )
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
  const sortAliases = {
    po: "order_id",
    order: "order_id",
    orderid: "order_id",
    order_id: "order_id",
    date: "request_date",
    requestdate: "request_date",
    request_date: "request_date",
    createdat: "createdAt",
    created_at: "createdAt",
  };
  const sortBy = sortAliases[normalizedSortKey] || "request_date";
  const explicitSortOrder = String(sortOrderInput || "")
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
  let sortStage = {
    request_date_sort_key: -1,
    "order_meta.order_id": 1,
    createdAt: -1,
  };
  if (sortBy === "request_date") {
    sortStage = {
      request_date_sort_key: sortDirection,
      "order_meta.order_id": 1,
      createdAt: -1,
    };
  } else if (sortBy === "order_id") {
    sortStage = {
      "order_meta.order_id": sortDirection,
      request_date_sort_key: -1,
      createdAt: -1,
    };
  } else if (sortBy === "createdAt") {
    sortStage = {
      createdAt: sortDirection,
      "order_meta.order_id": 1,
    };
  }

  return {
    sortBy,
    sortOrder,
    sortStage,
  };
};

const normalizeQcInspectionStatusFilter = (value = "") => {
  const normalized = normalizeInspectionStatus(value);
  if (!normalized || normalized === "all") return "";
  if (normalized === "pending") return QC_INSPECTION_STATUS_LABEL.PENDING;
  if (normalized === "inspection done") return QC_INSPECTION_STATUS_LABEL.DONE;
  if (normalized === "goods not ready") {
    return QC_INSPECTION_STATUS_LABEL.GOODS_NOT_READY;
  }
  if (normalized === "rejected") return QC_INSPECTION_STATUS_LABEL.REJECTED;
  if (normalized === "transfered" || normalized === "transferred") {
    return QC_INSPECTION_STATUS_LABEL.TRANSFERRED;
  }
  return "";
};

const buildLatestInspectionLookupStages = () => [
  {
    $lookup: {
      from: "inspections",
      let: { qcId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ["$qc", "$$qcId"] },
          },
        },
        {
          $addFields: {
            inspection_date_sort_key: {
              $ifNull: [inspectionDateToDateExpression, "$createdAt"],
            },
          },
        },
        { $sort: { inspection_date_sort_key: -1, createdAt: -1 } },
        { $limit: 1 },
        {
          $project: {
            inspection_date_sort_key: 0,
            __v: 0,
          },
        },
      ],
      as: "last_inspection",
    },
  },
  {
    $addFields: {
      last_inspection: { $arrayElemAt: ["$last_inspection", 0] },
    },
  },
];

const buildQcInspectionStatusExpression = () => {
  const truthyStrings = ["true", "1", "yes", "y"];
  const goodsNotReadyFlagExpression = {
    $let: {
      vars: {
        goodsNotReady: "$last_inspection.goods_not_ready",
        goodsNotReadyType: { $type: "$last_inspection.goods_not_ready" },
      },
      in: {
        $or: [
          { $eq: ["$$goodsNotReady", true] },
          {
            $and: [
              { $eq: ["$$goodsNotReadyType", "string"] },
              {
                $in: [
                  {
                    $toLower: {
                      $trim: {
                        input: {
                          $cond: [
                            { $eq: ["$$goodsNotReadyType", "string"] },
                            "$$goodsNotReady",
                            "",
                          ],
                        },
                      },
                    },
                  },
                  truthyStrings,
                ],
              },
            ],
          },
          {
            $and: [
              { $eq: ["$$goodsNotReadyType", "object"] },
              {
                $or: [
                  {
                    $in: [
                      {
                        $toLower: {
                          $trim: {
                            input: {
                              $toString: {
                                $ifNull: ["$$goodsNotReady.ready", ""],
                              },
                            },
                          },
                        },
                      },
                      truthyStrings,
                    ],
                  },
                  {
                    $gt: [
                      {
                        $strLenCP: {
                          $trim: {
                            input: {
                              $toString: {
                                $ifNull: ["$$goodsNotReady.reason", ""],
                              },
                            },
                          },
                        },
                      },
                      0,
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };

  return {
    $let: {
      vars: {
        explicitStatus: {
          $toLower: {
            $trim: {
              input: {
                $toString: { $ifNull: ["$last_inspection.status", ""] },
              },
            },
          },
        },
        checkedQuantity: {
          $convert: {
            input: "$last_inspection.checked",
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
      },
      in: {
        $switch: {
          branches: [
            {
              case: {
                $eq: [
                  "$$explicitStatus",
                  normalizeInspectionStatus(INSPECTION_RECORD_STATUS.REJECTED),
                ],
              },
              then: QC_INSPECTION_STATUS_LABEL.REJECTED,
            },
            {
              case: {
                $in: [
                  "$$explicitStatus",
                  [
                    normalizeInspectionStatus(INSPECTION_RECORD_STATUS.TRANSFERRED),
                    "transferred",
                  ],
                ],
              },
              then: QC_INSPECTION_STATUS_LABEL.TRANSFERRED,
            },
            {
              case: {
                $or: [
                  {
                    $eq: [
                      "$$explicitStatus",
                      normalizeInspectionStatus(
                        INSPECTION_RECORD_STATUS.GOODS_NOT_READY,
                      ),
                    ],
                  },
                  goodsNotReadyFlagExpression,
                ],
              },
              then: QC_INSPECTION_STATUS_LABEL.GOODS_NOT_READY,
            },
            {
              case: {
                $or: [
                  { $gt: ["$$checkedQuantity", 0] },
                  {
                    $eq: [
                      "$$explicitStatus",
                      normalizeInspectionStatus(INSPECTION_RECORD_STATUS.DONE),
                    ],
                  },
                ],
              },
              then: QC_INSPECTION_STATUS_LABEL.DONE,
            },
          ],
          default: QC_INSPECTION_STATUS_LABEL.PENDING,
        },
      },
    },
  };
};

const buildQcInspectionStatusStages = (selectedStatus = "") => [
  ...buildLatestInspectionLookupStages(),
  {
    $addFields: {
      inspection_status: buildQcInspectionStatusExpression(),
    },
  },
  ...(selectedStatus ? [{ $match: { inspection_status: selectedStatus } }] : []),
];

exports.getQCList = async (req, res) => {
  await QC.createIndexes();
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      inspector = "",
      vendor = "",
      brand = "",
      order = "",
      from = "",
      to = "",
      sort = "-request_date",
    } = req.query;
    const selectedInspectionStatus = normalizeQcInspectionStatusFilter(
      req.query.inspection_status ?? req.query.inspectionStatus,
    );
    const requestedInspectorId = String(inspector || "").trim();
    const normalizedRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const isQcUser = normalizedRole === "qc";
    const currentUserId = String(req.user?._id || req.user?.id || "").trim();
    const inspectorId = isQcUser ? currentUserId : requestedInspectorId;

    if (inspectorId && !mongoose.Types.ObjectId.isValid(inspectorId)) {
      return res.status(400).json({ message: "Invalid inspector id" });
    }

    if (isQcUser && !inspectorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;
    const { sortBy, sortOrder, sortStage } = resolveQcListSortConfig({
      sortToken: sort,
      sortByInput: req.query.sort_by ?? req.query.sortBy ?? "",
      sortOrderInput: req.query.sort_order ?? req.query.sortOrder ?? "",
    });
    const filterInput = {
      inspector: inspectorId,
      vendor,
      brand,
      order,
      search,
      from,
      to,
    };
    const match = buildQcListMatch(filterInput);
    const inspectionStatusStages =
      buildQcInspectionStatusStages(selectedInspectionStatus);
    const optionInspectionStatusStages = selectedInspectionStatus
      ? buildQcInspectionStatusStages(selectedInspectionStatus)
      : [];

    const pipeline = [
      { $match: match },
      buildActiveOrderLookupStage("order"),
      { $unwind: { path: "$order", preserveNullAndEmptyArrays: false } },
      {
        $addFields: {
          request_date_sort_key: {
            $ifNull: [requestDateToDateExpression, "$createdAt"],
          },
        },
      },
      ...inspectionStatusStages,
      { $sort: sortStage },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limitNum },

            {
              $lookup: {
                from: "users",
                localField: "inspector",
                foreignField: "_id",
                as: "inspector",
              },
            },
            {
              $unwind: { path: "$inspector", preserveNullAndEmptyArrays: true },
            },
            { $project: { request_date_sort_key: 0 } },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [result, vendorsRaw, ordersRaw, itemCodesRaw] = await Promise.all([
      QC.aggregate(pipeline).allowDiskUse(true),
      QC.aggregate([
        { $match: buildQcListMatch({ ...filterInput, includeVendor: false }) },
        buildActiveOrderLookupStage("order"),
        { $unwind: { path: "$order", preserveNullAndEmptyArrays: false } },
        ...optionInspectionStatusStages,
        { $group: { _id: "$order_meta.vendor" } },
        { $project: { _id: 0, value: "$_id" } },
      ]).allowDiskUse(true),
      QC.aggregate([
        { $match: buildQcListMatch({ ...filterInput, includeOrder: false }) },
        buildActiveOrderLookupStage("order"),
        { $unwind: { path: "$order", preserveNullAndEmptyArrays: false } },
        ...optionInspectionStatusStages,
        { $group: { _id: "$order_meta.order_id" } },
        { $project: { _id: 0, value: "$_id" } },
      ]).allowDiskUse(true),
      QC.aggregate([
        { $match: buildQcListMatch({ ...filterInput, includeSearch: false }) },
        buildActiveOrderLookupStage("order"),
        { $unwind: { path: "$order", preserveNullAndEmptyArrays: false } },
        ...optionInspectionStatusStages,
        { $group: { _id: "$item.item_code" } },
        { $project: { _id: 0, value: "$_id" } },
      ]).allowDiskUse(true),
    ]);

    const data = (result?.[0]?.data || []).map((entry) => ({
      ...entry,
      order: entry?.order
        ? {
            ...entry.order,
            status: resolveQcOrderStatus(entry, entry.order),
          }
        : entry?.order || null,
    }));
    const totalRecords = result?.[0]?.totalCount?.[0]?.count || 0;

    res.json({
      data,
      pagination: {
        page: pageNum,
        totalPages: Math.ceil(totalRecords / limitNum) || 1,
        totalRecords,
      },
      sort: {
        sort_by: sortBy,
        sort_order: sortOrder,
      },
      filters: {
        vendors: normalizeDistinctValues(
          vendorsRaw.map((entry) => entry?.value),
        ),
        orders: normalizeDistinctValues(ordersRaw.map((entry) => entry?.value)),
        item_codes: normalizeDistinctValues(
          itemCodesRaw.map((entry) => entry?.value),
        ),
        inspection_status_options: Object.values(QC_INSPECTION_STATUS_LABEL),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.exportQCList = async (req, res) => {
  await QC.createIndexes();
  try {
    const {
      search = "",
      inspector = "",
      vendor = "",
      brand = "",
      order = "",
      from = "",
      to = "",
      sort = "-request_date",
      format = "xlsx",
    } = req.query;
    const exportFormat =
      String(format || "")
        .trim()
        .toLowerCase() === "csv"
        ? "csv"
        : "xlsx";
    const selectedInspectionStatus = normalizeQcInspectionStatusFilter(
      req.query.inspection_status ?? req.query.inspectionStatus,
    );

    const inspectorId = String(inspector || "").trim();
    if (inspectorId && !mongoose.Types.ObjectId.isValid(inspectorId)) {
      return res.status(400).json({ message: "Invalid inspector id" });
    }

    const filterInput = {
      inspector: inspectorId,
      vendor,
      brand,
      order,
      search,
      from,
      to,
    };
    const match = buildQcListMatch(filterInput);
    const inspectionStatusStages =
      buildQcInspectionStatusStages(selectedInspectionStatus);
    const { sortStage } = resolveQcListSortConfig({
      sortToken: sort,
      sortByInput: req.query.sort_by ?? req.query.sortBy ?? "",
      sortOrderInput: req.query.sort_order ?? req.query.sortOrder ?? "",
    });

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          request_date_sort_key: {
            $ifNull: [requestDateToDateExpression, "$createdAt"],
          },
        },
      },
      ...inspectionStatusStages,
      { $sort: sortStage },
      {
        $lookup: {
          from: "users",
          localField: "inspector",
          foreignField: "_id",
          as: "inspector",
        },
      },
      { $unwind: { path: "$inspector", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "createdByUser",
        },
      },
      { $unwind: { path: "$createdByUser", preserveNullAndEmptyArrays: true } },
      buildActiveOrderLookupStage("order"),
      { $unwind: { path: "$order", preserveNullAndEmptyArrays: false } },
      {
        $project: {
          request_date_sort_key: 0,
          inspection_record: 0,
          __v: 0,
          "order.__v": 0,
          "inspector.password": 0,
          "createdByUser.password": 0,
        },
      },
    ];

    const qcRows = (await QC.aggregate(pipeline).allowDiskUse(true)).map((entry) => ({
      ...entry,
      order: entry?.order
        ? {
            ...entry.order,
            status: resolveQcOrderStatus(entry, entry.order),
          }
        : entry?.order || null,
    }));
    const itemCodeKeys = [
      ...new Set(
        qcRows
          .map((entry) =>
            normalizeItemCodeKey(
              entry?.item?.item_code || entry?.order?.item?.item_code || "",
            ),
          )
          .filter(Boolean),
      ),
    ];
    const itemMasterMap = new Map();
    if (itemCodeKeys.length > 0) {
      const matchedItems = await Item.aggregate([
        {
          $addFields: {
            __code_key: {
              $toLower: {
                $trim: {
                  input: { $toString: { $ifNull: ["$code", ""] } },
                },
              },
            },
          },
        },
        { $match: { __code_key: { $in: itemCodeKeys } } },
        {
          $project: {
            __code_key: 1,
            code: 1,
            name: 1,
            description: 1,
            brands: 1,
            vendors: 1,
            inspected_weight: 1,
            pis_weight: 1,
            weight: 1,
            cbm: 1,
            inspected_item_LBH: 1,
            inspected_item_sizes: 1,
            inspected_item_top_LBH: 1,
            inspected_item_bottom_LBH: 1,
            pis_item_LBH: 1,
            pis_item_sizes: 1,
            pis_item_top_LBH: 1,
            pis_item_bottom_LBH: 1,
            item_LBH: 1,
            inspected_box_LBH: 1,
            inspected_box_sizes: 1,
            inspected_box_top_LBH: 1,
            inspected_box_bottom_LBH: 1,
            inspected_top_LBH: 1,
            inspected_bottom_LBH: 1,
            pis_box_LBH: 1,
            pis_box_sizes: 1,
            pis_box_top_LBH: 1,
            pis_box_bottom_LBH: 1,
            box_LBH: 1,
          },
        },
      ]).allowDiskUse(true);

      for (const itemDoc of matchedItems) {
        const key = normalizeItemCodeKey(itemDoc?.__code_key);
        if (key && !itemMasterMap.has(key)) {
          itemMasterMap.set(key, itemDoc);
        }
      }
    }

    const columns = [
      { key: "po", header: "PO" },
      { key: "brand", header: "Brand" },
      { key: "vendor", header: "Vendor" },
      { key: "qc_request_type", header: "QC Request Type" },
      { key: "item_code", header: "QC Item Code" },
      { key: "description", header: "QC Item Description" },
      { key: "order_item_code", header: "Order Item Code" },
      { key: "order_item_description", header: "Order Item Description" },
      { key: "item_master_code", header: "Item Master Code" },
      { key: "item_master_name", header: "Item Master Name" },
      { key: "item_master_description", header: "Item Master Description" },
      { key: "item_master_brands", header: "Item Master Brands" },
      { key: "item_master_vendors", header: "Item Master Vendors" },
      { key: "item_master_weight_net", header: "Item Weight Net" },
      { key: "item_master_weight_gross", header: "Item Weight Gross" },
      { key: "item_master_cbm_total", header: "Item Master CBM Total" },
      { key: "item_master_item_lbh", header: "Item Master Item LBH" },
      { key: "item_master_box_lbh", header: "Item Master Box LBH" },
      { key: "request_date", header: "Request Date" },
      { key: "last_inspected_date", header: "Last Inspected Date" },
      { key: "inspection_status", header: "Inspection Status" },
      { key: "order_date", header: "Order Date" },
      { key: "etd", header: "ETD" },
      { key: "order_status", header: "Order Status" },
      { key: "order_quantity", header: "Order Quantity" },
      { key: "quantity_requested", header: "Quantity Requested" },
      { key: "vendor_provision", header: "Vendor Provision" },
      { key: "qc_checked", header: "QC Checked" },
      { key: "qc_passed", header: "QC Passed" },
      { key: "pending", header: "Pending" },
      { key: "qc_rejected", header: "QC Rejected" },
      { key: "cbm_box1", header: "CBM Box 1" },
      { key: "cbm_box2", header: "CBM Box 2" },
      { key: "cbm_box3", header: "CBM Box 3" },
      { key: "cbm_total", header: "CBM Total" },
      { key: "barcode", header: "Barcode" },
      { key: "packed_size", header: "Packed Size" },
      { key: "finishing", header: "Finishing" },
      { key: "branding", header: "Branding" },
      { key: "labels", header: "Labels" },
      { key: "inspector_name", header: "Inspector Name" },
      { key: "inspector_email", header: "Inspector Email" },
      { key: "created_by", header: "Created By" },
      { key: "created_at", header: "Created At" },
      { key: "updated_at", header: "Updated At" },
      { key: "remarks", header: "QC Remarks" },
      { key: "request_history_count", header: "Request History Count" },
      { key: "shipment_count", header: "Shipment Count" },
      { key: "shipped_quantity", header: "Shipped Quantity" },
      { key: "shipment_containers", header: "Shipment Containers" },
      { key: "shipment_dates", header: "Shipment Dates" },
      { key: "shipment_quantities", header: "Shipment Quantities" },
      { key: "shipment_pending", header: "Shipment Pending" },
      { key: "shipment_remarks", header: "Shipment Remarks" },
      {
        key: "shipment_rows",
        header: "Shipment Rows (Date/Container/Qty/Pending/Remarks)",
      },
    ];

    const exportRows = qcRows.map((entry) => {
      const qcItemCode = normalizeText(entry?.item?.item_code || "");
      const qcItemDescription = normalizeText(entry?.item?.description || "");
      const orderItemCode = normalizeText(entry?.order?.item?.item_code || "");
      const orderItemDescription = normalizeText(
        entry?.order?.item?.description || "",
      );
      const itemMaster = itemMasterMap.get(
        normalizeItemCodeKey(qcItemCode || orderItemCode),
      );
      const shipmentEntries = Array.isArray(entry?.order?.shipment)
        ? entry.order.shipment
        : [];
      const shippedQuantity = shipmentEntries.reduce(
        (sum, shipment) => sum + toNonNegativeNumber(shipment?.quantity, 0),
        0,
      );
      const shipmentContainers = shipmentEntries.map((shipment) =>
        normalizeText(shipment?.container || ""),
      );
      const shipmentDates = shipmentEntries.map((shipment) =>
        formatDateDDMMYYYY(shipment?.stuffing_date, ""),
      );
      const shipmentQuantities = shipmentEntries.map((shipment) =>
        String(toNonNegativeNumber(shipment?.quantity, 0)),
      );
      const shipmentPending = shipmentEntries.map((shipment) =>
        String(toNonNegativeNumber(shipment?.pending, 0)),
      );
      const shipmentRemarks = shipmentEntries.map((shipment) =>
        normalizeText(shipment?.remaining_remarks || ""),
      );
      const shipmentRowsText = shipmentEntries.map((shipment) =>
        [
          formatDateDDMMYYYY(shipment?.stuffing_date, ""),
          normalizeText(shipment?.container || ""),
          toNonNegativeNumber(shipment?.quantity, 0),
          toNonNegativeNumber(shipment?.pending, 0),
          normalizeText(shipment?.remaining_remarks || ""),
        ].join(" / "),
      );
      const sortedLabels = normalizeLabels(entry?.labels);
      const labelsText = sortedLabels.length > 0 ? sortedLabels.join(", ") : "";
      const inspectorName = normalizeText(entry?.inspector?.name || "");
      const inspectorEmail = normalizeText(entry?.inspector?.email || "");
      const createdByName =
        normalizeText(entry?.createdByUser?.name) ||
        normalizeText(entry?.createdByUser?.email) ||
        "";

      return {
        po: normalizeText(
          entry?.order_meta?.order_id || entry?.order?.order_id || "",
        ),
        brand: normalizeText(
          entry?.order_meta?.brand || entry?.order?.brand || "",
        ),
        vendor: normalizeText(
          entry?.order_meta?.vendor || entry?.order?.vendor || "",
        ),
        qc_request_type: normalizeQcRequestType(entry?.request_type),
        item_code: qcItemCode,
        description: qcItemDescription,
        order_item_code: orderItemCode,
        order_item_description: orderItemDescription,
        item_master_code: normalizeText(itemMaster?.code || ""),
        item_master_name: normalizeText(itemMaster?.name || ""),
        item_master_description: normalizeText(itemMaster?.description || ""),
        item_master_brands: Array.isArray(itemMaster?.brands)
          ? itemMaster.brands
              .map((brandValue) => normalizeText(brandValue))
              .filter(Boolean)
              .join(" | ")
          : "",
        item_master_vendors: Array.isArray(itemMaster?.vendors)
          ? itemMaster.vendors
              .map((vendorValue) => normalizeText(vendorValue))
              .filter(Boolean)
              .join(" | ")
          : "",
        item_master_weight_net: getItemWeightNet(itemMaster),
        item_master_weight_gross: getItemWeightGross(itemMaster),
        item_master_cbm_total: getItemInspectedCbmTotal(itemMaster),
        item_master_item_lbh: formatLbh(getItemItemLbh(itemMaster)),
        item_master_box_lbh: formatLbh(getItemBoxLbh(itemMaster)),
        request_date: formatDateDDMMYYYY(entry?.request_date, ""),
        last_inspected_date: formatDateDDMMYYYY(entry?.last_inspected_date, ""),
        inspection_status: normalizeText(entry?.inspection_status || ""),
        order_date: formatDateDDMMYYYY(entry?.order?.order_date, ""),
        etd: formatDateDDMMYYYY(entry?.order?.ETD, ""),
        order_status: resolveQcOrderStatus(entry, entry?.order),
        order_quantity: toNonNegativeNumber(entry?.order?.quantity, 0),
        quantity_requested: toNonNegativeNumber(
          entry?.quantities?.quantity_requested,
          0,
        ),
        vendor_provision: toNonNegativeNumber(
          entry?.quantities?.vendor_provision,
          0,
        ),
        qc_checked: toNonNegativeNumber(entry?.quantities?.qc_checked, 0),
        qc_passed: toNonNegativeNumber(entry?.quantities?.qc_passed, 0),
        pending: toNonNegativeNumber(entry?.quantities?.pending, 0),
        qc_rejected: toNonNegativeNumber(entry?.quantities?.qc_rejected, 0),
        cbm_box1: normalizeText(
          buildNormalizedCbmSnapshot(entry?.cbm)?.box1 || "0",
        ),
        cbm_box2: normalizeText(
          buildNormalizedCbmSnapshot(entry?.cbm)?.box2 || "0",
        ),
        cbm_box3: normalizeText(
          buildNormalizedCbmSnapshot(entry?.cbm)?.box3 || "0",
        ),
        cbm_total: normalizeText(
          buildNormalizedCbmSnapshot(entry?.cbm)?.total || "0",
        ),
        barcode: toNonNegativeNumber(entry?.barcode, 0),
        packed_size: entry?.packed_size ? "Yes" : "No",
        finishing: entry?.finishing ? "Yes" : "No",
        branding: entry?.branding ? "Yes" : "No",
        labels: labelsText,
        inspector_name: inspectorName,
        inspector_email: inspectorEmail,
        created_by: createdByName,
        created_at: formatDateDDMMYYYY(entry?.createdAt, ""),
        updated_at: formatDateDDMMYYYY(entry?.updatedAt, ""),
        remarks: normalizeText(entry?.remarks || ""),
        request_history_count: Array.isArray(entry?.request_history)
          ? entry.request_history.length
          : 0,
        shipment_count: shipmentEntries.length,
        shipped_quantity: shippedQuantity,
        shipment_containers: shipmentContainers.join(" | "),
        shipment_dates: shipmentDates.join(" | "),
        shipment_quantities: shipmentQuantities.join(" | "),
        shipment_pending: shipmentPending.join(" | "),
        shipment_remarks: shipmentRemarks.join(" | "),
        shipment_rows: shipmentRowsText.join(" | "),
      };
    });

    const headerRow = columns.map((column) => column.header);
    const dataRows = exportRows.map((row) =>
      columns.map((column) => row[column.key] ?? ""),
    );
    const fileDate = toISODateString(new Date()) || "export";
    const baseFileName = `qc-records-${fileDate}`;

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
    XLSX.utils.book_append_sheet(workbook, worksheet, "QC Records");
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
  } catch (err) {
    console.error("QC Export Error:", err);
    return res.status(500).json({
      message: "Failed to export QC records",
      error: err.message,
    });
  }
};

/**
 * POST /align-qc
 * Manager/Admin aligns QC + vendor provision
 */
exports.alignQC = async (req, res) => {
  try {
    const {
      order,
      item,
      inspector,
      quantities,
      remarks,
      request_date,
      request_type,
    } = req.body;
    const ignoreUnworkedRequest = normalizeActionBoolean(
      req.body?.ignore_unworked_request ?? req.body?.ignoreUnworkedRequest,
      false,
    );

    const inspectorId = String(inspector || "").trim();
    if (!inspectorId) {
      return res.status(400).json({ message: "inspector is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(inspectorId)) {
      return res.status(400).json({ message: "invalid inspector id" });
    }

    const existingQC = await QC.findOne({
      order: order,
      "item.item_code": item.item_code,
    });
    const orderRecord = await Order.findById(order);
    if (!orderRecord) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (CLOSED_ORDER_STATUSES.includes(String(orderRecord.status || ""))) {
      return res.status(400).json({ message: "Order is already closed" });
    }

    const clientDemand = Number(quantities?.client_demand);
    const quantityRequestedInput = Number(
      quantities?.quantity_requested ?? quantities?.vendor_provision,
    );
    const normalizedRequestType = normalizeQcRequestType(
      request_type ?? quantities?.request_type,
    );
    const hasVendorProvisionInput =
      quantities?.vendor_provision !== undefined &&
      quantities?.vendor_provision !== null &&
      quantities?.vendor_provision !== "";
    const vendorProvision = !hasVendorProvisionInput
      ? 0
      : Number(quantities?.vendor_provision);

    const quantityRequested = quantityRequestedInput;

    if (
      Number.isNaN(clientDemand) ||
      Number.isNaN(vendorProvision) ||
      Number.isNaN(quantityRequestedInput)
    ) {
      return res.status(400).json({
        message:
          "client demand, quantity requested and vendor provision must be valid numbers",
      });
    }

    if (
      clientDemand < 0 ||
      vendorProvision < 0 ||
      quantityRequestedInput < 0
    ) {
      return res.status(400).json({
        message: "Quantity values must be valid non-negative numbers",
      });
    }

    if (
      normalizedRequestType === QC_REQUEST_TYPES.AQL &&
      quantityRequested <= 0
    ) {
      return res.status(400).json({
        message: "quantity requested must be greater than 0 for AQL",
      });
    }

    if (quantityRequested > clientDemand) {
      return res.status(400).json({
        message: "quantity requested can't be greater than client demand",
      });
    }

    if (hasVendorProvisionInput && vendorProvision > quantityRequested) {
      return res.status(400).json({
        message: "vendor provision can't be greater than quantity requested",
      });
    }

    const requestDateValue = toISODateString(request_date);
    if (!requestDateValue) {
      return res.status(400).json({ message: "request date is required" });
    }

    const parsedRequestDate = new Date(`${requestDateValue}T00:00:00Z`);

    if (Number.isNaN(parsedRequestDate.getTime())) {
      return res
        .status(400)
        .json({ message: "request date must be a valid date" });
    }

    const normalizedRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const isAdmin = normalizedRole === "admin";
    const isManager = normalizedRole === "manager";

    if (
      isManager &&
      !isIsoDateWithinPastDaysInclusive(
        requestDateValue,
        MANAGER_ALLOWED_PAST_DAYS,
      )
    ) {
      return res.status(403).json({
        message: "Manager can align QC only for today and previous 2 days",
      });
    }

    if (!isAdmin && !isManager) {
      return res.status(403).json({
        message: "You are not authorized to align QC requests",
      });
    }

    const normalizedItemCode = normalizeText(item?.item_code || "");
    const matchedItem = normalizedItemCode
      ? await Item.findOne({
          code: {
            $regex: `^${escapeRegex(normalizedItemCode)}$`,
            $options: "i",
          },
        })
          .select("code name description cbm qc")
          .lean()
      : null;

    if (existingQC) {
      const auditTimestamp = new Date();
      const beforeQcInspectionRecords = await Inspection.find({
        qc: existingQC._id,
      }).lean();
      const latestRequestEntry = resolveLatestRequestEntry(
        existingQC.request_history || [],
      );
      const latestRequestInspection = resolveLatestInspectionRecordForRequestEntry(
        beforeQcInspectionRecords,
        latestRequestEntry,
      );
      const latestRequestHasActivity = latestRequestInspection
        ? hasInspectionRecordActivity({
            checked: latestRequestInspection?.checked,
            passed: latestRequestInspection?.passed,
            vendorOffered: latestRequestInspection?.vendor_offered,
            labelsAdded: latestRequestInspection?.labels_added,
            labelRanges: latestRequestInspection?.label_ranges,
            goodsNotReady: latestRequestInspection?.goods_not_ready,
            status: latestRequestInspection?.status,
          })
        : false;
      const latestRequestStatus = normalizeRequestHistoryStatus(
        latestRequestEntry?.status || REQUEST_HISTORY_STATUS.OPEN,
      );

      if (
        latestRequestEntry &&
        !ignoreUnworkedRequest &&
        latestRequestStatus !== REQUEST_HISTORY_STATUS.TRANSFERRED &&
        latestRequestStatus !== REQUEST_HISTORY_STATUS.INSPECTED &&
        latestRequestStatus !== REQUEST_HISTORY_STATUS.REJECTED &&
        !latestRequestHasActivity
      ) {
        return res.status(409).json({
          message:
            "The last request for this item has not been worked upon yet. Consider transferring that request from QC Details instead of creating a new one.",
          suggest_transfer: true,
          code: "LATEST_REQUEST_NOT_WORKED",
          data: {
            qc_id: existingQC._id,
            latest_request: {
              request_history_id: latestRequestEntry?._id || null,
              request_date:
                toISODateString(latestRequestEntry?.request_date) || "",
              quantity_requested: toNonNegativeNumber(
                latestRequestEntry?.quantity_requested,
                0,
              ),
            },
          },
        });
      }

      const beforeQcSnapshot = buildQcEditLogSnapshot(
        existingQC.toObject(),
        beforeQcInspectionRecords,
      );
      const beforeOrderSnapshot = buildOrderAuditSnapshotForQc(orderRecord);

      if (clientDemand < existingQC.quantities.qc_passed) {
        return res.status(400).json({
          message: "client demand cannot be less than already passed quantity",
        });
      }

      const existingPendingRaw = Number(
        existingQC?.quantities?.pending ??
          (existingQC?.quantities?.client_demand || 0) -
            (existingQC?.quantities?.qc_passed || 0),
      );
      const existingPendingQuantity = Number.isFinite(existingPendingRaw)
        ? Math.max(0, existingPendingRaw)
        : 0;

      if (quantityRequested > existingPendingQuantity) {
        return res.status(400).json({
          message: "quantity requested cannot be greater than pending quantity",
        });
      }

      if (
        hasVendorProvisionInput &&
        vendorProvision < existingQC.quantities.qc_passed
      ) {
        return res.status(400).json({
          message:
            "vendor provision cannot be less than already passed quantity",
        });
      }

      const totalOffered = hasVendorProvisionInput
        ? vendorProvision
        : existingQC.quantities.vendor_provision || 0;

      if ((existingQC.quantities.qc_checked || 0) > totalOffered) {
        return res.status(400).json({
          message:
            "vendor provision cannot be less than already checked quantity",
        });
      }

      // const dateOnly = new Date(req.body.request_date)

      existingQC.inspector = inspectorId;
      existingQC.request_type = normalizedRequestType;
      existingQC.request_date = requestDateValue;
      existingQC.item = item;
      existingQC.quantities.client_demand = clientDemand;
      existingQC.quantities.quantity_requested = quantityRequested;
      if (hasVendorProvisionInput) {
        existingQC.quantities.vendor_provision = vendorProvision;
      }
      existingQC.quantities.pending =
        clientDemand - (existingQC.quantities.qc_passed || 0);

      if (remarks !== undefined) {
        existingQC.remarks = remarks;
      }

      const existingPatchResult = buildQcItemDetailsPatch({
        qcSnapshot: existingQC,
        itemDoc: matchedItem,
        onlyUpdatedItems: true,
      });
      if (existingPatchResult?.set) {
        applyQcItemDetailsPatch(existingQC, existingPatchResult.set);
      }

      existingQC.request_history = existingQC.request_history || [];
      const requestHistoryEntry = {
        request_date: requestDateValue,
        request_type: normalizedRequestType,
        quantity_requested: quantityRequested,
        inspector: inspectorId,
        status: "open",
        remarks: remarks || "",
        createdBy: req.user._id,
        updatedAt: auditTimestamp,
        updated_by: buildAuditActor(req.user),
      };
      existingQC.request_history.push(requestHistoryEntry);
      existingQC.updated_by = buildAuditActor(req.user);

      await upsertInspectionRecordForRequest({
        qcDoc: existingQC,
        inspectorId,
        requestDate: requestDateValue,
        requestHistoryId:
          resolveLatestRequestEntry(existingQC.request_history)?._id || null,
        requestedQuantity: quantityRequested,
        inspectionDate: requestDateValue,
        remarks: remarks || "",
        createdBy: req.user._id,
        auditUser: req.user,
        addChecked: 0,
        addPassed: 0,
        addProvision: 0,
        appendLabelRanges: [],
        appendLabels: [],
        replaceCbmSnapshot: true,
        allowRequestedDateFallback: false,
      });

      await existingQC.save();

      if (orderRecord) {
        applyQcOrderStatus(existingQC, orderRecord);
        orderRecord.qc_record = existingQC._id;
        orderRecord.updated_by = buildAuditActor(req.user);
        await applyQcOrderPoCbm(orderRecord);
        await orderRecord.save();
      }

      const afterQcInspectionRecords = await Inspection.find({
        qc: existingQC._id,
      }).lean();
      await createQcEditLog({
        reqUser: req.user,
        qcDoc: existingQC,
        beforeSnapshot: beforeQcSnapshot,
        afterSnapshot: buildQcEditLogSnapshot(
          existingQC.toObject(),
          afterQcInspectionRecords,
        ),
        operationType: "qc_align",
        extraRemarks: ["QC request re-aligned through align-qc route."],
      });
      await createOrderEditLogFromQc({
        reqUser: req.user,
        orderDoc: orderRecord,
        beforeSnapshot: beforeOrderSnapshot,
        afterSnapshot: buildOrderAuditSnapshotForQc(orderRecord),
        extraRemarks: ["Order updated from align-qc flow."],
      });

      try {
        await upsertItemFromQc(existingQC);
      } catch (itemSyncError) {
        console.error("Item sync after QC re-align failed:", {
          qcId: existingQC?._id,
          error: itemSyncError?.message || String(itemSyncError),
        });
      }

      return res.status(200).json({
        message: "QC re-aligned successfully",
        data: existingQC,
      });
    }

    const auditTimestamp = new Date();
    const beforeOrderSnapshot = buildOrderAuditSnapshotForQc(orderRecord);
    const requestHistoryEntry = {
      request_date: requestDateValue,
      request_type: normalizedRequestType,
      quantity_requested: quantityRequested,
      inspector: inspectorId,
      status: "open",
      remarks: remarks || "",
      createdBy: req.user._id,
      updatedAt: auditTimestamp,
      updated_by: buildAuditActor(req.user),
    };

    const qc = await QC.create({
      order,
      item,
      inspector: inspectorId,
      request_type: normalizedRequestType,
      order_meta: {
        order_id: orderRecord.order_id,
        vendor: orderRecord.vendor,
        brand: orderRecord.brand,
      },
      request_date: requestDateValue,
      last_inspected_date: requestDateValue,
      quantities: {
        client_demand: clientDemand,
        quantity_requested: quantityRequested,
        vendor_provision: hasVendorProvisionInput ? vendorProvision : 0,
        qc_checked: 0,
        qc_passed: 0,
        pending: clientDemand,
      },
      request_history: [requestHistoryEntry],
      remarks,
      createdBy: req.user._id,
      updated_by: buildAuditActor(req.user),
    });

    const createPatchResult = buildQcItemDetailsPatch({
      qcSnapshot: qc,
      itemDoc: matchedItem,
      onlyUpdatedItems: true,
    });
    if (createPatchResult?.set) {
      applyQcItemDetailsPatch(qc, createPatchResult.set);
    }

    await upsertInspectionRecordForRequest({
      qcDoc: qc,
      inspectorId,
      requestDate: requestDateValue,
      requestHistoryId:
        resolveLatestRequestEntry(qc.request_history)?._id || null,
      requestedQuantity: quantityRequested,
      inspectionDate: requestDateValue,
      remarks: remarks || "",
      createdBy: req.user._id,
      auditUser: req.user,
      addChecked: 0,
      addPassed: 0,
      addProvision: 0,
      appendLabelRanges: [],
      appendLabels: [],
      replaceCbmSnapshot: true,
      allowRequestedDateFallback: false,
    });

    applyQcOrderStatus(qc, orderRecord);
    orderRecord.qc_record = qc._id;
    orderRecord.updated_by = buildAuditActor(req.user);

    await qc.save();
    await applyQcOrderPoCbm(orderRecord);
    await orderRecord.save();

    const afterQcInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    await createQcEditLog({
      reqUser: req.user,
      qcDoc: qc,
      beforeSnapshot: {},
      afterSnapshot: buildQcEditLogSnapshot(qc.toObject(), afterQcInspectionRecords),
      operationType: "qc_align",
      extraRemarks: ["QC created through align-qc route."],
    });
    await createOrderEditLogFromQc({
      reqUser: req.user,
      orderDoc: orderRecord,
      beforeSnapshot: beforeOrderSnapshot,
      afterSnapshot: buildOrderAuditSnapshotForQc(orderRecord),
      extraRemarks: ["Order updated from align-qc flow."],
    });

    try {
      await upsertItemFromQc(qc);
    } catch (itemSyncError) {
      console.error("Item sync after QC align failed:", {
        qcId: qc?._id,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    res.status(201).json({
      message: "QC aligned successfully",
      data: qc,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/**
 * PATCH /update-qc/:id
 * QC inspector updates checked / passed with allocated labels
 */
exports.updateQC = async (req, res) => {
  try {
    const {
      qc_checked,
      qc_passed,
      remarks,
      labels,
      label_ranges,
      inspector,
      vendor_provision,
      barcode,
      master_barcode,
      inner_barcode,
      packed_size,
      finishing,
      branding,
      last_inspected_date,
      CBM_box1,
      CBM_box2,
      CBM_box3,
      CBM_top,
      CBM_bottom,
      CBM,
      inspected_item_sizes,
      inspected_box_mode,
      inspected_box_sizes,
      inspected_item_LBH,
      inspected_item_top_LBH,
      inspected_item_bottom_LBH,
      inspected_box_LBH,
      inspected_box_top_LBH,
      inspected_box_bottom_LBH,
      inspected_top_LBH,
      inspected_bottom_LBH,
      inspected_weight,
    } = req.body;

    const qc = await QC.findById(req.params.id)
      .populate("inspector")
      .populate("order", "status quantity shipment order_id brand vendor");

    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }
    const beforeInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    const beforeQcSnapshot = buildQcEditLogSnapshot(
      qc.toObject(),
      beforeInspectionRecords,
    );
    const linkedOrderId = qc?.order?._id || qc.order;
    const linkedOrderBefore =
      linkedOrderId && mongoose.Types.ObjectId.isValid(linkedOrderId)
        ? await Order.findById(linkedOrderId)
        : null;
    const beforeOrderSnapshot = buildOrderAuditSnapshotForQc(linkedOrderBefore);

    const normalizedRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const isAdmin = normalizedRole === "admin";
    const isManager = normalizedRole === "manager";
    const isQcUser = normalizedRole === "qc";
    const hasElevatedAccess = isAdmin || isManager;
    const currentUserId = String(req.user?._id || req.user?.id || "").trim();
    const updateQcPastDaysLimit = getUpdateQcPastDaysLimit(
      normalizedRole,
      currentUserId,
    );
    const isCurrentUserLabelExempt =
      isAdmin || isLabelExemptUser(currentUserId);
    const adminRewriteLatestRecord =
      isAdmin &&
      (req.body?.admin_rewrite_latest_record === true ||
        String(req.body?.admin_rewrite_latest_record || "")
          .trim()
          .toLowerCase() === "true");
    const allowAdminRewrite = adminRewriteLatestRecord;
    const allowQcFieldEdits = allowAdminRewrite || isQcUser;

    const requestedInspectorId =
      inspector !== undefined &&
      inspector !== null &&
      String(inspector).trim() !== ""
        ? String(inspector).trim()
        : null;

    const hasStartedInspection =
      Number(qc.quantities?.qc_checked || 0) > 0 ||
      Number(qc.quantities?.qc_passed || 0) > 0 ||
      Number(qc.quantities?.vendor_provision || 0) > 0 ||
      normalizeLabels(qc.labels).length > 0;

    const latestRequestEntry = resolveLatestRequestEntry(
      qc?.request_history || [],
    );
    const latestRequestedQuantity = resolveRequestedQuantityFromQc(qc);
    const hasQcRequest =
      (Array.isArray(qc?.request_history) && qc.request_history.length > 0) ||
      latestRequestedQuantity > 0;

    if (!hasQcRequest) {
      return res.status(400).json({
        message: "QC is not requested yet. Align QC request before updating.",
      });
    }

    const inspectionDateForPermissionRaw =
      last_inspected_date !== undefined &&
      String(last_inspected_date).trim() !== ""
        ? String(last_inspected_date).trim()
        : String(
            latestRequestEntry?.request_date ||
              qc?.request_date ||
              qc?.last_inspected_date ||
              "",
          ).trim();
    let qcUserRequestAvailability = null;
    if (isQcUser && !hasElevatedAccess) {
      qcUserRequestAvailability = getQcUserLatestRequestAvailability(
        qc,
        beforeInspectionRecords,
        {
          currentUserId,
          inspectionDate:
            last_inspected_date !== undefined
              ? inspectionDateForPermissionRaw
              : "",
        },
      );
      if (!qcUserRequestAvailability.isAvailable) {
        return res
          .status(qcUserRequestAvailability.statusCode || 403)
          .json({
            message: qcUserRequestAvailability.reason,
          });
      }

      const activeRequestInspectorId = String(
        qcUserRequestAvailability?.latestRequestEntry?.inspector?._id ||
          qcUserRequestAvailability?.latestRequestEntry?.inspector ||
          qc?.inspector?._id ||
          qc?.inspector ||
          "",
      ).trim();
      if (requestedInspectorId && requestedInspectorId !== activeRequestInspectorId) {
        return res.status(403).json({
          message: "QC cannot change the requested inspector",
        });
      }
    }

    if (requestedInspectorId) {
      if (!mongoose.Types.ObjectId.isValid(requestedInspectorId)) {
        return res.status(400).json({ message: "Invalid inspector id" });
      }
      qc.inspector = requestedInspectorId;
    }

    /* ────────────────────────
         📐 LBH → CBM HELPERS
      ──────────────────────── */

    const hasCbmUpdate =
      CBM !== undefined ||
      CBM_box1 !== undefined ||
      CBM_box2 !== undefined ||
      CBM_box3 !== undefined ||
      CBM_top !== undefined ||
      CBM_bottom !== undefined;

    const parseCbmField = (value, fieldName) => {
      if (value === undefined) return { hasInput: false, value: null };
      if (value === null || String(value).trim() === "") {
        return { hasInput: true, value: 0 };
      }

      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${fieldName} must be a valid non-negative number`);
      }
      return { hasInput: true, value: parsed };
    };

    const parsedCbmTotal = parseCbmField(CBM, "CBM");
    const parsedCbmBox1 = parseCbmField(
      CBM_box1 !== undefined ? CBM_box1 : CBM_top,
      "CBM box1",
    );
    const parsedCbmBox2 = parseCbmField(
      CBM_box2 !== undefined ? CBM_box2 : CBM_bottom,
      "CBM box2",
    );
    const parsedCbmBox3 = parseCbmField(CBM_box3, "CBM box3");

    const parseSizeEntriesPayload = (
      value,
      fieldName,
      { remarkOptions = [], weightKey = "", mode = "" } = {},
    ) => {
      if (value === undefined) return { hasInput: false, value: null };
      if (value === null) {
        return allowAdminRewrite
          ? { hasInput: true, value: [] }
          : { hasInput: false, value: null };
      }
      if (!Array.isArray(value)) {
        throw new Error(`${fieldName} must be an array`);
      }

      const nonEmptyEntries = value.filter((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return false;
        }
        return (
          normalizeText(entry?.remark || entry?.type || "") !== "" ||
          normalizeText(entry?.L) !== "" ||
          normalizeText(entry?.B) !== "" ||
          normalizeText(entry?.H) !== "" ||
          (weightKey ? normalizeText(entry?.[weightKey]) !== "" : false)
        );
      });

      if (nonEmptyEntries.length === 0) {
        return allowAdminRewrite
          ? { hasInput: true, value: [] }
          : { hasInput: false, value: null };
      }

      if (nonEmptyEntries.length > SIZE_ENTRY_LIMIT) {
        throw new Error(`${fieldName} cannot exceed ${SIZE_ENTRY_LIMIT} entries`);
      }

      const resolvedBoxMode =
        fieldName === "inspected_box_sizes"
          ? detectBoxPackagingMode(mode, nonEmptyEntries)
          : BOX_PACKAGING_MODES.INDIVIDUAL;

      if (
        fieldName === "inspected_box_sizes" &&
        resolvedBoxMode === BOX_PACKAGING_MODES.CARTON &&
        nonEmptyEntries.length !== 2
      ) {
        throw new Error(`${fieldName} must contain exactly 2 entries in carton mode`);
      }

      const seenRemarks = new Set();
      const parsedEntries = nonEmptyEntries.map((entry, entryIndex) => {
        const L = toNonNegativeNumber(entry?.L, NaN);
        const B = toNonNegativeNumber(entry?.B, NaN);
        const H = toNonNegativeNumber(entry?.H, NaN);
        if (
          !Number.isFinite(L) ||
          !Number.isFinite(B) ||
          !Number.isFinite(H) ||
          L <= 0 ||
          B <= 0 ||
          H <= 0
        ) {
          throw new Error(
            `${fieldName}[${entryIndex}] must include valid L, B and H values greater than 0`,
          );
        }

        const normalizedRemark = normalizeText(
          entry?.remark || entry?.type || "",
        ).toLowerCase();
        const nextRemark =
          nonEmptyEntries.length === 1 ? "" : normalizedRemark;

        if (nonEmptyEntries.length > 1) {
          if (!nextRemark) {
            throw new Error(
              `${fieldName}[${entryIndex}] remark is required when multiple entries are provided`,
            );
          }
          if (!remarkOptions.includes(nextRemark)) {
            throw new Error(`${fieldName}[${entryIndex}] remark is invalid`);
          }
          if (seenRemarks.has(nextRemark)) {
            throw new Error(`${fieldName} remarks must be unique`);
          }
          seenRemarks.add(nextRemark);
        }

        const parsedEntry = {
          L,
          B,
          H,
          remark: nextRemark,
        };

        if (weightKey) {
          parsedEntry[weightKey] = toNonNegativeNumber(entry?.[weightKey], 0);
          if (parsedEntry[weightKey] <= 0) {
            throw new Error(
              `${fieldName}[${entryIndex}].${weightKey} must be greater than 0`,
            );
          }
        }

        if (fieldName === "inspected_box_sizes") {
          if (resolvedBoxMode === BOX_PACKAGING_MODES.CARTON) {
            const boxType = entryIndex === 0 ? "inner" : "master";
            parsedEntry.remark = boxType;
            parsedEntry.box_type = boxType;
            parsedEntry.item_count_in_inner =
              boxType === "inner"
                ? toNonNegativeNumber(entry?.item_count_in_inner, 0)
                : 0;
            parsedEntry.box_count_in_master =
              boxType === "master"
                ? toNonNegativeNumber(entry?.box_count_in_master, 0)
                : 0;

            if (boxType === "inner" && parsedEntry.item_count_in_inner <= 0) {
              throw new Error(
                `${fieldName}[${entryIndex}].item_count_in_inner must be greater than 0`,
              );
            }
            if (boxType === "master" && parsedEntry.box_count_in_master <= 0) {
              throw new Error(
                `${fieldName}[${entryIndex}].box_count_in_master must be greater than 0`,
              );
            }
          } else {
            parsedEntry.box_type = "individual";
            parsedEntry.item_count_in_inner = 0;
            parsedEntry.box_count_in_master = 0;
          }
        }

        return parsedEntry;
      });

      return {
        hasInput: true,
        value: parsedEntries,
        mode:
          fieldName === "inspected_box_sizes"
            ? resolvedBoxMode
            : BOX_PACKAGING_MODES.INDIVIDUAL,
      };
    };
    const sortSizeEntriesForLegacy = (entries = [], remarkOptions = []) =>
      [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
        const leftIndex = remarkOptions.indexOf(normalizeText(left?.remark).toLowerCase());
        const rightIndex = remarkOptions.indexOf(normalizeText(right?.remark).toLowerCase());
        const safeLeftIndex = leftIndex >= 0 ? leftIndex : SIZE_ENTRY_LIMIT + 1;
        const safeRightIndex = rightIndex >= 0 ? rightIndex : SIZE_ENTRY_LIMIT + 1;
        return safeLeftIndex - safeRightIndex;
      });
    const toLegacyLbhGroup = (entry = null) =>
      entry && hasCompletePositiveLbh(entry)
        ? {
            L: toNonNegativeNumber(entry?.L, 0),
            B: toNonNegativeNumber(entry?.B, 0),
            H: toNonNegativeNumber(entry?.H, 0),
          }
        : { ...EMPTY_LBH };
    const deriveLegacySizeFields = (
      entries = [],
      { remarkOptions = [], weightKey = "", mode = "" } = {},
    ) => {
      if (Array.isArray(remarkOptions) && remarkOptions === BOX_SIZE_REMARK_OPTIONS) {
        return buildBoxLegacyFieldsFromEntries(entries, { weightKey, mode });
      }

      const sortedEntries = sortSizeEntriesForLegacy(entries, remarkOptions);
      const totalWeight = weightKey
        ? sortedEntries.reduce(
            (sum, entry) => sum + toNonNegativeNumber(entry?.[weightKey], 0),
            0,
          )
        : 0;

      return {
        single: sortedEntries.length === 1 ? toLegacyLbhGroup(sortedEntries[0]) : { ...EMPTY_LBH },
        top: sortedEntries.length >= 2 ? toLegacyLbhGroup(sortedEntries[0]) : { ...EMPTY_LBH },
        bottom: sortedEntries.length >= 2 ? toLegacyLbhGroup(sortedEntries[1]) : { ...EMPTY_LBH },
        totalWeight,
        topWeight:
          sortedEntries.length >= 2 && weightKey
            ? toNonNegativeNumber(sortedEntries[0]?.[weightKey], 0)
            : 0,
        bottomWeight:
          sortedEntries.length >= 2 && weightKey
            ? toNonNegativeNumber(sortedEntries[1]?.[weightKey], 0)
            : 0,
        };
      };
    const buildDerivedLbhUpdate = (
      parsedSizeEntries,
      derivedFields,
      slot = "single",
    ) => {
      const sizeEntries = Array.isArray(parsedSizeEntries?.value)
        ? parsedSizeEntries.value
        : [];
      if (!parsedSizeEntries?.hasInput) {
        return { hasInput: false, value: null };
      }
      if (slot === "single") {
        return {
          hasInput: true,
          value: sizeEntries.length === 1
            ? (derivedFields?.single || { ...EMPTY_LBH })
            : { ...EMPTY_LBH },
        };
      }
      return {
        hasInput: true,
        value: sizeEntries.length >= 2
          ? (derivedFields?.[slot] || { ...EMPTY_LBH })
          : { ...EMPTY_LBH },
      };
    };

    const parseLbhPayload = (value, fieldName) => {
      if (value === undefined) return { hasInput: false, value: null };
      if (value === null) {
        if (!allowAdminRewrite) {
          throw new Error(`${fieldName} must be an object with L, B and H`);
        }
        return { hasInput: true, value: { ...EMPTY_LBH } };
      }
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${fieldName} must be an object with L, B and H`);
      }

      const hasAnyInput =
        value.L !== undefined || value.B !== undefined || value.H !== undefined;
      if (!hasAnyInput) {
        return allowAdminRewrite
          ? { hasInput: true, value: { ...EMPTY_LBH } }
          : { hasInput: false, value: null };
      }

      if (
        value.L === undefined ||
        value.B === undefined ||
        value.H === undefined
      ) {
        throw new Error(`${fieldName} must include L, B and H`);
      }

      const L = toNonNegativeNumber(value.L, NaN);
      const B = toNonNegativeNumber(value.B, NaN);
      const H = toNonNegativeNumber(value.H, NaN);
      if (
        !Number.isFinite(L) ||
        !Number.isFinite(B) ||
        !Number.isFinite(H) ||
        L <= 0 ||
        B <= 0 ||
        H <= 0
      ) {
        throw new Error(
          `${fieldName} values must be valid numbers greater than 0`,
        );
      }

      return { hasInput: true, value: { L, B, H } };
    };
    const parseInspectedWeightPayloadField = (value, fieldName) => {
      if (value === undefined) return { hasInput: false, value: null };
      const normalized = String(value ?? "").trim();
      if (!normalized) {
        if (allowAdminRewrite) {
          return { hasInput: true, value: 0 };
        }
        throw new Error(`${fieldName} must be greater than 0`);
      }

      const parsed = toNonNegativeNumber(normalized, NaN);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${fieldName} must be greater than 0`);
      }
      return { hasInput: true, value: parsed };
    };
    const isSameLbhValue = (left = {}, right = {}) =>
      toNonNegativeNumber(left?.L, 0) === toNonNegativeNumber(right?.L, 0) &&
      toNonNegativeNumber(left?.B, 0) === toNonNegativeNumber(right?.B, 0) &&
      toNonNegativeNumber(left?.H, 0) === toNonNegativeNumber(right?.H, 0);
    const hasSameNumericValue = (left, right) =>
      Math.abs(toNonNegativeNumber(left, 0) - toNonNegativeNumber(right, 0)) <
      0.000001;

    const parsedInspectedItemSizeEntries = parseSizeEntriesPayload(
      inspected_item_sizes,
      "inspected_item_sizes",
      {
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        weightKey: "net_weight",
      },
    );
    const parsedInspectedBoxMode = detectBoxPackagingMode(
      inspected_box_mode,
      inspected_box_sizes,
    );
    const parsedInspectedBoxSizeEntries = parseSizeEntriesPayload(
      inspected_box_sizes,
      "inspected_box_sizes",
      {
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        weightKey: "gross_weight",
        mode: parsedInspectedBoxMode,
      },
    );
    const derivedLegacyItemSizeFields = parsedInspectedItemSizeEntries.hasInput
      ? deriveLegacySizeFields(parsedInspectedItemSizeEntries.value || [], {
          remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
          weightKey: "net_weight",
        })
      : null;
    const derivedLegacyBoxSizeFields = parsedInspectedBoxSizeEntries.hasInput
      ? deriveLegacySizeFields(parsedInspectedBoxSizeEntries.value || [], {
          remarkOptions: BOX_SIZE_REMARK_OPTIONS,
          weightKey: "gross_weight",
          mode: parsedInspectedBoxSizeEntries.mode || parsedInspectedBoxMode,
        })
      : null;

    const parsedInspectedItemLbh = parsedInspectedItemSizeEntries.hasInput
      ? buildDerivedLbhUpdate(
          parsedInspectedItemSizeEntries,
          derivedLegacyItemSizeFields,
          "single",
        )
      : parseLbhPayload(
          inspected_item_LBH,
          "inspected_item_LBH",
        );
    const parsedInspectedItemTopLbh = parsedInspectedItemSizeEntries.hasInput
      ? buildDerivedLbhUpdate(
          parsedInspectedItemSizeEntries,
          derivedLegacyItemSizeFields,
          "top",
        )
      : parseLbhPayload(
          inspected_item_top_LBH,
          "inspected_item_top_LBH",
        );
    const parsedInspectedItemBottomLbh = parsedInspectedItemSizeEntries.hasInput
      ? buildDerivedLbhUpdate(
          parsedInspectedItemSizeEntries,
          derivedLegacyItemSizeFields,
          "bottom",
        )
      : parseLbhPayload(
          inspected_item_bottom_LBH,
          "inspected_item_bottom_LBH",
        );
    const parsedInspectedBoxLbh = parsedInspectedBoxSizeEntries.hasInput
      ? buildDerivedLbhUpdate(
          parsedInspectedBoxSizeEntries,
          derivedLegacyBoxSizeFields,
          "single",
        )
      : parseLbhPayload(
          inspected_box_LBH,
          "inspected_box_LBH",
        );
    const parsedInspectedTopLbh = parsedInspectedBoxSizeEntries.hasInput
      ? buildDerivedLbhUpdate(
          parsedInspectedBoxSizeEntries,
          derivedLegacyBoxSizeFields,
          "top",
        )
      : parseLbhPayload(
          inspected_box_top_LBH !== undefined
            ? inspected_box_top_LBH
            : inspected_top_LBH,
          "inspected_box_top_LBH",
        );
    const parsedInspectedBottomLbh = parsedInspectedBoxSizeEntries.hasInput
      ? buildDerivedLbhUpdate(
          parsedInspectedBoxSizeEntries,
          derivedLegacyBoxSizeFields,
          "bottom",
        )
      : parseLbhPayload(
          inspected_box_bottom_LBH !== undefined
            ? inspected_box_bottom_LBH
            : inspected_bottom_LBH,
          "inspected_box_bottom_LBH",
        );
    const nextInspectedItemLbh = parsedInspectedItemLbh.value;
    const nextInspectedItemTopLbh = parsedInspectedItemTopLbh.value;
    const nextInspectedItemBottomLbh = parsedInspectedItemBottomLbh.value;
    const nextInspectedBoxLbh = parsedInspectedBoxLbh.value;
    const nextInspectedTopLbh = parsedInspectedTopLbh.value;
    const nextInspectedBottomLbh = parsedInspectedBottomLbh.value;
    const hasInspectedLbhUpdate = Boolean(
      parsedInspectedItemLbh.hasInput ||
      parsedInspectedItemTopLbh.hasInput ||
      parsedInspectedItemBottomLbh.hasInput ||
      parsedInspectedBoxLbh.hasInput ||
      parsedInspectedTopLbh.hasInput ||
      parsedInspectedBottomLbh.hasInput
    );

    if (
      inspected_weight !== undefined &&
      (inspected_weight === null ||
        typeof inspected_weight !== "object" ||
        Array.isArray(inspected_weight))
    ) {
      return res.status(400).json({
        message:
          "inspected_weight must be an object with top/bottom/total net/gross values",
      });
    }
    const parsedInspectedWeightFields = INSPECTED_WEIGHT_FIELD_KEYS.reduce(
      (accumulator, fieldKey) => {
        if (parsedInspectedItemSizeEntries.hasInput || parsedInspectedBoxSizeEntries.hasInput) {
          const derivedWeightValue =
            fieldKey === "total_net"
              ? derivedLegacyItemSizeFields?.totalWeight
              : fieldKey === "top_net"
                ? derivedLegacyItemSizeFields?.topWeight
                : fieldKey === "bottom_net"
                  ? derivedLegacyItemSizeFields?.bottomWeight
                  : fieldKey === "total_gross"
                    ? derivedLegacyBoxSizeFields?.totalWeight
                    : fieldKey === "top_gross"
                      ? derivedLegacyBoxSizeFields?.topWeight
                      : fieldKey === "bottom_gross"
                        ? derivedLegacyBoxSizeFields?.bottomWeight
                        : undefined;
          accumulator[fieldKey] = {
            hasInput: true,
            value: toNonNegativeNumber(derivedWeightValue, 0),
          };
          return accumulator;
        }

        const rawValue =
          inspected_weight?.[fieldKey] ??
          (LEGACY_WEIGHT_FALLBACK_BY_KEY[fieldKey]
            ? inspected_weight?.[LEGACY_WEIGHT_FALLBACK_BY_KEY[fieldKey]]
            : undefined);
        accumulator[fieldKey] = parseInspectedWeightPayloadField(
          rawValue,
          `inspected_weight.${fieldKey}`,
        );
        return accumulator;
      },
      {},
    );
    const hasInspectedWeightUpdate = INSPECTED_WEIGHT_FIELD_KEYS.some(
      (fieldKey) => parsedInspectedWeightFields[fieldKey]?.hasInput,
    );
    const hasInspectedBoxModeUpdate = inspected_box_mode !== undefined;

    const hasItemMasterUpdate =
      hasInspectedLbhUpdate || hasInspectedWeightUpdate || hasInspectedBoxModeUpdate;
    const itemCodeForInspectedLbhUpdate =
      hasItemMasterUpdate || hasCbmUpdate
        ? normalizeText(qc?.item?.item_code || "")
        : "";
    if (
      (hasItemMasterUpdate || hasCbmUpdate) &&
      !itemCodeForInspectedLbhUpdate
    ) {
      return res.status(400).json({
        message:
          "Item code is required to update inspected LBH/weight or CBM fields",
      });
    }

    let itemDocForInspectedLbhUpdate = null;
    if (itemCodeForInspectedLbhUpdate) {
      itemDocForInspectedLbhUpdate = await Item.findOne({
        code: {
          $regex: `^${escapeRegex(itemCodeForInspectedLbhUpdate)}$`,
          $options: "i",
        },
      });
    }

    if (hasItemMasterUpdate && !itemDocForInspectedLbhUpdate) {
      return res.status(404).json({
        message: "Item master record not found for this item code",
      });
    }

    if (hasInspectedLbhUpdate && !allowQcFieldEdits) {
      const assertWriteOnceLbh = (incomingValue, existingValue, fieldName) => {
        if (!incomingValue) return;
        if (
          hasCompletePositiveLbh(existingValue) &&
          !isSameLbhValue(existingValue, incomingValue)
        ) {
          throw new Error(`${fieldName} can only be set once`);
        }
      };

      assertWriteOnceLbh(
        nextInspectedItemLbh,
        itemDocForInspectedLbhUpdate?.inspected_item_LBH,
        "inspected_item_LBH",
      );
      assertWriteOnceLbh(
        nextInspectedItemTopLbh,
        itemDocForInspectedLbhUpdate?.inspected_item_top_LBH,
        "inspected_item_top_LBH",
      );
      assertWriteOnceLbh(
        nextInspectedItemBottomLbh,
        itemDocForInspectedLbhUpdate?.inspected_item_bottom_LBH,
        "inspected_item_bottom_LBH",
      );
      assertWriteOnceLbh(
        nextInspectedBoxLbh,
        itemDocForInspectedLbhUpdate?.inspected_box_LBH,
        "inspected_box_LBH",
      );
      assertWriteOnceLbh(
        nextInspectedTopLbh,
        itemDocForInspectedLbhUpdate?.inspected_box_top_LBH ||
          itemDocForInspectedLbhUpdate?.inspected_top_LBH,
        "inspected_box_top_LBH",
      );
      assertWriteOnceLbh(
        nextInspectedBottomLbh,
        itemDocForInspectedLbhUpdate?.inspected_box_bottom_LBH ||
          itemDocForInspectedLbhUpdate?.inspected_bottom_LBH,
        "inspected_box_bottom_LBH",
      );
    }

    if (hasInspectedWeightUpdate && !allowQcFieldEdits) {
      for (const fieldKey of INSPECTED_WEIGHT_FIELD_KEYS) {
        const parsedField = parsedInspectedWeightFields[fieldKey];
        if (!parsedField?.hasInput) continue;

        const existingWeightValue = getWeightFieldValue(
          itemDocForInspectedLbhUpdate?.inspected_weight,
          fieldKey,
          0,
        );

        if (
          existingWeightValue > 0 &&
          !hasSameNumericValue(existingWeightValue, parsedField.value)
        ) {
          throw new Error(`inspected_weight.${fieldKey} can only be set once`);
        }
      }
    }

    const effectiveInspectedItemLbh =
      parsedInspectedItemLbh.hasInput
        ? nextInspectedItemLbh || {}
        : itemDocForInspectedLbhUpdate?.inspected_item_LBH ||
          itemDocForInspectedLbhUpdate?.item_LBH ||
          {};
    const effectiveInspectedItemTopLbh =
      parsedInspectedItemTopLbh.hasInput
        ? nextInspectedItemTopLbh || {}
        : itemDocForInspectedLbhUpdate?.inspected_item_top_LBH || {};
    const effectiveInspectedItemBottomLbh =
      parsedInspectedItemBottomLbh.hasInput
        ? nextInspectedItemBottomLbh || {}
        : itemDocForInspectedLbhUpdate?.inspected_item_bottom_LBH || {};
    const effectiveInspectedBoxLbh =
      parsedInspectedBoxLbh.hasInput
        ? nextInspectedBoxLbh || {}
        : itemDocForInspectedLbhUpdate?.inspected_box_LBH ||
          itemDocForInspectedLbhUpdate?.box_LBH ||
          {};
    const effectiveInspectedTopLbh =
      parsedInspectedTopLbh.hasInput
        ? nextInspectedTopLbh || {}
        : itemDocForInspectedLbhUpdate?.inspected_box_top_LBH ||
          itemDocForInspectedLbhUpdate?.inspected_top_LBH ||
          {};
    const effectiveInspectedBottomLbh =
      parsedInspectedBottomLbh.hasInput
        ? nextInspectedBottomLbh || {}
        : itemDocForInspectedLbhUpdate?.inspected_box_bottom_LBH ||
          itemDocForInspectedLbhUpdate?.inspected_bottom_LBH ||
          {};
    const existingCbmSnapshot = buildNormalizedCbmSnapshot(qc?.cbm);
    const existingCbmTotal = toNonNegativeNumber(existingCbmSnapshot?.total, 0);
    const existingCbmBox1 = toNonNegativeNumber(existingCbmSnapshot?.box1, 0);
    const existingCbmBox2 = toNonNegativeNumber(existingCbmSnapshot?.box2, 0);
    const existingCbmBox3 = toNonNegativeNumber(existingCbmSnapshot?.box3, 0);
    const cbmLockedByLbh =
      hasCompletePositiveLbh(effectiveInspectedItemLbh) ||
      hasCompletePositiveLbh(effectiveInspectedItemTopLbh) ||
      hasCompletePositiveLbh(effectiveInspectedItemBottomLbh) ||
      hasCompletePositiveLbh(effectiveInspectedBoxLbh) ||
      hasCompletePositiveLbh(effectiveInspectedTopLbh) ||
      hasCompletePositiveLbh(effectiveInspectedBottomLbh);

    if (hasCbmUpdate && cbmLockedByLbh && !allowQcFieldEdits) {
      return res.status(400).json({
        message:
          "CBM fields are locked because inspected LBH is present. Update LBH instead.",
      });
    }

    if (hasCbmUpdate) {
      const hasExplicitBoxUpdate =
        parsedCbmBox1.hasInput ||
        parsedCbmBox2.hasInput ||
        parsedCbmBox3.hasInput;

      if (hasExplicitBoxUpdate) {
        qc.cbm = buildNormalizedCbmSnapshot({
          box1: parsedCbmBox1.hasInput ? parsedCbmBox1.value : existingCbmBox1,
          box2: parsedCbmBox2.hasInput ? parsedCbmBox2.value : existingCbmBox2,
          box3: parsedCbmBox3.hasInput ? parsedCbmBox3.value : existingCbmBox3,
          total: parsedCbmTotal.hasInput ? parsedCbmTotal.value : existingCbmTotal,
        });
      } else if (parsedCbmTotal.hasInput) {
        qc.cbm = buildSingleBoxCbmSnapshot(parsedCbmTotal.value);
      }
    }

    if (last_inspected_date !== undefined) {
      const normalizedLastInspectedDate = toISODateString(last_inspected_date);
      if (!normalizedLastInspectedDate) {
        return res.status(400).json({
          message:
            "last_inspected_date must be a valid date in DD/MM/YYYY or YYYY-MM-DD format",
        });
      }
      if (
        isManager &&
        !isIsoDateWithinPastDaysInclusive(
          normalizedLastInspectedDate,
          updateQcPastDaysLimit,
        )
      ) {
        return res.status(403).json({
          message: buildUpdateQcPastDaysMessage(
            normalizedRole,
            updateQcPastDaysLimit,
          ),
        });
      }
      qc.last_inspected_date = normalizedLastInspectedDate;
    }

    /* ────────────────────────
         🔢 BARCODE
      ──────────────────────── */

    const nextMasterBarcodeRaw =
      master_barcode !== undefined ? master_barcode : barcode;
    if (nextMasterBarcodeRaw !== undefined) {
      const nextMasterBarcode = Number(nextMasterBarcodeRaw);
      if (!Number.isFinite(nextMasterBarcode) || nextMasterBarcode < 0) {
        return res.status(400).json({
          message: "master_barcode must be a non-negative number",
        });
      }
      if (!allowQcFieldEdits && !isAdmin) {
        const currentMasterBarcode = Number(qc?.master_barcode || qc?.barcode || 0);
        if (currentMasterBarcode > 0 && nextMasterBarcode !== currentMasterBarcode) {
          return res
            .status(400)
            .json({ message: "master barcode can only be set once" });
        }
      }
      qc.master_barcode = nextMasterBarcode;
      qc.barcode = nextMasterBarcode;
    }

    if (inner_barcode !== undefined) {
      const nextInnerBarcode = Number(inner_barcode);
      if (!Number.isFinite(nextInnerBarcode) || nextInnerBarcode < 0) {
        return res.status(400).json({
          message: "inner_barcode must be a non-negative number",
        });
      }
      if (!allowQcFieldEdits && !isAdmin) {
        const currentInnerBarcode = Number(qc?.inner_barcode || 0);
        if (currentInnerBarcode > 0 && nextInnerBarcode !== currentInnerBarcode) {
          return res
            .status(400)
            .json({ message: "inner barcode can only be set once" });
        }
      }
      qc.inner_barcode = nextInnerBarcode;
    }

    /* ────────────────────────
         ✅ BOOLEAN FLAGS
      ──────────────────────── */

    const setOnceBoolean = (field, value, name) => {
      if (value === undefined) return;
      if (typeof value !== "boolean") {
        throw new Error(`${name} must be boolean`);
      }
      if (allowQcFieldEdits) {
        qc[field] = value;
        return;
      }
      if (qc[field] && value === false) {
        throw new Error(`${name} can only be set once`);
      }
      if (!qc[field] && value === true) {
        qc[field] = true;
      }
    };

    setOnceBoolean("packed_size", packed_size, "packed_size");
    setOnceBoolean("finishing", finishing, "finishing");
    setOnceBoolean("branding", branding, "branding");

    /* ────────────────────────
         🔢 QUANTITIES
      ──────────────────────── */

    const addChecked = Number(qc_checked ?? 0);
    const addPassed = Number(qc_passed ?? 0);
    const addProvision = Number(vendor_provision ?? 0);
    const hasExplicitQuantityPayload =
      qc_checked !== undefined ||
      qc_passed !== undefined ||
      vendor_provision !== undefined;
    const hasExplicitLabelsPayload =
      labels !== undefined ||
      label_ranges !== undefined;
    const requestType = normalizeQcRequestType(qc?.request_type);
    const quantityRequestedCap = latestRequestedQuantity;
    const clientDemandQuantity = toNonNegativeNumber(
      qc?.quantities?.client_demand,
      0,
    );
    const currentAggregateMetrics = calculateQcAggregateMetrics(
      qc,
      beforeInspectionRecords,
    );
    const currentCheckedTotal = currentAggregateMetrics.totalChecked;
    const currentSamplePassedTotal = currentAggregateMetrics.totalSamplePassed;
    const currentEffectivePassedTotal =
      currentAggregateMetrics.totalEffectivePassed;
    const currentVendorOfferedTotal =
      currentAggregateMetrics.totalVendorOffered;
    const currentRequestInspectionRecord =
      resolveLatestInspectionRecordForRequestEntry(
        beforeInspectionRecords,
        latestRequestEntry,
      );
    const currentRequestRequestedQuantity =
      [
        currentRequestInspectionRecord?.vendor_requested,
        latestRequestEntry?.quantity_requested,
        quantityRequestedCap,
        clientDemandQuantity,
      ]
        .map((value) => toNonNegativeNumber(value, 0))
        .find((value) => value > 0) || 0;
    const currentRequestCheckedBefore = toNonNegativeNumber(
      currentRequestInspectionRecord?.checked,
      0,
    );
    const currentRequestSamplePassedBefore = toNonNegativeNumber(
      currentRequestInspectionRecord?.passed,
      0,
    );
    const currentRequestOfferedBefore = toNonNegativeNumber(
      currentRequestInspectionRecord?.vendor_offered,
      0,
    );
    const currentRequestEffectivePassedBefore =
      getEffectiveRequestPassedQuantity({
        requestType,
        samplePassed: currentRequestSamplePassedBefore,
        requestedQuantity: currentRequestRequestedQuantity,
      });

    if (
      [addChecked, addPassed, addProvision].some(
        (v) => v < 0 || Number.isNaN(v),
      )
    ) {
      return res.status(400).json({
        message: "Quantity values must be valid non-negative numbers",
      });
    }

    const hasLabelRangePayload =
      Array.isArray(label_ranges) &&
      label_ranges.some(
        (range) =>
          range &&
          (String(range.start ?? "").trim() !== "" ||
            String(range.end ?? "").trim() !== ""),
      );
    const hasLabelsPayload =
      (Array.isArray(labels) && labels.length > 0) || hasLabelRangePayload;

    const buildLabelsFromRanges = (ranges = []) => {
      const normalizedRanges = [];
      const generatedLabels = [];

      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i] || {};
        const hasStart = String(range.start ?? "").trim() !== "";
        const hasEnd = String(range.end ?? "").trim() !== "";

        if (!hasStart && !hasEnd) continue;
        if (!hasStart || !hasEnd) {
          throw new Error(
            `Both start and end are required for label range ${i + 1}`,
          );
        }

        const start = Number(range.start);
        const end = Number(range.end);
        if (!Number.isInteger(start) || !Number.isInteger(end)) {
          throw new Error(`Label range ${i + 1} must contain integer values`);
        }
        if (start < 0 || end < 0) {
          throw new Error(
            `Label range ${i + 1} must contain non-negative values`,
          );
        }
        if (start > end) {
          throw new Error(
            `Start cannot be greater than end in label range ${i + 1}`,
          );
        }

        normalizedRanges.push({ start, end });
        for (let label = start; label <= end; label++) {
          generatedLabels.push(label);
        }
      }

      return { generatedLabels, normalizedRanges };
    };

    // If user is updating passed quantity or labels, they must provide checked in same visit
    if (
      !allowAdminRewrite &&
      (
        addPassed ||
        (Array.isArray(labels) && labels.length) ||
        hasLabelRangePayload
      ) &&
      addChecked <= 0
    ) {
      return res.status(400).json({
        message:
          "qc_checked must be greater than 0 when updating quantities or labels",
      });
    }

    let nextVendorProvision = currentVendorOfferedTotal;
    let nextChecked = currentCheckedTotal;
    let nextSamplePassedTotal = currentSamplePassedTotal;
    let nextCurrentRequestChecked = currentRequestCheckedBefore;
    let nextCurrentRequestSamplePassed = currentRequestSamplePassedBefore;
    let nextCurrentRequestOffered = currentRequestOfferedBefore;

    if (allowAdminRewrite && hasExplicitQuantityPayload) {
      nextVendorProvision = toNonNegativeNumber(vendor_provision, 0);
      nextChecked = toNonNegativeNumber(qc_checked, 0);
      nextSamplePassedTotal = toNonNegativeNumber(qc_passed, 0);

      const otherChecked = Math.max(
        0,
        currentCheckedTotal - currentRequestCheckedBefore,
      );
      const otherOffered = Math.max(
        0,
        currentVendorOfferedTotal - currentRequestOfferedBefore,
      );
      const otherSamplePassed = Math.max(
        0,
        currentSamplePassedTotal - currentRequestSamplePassedBefore,
      );

      nextCurrentRequestChecked = Math.max(0, nextChecked - otherChecked);
      nextCurrentRequestOffered = Math.max(0, nextVendorProvision - otherOffered);
      nextCurrentRequestSamplePassed = Math.max(
        0,
        nextSamplePassedTotal - otherSamplePassed,
      );
    } else {
      nextVendorProvision = currentVendorOfferedTotal + addProvision;
      nextChecked = currentCheckedTotal + addChecked;
      nextSamplePassedTotal = currentSamplePassedTotal + addPassed;
      nextCurrentRequestChecked = currentRequestCheckedBefore + addChecked;
      nextCurrentRequestSamplePassed = currentRequestSamplePassedBefore + addPassed;
      nextCurrentRequestOffered = currentRequestOfferedBefore + addProvision;
    }

    const nextEffectivePassed =
      Math.max(0, currentEffectivePassedTotal - currentRequestEffectivePassedBefore) +
      getEffectiveRequestPassedQuantity({
        requestType,
        samplePassed: nextCurrentRequestSamplePassed,
        requestedQuantity: currentRequestRequestedQuantity,
      });

    if (nextVendorProvision < 0) {
      return res
        .status(400)
        .json({ message: "offered quantity cannot be negative" });
    }

    const pendingQuantityLimit = Math.max(
      0,
      clientDemandQuantity - currentEffectivePassedTotal,
    );

    if (allowAdminRewrite && hasExplicitQuantityPayload) {
      // Admin rewrite updates aggregate QC totals across inspection rows.
      // Per-request offered/requested validation belongs to the inspection row edit route.
    } else if (hasStartedInspection) {
      if (addProvision > pendingQuantityLimit) {
        return res.status(400).json({
          message: "offered quantity cannot exceed pending quantity",
        });
      }
    } else if (
      Number.isFinite(quantityRequestedCap) &&
      quantityRequestedCap >= 0 &&
      nextVendorProvision > quantityRequestedCap
    ) {
      return res.status(400).json({
        message: "offered quantity cannot exceed quantity requested",
      });
    }

    if (nextCurrentRequestChecked > nextCurrentRequestOffered) {
      return res.status(400).json({
        message: "qc_checked cannot exceed offered quantity",
      });
    }

    if (nextCurrentRequestSamplePassed > nextCurrentRequestChecked) {
      return res.status(400).json({
        message: "qc_passed cannot exceed qc_checked",
      });
    }

    if (nextCurrentRequestSamplePassed > nextCurrentRequestOffered) {
      return res.status(400).json({
        message: "passed quantity cannot exceed offered quantity",
      });
    }

    // Calculate size counts for label validation
    const boxSizesArray = parsedInspectedBoxSizeEntries.hasInput
      ? parsedInspectedBoxSizeEntries.value
      : (itemDocForInspectedLbhUpdate?.inspected_box_sizes ||
         itemDocForInspectedLbhUpdate?.pis_box_sizes ||
         []);
    const boxSizesCount = Array.isArray(boxSizesArray) ? boxSizesArray.length : 0;

    const currentRequestLabelsBefore = normalizeLabels(
      currentRequestInspectionRecord?.labels_added || [],
    );
    const labelRequirement = getQcLabelRequirement({
      totalPassed: nextCurrentRequestSamplePassed,
      boxSizesCount,
    });
    const existingNormalizedLabels = normalizeLabels(qc.labels || []);

    qc.quantities.vendor_provision = nextVendorProvision;
    qc.quantities.qc_checked = nextChecked;
    qc.quantities.qc_passed = nextEffectivePassed;
    qc.quantities.pending = Math.max(
      0,
      clientDemandQuantity - nextEffectivePassed,
    );
    qc.quantities.qc_rejected = Math.max(
      0,
      nextChecked - nextSamplePassedTotal,
    );

    /* ────────────────────────
         🏷️ LABELS (UNCHANGED LOGIC)
      ──────────────────────── */

    let labelsAddedThisVisit = [];
    let labelRangesUsedThisVisit = [];
    let nextLabels = existingNormalizedLabels;
    let inspectorToSave = null;
    if (allowAdminRewrite && hasExplicitLabelsPayload) {
      const directLabels = Array.isArray(labels) ? labels : [];
      const parsedDirectLabels = directLabels.map(Number);
      if (
        parsedDirectLabels.some(
          (label) => !Number.isInteger(label) || label < 0,
        )
      ) {
        return res.status(400).json({
          message: "All labels must be non-negative integers",
        });
      }

      let generatedFromRanges = [];
      if (Array.isArray(label_ranges)) {
        const rangeResult = buildLabelsFromRanges(label_ranges);
        generatedFromRanges = rangeResult.generatedLabels;
      }

      const replacementLabels =
        parsedDirectLabels.length > 0
          ? parsedDirectLabels
          : generatedFromRanges;
      const normalizedReplacementLabels = normalizeLabels(replacementLabels);
      nextLabels = normalizedReplacementLabels;
    } else if (hasLabelsPayload) {
      const inspectionInspectorUserId = qc.inspector?._id
        ? qc.inspector._id
        : qc.inspector;
      const inspector = await Inspector.findOne({
        user: inspectionInspectorUserId,
      });

      if (!inspector) {
        return res.status(404).json({ message: "Inspector record not found" });
      }

      const directLabels = Array.isArray(labels) ? labels : [];
      const parsedDirectLabels = directLabels.map(Number);
      if (
        parsedDirectLabels.some(
          (label) => !Number.isInteger(label) || label < 0,
        )
      ) {
        return res.status(400).json({
          message: "All labels must be non-negative integers",
        });
      }

      let generatedFromRanges = [];
      if (Array.isArray(label_ranges)) {
        const rangeResult = buildLabelsFromRanges(label_ranges);
        generatedFromRanges = rangeResult.generatedLabels;
        labelRangesUsedThisVisit = rangeResult.normalizedRanges;
      }

      // If client sends explicit labels, treat them as authoritative.
      // Otherwise derive from ranges.
      const labelsForUpdate =
        parsedDirectLabels.length > 0
          ? parsedDirectLabels
          : generatedFromRanges;
      const uniqueIncoming = [...new Set(labelsForUpdate)];
      const existingSet = new Set(existingNormalizedLabels);
      const incomingNew = uniqueIncoming.filter(
        (label) => !existingSet.has(label),
      );
      const allocatedSet = new Set(
        normalizeLabels(inspector.alloted_labels || []),
      );
      const usedSet = new Set(normalizeLabels(inspector.used_labels || []));
      const rejectedSet = new Set(
        normalizeLabels(inspector.rejected_labels || []),
      );

      const rejectedIncoming = incomingNew.filter((label) =>
        rejectedSet.has(label),
      );
      if (rejectedIncoming.length > 0) {
        const preview = rejectedIncoming.slice(0, 10).join(", ");
        return res.status(400).json({
          message: `Rejected labels cannot be used: ${preview}${rejectedIncoming.length > 10 ? "..." : ""}`,
        });
      }

      const unallocatedIncoming = incomingNew.filter(
        (label) => !allocatedSet.has(label),
      );
      if (unallocatedIncoming.length > 0) {
        const preview = unallocatedIncoming.slice(0, 10).join(", ");
        return res.status(400).json({
          message: `Only allocated labels are accepted. Unallocated labels: ${preview}${unallocatedIncoming.length > 10 ? "..." : ""}`,
        });
      }

      const alreadyUsedIncoming = incomingNew.filter((label) =>
        usedSet.has(label),
      );
      if (alreadyUsedIncoming.length > 0) {
        const preview = alreadyUsedIncoming.slice(0, 10).join(", ");
        return res.status(400).json({
          message: `Some labels are already used and cannot be reused: ${preview}${alreadyUsedIncoming.length > 10 ? "..." : ""}`,
        });
      }

      nextLabels = normalizeLabels([...existingNormalizedLabels, ...incomingNew]);

      inspector.used_labels = [
        ...new Set([...(inspector.used_labels || []), ...incomingNew]),
      ];

      inspectorToSave = inspector;
      labelsAddedThisVisit = incomingNew;
    }

    if (!isCurrentUserLabelExempt && !(allowAdminRewrite && hasExplicitLabelsPayload)) {
      const currentRequestLabelsAfterUpdate = normalizeLabels([
        ...currentRequestLabelsBefore,
        ...labelsAddedThisVisit,
      ]);
      const currentRequestLabelsCountAfterUpdate =
        currentRequestLabelsAfterUpdate.length;
      const requiresBoxSizeForLabels =
        nextCurrentRequestSamplePassed > 0 ||
        currentRequestLabelsCountAfterUpdate > 0;
      if (requiresBoxSizeForLabels && boxSizesCount === 0) {
        return res.status(400).json({
          message: "At least 1 box size is required to validate labels",
        });
      }

      if (currentRequestLabelsCountAfterUpdate !== labelRequirement.requiredCount) {
        return res.status(400).json({
          message: buildQcLabelRequirementMessage({
            totalPassed: nextCurrentRequestSamplePassed,
            boxSizesCount,
            actualCount: currentRequestLabelsCountAfterUpdate,
          }),
        });
      }
    } else if (!isCurrentUserLabelExempt && boxSizesCount === 0) {
      return res.status(400).json({
        message: "At least 1 box size is required to validate labels",
      });
    }

    qc.labels = nextLabels;

    if (inspectorToSave) {
      await inspectorToSave.save();
    }

    if (remarks !== undefined) {
      qc.remarks = String(remarks || "");
    }

    /* ────────────────────────
         🧾 CREATE INSPECTION RECORD
      ──────────────────────── */

    const isVisitUpdate =
      addChecked > 0 ||
      addPassed > 0 ||
      addProvision > 0 ||
      (labelsAddedThisVisit && labelsAddedThisVisit.length > 0);

    const shouldUpdateInspectionRecord =
      !allowAdminRewrite &&
      (
        isQcUser ||
        isVisitUpdate ||
        hasCbmUpdate ||
        (last_inspected_date !== undefined &&
          String(last_inspected_date).trim() !== "") ||
        remarks !== undefined
      );

    if (shouldUpdateInspectionRecord) {
      const inspectionInspectorId = qc.inspector?._id
        ? qc.inspector._id
        : qc.inspector;
      if (!inspectionInspectorId) {
        return res.status(400).json({
          message:
            "Inspector is required before updating inspection quantities",
        });
      }

      const inspectionDateForRecordRaw =
        last_inspected_date !== undefined &&
        String(last_inspected_date).trim() !== ""
          ? String(last_inspected_date).trim()
          : String(
              latestRequestEntry?.request_date ||
                qc.request_date ||
                qc.last_inspected_date ||
                "",
            ).trim();
      const inspectionDateForRecord = toISODateString(
        inspectionDateForRecordRaw,
      );

      if (!inspectionDateForRecord) {
        return res.status(400).json({
          message: "last_inspected_date is required for inspection records",
        });
      }
      if (
        isManager &&
        !isIsoDateWithinPastDaysInclusive(
          inspectionDateForRecord,
          updateQcPastDaysLimit,
        )
      ) {
        return res.status(403).json({
          message: buildUpdateQcPastDaysMessage(
            normalizedRole,
            updateQcPastDaysLimit,
          ),
        });
      }

      const requestedDateForRecordRaw = String(
        latestRequestEntry?.request_date ||
          qc.request_date ||
          inspectionDateForRecord,
      ).trim();
      const requestedDateForRecord = toISODateString(requestedDateForRecordRaw);
      if (!requestedDateForRecord) {
        return res.status(400).json({
          message: "request_date is invalid for inspection records",
        });
      }

      const requestedQuantityForRecord = quantityRequestedCap;

      const inspectionRecord = await upsertInspectionRecordForRequest({
        qcDoc: qc,
        inspectorId: inspectionInspectorId,
        requestDate: requestedDateForRecord,
        requestHistoryId: latestRequestEntry?._id || null,
        requestedQuantity: requestedQuantityForRecord,
        inspectionDate: inspectionDateForRecord,
        remarks: remarks || "",
        createdBy: req.user._id,
        auditUser: req.user,
        addChecked: isVisitUpdate ? addChecked : 0,
        addPassed: isVisitUpdate ? addPassed : 0,
        addProvision: isVisitUpdate ? addProvision : 0,
        appendLabelRanges: isVisitUpdate ? labelRangesUsedThisVisit : [],
        appendLabels: isVisitUpdate ? labelsAddedThisVisit : [],
        replaceCbmSnapshot: hasCbmUpdate || isVisitUpdate,
        explicitStatus: isQcUser ? INSPECTION_RECORD_STATUS.DONE : "",
      });

      if (latestRequestEntry && inspectionRecord && (isVisitUpdate || isQcUser)) {
        latestRequestEntry.status = REQUEST_HISTORY_STATUS.INSPECTED;
        stampRequestHistoryEntry(latestRequestEntry, {
          user: req.user,
        });
      }

      if (inspectionRecord) {
        await recalculateInspectorUsedLabels([inspectionInspectorId]);
      }
    }

    if (hasItemMasterUpdate) {
      const itemDoc = itemDocForInspectedLbhUpdate;
      let hasItemDocChanges = false;
      const hasPoCbmRelevantItemChanges = Boolean(
        parsedInspectedBoxSizeEntries.hasInput ||
          parsedInspectedBoxLbh.hasInput ||
          parsedInspectedTopLbh.hasInput ||
          parsedInspectedBottomLbh.hasInput ||
          hasInspectedBoxModeUpdate,
      );
      const setSizeEntriesPath = (
        path,
        parsedEntries,
        { weightKey = "", mode = "" } = {},
      ) => {
        if (!parsedEntries?.hasInput) return false;
        const nextEntries =
          path === "inspected_box_sizes"
            ? normalizeStoredBoxEntries(parsedEntries.value || [], {
                weightKey,
                mode: mode || parsedEntries.mode,
              })
            : normalizeStoredSizeEntries(parsedEntries.value || [], {
                weightKey,
              });
        const existingEntries =
          path === "inspected_box_sizes"
            ? normalizeStoredBoxEntries(itemDoc?.[path] || [], {
                weightKey,
                mode: itemDoc?.inspected_box_mode,
              })
            : normalizeStoredSizeEntries(itemDoc?.[path] || [], {
                weightKey,
              });
        if (JSON.stringify(existingEntries) === JSON.stringify(nextEntries)) {
          return false;
        }
        itemDoc.set(path, nextEntries);
        itemDoc.markModified(path);
        return true;
      };
      const setBoxModePath = (nextMode) => {
        const resolvedNextMode = detectBoxPackagingMode(
          nextMode,
          parsedInspectedBoxSizeEntries.value || itemDoc?.inspected_box_sizes,
        );
        const existingMode = detectBoxPackagingMode(
          itemDoc?.inspected_box_mode,
          itemDoc?.inspected_box_sizes,
        );
        if (existingMode === resolvedNextMode) return false;
        itemDoc.set("inspected_box_mode", resolvedNextMode);
        itemDoc.markModified("inspected_box_mode");
        return true;
      };
      const setLbhPath = (path, parsedUpdate) => {
        if (!parsedUpdate?.hasInput) return false;
        const value = parsedUpdate.value || EMPTY_LBH;
        const nextValue = {
          L: toNonNegativeNumber(value?.L, 0),
          B: toNonNegativeNumber(value?.B, 0),
          H: toNonNegativeNumber(value?.H, 0),
        };
        const existingValue = itemDoc.get(path);
        if (isSameLbhValue(existingValue, nextValue)) return false;
        itemDoc.set(path, nextValue);
        itemDoc.markModified(path);
        return true;
      };

      hasItemDocChanges =
        setSizeEntriesPath(
          "inspected_item_sizes",
          parsedInspectedItemSizeEntries,
          { weightKey: "net_weight" },
        ) || hasItemDocChanges;
      hasItemDocChanges =
        setSizeEntriesPath(
          "inspected_box_sizes",
          parsedInspectedBoxSizeEntries,
          {
            weightKey: "gross_weight",
            mode: parsedInspectedBoxSizeEntries.mode || parsedInspectedBoxMode,
          },
        ) || hasItemDocChanges;
      hasItemDocChanges =
        (
          (hasInspectedBoxModeUpdate || parsedInspectedBoxSizeEntries.hasInput) &&
          setBoxModePath(parsedInspectedBoxSizeEntries.mode || parsedInspectedBoxMode)
        ) || hasItemDocChanges;

      if (hasInspectedLbhUpdate) {
        hasItemDocChanges =
          setLbhPath("inspected_item_LBH", parsedInspectedItemLbh) ||
          hasItemDocChanges;
        hasItemDocChanges =
          setLbhPath("inspected_item_top_LBH", parsedInspectedItemTopLbh) ||
          hasItemDocChanges;
        hasItemDocChanges =
          setLbhPath("inspected_item_bottom_LBH", parsedInspectedItemBottomLbh) ||
          hasItemDocChanges;
        hasItemDocChanges =
          setLbhPath("inspected_box_LBH", parsedInspectedBoxLbh) ||
          hasItemDocChanges;

        hasItemDocChanges =
          setLbhPath("inspected_box_top_LBH", parsedInspectedTopLbh) ||
          hasItemDocChanges;
        hasItemDocChanges =
          setLbhPath("inspected_top_LBH", parsedInspectedTopLbh) ||
          hasItemDocChanges;

        hasItemDocChanges =
          setLbhPath("inspected_box_bottom_LBH", parsedInspectedBottomLbh) ||
          hasItemDocChanges;
        hasItemDocChanges =
          setLbhPath("inspected_bottom_LBH", parsedInspectedBottomLbh) ||
          hasItemDocChanges;
      }

      if (hasInspectedWeightUpdate) {
        const nextInspectedWeight = INSPECTED_WEIGHT_FIELD_KEYS.reduce(
          (accumulator, fieldKey) => {
            const parsedField = parsedInspectedWeightFields[fieldKey];
            accumulator[fieldKey] = parsedField?.hasInput
              ? parsedField.value
              : getWeightFieldValue(itemDoc?.inspected_weight, fieldKey, 0);
            return accumulator;
          },
          {},
        );
        const existingInspectedWeight = INSPECTED_WEIGHT_FIELD_KEYS.reduce(
          (accumulator, fieldKey) => {
            accumulator[fieldKey] = getWeightFieldValue(
              itemDoc?.inspected_weight,
              fieldKey,
              0,
            );
            return accumulator;
          },
          {},
        );
        const hasAnyWeightChange = INSPECTED_WEIGHT_FIELD_KEYS.some(
          (fieldKey) =>
            !hasSameNumericValue(
              existingInspectedWeight[fieldKey],
              nextInspectedWeight[fieldKey],
            ),
        );
        if (hasAnyWeightChange) {
          itemDoc.set("inspected_weight", nextInspectedWeight);
          itemDoc.markModified("inspected_weight");
          hasItemDocChanges = true;
        }
      }

      if (hasInspectedLbhUpdate || hasInspectedBoxModeUpdate) {
        const inspectedBoxMode = detectBoxPackagingMode(
          itemDoc?.inspected_box_mode,
          itemDoc?.inspected_box_sizes,
        );
        const inspectedBoxSummary = buildBoxMeasurementCbmSummary({
          sizes: itemDoc?.inspected_box_sizes,
          mode: inspectedBoxMode,
          singleLbh: itemDoc?.inspected_box_LBH || itemDoc?.box_LBH,
          topLbh:
            inspectedBoxMode === BOX_PACKAGING_MODES.CARTON
              ? null
              : itemDoc?.inspected_box_top_LBH ||
                itemDoc?.inspected_top_LBH,
          bottomLbh:
            inspectedBoxMode === BOX_PACKAGING_MODES.CARTON
              ? null
              : itemDoc?.inspected_box_bottom_LBH ||
                itemDoc?.inspected_bottom_LBH,
        });
        const calculatedInspectedSizeEntriesCbm = Math.max(
          calculateEffectiveBoxEntriesCbmTotal(
            itemDoc?.inspected_box_sizes,
            inspectedBoxMode,
          ),
          calculateSizeEntriesCbmTotal(itemDoc?.inspected_item_sizes),
        );
        const calculatedInspectedTopCbm = inspectedBoxSummary.first;
        const calculatedInspectedBottomCbm = inspectedBoxSummary.second;
        const calculatedInspectedCbmFromBox = calculateCbmFromLbh(
          itemDoc?.inspected_box_LBH ||
            itemDoc?.box_LBH ||
            itemDoc?.inspected_item_LBH ||
            itemDoc?.item_LBH ||
            {},
        );
        const calculatedInspectedCbm =
          toNonNegativeNumber(inspectedBoxSummary.total, 0) > 0
            ? inspectedBoxSummary.total
          : calculatedInspectedSizeEntriesCbm > 0
            ? toNormalizedCbmString(calculatedInspectedSizeEntriesCbm)
            : calculatedInspectedCbmFromBox;
        const calculatedPisSizeEntriesCbm = Math.max(
          calculateSizeEntriesCbmTotal(itemDoc?.pis_box_sizes),
          calculateSizeEntriesCbmTotal(itemDoc?.pis_item_sizes),
        );
        const calculatedPisCbm = calculateCbmFromLbh(
          calculatedPisSizeEntriesCbm > 0
            ? {}
            : itemDoc?.pis_box_LBH ||
                itemDoc?.box_LBH ||
                itemDoc?.pis_item_LBH ||
                itemDoc?.item_LBH ||
                {},
        );

        itemDoc.cbm = {
          ...(itemDoc.cbm || {}),
          inspected_top: calculatedInspectedTopCbm,
          inspected_bottom: calculatedInspectedBottomCbm,
          inspected_total: calculatedInspectedCbm,
          calculated_inspected_total: calculatedInspectedCbm,
          calculated_pis_total:
            calculatedPisSizeEntriesCbm > 0
              ? toNormalizedCbmString(calculatedPisSizeEntriesCbm)
              : calculatedPisCbm,
          calculated_total: calculatedInspectedCbm,
        };
        hasItemDocChanges = true;

        if (
          nextInspectedItemLbh ||
          nextInspectedItemTopLbh ||
          nextInspectedItemBottomLbh ||
          nextInspectedBoxLbh ||
          nextInspectedTopLbh ||
          nextInspectedBottomLbh ||
          hasInspectedBoxModeUpdate
        ) {
          qc.cbm = buildItemInspectedBoxCbmSnapshot(itemDoc);
        }
      }

      if (hasItemDocChanges) {
        await itemDoc.save();
        if (hasPoCbmRelevantItemChanges) {
          try {
            await syncTotalPoCbmForItem(itemDoc.toObject());
          } catch (syncError) {
            console.error("QC inspected box PO CBM sync failed:", {
              itemId: itemDoc?._id,
              code: itemDoc?.code,
              error: syncError?.message || String(syncError),
            });
          }
        }
      }
    }

    qc.updated_by = buildAuditActor(req.user);
    await qc.save();

    const orderId = qc?.order?._id || qc.order;
    const orderRecord = await Order.findById(orderId);
    if (orderRecord && !CLOSED_ORDER_STATUSES.includes(orderRecord.status)) {
      applyQcOrderStatus(qc, orderRecord);
      orderRecord.updated_by = buildAuditActor(req.user);
      await applyQcOrderPoCbm(orderRecord);
      await orderRecord.save();
    }

    const afterInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    await createQcEditLog({
      reqUser: req.user,
      qcDoc: qc,
      beforeSnapshot: beforeQcSnapshot,
      afterSnapshot: buildQcEditLogSnapshot(qc.toObject(), afterInspectionRecords),
      operationType: "qc_update",
      extraRemarks: ["QC updated through update-qc route."],
    });
    if (orderRecord) {
      await createOrderEditLogFromQc({
        reqUser: req.user,
        orderDoc: orderRecord,
        beforeSnapshot: beforeOrderSnapshot,
        afterSnapshot: buildOrderAuditSnapshotForQc(orderRecord),
        extraRemarks: ["Order status evaluated from QC update flow."],
      });
    }

    try {
      await upsertItemFromQc(qc);
    } catch (itemSyncError) {
      console.error("Item sync after QC update failed:", {
        qcId: qc?._id,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    res.json({
      message: "QC updated successfully",
      data: qc,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.syncQcDetailsFromItems = async (req, res) => {
  try {
    const onlyUpdatedItems =
      String(
        req.query.only_updated_items ?? req.body?.only_updated_items ?? "true",
      )
        .trim()
        .toLowerCase() !== "false";

    const [items, qcs] = await Promise.all([
      Item.find({ code: { $exists: true, $ne: "" } })
        .select("code name description cbm qc")
        .lean(),
      QC.find({ "item.item_code": { $exists: true, $ne: "" } })
        .select(
          "_id item cbm barcode packed_size finishing branding last_inspected_date",
        )
        .lean(),
    ]);

    const itemMap = new Map();
    for (const itemDoc of items) {
      const key = normalizeItemCodeKey(itemDoc?.code || "");
      if (!key || itemMap.has(key)) continue;
      itemMap.set(key, itemDoc);
    }

    const summary = {
      processed: 0,
      matched_items: 0,
      updated: 0,
      unchanged: 0,
      skipped_missing_item: 0,
      skipped_item_details_not_updated: 0,
      only_updated_items: onlyUpdatedItems,
    };

    const bulkOps = [];

    for (const qcRow of qcs) {
      summary.processed += 1;

      const itemCodeKey = normalizeItemCodeKey(qcRow?.item?.item_code || "");
      if (!itemCodeKey || !itemMap.has(itemCodeKey)) {
        summary.skipped_missing_item += 1;
        continue;
      }

      const itemDoc = itemMap.get(itemCodeKey);
      summary.matched_items += 1;

      const patchResult = buildQcItemDetailsPatch({
        qcSnapshot: qcRow,
        itemDoc,
        onlyUpdatedItems,
      });

      if (!patchResult?.set) {
        if (patchResult?.reason === "item_details_not_updated") {
          summary.skipped_item_details_not_updated += 1;
        } else {
          summary.unchanged += 1;
        }
        continue;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: qcRow._id },
          update: { $set: patchResult.set },
        },
      });
      summary.updated += 1;
    }

    if (bulkOps.length > 0) {
      await QC.bulkWrite(bulkOps, { ordered: false });
    }

    return res.status(200).json({
      success: true,
      message: "QC details synced successfully from items",
      summary,
    });
  } catch (err) {
    console.error("Sync QC Details From Items Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to sync QC details from items",
      error: err?.message || String(err),
    });
  }
};

exports.getInspectorReports = async (req, res) => {
  try {
    const selectedInspector = normalizeOptionalReportFilter(
      req.query.inspector ?? req.query.inspector_id ?? req.query.inspectorId,
    );
    if (
      selectedInspector &&
      !mongoose.Types.ObjectId.isValid(selectedInspector)
    ) {
      return res.status(400).json({ message: "Invalid inspector filter" });
    }

    const reportRange = resolveInspectorReportRange({
      fromDate: req.query.from_date ?? req.query.fromDate,
      toDate: req.query.to_date ?? req.query.toDate,
      timeline: req.query.timeline,
      customDays: req.query.custom_days ?? req.query.customDays,
    });
    if (!reportRange) {
      return res.status(400).json({ message: "Invalid inspector report filters" });
    }

    const baseInspectionMatch = {
      $or: [
        {
          inspection_date: {
            $gte: reportRange.from_date_iso,
            $lte: reportRange.to_date_iso,
          },
        },
        {
          createdAt: {
            $gte: reportRange.from_date_utc,
            $lt: reportRange.to_date_exclusive_utc,
          },
        },
      ],
    };
    const inspectionMatch = selectedInspector
      ? {
          ...baseInspectionMatch,
          inspector: new mongoose.Types.ObjectId(selectedInspector),
        }
      : baseInspectionMatch;

    const [inspectorOptionsRaw, inspectionsRaw] = await Promise.all([
      Inspection.find(baseInspectionMatch)
        .select("inspector inspection_date createdAt qc")
        .populate("inspector", "name email")
        .populate({
          path: "qc",
          select: "order",
          populate: {
            path: "order",
            select: "_id",
            match: ACTIVE_ORDER_MATCH,
          },
        })
        .lean(),
      Inspection.find(inspectionMatch)
        .select(
          "inspector inspection_date createdAt checked passed vendor_requested cbm qc",
        )
      .populate("inspector", "name email")
        .populate({
          path: "qc",
          select: "order_meta item order",
          populate: {
            path: "order",
            select: "order_id brand vendor status quantity shipment archived",
            match: ACTIVE_ORDER_MATCH,
          },
        })
      .sort({ createdAt: -1 })
        .lean(),
    ]);

    const inspectorOptionsMap = new Map();
    for (const optionEntry of inspectorOptionsRaw) {
      if (!optionEntry?.qc?.order) continue;

      const optionDateIso = resolveInspectionReportDateIso(optionEntry);
      if (
        !isIsoDateWithinInclusiveRange(
          optionDateIso,
          reportRange.from_date_iso,
          reportRange.to_date_iso,
        )
      ) {
        continue;
      }

      const optionInspectorId = String(
        optionEntry?.inspector?._id || optionEntry?.inspector || "",
      ).trim();
      if (!optionInspectorId) continue;

      if (!inspectorOptionsMap.has(optionInspectorId)) {
        inspectorOptionsMap.set(optionInspectorId, {
          _id: optionInspectorId,
          name: normalizeText(optionEntry?.inspector?.name || "Unknown"),
          email: normalizeText(optionEntry?.inspector?.email || ""),
        });
      }
    }

    const inspections = inspectionsRaw.filter((entry) => {
      if (!entry?.qc?.order) return false;

      const reportDateIso = resolveInspectionReportDateIso(entry);
      return isIsoDateWithinInclusiveRange(
        reportDateIso,
        reportRange.from_date_iso,
        reportRange.to_date_iso,
      );
    });
    const uniqueItemCodes = [
      ...new Set(
        inspections
          .map((entry) => normalizeText(entry?.qc?.item?.item_code || ""))
          .filter(Boolean),
      ),
    ];
    const itemDocs = uniqueItemCodes.length
      ? await Item.find({
          code: {
            $in: uniqueItemCodes.map(
              (itemCode) => new RegExp(`^${escapeRegex(itemCode)}$`, "i"),
            ),
          },
        })
          .select(
            "code cbm inspected_item_LBH inspected_item_sizes inspected_item_top_LBH inspected_item_bottom_LBH inspected_box_LBH inspected_box_sizes inspected_box_top_LBH inspected_box_bottom_LBH inspected_top_LBH inspected_bottom_LBH pis_item_LBH pis_item_sizes pis_item_top_LBH pis_item_bottom_LBH pis_box_LBH pis_box_sizes pis_box_top_LBH pis_box_bottom_LBH",
          )
          .lean()
      : [];
    const itemDocByCodeKey = new Map(
      itemDocs.map((itemDoc) => [normalizeItemCodeKey(itemDoc?.code), itemDoc]),
    );
    const inspectorMap = new Map();
    const dailyTotalsMap = new Map();
    const weeklyTotalsMap = new Map();

    const upsertBucket = (bucketMap, key, seedFactory) => {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) return null;
      if (!bucketMap.has(normalizedKey)) {
        bucketMap.set(normalizedKey, seedFactory(normalizedKey));
      }
      return bucketMap.get(normalizedKey);
    };

    let totalRequested = 0;
    let totalChecked = 0;
    let totalPassed = 0;
    let totalInspectedCbm = 0;

    for (const inspection of inspections) {
      const requestedQty = toNonNegativeNumber(inspection?.vendor_requested, 0);
      const inspectedQty = toNonNegativeNumber(inspection?.checked, 0);
      const passedQty = toNonNegativeNumber(inspection?.passed, 0);
      const itemCodeKey = normalizeItemCodeKey(inspection?.qc?.item?.item_code || "");
      const itemDoc = itemDocByCodeKey.get(itemCodeKey) || null;
      const cbmPerUnit = resolveItemReportCbmPerUnit(itemDoc, inspection);
      const inspectedCbm = cbmPerUnit * inspectedQty;
      const inspectionDateIso = resolveInspectionReportDateIso(inspection);
      const weekStartIso = getWeekStartIsoDate(
        inspectionDateIso || inspection?.createdAt,
      );
      const inspectorId = String(
        inspection?.inspector?._id || inspection?.inspector || "unassigned",
      );
      const orderId = String(
        inspection?.qc?.order_meta?.order_id ||
          inspection?.qc?.order?.order_id ||
          "",
      ).trim();

      const inspectorEntry = upsertBucket(inspectorMap, inspectorId, () => ({
        inspector: inspection?.inspector
          ? {
              _id: inspection.inspector._id,
              name: inspection.inspector.name || "Unknown",
              email: inspection.inspector.email || "",
            }
          : {
              _id: null,
              name: "Unassigned",
              email: "",
            },
        total_inspections: 0,
        total_requested: 0,
        total_checked: 0,
        total_passed: 0,
        total_inspected_cbm: 0,
        order_keys: new Set(),
        daily: new Map(),
        weekly: new Map(),
      }));
      if (!inspectorEntry) continue;

      inspectorEntry.total_inspections += 1;
      inspectorEntry.total_requested += requestedQty;
      inspectorEntry.total_checked += inspectedQty;
      inspectorEntry.total_passed += passedQty;
      inspectorEntry.total_inspected_cbm += inspectedCbm;
      if (orderId) {
        inspectorEntry.order_keys.add(orderId);
      }

      totalRequested += requestedQty;
      totalChecked += inspectedQty;
      totalPassed += passedQty;
      totalInspectedCbm += inspectedCbm;

      if (inspectionDateIso) {
        const dailyBucket = upsertBucket(
          inspectorEntry.daily,
          inspectionDateIso,
          (bucketKey) => ({
            date: bucketKey,
            requested_quantity: 0,
            checked_quantity: 0,
            passed_quantity: 0,
            inspections_count: 0,
            inspected_cbm: 0,
          }),
        );
        if (dailyBucket) {
          dailyBucket.requested_quantity += requestedQty;
          dailyBucket.checked_quantity += inspectedQty;
          dailyBucket.passed_quantity += passedQty;
          dailyBucket.inspections_count += 1;
          dailyBucket.inspected_cbm += inspectedCbm;
        }

        const globalDaily = upsertBucket(
          dailyTotalsMap,
          inspectionDateIso,
          (bucketKey) => ({
            date: bucketKey,
            requested_quantity: 0,
            checked_quantity: 0,
            passed_quantity: 0,
            inspections_count: 0,
            inspected_cbm: 0,
          }),
        );
        if (globalDaily) {
          globalDaily.requested_quantity += requestedQty;
          globalDaily.checked_quantity += inspectedQty;
          globalDaily.passed_quantity += passedQty;
          globalDaily.inspections_count += 1;
          globalDaily.inspected_cbm += inspectedCbm;
        }
      }

      if (weekStartIso) {
        const weeklyBucket = upsertBucket(
          inspectorEntry.weekly,
          weekStartIso,
          (bucketKey) => ({
            week_start: bucketKey,
            week_end: getWeekEndIsoDate(bucketKey),
            requested_quantity: 0,
            checked_quantity: 0,
            passed_quantity: 0,
            inspections_count: 0,
            inspected_cbm: 0,
          }),
        );
        if (weeklyBucket) {
          weeklyBucket.requested_quantity += requestedQty;
          weeklyBucket.checked_quantity += inspectedQty;
          weeklyBucket.passed_quantity += passedQty;
          weeklyBucket.inspections_count += 1;
          weeklyBucket.inspected_cbm += inspectedCbm;
        }

        const globalWeekly = upsertBucket(
          weeklyTotalsMap,
          weekStartIso,
          (bucketKey) => ({
            week_start: bucketKey,
            week_end: getWeekEndIsoDate(bucketKey),
            requested_quantity: 0,
            checked_quantity: 0,
            passed_quantity: 0,
            inspections_count: 0,
            inspected_cbm: 0,
          }),
        );
        if (globalWeekly) {
          globalWeekly.requested_quantity += requestedQty;
          globalWeekly.checked_quantity += inspectedQty;
          globalWeekly.passed_quantity += passedQty;
          globalWeekly.inspections_count += 1;
          globalWeekly.inspected_cbm += inspectedCbm;
        }
      }
    }

    const sortByDateDesc = (a, b, key) =>
      toSortableTimestamp(b?.[key]) - toSortableTimestamp(a?.[key]);

    const inspectors = Array.from(inspectorMap.values())
      .map((entry) => ({
        inspector: entry.inspector,
        total_inspections: entry.total_inspections,
        total_requested: entry.total_requested,
        total_checked: entry.total_checked,
        total_passed: entry.total_passed,
        total_inspected_cbm: toRoundedNumber(entry.total_inspected_cbm, 3),
        orders_touched: entry.order_keys.size,
        daily: Array.from(entry.daily.values())
          .map((bucket) => ({
            ...bucket,
            inspected_cbm: toRoundedNumber(bucket.inspected_cbm, 3),
          }))
          .sort((a, b) => sortByDateDesc(a, b, "date")),
        weekly: Array.from(entry.weekly.values())
          .map((bucket) => ({
            ...bucket,
            inspected_cbm: toRoundedNumber(bucket.inspected_cbm, 3),
          }))
          .sort((a, b) => sortByDateDesc(a, b, "week_start")),
      }))
      .sort((a, b) =>
        String(a?.inspector?.name || "").localeCompare(
          String(b?.inspector?.name || ""),
        ),
      );

    const daily_totals = Array.from(dailyTotalsMap.values())
      .map((bucket) => ({
        ...bucket,
        inspected_cbm: toRoundedNumber(bucket.inspected_cbm, 3),
      }))
      .sort((a, b) => sortByDateDesc(a, b, "date"));
    const weekly_totals = Array.from(weeklyTotalsMap.values())
      .map((bucket) => ({
        ...bucket,
        inspected_cbm: toRoundedNumber(bucket.inspected_cbm, 3),
      }))
      .sort((a, b) => sortByDateDesc(a, b, "week_start"));
    const inspector_options = Array.from(inspectorOptionsMap.values()).sort(
      (a, b) =>
        String(a?.name || "").localeCompare(String(b?.name || "")) ||
        String(a?._id || "").localeCompare(String(b?._id || "")),
    );

    return res.status(200).json({
      filters: {
        timeline: reportRange.timeline,
        custom_days:
          reportRange.timeline === "custom" ? reportRange.days : null,
        from_date: reportRange.from_date_iso,
        to_date: reportRange.to_date_iso,
        inspector: selectedInspector,
        inspector_options,
      },
      summary: {
        inspectors_count: inspectors.length,
        inspections_count: inspections.length,
        total_requested: totalRequested,
        total_checked: totalChecked,
        total_passed: totalPassed,
        total_inspected_cbm: toRoundedNumber(totalInspectedCbm, 3),
      },
      inspectors,
      daily_totals,
      weekly_totals,
    });
  } catch (err) {
    console.error("Inspector Reports Error:", err);
    return res
      .status(500)
      .json({ message: err.message || "Failed to fetch inspector reports" });
  }
};

exports.getVendorReports = async (req, res) => {
  try {
    const selectedBrand = normalizeOptionalReportFilter(req.query.brand);
    const selectedVendor = normalizeOptionalReportFilter(req.query.vendor);
    const normalizedTimeline = String(req.query.timeline || "")
      .trim()
      .toLowerCase();
    const explicitRange = resolveExplicitDateRange({
      fromDate: req.query.from_date ?? req.query.fromDate,
      toDate: req.query.to_date ?? req.query.toDate,
    });
    const timelineRange = normalizedTimeline === "custom"
      ? explicitRange
      : explicitRange || resolveTimelineRange({
        timeline: req.query.timeline,
        customDays: req.query.custom_days ?? req.query.customDays,
      });
    if (!timelineRange) {
      return res.status(400).json({ message: "Invalid timeline filters" });
    }

    const orderRows = await Order.find({
      ...ACTIVE_ORDER_MATCH,
    })
      .select(
        "order_id brand vendor status order_date ETD revised_ETD quantity item shipment",
      )
      .lean();

    const orderGroupMap = new Map();

    for (const row of orderRows) {
      const orderId = String(row?.order_id || "").trim() || "N/A";
      const vendor = String(row?.vendor || "").trim() || "N/A";
      const brand = String(row?.brand || "").trim() || "N/A";
      const key = `${vendor.toLowerCase()}__${brand.toLowerCase()}__${orderId.toLowerCase()}`;

      if (!orderGroupMap.has(key)) {
        orderGroupMap.set(key, {
          order_id: orderId,
          vendor,
          brand,
          statuses: new Set(),
          item_codes: new Set(),
          quantity_total: 0,
          order_date_utc: null,
          etd_utc: null,
          latest_shipment_utc: null,
        });
      }

      const entry = orderGroupMap.get(key);
      const statusValue = String(row?.status || "").trim();
      if (statusValue) {
        entry.statuses.add(statusValue);
      }

      const itemCode = String(row?.item?.item_code || "").trim();
      if (itemCode) {
        entry.item_codes.add(itemCode);
      }

      entry.quantity_total += toNonNegativeNumber(row?.quantity, 0);

      const orderDateUtc = toUtcDateOnly(row?.order_date);
      if (
        orderDateUtc &&
        (!entry.order_date_utc ||
          orderDateUtc.getTime() < entry.order_date_utc.getTime())
      ) {
        entry.order_date_utc = orderDateUtc;
      }

      const effectiveEtdUtc = resolveEffectiveOrderEtdUtc(row);
      if (
        effectiveEtdUtc &&
        (!entry.etd_utc || effectiveEtdUtc.getTime() > entry.etd_utc.getTime())
      ) {
        entry.etd_utc = effectiveEtdUtc;
      }

      for (const shipment of Array.isArray(row?.shipment) ? row.shipment : []) {
        const shipmentDateUtc = toUtcDateOnly(shipment?.stuffing_date);
        if (
          shipmentDateUtc &&
          (!entry.latest_shipment_utc ||
            shipmentDateUtc.getTime() > entry.latest_shipment_utc.getTime())
        ) {
          entry.latest_shipment_utc = shipmentDateUtc;
        }
      }
    }

    const todayUtc = toUtcDayStart(new Date());
    const timelineOrders = [...orderGroupMap.values()].filter((entry) => {
      const status = resolveOrderStatusFromSet([...entry?.statuses || []]);
      const isFullyShipped = String(status || "").trim() === "Shipped";

      if (!isFullyShipped || !entry?.latest_shipment_utc) return false;
      return (
        entry.latest_shipment_utc.getTime() >=
          timelineRange.from_date_utc.getTime() &&
        entry.latest_shipment_utc.getTime() <
          timelineRange.to_date_exclusive_utc.getTime()
      );
    });
    const brandOptionsBase = selectedVendor
      ? timelineOrders.filter((entry) => entry.vendor === selectedVendor)
      : timelineOrders;
    const vendorOptionsBase = selectedBrand
      ? timelineOrders.filter((entry) => entry.brand === selectedBrand)
      : timelineOrders;
    const brandOptions = normalizeDistinctValues(
      brandOptionsBase.map((entry) => entry?.brand || ""),
    );
    const vendorOptions = normalizeDistinctValues(
      vendorOptionsBase.map((entry) => entry?.vendor || ""),
    );

    const filteredOrders = timelineOrders.filter((entry) => {
      if (selectedBrand && entry?.brand !== selectedBrand) return false;
      if (selectedVendor && entry?.vendor !== selectedVendor) return false;
      return true;
    });

    const vendorShippingStatsMap = new Map();
    for (const orderEntry of timelineOrders) {
      if (selectedBrand && orderEntry?.brand !== selectedBrand) continue;
      if (selectedVendor && orderEntry?.vendor !== selectedVendor) continue;

      const latestShipmentUtc = orderEntry.latest_shipment_utc;
      const orderDateUtc = orderEntry.order_date_utc;

      if (!latestShipmentUtc || !orderDateUtc) {
        continue;
      }

      const shippingTimeDays = Math.max(
        0,
        Math.floor(
          (latestShipmentUtc.getTime() - orderDateUtc.getTime()) / MS_PER_DAY,
        ),
      );
      const vendorKey = String(orderEntry.vendor || "").toLowerCase();

      if (!vendorShippingStatsMap.has(vendorKey)) {
        vendorShippingStatsMap.set(vendorKey, {
          shipped_in_range_count: 0,
          total_shipping_time_days: 0,
        });
      }

      const shippingStatsEntry = vendorShippingStatsMap.get(vendorKey);
      shippingStatsEntry.shipped_in_range_count += 1;
      shippingStatsEntry.total_shipping_time_days += shippingTimeDays;
    }

    const vendorMap = new Map();
    let delayedOrdersCount = 0;
    let ordersWithEtdCount = 0;
    let totalDelayDaysDelayedOnly = 0;

    for (const orderEntry of filteredOrders) {
      const status = resolveOrderStatusFromSet([...orderEntry.statuses]);
      const effectiveEtdUtc = orderEntry.etd_utc;
      const hasEffectiveEtd = Boolean(effectiveEtdUtc);
      const hasShippedStatus = String(status || "").trim() === "Shipped";
      const actualShippedDateUtc = orderEntry.latest_shipment_utc;
      const hasEtdCrossed = Boolean(
        hasEffectiveEtd &&
        todayUtc &&
        effectiveEtdUtc.getTime() < todayUtc.getTime(),
      );

      let delayDays = 0;
      let isDelayed = false;
      let delayReference = hasShippedStatus ? "latest_shipment_date" : "today";

      if (hasEffectiveEtd && hasShippedStatus) {
        if (
          actualShippedDateUtc &&
          actualShippedDateUtc.getTime() > effectiveEtdUtc.getTime()
        ) {
          isDelayed = true;
          delayReference = "latest_shipment_date";
        }
      } else if (hasEffectiveEtd && hasEtdCrossed) {
        isDelayed = true;
        delayReference = "today";
      }

      if (isDelayed) {
        const delayEndDate = hasShippedStatus ? actualShippedDateUtc : todayUtc;
        if (delayEndDate) {
          const rawDelay = Math.floor(
            (delayEndDate.getTime() - effectiveEtdUtc.getTime()) / MS_PER_DAY,
          );
          delayDays = Math.max(0, rawDelay);
        }
      }

      if (hasEffectiveEtd) {
        ordersWithEtdCount += 1;
      }
      if (isDelayed) {
        delayedOrdersCount += 1;
        totalDelayDaysDelayedOnly += delayDays;
      }

      const vendorKey = String(orderEntry.vendor || "").toLowerCase();
      if (!vendorMap.has(vendorKey)) {
        vendorMap.set(vendorKey, {
          vendor: orderEntry.vendor,
          orders_count: 0,
          delayed_orders_count: 0,
          orders_with_etd_count: 0,
          total_delay_days: 0,
          brands: new Set(),
          orders: [],
        });
      }

      const vendorEntry = vendorMap.get(vendorKey);
      vendorEntry.orders_count += 1;
      if (isDelayed) {
        vendorEntry.delayed_orders_count += 1;
        vendorEntry.total_delay_days += delayDays;
      }
      if (hasEffectiveEtd) {
        vendorEntry.orders_with_etd_count += 1;
      }

      vendorEntry.brands.add(orderEntry.brand);
      vendorEntry.orders.push({
        order_id: orderEntry.order_id,
        brand: orderEntry.brand,
        vendor: orderEntry.vendor,
        status,
        order_date: orderEntry.order_date_utc
          ? toISODateString(orderEntry.order_date_utc)
          : "",
        etd: effectiveEtdUtc ? toISODateString(effectiveEtdUtc) : "",
        latest_shipment_date: orderEntry.latest_shipment_utc
          ? toISODateString(orderEntry.latest_shipment_utc)
          : "",
        delay_days: delayDays,
        delay_reference: delayReference,
        item_count: orderEntry.item_codes.size,
        quantity_total: orderEntry.quantity_total,
      });
    }

    const vendors = Array.from(vendorMap.values())
      .map((entry) => {
        const vendorShippingStats =
          vendorShippingStatsMap.get(String(entry.vendor || "").toLowerCase())
          || null;
        const shippedInRangeCount = Number(
          vendorShippingStats?.shipped_in_range_count || 0,
        );

        return {
          vendor: entry.vendor,
          brands: [...entry.brands].sort((a, b) =>
            String(a || "").localeCompare(String(b || "")),
          ),
          orders_count: entry.orders_count,
          delayed_orders_count: entry.delayed_orders_count,
          orders_with_etd_count: entry.orders_with_etd_count,
          total_delay_days: entry.total_delay_days,
          average_delay_days:
            entry.delayed_orders_count > 0
              ? toRoundedNumber(
                  entry.total_delay_days / entry.delayed_orders_count,
                  2,
                )
              : 0,
          shipped_in_range_count: shippedInRangeCount,
          average_shipping_time_days:
            shippedInRangeCount > 0
              ? toRoundedNumber(
                  vendorShippingStats.total_shipping_time_days / shippedInRangeCount,
                  2,
                )
              : null,
          orders: [...entry.orders].sort((a, b) => {
            const aDelay = Number.isFinite(a?.delay_days) ? a.delay_days : -1;
            const bDelay = Number.isFinite(b?.delay_days) ? b.delay_days : -1;
            if (aDelay !== bDelay) return bDelay - aDelay;
            return (
              toSortableTimestamp(b?.order_date) -
              toSortableTimestamp(a?.order_date)
            );
          }),
        };
      })
      .sort((a, b) => {
        const avgDiff =
          Number(b?.average_delay_days || 0) -
          Number(a?.average_delay_days || 0);
        if (avgDiff !== 0) return avgDiff;
        return String(a?.vendor || "").localeCompare(String(b?.vendor || ""));
      });

    return res.status(200).json({
      filters: {
        timeline:
          normalizedTimeline === "custom"
            ? "custom"
            : timelineRange.timeline,
        custom_days: null,
        from_date: timelineRange.from_date_iso,
        to_date: timelineRange.to_date_iso,
        brand: selectedBrand,
        vendor: selectedVendor,
        brand_options: brandOptions,
        vendor_options: vendorOptions,
      },
      summary: {
        vendors_count: vendors.length,
        orders_count: filteredOrders.length,
        delayed_orders_count: delayedOrdersCount,
        orders_with_etd_count: ordersWithEtdCount,
        total_delay_days: totalDelayDaysDelayedOnly,
        average_delay_days:
          delayedOrdersCount > 0
            ? toRoundedNumber(totalDelayDaysDelayedOnly / delayedOrdersCount, 2)
            : 0,
      },
      vendors,
    });
  } catch (err) {
    console.error("Vendor Reports Error:", err);
    return res
      .status(500)
      .json({ message: err.message || "Failed to fetch vendor reports" });
  }
};

exports.getWeeklyOrderSummary = async (req, res) => {
  try {
    const selectedBrand = normalizeOptionalReportFilter(req.query.brand);
    const reportRange = resolveWeeklySummaryRange({
      fromDate: req.query.from_date ?? req.query.fromDate,
      toDate: req.query.to_date ?? req.query.toDate,
    });
    if (!reportRange) {
      return res.status(400).json({ message: "Invalid weekly summary filters" });
    }

    const inspectedQcSnapshots = await Inspection.aggregate([
      {
        $addFields: {
          inspection_date_value: {
            $ifNull: [inspectionDateToDateExpression, "$createdAt"],
          },
        },
      },
      {
        $match: {
          inspection_date_value: {
            $gte: reportRange.from_date_utc,
            $lt: reportRange.to_date_exclusive_utc,
          },
        },
      },
      {
        $sort: {
          qc: 1,
          inspection_date_value: -1,
          createdAt: -1,
        },
      },
      {
        $group: {
          _id: "$qc",
          inspection_date: { $first: "$inspection_date" },
          createdAt: { $first: "$createdAt" },
          goods_not_ready: { $first: "$goods_not_ready" },
          remarks: { $first: "$remarks" },
          inspector: { $first: "$inspector" },
        },
      },
    ]);

    const touchedQcIds = inspectedQcSnapshots
      .map((entry) => entry?._id)
      .filter((value) => mongoose.Types.ObjectId.isValid(value));

    if (touchedQcIds.length === 0) {
      return res.status(200).json({
        filters: {
          period: "selected_range",
          period_label: `${formatDateDDMMYYYY(reportRange.from_date_iso)} - ${formatDateDDMMYYYY(reportRange.to_date_iso)}`,
          from_date: reportRange.from_date_iso,
          to_date: reportRange.to_date_iso,
          brand: selectedBrand,
          brand_options: [],
        },
        summary: {
          vendors_count: 0,
          pos_count: 0,
          items_count: 0,
          inspected_items_count: 0,
        },
        vendors: [],
      });
    }

    const touchedQcDocs = await QC.find({ _id: { $in: touchedQcIds } })
      .select("order order_meta item quantities request_history")
      .populate({
        path: "order",
        match: ACTIVE_ORDER_MATCH,
        select: "order_id vendor brand quantity status shipment",
      })
      .lean();

    const touchedQcDocById = new Map(
      touchedQcDocs
        .filter((entry) => entry?.order)
        .map((entry) => [String(entry._id), entry]),
    );

    const includedPoMap = new Map();
    const inspectionInRangeByQcId = new Map();

    for (const snapshot of inspectedQcSnapshots) {
      const qcId = String(snapshot?._id || "").trim();
      const qcDoc = touchedQcDocById.get(qcId);
      if (!qcDoc) continue;

      const poMeta = resolveWeeklySummaryPoMeta(qcDoc);
      if (!poMeta.order_id) continue;

      const poKey = buildWeeklySummaryPoKey({
        orderId: poMeta.order_id,
        vendor: poMeta.vendor,
        brand: poMeta.brand,
      });
      includedPoMap.set(poKey, poMeta);
      inspectionInRangeByQcId.set(qcId, {
        inspection_date: resolveInspectionReportDateIso(snapshot),
        goods_not_ready: isGoodsNotReadyMarked(snapshot?.goods_not_ready),
        goods_not_ready_reason: getGoodsNotReadyReason(
          snapshot?.goods_not_ready,
          snapshot?.remarks || "",
        ),
        inspector_id: String(snapshot?.inspector || "").trim(),
      });
    }

    const includedOrderIds = [
      ...new Set(
        Array.from(includedPoMap.values())
          .map((entry) => normalizeText(entry?.order_id || ""))
          .filter(Boolean),
      ),
    ];

    if (includedOrderIds.length === 0) {
      return res.status(200).json({
        filters: {
          period: "selected_range",
          period_label: `${formatDateDDMMYYYY(reportRange.from_date_iso)} - ${formatDateDDMMYYYY(reportRange.to_date_iso)}`,
          from_date: reportRange.from_date_iso,
          to_date: reportRange.to_date_iso,
          brand: selectedBrand,
          brand_options: [],
        },
        summary: {
          vendors_count: 0,
          pos_count: 0,
          items_count: 0,
          inspected_items_count: 0,
        },
        vendors: [],
      });
    }

    const allPoQcDocs = await QC.find({
      "order_meta.order_id": { $in: includedOrderIds },
    })
      .select("order order_meta item quantities request_history cbm")
      .populate({
        path: "order",
        match: ACTIVE_ORDER_MATCH,
        select: "order_id vendor brand quantity status shipment",
      })
      .lean();

    const includedQcDocs = allPoQcDocs.filter((qcDoc) => {
      if (!qcDoc?.order) return false;
      const poMeta = resolveWeeklySummaryPoMeta(qcDoc);
      if (!poMeta.order_id) return false;
      const poKey = buildWeeklySummaryPoKey({
        orderId: poMeta.order_id,
        vendor: poMeta.vendor,
        brand: poMeta.brand,
      });
      return includedPoMap.has(poKey);
    });
    const uniqueItemCodes = [
      ...new Set(
        includedQcDocs
          .map((qcDoc) => normalizeText(qcDoc?.item?.item_code || ""))
          .filter(Boolean),
      ),
    ];
    const itemDocs = uniqueItemCodes.length > 0
      ? await Item.find({
          code: {
            $in: uniqueItemCodes.map(
              (itemCode) => new RegExp(`^${escapeRegex(itemCode)}$`, "i"),
            ),
          },
        })
          .select(
            "code cbm inspected_item_LBH inspected_item_sizes inspected_item_top_LBH inspected_item_bottom_LBH inspected_box_LBH inspected_box_sizes inspected_box_top_LBH inspected_box_bottom_LBH inspected_top_LBH inspected_bottom_LBH box_LBH pis_item_LBH pis_item_sizes pis_item_top_LBH pis_item_bottom_LBH pis_box_LBH pis_box_sizes pis_box_top_LBH pis_box_bottom_LBH",
          )
          .lean()
      : [];
    const itemDocByCodeKey = new Map(
      itemDocs.map((itemDoc) => [normalizeItemCodeKey(itemDoc?.code), itemDoc]),
    );

    const includedQcIds = includedQcDocs
      .map((entry) => entry?._id)
      .filter((value) => mongoose.Types.ObjectId.isValid(value));

    const latestInspectionByQc = includedQcIds.length
      ? await Inspection.aggregate([
          {
            $match: {
              qc: { $in: includedQcIds },
            },
          },
          {
            $addFields: {
              inspection_date_value: {
                $ifNull: [inspectionDateToDateExpression, "$createdAt"],
              },
            },
          },
          {
            $sort: {
              qc: 1,
              inspection_date_value: -1,
              createdAt: -1,
            },
          },
          {
            $group: {
              _id: "$qc",
              inspection_date: { $first: "$inspection_date" },
              createdAt: { $first: "$createdAt" },
              inspector: { $first: "$inspector" },
            },
          },
        ])
      : [];

    const latestInspectionByQcId = new Map(
      latestInspectionByQc.map((entry) => [
        String(entry?._id || "").trim(),
        {
          inspection_date: resolveInspectionReportDateIso(entry),
          inspector_id: String(entry?.inspector || "").trim(),
        },
      ]),
    );

    const userIds = [
      ...new Set(
        [
          ...Array.from(inspectionInRangeByQcId.values()).map((entry) =>
            String(entry?.inspector_id || "").trim(),
          ),
          ...Array.from(latestInspectionByQcId.values()).map((entry) =>
            String(entry?.inspector_id || "").trim(),
          ),
        ].filter((value) => mongoose.Types.ObjectId.isValid(value)),
      ),
    ];

    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
          .select("name email")
          .lean()
      : [];
    const userNameById = new Map(
      users.map((entry) => [
        String(entry?._id || "").trim(),
        normalizeText(entry?.name || entry?.email || ""),
      ]),
    );

    const normalizedRows = includedQcDocs.map((qcDoc) => {
      const qcId = String(qcDoc?._id || "").trim();
      const poMeta = resolveWeeklySummaryPoMeta(qcDoc);
      const weeklyInspection = inspectionInRangeByQcId.get(qcId) || null;
      const latestOverallInspection = latestInspectionByQcId.get(qcId) || null;
      const itemCode = normalizeText(qcDoc?.item?.item_code || "") || "N/A";
      const itemDoc = itemDocByCodeKey.get(normalizeItemCodeKey(itemCode)) || null;
      const quantityPassed = toNonNegativeNumber(qcDoc?.quantities?.qc_passed, 0);
      const itemCbm = resolveWeeklySummaryCbmPerUnit(itemDoc, qcDoc);
      const totalCbm = itemCbm > 0
        ? toRoundedNumber(itemCbm * quantityPassed, 3)
        : 0;

      return {
        order_id: poMeta.order_id || "N/A",
        vendor: poMeta.vendor || "N/A",
        brand: poMeta.brand || "N/A",
        item_code: itemCode,
        total_order_quantity: toNonNegativeNumber(
          qcDoc?.quantities?.client_demand ?? qcDoc?.order?.quantity,
          0,
        ),
        order_status: resolveQcOrderStatus(qcDoc, qcDoc?.order),
        quantity_passed: quantityPassed,
        item_cbm: toRoundedNumber(itemCbm, 3),
        total_cbm: totalCbm,
        pending: toNonNegativeNumber(qcDoc?.quantities?.pending, 0),
        goods_not_ready: Boolean(weeklyInspection?.goods_not_ready),
        goods_not_ready_reason: normalizeText(
          weeklyInspection?.goods_not_ready_reason || "",
        ),
        goods_not_ready_inspection_date: normalizeText(
          weeklyInspection?.inspection_date || "",
        ),
        inspected_in_range: Boolean(weeklyInspection),
        last_inspection_date_in_range: normalizeText(
          weeklyInspection?.inspection_date || "",
        ),
        last_inspector_name_in_range: normalizeText(
          userNameById.get(String(weeklyInspection?.inspector_id || "").trim()) || "",
        ),
        latest_overall_inspection_date: normalizeText(
          latestOverallInspection?.inspection_date || "",
        ),
        latest_overall_inspector_name: normalizeText(
          userNameById.get(String(latestOverallInspection?.inspector_id || "").trim()) || "",
        ),
      };
    });

    const brandOptions = normalizeDistinctValues(
      normalizedRows.map((row) => row?.brand || ""),
    );

    const filteredRows = selectedBrand
      ? normalizedRows.filter((row) => row.brand === selectedBrand)
      : normalizedRows;

    const vendorMap = new Map();
    const poKeys = new Set();

    for (const row of filteredRows) {
      const poKey = buildWeeklySummaryPoKey({
        orderId: row.order_id,
        vendor: row.vendor,
        brand: row.brand,
      });
      poKeys.add(poKey);

      const vendorKey = String(row.vendor || "").toLowerCase();
      if (!vendorMap.has(vendorKey)) {
        vendorMap.set(vendorKey, {
          vendor: row.vendor,
          items: [],
        });
      }

      vendorMap.get(vendorKey).items.push({
        order_id: row.order_id,
        item_code: row.item_code,
        total_order_quantity: row.total_order_quantity,
        order_status: row.order_status,
        quantity_passed: row.quantity_passed,
        item_cbm: row.item_cbm,
        total_cbm: row.total_cbm,
        pending: row.pending,
        goods_not_ready: row.goods_not_ready,
        goods_not_ready_reason: row.goods_not_ready_reason,
        goods_not_ready_inspection_date: row.goods_not_ready_inspection_date,
        inspected_in_range: row.inspected_in_range,
        last_inspection_date_in_range: row.last_inspection_date_in_range,
        last_inspector_name_in_range: row.last_inspector_name_in_range,
        latest_overall_inspection_date: row.latest_overall_inspection_date,
        latest_overall_inspector_name: row.latest_overall_inspector_name,
      });
    }

    const vendors = Array.from(vendorMap.values())
      .map((entry) => ({
        vendor: entry.vendor,
        items: [...entry.items].sort((left, right) => {
          const orderCompare = String(left?.order_id || "").localeCompare(
            String(right?.order_id || ""),
          );
          if (orderCompare !== 0) return orderCompare;
          return String(left?.item_code || "").localeCompare(
            String(right?.item_code || ""),
          );
        }),
      }))
      .sort((left, right) =>
        String(left?.vendor || "").localeCompare(String(right?.vendor || "")),
      );

    return res.status(200).json({
      filters: {
        period: "selected_range",
        period_label: `${formatDateDDMMYYYY(reportRange.from_date_iso)} - ${formatDateDDMMYYYY(reportRange.to_date_iso)}`,
        from_date: reportRange.from_date_iso,
        to_date: reportRange.to_date_iso,
        brand: selectedBrand,
        brand_options: brandOptions,
      },
      summary: {
        vendors_count: vendors.length,
        pos_count: poKeys.size,
        items_count: filteredRows.length,
        inspected_items_count: filteredRows.filter((row) => row.inspected_in_range).length,
      },
      vendors,
    });
  } catch (err) {
    console.error("Weekly Order Summary Error:", err);
    return res
      .status(500)
      .json({ message: err.message || "Failed to fetch weekly order summary" });
  }
};

exports.getDailyOrderSummary = async (req, res) => {
  try {
    const reportDate = resolveReportDate(req.query.date);
    if (!reportDate) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const selectedBrand = normalizeOptionalReportFilter(req.query.brand);
    const reportDateUtc = parseIsoDateToUtcDate(reportDate);
    const nextDateUtc = addUtcDays(reportDateUtc, 1);
    if (!reportDateUtc || !nextDateUtc) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const dailyRows = await Inspection.aggregate([
      {
        $addFields: {
          inspection_date_value: {
            $ifNull: [inspectionDateToDateExpression, "$createdAt"],
          },
        },
      },
      {
        $match: {
          inspection_date_value: {
            $gte: reportDateUtc,
            $lt: nextDateUtc,
          },
        },
      },
      {
        $sort: {
          qc: 1,
          inspection_date_value: -1,
          createdAt: -1,
        },
      },
      {
        $group: {
          _id: "$qc",
          inspection_id: { $first: "$_id" },
          inspection_date: { $first: "$inspection_date" },
          status: { $first: "$status" },
          requested_quantity: { $first: "$vendor_requested" },
          passed_quantity: { $first: "$passed" },
          open_quantity: { $first: "$pending_after" },
          goods_not_ready: { $first: "$goods_not_ready" },
          remarks: { $first: "$remarks" },
          inspector_id: { $first: "$inspector" },
        },
      },
      {
        $lookup: {
          from: QC.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "qc_doc",
        },
      },
      { $unwind: "$qc_doc" },
      {
        $lookup: {
          from: Order.collection.name,
          let: { orderId: "$qc_doc.order" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$orderId"] },
              },
            },
            {
              $match: ACTIVE_ORDER_MATCH,
            },
          ],
          as: "order_doc",
        },
      },
      { $unwind: "$order_doc" },
      {
        $lookup: {
          from: "users",
          localField: "inspector_id",
          foreignField: "_id",
          as: "inspector_user",
        },
      },
      {
        $addFields: {
          inspector_user: { $arrayElemAt: ["$inspector_user", 0] },
        },
      },
      {
        $project: {
          _id: 0,
          qc_id: "$_id",
          inspection_id: 1,
          order_id: {
            $ifNull: ["$qc_doc.order_meta.order_id", "$order_doc.order_id"],
          },
          vendor: {
            $ifNull: ["$qc_doc.order_meta.vendor", "$order_doc.vendor"],
          },
          brand: {
            $ifNull: ["$qc_doc.order_meta.brand", "$order_doc.brand"],
          },
          item_code: "$qc_doc.item.item_code",
          requested_quantity: 1,
          passed_quantity: 1,
          open_quantity: 1,
          status: 1,
          goods_not_ready: 1,
          remarks: 1,
          inspection_date: 1,
          inspector_name: "$inspector_user.name",
        },
      },
    ]);

    const normalizedRows = dailyRows.map((row) => {
      const inspectionStatus = resolveInspectionRecordStatus({
        goodsNotReady: row?.goods_not_ready,
        explicitStatus: row?.status,
      });
      const isGoodsNotReady = isInspectionStatusMatching(
        inspectionStatus,
        INSPECTION_RECORD_STATUS.GOODS_NOT_READY,
      );

      return {
        qc_id: String(row?.qc_id || "").trim(),
        inspection_id: String(row?.inspection_id || "").trim(),
        order_id: normalizeText(row?.order_id || "") || "N/A",
        vendor: normalizeText(row?.vendor || "") || "N/A",
        brand: normalizeText(row?.brand || "") || "N/A",
        item_code: normalizeText(row?.item_code || "") || "N/A",
        requested_quantity: toNonNegativeNumber(row?.requested_quantity, 0),
        passed_quantity: toNonNegativeNumber(row?.passed_quantity, 0),
        open_quantity: toNonNegativeNumber(row?.open_quantity, 0),
        goods_not_ready: isGoodsNotReady,
        goods_not_ready_reason: getGoodsNotReadyReason(
          row?.goods_not_ready,
          row?.remarks || "",
        ),
        inspector_name: normalizeText(row?.inspector_name || ""),
        inspection_date: normalizeText(row?.inspection_date || ""),
      };
    });

    const brandOptions = normalizeDistinctValues(
      normalizedRows.map((row) => row?.brand || ""),
    );

    const filteredRows = selectedBrand
      ? normalizedRows.filter((row) => row.brand === selectedBrand)
      : normalizedRows;

    const vendorMap = new Map();
    for (const row of filteredRows) {
      const vendorKey = String(row.vendor || "").toLowerCase();
      if (!vendorMap.has(vendorKey)) {
        vendorMap.set(vendorKey, {
          vendor: row.vendor,
          items: [],
        });
      }

      const vendorEntry = vendorMap.get(vendorKey);
      vendorEntry.items.push({
        qc_id: row.qc_id,
        inspection_id: row.inspection_id,
        order_id: row.order_id,
        item_code: row.item_code,
        requested_quantity: row.requested_quantity,
        passed_quantity: row.passed_quantity,
        open_quantity: row.open_quantity,
        goods_not_ready: row.goods_not_ready,
        goods_not_ready_reason: row.goods_not_ready_reason,
        inspector_name: row.inspector_name,
        inspection_date: row.inspection_date,
      });
    }

    const vendors = Array.from(vendorMap.values())
      .map((entry) => ({
        vendor: entry.vendor,
        items: [...entry.items].sort((left, right) => {
          const orderCompare = String(left?.order_id || "").localeCompare(
            String(right?.order_id || ""),
          );
          if (orderCompare !== 0) return orderCompare;
          return String(left?.item_code || "").localeCompare(
            String(right?.item_code || ""),
          );
        }),
      }))
      .sort((left, right) =>
        String(left?.vendor || "").localeCompare(String(right?.vendor || "")),
      );

    return res.status(200).json({
      filters: {
        date: reportDate,
        brand: selectedBrand,
        brand_options: brandOptions,
      },
      summary: {
        vendors_count: vendors.length,
        items_count: filteredRows.length,
      },
      vendors,
    });
  } catch (err) {
    console.error("Daily Order Summary Error:", err);
    return res
      .status(500)
      .json({ message: err.message || "Failed to fetch daily order summary" });
  }
};

exports.markGoodsNotReady = async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ message: "Reason is required" });
    }

    const qc = await QC.findById(req.params.id)
      .populate("inspector")
      .populate("order", "status quantity shipment order_id brand vendor");

    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }
    const beforeInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    const beforeQcSnapshot = buildQcEditLogSnapshot(
      qc.toObject(),
      beforeInspectionRecords,
    );

    const normalizedRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const isAdmin = normalizedRole === "admin";
    const isManager = normalizedRole === "manager";
    const hasElevatedAccess = isAdmin || isManager;
    const currentUserId = String(req.user?._id || req.user?.id || "").trim();

    const latestRequestEntry = resolveLatestRequestEntry(
      qc?.request_history || [],
    );
    const latestRequestedQuantity = resolveRequestedQuantityFromQc(qc);
    const hasQcRequest =
      (Array.isArray(qc?.request_history) && qc.request_history.length > 0) ||
      latestRequestedQuantity > 0;

    if (!hasQcRequest) {
      return res.status(400).json({
        message: "QC is not requested yet. Align QC request before updating.",
      });
    }

    if (!hasElevatedAccess && normalizedRole === "qc") {
      const qcUserRequestAvailability = getQcUserLatestRequestAvailability(
        qc,
        beforeInspectionRecords,
        { currentUserId },
      );
      if (!qcUserRequestAvailability.isAvailable) {
        return res
          .status(qcUserRequestAvailability.statusCode || 403)
          .json({
            message: qcUserRequestAvailability.reason,
          });
      }
    }

    const inspectionInspectorId = qc?.inspector?._id
      ? qc.inspector._id
      : qc.inspector;
    if (!inspectionInspectorId) {
      return res.status(400).json({
        message: "Inspector is required before marking goods not ready",
      });
    }

    const inspectionDate = toISODateString(new Date());
    if (!inspectionDate) {
      return res
        .status(500)
        .json({ message: "Failed to resolve inspection date" });
    }

    const requestedDateForRecordRaw = String(
      latestRequestEntry?.request_date || qc.request_date || inspectionDate,
    ).trim();
    const requestedDateForRecord = toISODateString(requestedDateForRecordRaw);
    if (!requestedDateForRecord) {
      return res.status(400).json({
        message: "request_date is invalid for inspection records",
      });
    }

    const requestedQuantityForRecord = latestRequestedQuantity;

    qc.last_inspected_date = inspectionDate;
    qc.remarks = reason;
    qc.updated_by = buildAuditActor(req.user);

    const inspectionRecord = await upsertInspectionRecordForRequest({
      qcDoc: qc,
      inspectorId: inspectionInspectorId,
      requestDate: requestedDateForRecord,
      requestHistoryId: latestRequestEntry?._id || null,
      requestedQuantity: requestedQuantityForRecord,
      inspectionDate,
      remarks: reason,
      createdBy: req.user._id,
      auditUser: req.user,
      addChecked: 0,
      addPassed: 0,
      addProvision: 0,
      appendLabelRanges: [],
      appendLabels: [],
      replaceCbmSnapshot: false,
      goodsNotReady: {
        ready: true,
        reason,
      },
    });

    if (latestRequestEntry && inspectionRecord) {
      latestRequestEntry.status = "inspected";
      stampRequestHistoryEntry(latestRequestEntry, {
        user: req.user,
      });
    }

    await qc.save();

    const afterInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    await createQcEditLog({
      reqUser: req.user,
      qcDoc: qc,
      beforeSnapshot: beforeQcSnapshot,
      afterSnapshot: buildQcEditLogSnapshot(qc.toObject(), afterInspectionRecords),
      operationType: "qc_goods_not_ready",
      extraRemarks: ["Goods-not-ready inspection recorded."],
    });

    try {
      await upsertItemFromQc(qc);
    } catch (itemSyncError) {
      console.error("Item sync after goods-not-ready update failed:", {
        qcId: qc?._id,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    return res.status(200).json({
      message: "Goods marked as not ready",
      data: qc,
    });
  } catch (err) {
    console.error("Goods Not Ready Error:", err);
    return res
      .status(400)
      .json({ message: err.message || "Failed to mark goods not ready" });
  }
};

exports.rejectAllQc = async (req, res) => {
  let uploadedImageKey = "";
  let shouldCleanupUploadedImage = false;
  let preparedUpload = null;

  try {
    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ message: "Reason is required" });
    }

    const imageFile = req.file;
    if (!imageFile || !normalizeText(imageFile.path)) {
      return res.status(400).json({ message: "One rejection image is required" });
    }

    if (!isWasabiConfigured()) {
      return res.status(503).json({
        message: "Wasabi storage is not configured for rejected images",
      });
    }

    const qc = await QC.findById(req.params.id)
      .populate("inspector")
      .populate("order");

    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const beforeInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    const beforeQcSnapshot = buildQcEditLogSnapshot(
      qc.toObject(),
      beforeInspectionRecords,
    );
    const beforeOrderSnapshot = buildOrderAuditSnapshotForQc(qc?.order || null);

    const normalizedRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const isAdmin = normalizedRole === "admin";
    const isManager = normalizedRole === "manager";
    const hasElevatedAccess = isAdmin || isManager;
    const currentUserId = String(req.user?._id || req.user?.id || "").trim();

    const latestRequestEntry = resolveLatestRequestEntry(
      qc?.request_history || [],
    );
    const latestRequestedQuantity = resolveRequestedQuantityFromQc(qc);
    const hasQcRequest =
      (Array.isArray(qc?.request_history) && qc.request_history.length > 0) ||
      latestRequestedQuantity > 0;

    if (!hasQcRequest || !latestRequestEntry) {
      return res.status(400).json({
        message: "QC request history is required before rejecting all",
      });
    }

    if (!hasElevatedAccess && normalizedRole === "qc") {
      const qcUserRequestAvailability = getQcUserLatestRequestAvailability(
        qc,
        beforeInspectionRecords,
        { currentUserId },
      );
      if (!qcUserRequestAvailability.isAvailable) {
        return res
          .status(qcUserRequestAvailability.statusCode || 403)
          .json({
            message: qcUserRequestAvailability.reason,
          });
      }
    }

    const inspectionInspectorId = qc?.inspector?._id
      ? qc.inspector._id
      : qc.inspector;
    if (!inspectionInspectorId) {
      return res.status(400).json({
        message: "Inspector is required before rejecting this QC request",
      });
    }

    const requestedQuantityForRecord = toNonNegativeNumber(
      latestRequestedQuantity,
      0,
    );
    if (requestedQuantityForRecord <= 0) {
      return res.status(400).json({
        message: "Latest request quantity must be greater than 0",
      });
    }

    const inspectionDate = toISODateString(new Date());
    if (!inspectionDate) {
      return res
        .status(500)
        .json({ message: "Failed to resolve rejection date" });
    }

    const requestedDateForRecord = toISODateString(
      latestRequestEntry?.request_date || qc?.request_date || inspectionDate,
    );
    if (!requestedDateForRecord) {
      return res.status(400).json({
        message: "request_date is invalid for inspection records",
      });
    }

    const fallbackOriginalName = `${normalizeText(
      qc?.order_meta?.order_id || qc?._id || "qc",
    )}-rejected${path.extname(String(imageFile?.originalname || "")).toLowerCase() || ".jpg"}`;
    preparedUpload = await prepareSingleQcImageUpload({
      file: imageFile,
      fallbackOriginalName,
    });
    const uploadResult = await uploadPreparedQcImage({
      preparedUpload,
      folder: "qc-rejected-images",
    });
    uploadedImageKey = normalizeText(uploadResult?.key || "");
    shouldCleanupUploadedImage = Boolean(uploadedImageKey);

    const uploadedAt = new Date();
    const uploadedBy = buildAuditActor(req.user);
    const nextRejectedImageEntry = buildStoredQcImageEntry({
      uploadResult,
      hash: preparedUpload.hash,
      comment: reason,
      uploadedAt,
      uploadedBy,
    });
    const previousRejectedImageKey = normalizeText(
      qc?.rejected_image?.key || "",
    );

    const requestHistoryId = latestRequestEntry?._id || null;
    let inspectionRecord = null;
    if (requestHistoryId && mongoose.Types.ObjectId.isValid(requestHistoryId)) {
      inspectionRecord = await Inspection.findOne({
        qc: qc._id,
        request_history_id: requestHistoryId,
      }).sort({ createdAt: -1 });
    }

    if (!inspectionRecord) {
      inspectionRecord = await Inspection.findOne({
        qc: qc._id,
        requested_date: requestedDateForRecord,
      }).sort({ createdAt: -1 });
    }

    if (!inspectionRecord) {
      inspectionRecord = new Inspection({
        qc: qc._id,
        inspector: inspectionInspectorId,
        inspection_date: inspectionDate,
        status: INSPECTION_RECORD_STATUS.REJECTED,
        request_history_id: requestHistoryId || null,
        requested_date: requestedDateForRecord,
        vendor_requested: requestedQuantityForRecord,
        vendor_offered: requestedQuantityForRecord,
        checked: requestedQuantityForRecord,
        passed: 0,
        pending_after: 0,
        cbm: buildNormalizedCbmSnapshot(qc?.cbm),
        label_ranges: [],
        labels_added: [],
        goods_not_ready: {
          ready: false,
          reason: "",
        },
        remarks: reason,
        createdBy: req.user._id,
        updated_by: buildAuditActor(req.user),
      });
    } else {
      inspectionRecord.inspector = inspectionInspectorId;
      inspectionRecord.request_history_id =
        requestHistoryId || inspectionRecord.request_history_id || null;
      inspectionRecord.requested_date = requestedDateForRecord;
      inspectionRecord.inspection_date = inspectionDate;
      inspectionRecord.vendor_requested = requestedQuantityForRecord;
      inspectionRecord.vendor_offered = requestedQuantityForRecord;
      inspectionRecord.checked = requestedQuantityForRecord;
      inspectionRecord.passed = 0;
      inspectionRecord.status = INSPECTION_RECORD_STATUS.REJECTED;
      inspectionRecord.goods_not_ready = {
        ready: false,
        reason: "",
      };
      inspectionRecord.remarks = reason;
      inspectionRecord.updated_by = buildAuditActor(req.user);
    }

    await inspectionRecord.save();

    qc.inspection_record = Array.isArray(qc.inspection_record)
      ? qc.inspection_record
      : [];
    if (
      !qc.inspection_record.some(
        (entry) => String(entry) === String(inspectionRecord._id),
      )
    ) {
      qc.inspection_record.push(inspectionRecord._id);
    }

    let afterInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    recalculateQcAggregateQuantities(qc, afterInspectionRecords);

    const nextPendingAfter = toNonNegativeNumber(qc?.quantities?.pending, 0);
    if (toNonNegativeNumber(inspectionRecord.pending_after, 0) !== nextPendingAfter) {
      inspectionRecord.pending_after = nextPendingAfter;
      inspectionRecord.updated_by = buildAuditActor(req.user);
      await inspectionRecord.save();
      afterInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    }

    latestRequestEntry.status = REQUEST_HISTORY_STATUS.REJECTED;
    latestRequestEntry.remarks = reason;
    stampRequestHistoryEntry(latestRequestEntry, {
      user: req.user,
    });

    syncQcRequestHistoryStatuses(qc, afterInspectionRecords, {
      user: req.user,
    });
    syncQcCurrentRequestFieldsFromHistory(qc, afterInspectionRecords);

    qc.last_inspected_date = inspectionDate;
    qc.remarks = reason;
    qc.rejected_image = nextRejectedImageEntry;
    qc.updated_by = buildAuditActor(req.user);

    if (qc?.order) {
      applyQcOrderStatus(qc, qc.order);
      qc.order.updated_by = buildAuditActor(req.user);
    }

    await qc.save();
    shouldCleanupUploadedImage = false;
    if (qc?.order) {
      await applyQcOrderPoCbm(qc.order);
      await qc.order.save();
    }

    await createQcEditLog({
      reqUser: req.user,
      qcDoc: qc,
      beforeSnapshot: beforeQcSnapshot,
      afterSnapshot: buildQcEditLogSnapshot(qc.toObject(), afterInspectionRecords),
      operationType: "qc_reject_all",
      extraRemarks: ["Latest request marked as rejected with a rejection image."],
    });

    if (qc?.order) {
      await createOrderEditLogFromQc({
        reqUser: req.user,
        orderDoc: qc.order,
        beforeSnapshot: beforeOrderSnapshot,
        afterSnapshot: buildOrderAuditSnapshotForQc(qc.order),
        extraRemarks: ["Order updated from QC reject-all flow."],
      });
    }

    if (
      previousRejectedImageKey &&
      previousRejectedImageKey !== uploadedImageKey
    ) {
      await deleteObject(previousRejectedImageKey).catch(() => undefined);
    }

    try {
      await upsertItemFromQc(qc);
    } catch (itemSyncError) {
      console.error("Item sync after reject-all update failed:", {
        qcId: qc?._id,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    return res.status(200).json({
      message: "QC request rejected successfully",
      data: {
        qc_id: qc._id,
        inspection_id: inspectionRecord._id,
      },
    });
  } catch (err) {
    if (shouldCleanupUploadedImage && uploadedImageKey) {
      await deleteObject(uploadedImageKey).catch(() => undefined);
    }

    console.error("Reject All QC Error:", err);
    return res.status(400).json({
      message: err?.message || "Failed to reject this QC request",
    });
  } finally {
    await cleanupLocalQcImageFiles(preparedUpload?.cleanupPaths || [req.file?.path]);
  }
};

exports.transferQcRequest = async (req, res) => {
  try {
    const qcId = String(req.params.id || "").trim();
    const targetInspectorId = String(
      req.body?.inspector_id || req.body?.inspector || "",
    ).trim();
    const requestHistoryIds = [
      ...new Set(
        (Array.isArray(req.body?.request_history_ids)
          ? req.body.request_history_ids
          : [req.body?.request_history_id]
        )
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ];

    if (!mongoose.Types.ObjectId.isValid(qcId)) {
      return res.status(400).json({ message: "Invalid QC id" });
    }
    if (!mongoose.Types.ObjectId.isValid(targetInspectorId)) {
      return res.status(400).json({ message: "A valid target inspector is required" });
    }
    if (requestHistoryIds.length !== 1) {
      return res.status(400).json({
        message: "Select exactly one request history row to transfer",
      });
    }

    const qc = await QC.findById(qcId)
      .populate("inspector", "name email role")
      .populate("request_history.inspector", "name email role")
      .populate("order", "status quantity shipment order_id brand vendor");

    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const beforeInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    const beforeQcSnapshot = buildQcEditLogSnapshot(
      qc.toObject(),
      beforeInspectionRecords,
    );
    const targetInspector = await User.findById(targetInspectorId).select(
      "name email role",
    );

    if (!targetInspector) {
      return res.status(404).json({ message: "Target inspector not found" });
    }

    if (String(targetInspector?.role || "").trim().toLowerCase() !== "qc") {
      return res.status(400).json({ message: "Selected user is not a QC inspector" });
    }

    const selectedRequestHistoryId = requestHistoryIds[0];
    const requestEntry = Array.isArray(qc.request_history)
      ? qc.request_history.find(
          (entry) => String(entry?._id || "").trim() === selectedRequestHistoryId,
        )
      : null;

    if (!requestEntry) {
      return res.status(404).json({ message: "Selected request history row not found" });
    }

    if (
      normalizeRequestHistoryStatus(requestEntry?.status) ===
      normalizeRequestHistoryStatus(REQUEST_HISTORY_STATUS.TRANSFERRED)
    ) {
      return res.status(400).json({ message: "This request is already transferred" });
    }

    if (
      normalizeRequestHistoryStatus(requestEntry?.status) ===
      normalizeRequestHistoryStatus(REQUEST_HISTORY_STATUS.REJECTED)
    ) {
      return res.status(400).json({ message: "Rejected requests cannot be transferred" });
    }

    const currentRequestInspectorId = String(
      requestEntry?.inspector?._id || requestEntry?.inspector || "",
    ).trim();
    if (currentRequestInspectorId && currentRequestInspectorId === targetInspectorId) {
      return res.status(400).json({
        message: "Select a different inspector for transfer",
      });
    }

    const latestInspection = await Inspection.findOne({
      qc: qc._id,
      request_history_id: requestEntry._id,
    }).sort({ createdAt: -1 });

    if (!latestInspection) {
      return res.status(400).json({
        message: "No linked inspection record found for the selected request",
      });
    }

    const latestInspectionStatus = resolveInspectionRecordStatus({
      checked: latestInspection?.checked,
      goodsNotReady: latestInspection?.goods_not_ready,
      explicitStatus: latestInspection?.status,
    });
    if (
      normalizeInspectionStatus(latestInspectionStatus) ===
      normalizeInspectionStatus(INSPECTION_RECORD_STATUS.TRANSFERRED)
    ) {
      return res.status(400).json({
        message: "The latest inspection record is already transferred",
      });
    }

    if (
      normalizeInspectionStatus(latestInspectionStatus) ===
      normalizeInspectionStatus(INSPECTION_RECORD_STATUS.REJECTED)
    ) {
      return res.status(400).json({
        message: "Rejected requests cannot be transferred",
      });
    }

    const requestedQuantity = toNonNegativeNumber(
      requestEntry?.quantity_requested,
      0,
    );
    const pendingQuantity = Math.max(
      toNonNegativeNumber(latestInspection?.pending_after, 0),
      Math.max(
        0,
        requestedQuantity - toNonNegativeNumber(latestInspection?.passed, 0),
      ),
    );

    if (pendingQuantity <= 0) {
      return res.status(400).json({
        message: "No pending quantity is available to transfer",
      });
    }

    const auditTimestamp = new Date();
    const transferDate = toISODateString(auditTimestamp);
    if (!transferDate) {
      return res.status(500).json({ message: "Failed to resolve transfer date" });
    }

    const targetInspectorName = normalizeText(targetInspector?.name || "Selected Inspector");
    const previousInspectorName = normalizeText(
      requestEntry?.inspector?.name || qc?.inspector?.name || "",
    );
    const transferNote = `Transferred to ${targetInspectorName}`;
    const newRequestRemarks = previousInspectorName
      ? `Transferred from ${previousInspectorName}`
      : "";

    latestInspection.status = INSPECTION_RECORD_STATUS.TRANSFERRED;
    latestInspection.inspection_date = transferDate;
    latestInspection.remarks = transferNote;
    latestInspection.updated_by = buildAuditActor(req.user);
    await latestInspection.save();

    requestEntry.status = REQUEST_HISTORY_STATUS.TRANSFERRED;
    requestEntry.remarks = transferNote;
    stampRequestHistoryEntry(requestEntry, {
      user: req.user,
      updatedAt: auditTimestamp,
    });

    qc.request_history = Array.isArray(qc.request_history) ? qc.request_history : [];
    qc.request_history.push({
      request_date: transferDate,
      request_type: normalizeQcRequestType(
        requestEntry?.request_type || qc?.request_type,
      ),
      quantity_requested: requestedQuantity,
      inspector: targetInspectorId,
      status: REQUEST_HISTORY_STATUS.OPEN,
      remarks: newRequestRemarks,
      createdBy: req.user._id,
      updatedAt: auditTimestamp,
      updated_by: buildAuditActor(req.user),
    });

    const latestTransferredRequestEntry =
      qc.request_history[qc.request_history.length - 1] || null;

    await upsertInspectionRecordForRequest({
      qcDoc: qc,
      inspectorId: targetInspectorId,
      requestDate: transferDate,
      requestHistoryId: latestTransferredRequestEntry?._id || null,
      requestedQuantity: requestedQuantity,
      inspectionDate: transferDate,
      remarks: newRequestRemarks,
      createdBy: req.user._id,
      auditUser: req.user,
      addChecked: 0,
      addPassed: 0,
      addProvision: 0,
      appendLabelRanges: [],
      appendLabels: [],
      replaceCbmSnapshot: false,
      allowRequestedDateFallback: false,
    });

    const refreshedInspectionRecords = await Inspection.find({ qc: qc._id }).lean();
    syncQcCurrentRequestFieldsFromHistory(qc, refreshedInspectionRecords);
    syncQcRequestHistoryStatuses(qc, refreshedInspectionRecords, {
      user: req.user,
      updatedAt: auditTimestamp,
    });
    const transferredRequestEntry = qc.request_history.find(
      (entry) => String(entry?._id || "").trim() === selectedRequestHistoryId,
    );
    if (transferredRequestEntry) {
      transferredRequestEntry.status = REQUEST_HISTORY_STATUS.TRANSFERRED;
      transferredRequestEntry.remarks = transferNote;
      stampRequestHistoryEntry(transferredRequestEntry, {
        user: req.user,
        updatedAt: auditTimestamp,
      });
    }
    qc.updated_by = buildAuditActor(req.user);

    await qc.save();

    await createQcEditLog({
      reqUser: req.user,
      qcDoc: qc,
      beforeSnapshot: beforeQcSnapshot,
      afterSnapshot: buildQcEditLogSnapshot(qc.toObject(), refreshedInspectionRecords),
      operationType: "qc_request_transfer",
      extraRemarks: [transferNote],
    });

    return res.status(200).json({
      message: `Request transferred to ${targetInspectorName}`,
      data: {
        qc_id: qc._id,
        target_inspector: {
          _id: targetInspector._id,
          name: targetInspector.name || "Selected Inspector",
        },
        source_request_status: REQUEST_HISTORY_STATUS.TRANSFERRED,
        source_inspection_status: INSPECTION_RECORD_STATUS.TRANSFERRED,
        transfer_quantity: requestedQuantity,
        pending_quantity: pendingQuantity,
      },
    });
  } catch (err) {
    console.error("Transfer QC Request Error:", err);
    return res.status(400).json({
      message: err?.message || "Failed to transfer QC request",
    });
  }
};

exports.lookupInspectionTransferTarget = async (req, res) => {
  try {
    const qcId = String(req.params.id || "").trim();
    const recordId = String(req.params.recordId || "").trim();
    const poNumber = normalizeText(req.query?.po || req.query?.order_id || req.query?.orderId);

    if (!mongoose.Types.ObjectId.isValid(qcId)) {
      return res.status(400).json({ message: "Invalid QC id" });
    }
    if (!mongoose.Types.ObjectId.isValid(recordId)) {
      return res.status(400).json({ message: "Invalid inspection record id" });
    }
    if (!poNumber) {
      return res.status(400).json({ message: "PO is required" });
    }

    const qc = await QC.findById(qcId)
      .select("order item order_meta")
      .populate("order", "order_id brand vendor item quantity status shipment qc_record");
    if (!qc || !qc.order) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const sourceInspection = await Inspection.findOne({
      _id: recordId,
      qc: qc._id,
    }).select(
      "qc inspection_date requested_date status checked passed vendor_requested vendor_offered labels_added goods_not_ready",
    );
    if (!sourceInspection) {
      return res.status(404).json({ message: "Inspection record not found" });
    }

    const sourceStatus = resolveInspectionRecordStatus({
      checked: sourceInspection?.checked,
      passed: sourceInspection?.passed,
      vendorOffered: sourceInspection?.vendor_offered,
      labelsAdded: sourceInspection?.labels_added,
      goodsNotReady: sourceInspection?.goods_not_ready,
      explicitStatus: sourceInspection?.status,
      requestType: qc?.request_type,
    });
    if (
      normalizeInspectionStatus(sourceStatus) ===
        normalizeInspectionStatus(INSPECTION_RECORD_STATUS.REJECTED) ||
      normalizeInspectionStatus(sourceStatus) ===
        normalizeInspectionStatus(INSPECTION_RECORD_STATUS.GOODS_NOT_READY)
    ) {
      return res.status(400).json({
        message: "Rejected or goods-not-ready inspection records cannot be transferred",
      });
    }

    const sourcePassed = toNonNegativeNumber(sourceInspection?.passed, 0);
    if (sourcePassed <= 0) {
      return res.status(400).json({
        message: "This inspection record has no passed quantity available to transfer",
      });
    }

    const sourceLabels = normalizeLabels(sourceInspection?.labels_added);
    const {
      targetOrder,
      targetQc,
      openQuantity,
    } = await findTransferTargetOrderAndQc({
      poNumber,
      itemCode: qc?.item?.item_code || qc?.order?.item?.item_code || "",
      sourceOrderId: qc?.order?._id || qc?.order || "",
    });

    if (!targetOrder) {
      return res.status(404).json({
        message: "No active order with open quantity was found for this PO and item",
      });
    }

    if (openQuantity <= 0) {
      return res.status(400).json({
        message: "The selected PO has no open quantity available for transfer",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        source: {
          qc_id: qc._id,
          order_id: qc?.order?.order_id || qc?.order_meta?.order_id || "",
          item_code: qc?.item?.item_code || "",
          passed_quantity: sourcePassed,
          available_labels: sourceLabels,
          available_labels_count: sourceLabels.length,
        },
        target: {
          order_id: targetOrder?.order_id || "",
          brand: targetOrder?.brand || "",
          vendor: targetOrder?.vendor || "",
          item_code: targetOrder?.item?.item_code || "",
          open_quantity: openQuantity,
          qc_id: targetQc?._id || null,
        },
      },
    });
  } catch (err) {
    console.error("Lookup Inspection Transfer Target Error:", err);
    return res.status(400).json({
      message: err?.message || "Failed to lookup transfer target",
    });
  }
};

exports.transferInspectionRecord = async (req, res) => {
  try {
    const qcId = String(req.params.id || "").trim();
    const recordId = String(req.params.recordId || "").trim();
    const poNumber = normalizeText(req.body?.po || req.body?.order_id || req.body?.orderId);
    const transferQuantityRaw = Number(req.body?.quantity);
    const transferLabels = parseTransferLabelsInput(
      req.body?.labels ?? req.body?.labels_added,
    );

    if (!mongoose.Types.ObjectId.isValid(qcId)) {
      return res.status(400).json({ message: "Invalid QC id" });
    }
    if (!mongoose.Types.ObjectId.isValid(recordId)) {
      return res.status(400).json({ message: "Invalid inspection record id" });
    }
    if (!poNumber) {
      return res.status(400).json({ message: "PO is required" });
    }
    if (!Number.isInteger(transferQuantityRaw) || transferQuantityRaw <= 0) {
      return res.status(400).json({
        message: "quantity must be a positive integer",
      });
    }

    const sourceQc = await QC.findById(qcId)
      .populate("order", "order_id brand vendor item quantity status shipment qc_record")
      .populate("inspector", "name email role");
    if (!sourceQc || !sourceQc.order) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const sourceInspection = await Inspection.findOne({
      _id: recordId,
      qc: sourceQc._id,
    });
    if (!sourceInspection) {
      return res.status(404).json({ message: "Inspection record not found" });
    }

    const sourcePassed = toNonNegativeNumber(sourceInspection?.passed, 0);
    if (transferQuantityRaw > sourcePassed) {
      return res.status(400).json({
        message: "Transfer quantity cannot be greater than the passed quantity of this inspection record",
      });
    }

    const sourceLabels = normalizeLabels(sourceInspection?.labels_added);
    const invalidTransferLabels = transferLabels.filter(
      (label) => !sourceLabels.includes(label),
    );
    if (invalidTransferLabels.length > 0) {
      return res.status(400).json({
        message: `Selected labels are not available on this inspection record: ${invalidTransferLabels.join(", ")}`,
      });
    }

    const sourceStatus = resolveInspectionRecordStatus({
      checked: sourceInspection?.checked,
      passed: sourceInspection?.passed,
      vendorOffered: sourceInspection?.vendor_offered,
      labelsAdded: sourceInspection?.labels_added,
      goodsNotReady: sourceInspection?.goods_not_ready,
      explicitStatus: sourceInspection?.status,
      requestType: sourceQc?.request_type,
    });
    if (
      normalizeInspectionStatus(sourceStatus) ===
        normalizeInspectionStatus(INSPECTION_RECORD_STATUS.REJECTED) ||
      normalizeInspectionStatus(sourceStatus) ===
        normalizeInspectionStatus(INSPECTION_RECORD_STATUS.GOODS_NOT_READY)
    ) {
      return res.status(400).json({
        message: "Rejected or goods-not-ready inspection records cannot be transferred",
      });
    }

    const {
      targetOrder,
      targetQc: existingTargetQc,
      openQuantity,
    } = await findTransferTargetOrderAndQc({
      poNumber,
      itemCode: sourceQc?.item?.item_code || sourceQc?.order?.item?.item_code || "",
      sourceOrderId: sourceQc?.order?._id || sourceQc?.order || "",
    });

    if (!targetOrder) {
      return res.status(404).json({
        message: "No active order with open quantity was found for this PO and item",
      });
    }
    if (openQuantity <= 0) {
      return res.status(400).json({
        message: "The selected PO has no open quantity available for transfer",
      });
    }
    if (transferQuantityRaw > openQuantity) {
      return res.status(400).json({
        message: "Transfer quantity cannot exceed the open quantity on the selected PO",
      });
    }

    const itemCode = normalizeText(
      sourceQc?.item?.item_code || targetOrder?.item?.item_code || "",
    );
    const matchedItem = itemCode
      ? await Item.findOne({
          code: {
            $regex: `^${escapeRegex(itemCode)}$`,
            $options: "i",
          },
        })
          .select("code name description cbm qc")
          .lean()
      : null;

    const transferDate = toISODateString(new Date()) || sourceInspection?.inspection_date || sourceQc?.request_date || "";
    const requestedDate = String(
      sourceInspection?.requested_date ||
        sourceInspection?.inspection_date ||
        sourceQc?.request_date ||
        transferDate,
    );
    const inspectionDate = String(
      sourceInspection?.inspection_date || transferDate,
    );
    const transferNoteSource = `Transferred ${transferQuantityRaw} to PO ${targetOrder.order_id}`;
    const transferNoteTarget =
      `Transferred from PO ${sourceQc?.order?.order_id || sourceQc?.order_meta?.order_id || "N/A"}`;

    const sourceBeforeInspections = await Inspection.find({ qc: sourceQc._id }).lean();
    const sourceBeforeSnapshot = buildQcEditLogSnapshot(
      sourceQc.toObject(),
      sourceBeforeInspections,
    );
    const sourceOrderBeforeSnapshot = buildOrderAuditSnapshotForQc(sourceQc?.order);

    let targetQc = existingTargetQc;
    const targetBeforeInspections = targetQc
      ? await Inspection.find({ qc: targetQc._id }).lean()
      : [];
    const targetBeforeSnapshot = targetQc
      ? buildQcEditLogSnapshot(targetQc.toObject(), targetBeforeInspections)
      : {};
    const targetOrderBeforeSnapshot = buildOrderAuditSnapshotForQc(targetOrder);

    const targetRequestHistoryEntry = {
      request_date: requestedDate,
      request_type: normalizeQcRequestType(sourceQc?.request_type),
      quantity_requested: transferQuantityRaw,
      inspector: sourceInspection?.inspector || sourceQc?.inspector?._id || sourceQc?.inspector || null,
      status: REQUEST_HISTORY_STATUS.INSPECTED,
      remarks: transferNoteTarget,
      createdBy: req.user._id,
      updatedAt: new Date(),
      updated_by: buildAuditActor(req.user),
    };

    if (!targetQc) {
      targetQc = new QC({
        order: targetOrder._id,
        item: {
          item_code: targetOrder?.item?.item_code || sourceQc?.item?.item_code || "",
          description: targetOrder?.item?.description || sourceQc?.item?.description || "",
        },
        inspector:
          sourceInspection?.inspector || sourceQc?.inspector?._id || sourceQc?.inspector || null,
        request_type: normalizeQcRequestType(sourceQc?.request_type),
        order_meta: {
          order_id: targetOrder.order_id,
          vendor: targetOrder.vendor,
          brand: targetOrder.brand,
        },
        request_date: requestedDate,
        last_inspected_date: inspectionDate,
        quantities: {
          client_demand: toNonNegativeNumber(targetOrder?.quantity, 0),
          quantity_requested: transferQuantityRaw,
          vendor_provision: transferQuantityRaw,
          qc_checked: transferQuantityRaw,
          qc_passed: transferQuantityRaw,
          pending: Math.max(
            0,
            toNonNegativeNumber(targetOrder?.quantity, 0) - transferQuantityRaw,
          ),
          qc_rejected: 0,
        },
        request_history: [targetRequestHistoryEntry],
        remarks: transferNoteTarget,
        createdBy: req.user._id,
        updated_by: buildAuditActor(req.user),
      });

      const createPatchResult = buildQcItemDetailsPatch({
        qcSnapshot: targetQc,
        itemDoc: matchedItem,
        onlyUpdatedItems: true,
      });
      if (createPatchResult?.set) {
        applyQcItemDetailsPatch(targetQc, createPatchResult.set);
      }
    } else {
      targetQc.request_history = Array.isArray(targetQc.request_history)
        ? targetQc.request_history
        : [];
      targetQc.request_history.push(targetRequestHistoryEntry);
      targetQc.updated_by = buildAuditActor(req.user);
    }

    const sourceCheckedBefore = toNonNegativeNumber(sourceInspection?.checked, 0);
    const sourceRequestedBefore = toNonNegativeNumber(sourceInspection?.vendor_requested, 0);
    const sourceOfferedBefore = toNonNegativeNumber(sourceInspection?.vendor_offered, 0);
    const sourcePassedBefore = toNonNegativeNumber(sourceInspection?.passed, 0);
    const sourcePendingBefore = toNonNegativeNumber(sourceInspection?.pending_after, 0);
    const sourceCbmBefore = getNormalizedCbmTotalNumber(sourceInspection?.cbm);
    const transferCbmTotal =
      sourceCheckedBefore > 0
        ? (sourceCbmBefore / sourceCheckedBefore) * transferQuantityRaw
        : 0;

    sourceInspection.vendor_requested = Math.max(
      0,
      sourceRequestedBefore - transferQuantityRaw,
    );
    sourceInspection.vendor_offered = Math.max(
      0,
      sourceOfferedBefore - transferQuantityRaw,
    );
    sourceInspection.checked = Math.max(0, sourceCheckedBefore - transferQuantityRaw);
    sourceInspection.passed = Math.max(0, sourcePassedBefore - transferQuantityRaw);
    sourceInspection.pending_after = sourcePendingBefore + transferQuantityRaw;
    sourceInspection.labels_added = normalizeLabels(
      sourceLabels.filter((label) => !transferLabels.includes(label)),
    );
    sourceInspection.label_ranges = buildLabelRangesFromLabels(
      sourceInspection.labels_added,
    );
    sourceInspection.cbm = buildSingleBoxCbmSnapshot(
      Math.max(0, sourceCbmBefore - transferCbmTotal),
    );
    sourceInspection.status = resolveInspectionRecordStatus({
      checked: sourceInspection.checked,
      passed: sourceInspection.passed,
      vendorOffered: sourceInspection.vendor_offered,
      labelsAdded: sourceInspection.labels_added,
      labelRanges: sourceInspection.label_ranges,
      goodsNotReady: sourceInspection.goods_not_ready,
      explicitStatus:
        sourceInspection.checked <= 0 &&
        sourceInspection.passed <= 0 &&
        sourceInspection.vendor_offered <= 0 &&
        sourceInspection.labels_added.length === 0
          ? INSPECTION_RECORD_STATUS.TRANSFERRED
          : "",
      requestType: sourceQc?.request_type,
    });
    sourceInspection.remarks = normalizeText(
      [sourceInspection.remarks, transferNoteSource].filter(Boolean).join(" | "),
    );
    sourceInspection.updated_by = buildAuditActor(req.user);
    await sourceInspection.save();

    if (!targetQc._id) {
      await targetQc.save();
    }

    const latestTargetRequestEntry =
      Array.isArray(targetQc.request_history) && targetQc.request_history.length > 0
        ? targetQc.request_history[targetQc.request_history.length - 1]
        : null;
    const targetInspection = await upsertInspectionRecordForRequest({
      qcDoc: targetQc,
      inspectorId:
        sourceInspection?.inspector || sourceQc?.inspector?._id || sourceQc?.inspector || "",
      requestDate: requestedDate,
      requestHistoryId: latestTargetRequestEntry?._id || null,
      requestedQuantity: transferQuantityRaw,
      inspectionDate,
      remarks: transferNoteTarget,
      createdBy: req.user._id,
      auditUser: req.user,
      addChecked: transferQuantityRaw,
      addPassed: transferQuantityRaw,
      addProvision: transferQuantityRaw,
      appendLabelRanges: buildLabelRangesFromLabels(transferLabels),
      appendLabels: transferLabels,
      replaceCbmSnapshot: false,
      allowRequestedDateFallback: false,
      explicitStatus: INSPECTION_RECORD_STATUS.DONE,
    });
    if (targetInspection) {
      targetInspection.cbm = buildSingleBoxCbmSnapshot(transferCbmTotal);
      targetInspection.updated_by = buildAuditActor(req.user);
      await targetInspection.save();
    }

    const sourceAfterInspections = await refreshQcAggregateState(sourceQc, req.user);
    const targetAfterInspections = await refreshQcAggregateState(targetQc, req.user);

    applyQcOrderStatus(sourceQc, sourceQc.order);
    sourceQc.order.updated_by = buildAuditActor(req.user);
    await applyQcOrderPoCbm(sourceQc.order);
    await sourceQc.order.save();

    applyQcOrderStatus(targetQc, targetOrder);
    targetOrder.qc_record = targetQc._id;
    targetOrder.updated_by = buildAuditActor(req.user);
    await applyQcOrderPoCbm(targetOrder);
    await targetOrder.save();

    await recalculateInspectorUsedLabels([
      sourceInspection?.inspector,
      sourceQc?.inspector?._id || sourceQc?.inspector,
      targetQc?.inspector?._id || targetQc?.inspector,
    ]);

    await createQcEditLog({
      reqUser: req.user,
      qcDoc: sourceQc,
      beforeSnapshot: sourceBeforeSnapshot,
      afterSnapshot: buildQcEditLogSnapshot(sourceQc.toObject(), sourceAfterInspections),
      operationType: "qc_update",
      extraRemarks: [transferNoteSource],
    });
    await createOrderEditLogFromQc({
      reqUser: req.user,
      orderDoc: sourceQc.order,
      beforeSnapshot: sourceOrderBeforeSnapshot,
      afterSnapshot: buildOrderAuditSnapshotForQc(sourceQc.order),
      extraRemarks: ["Order recalculated after inspection transfer."],
    });

    await createQcEditLog({
      reqUser: req.user,
      qcDoc: targetQc,
      beforeSnapshot: targetBeforeSnapshot,
      afterSnapshot: buildQcEditLogSnapshot(targetQc.toObject(), targetAfterInspections),
      operationType: "qc_update",
      extraRemarks: [transferNoteTarget],
    });
    await createOrderEditLogFromQc({
      reqUser: req.user,
      orderDoc: targetOrder,
      beforeSnapshot: targetOrderBeforeSnapshot,
      afterSnapshot: buildOrderAuditSnapshotForQc(targetOrder),
      extraRemarks: ["Order recalculated after receiving transferred inspection quantity."],
    });

    try {
      await upsertItemFromQc(sourceQc);
      if (String(targetQc?._id || "") !== String(sourceQc?._id || "")) {
        await upsertItemFromQc(targetQc);
      }
    } catch (itemSyncError) {
      console.error("Item sync after inspection transfer failed:", {
        sourceQcId: sourceQc?._id,
        targetQcId: targetQc?._id,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    return res.status(200).json({
      success: true,
      message: `Transferred ${transferQuantityRaw} to PO ${targetOrder.order_id}`,
      data: {
        source_qc_id: sourceQc._id,
        source_order_id: sourceQc?.order?.order_id || sourceQc?.order_meta?.order_id || "",
        target_qc_id: targetQc._id,
        target_order_id: targetOrder.order_id,
        transferred_quantity: transferQuantityRaw,
        transferred_labels: transferLabels,
      },
    });
  } catch (err) {
    console.error("Transfer Inspection Record Error:", err);
    return res.status(400).json({
      message: err?.message || "Failed to transfer inspection record",
    });
  }
};

exports.getDailyReport = async (req, res) => {
  try {
    const reportDate = resolveReportDate(req.query.date);
    if (!reportDate) {
      return res.status(400).json({ message: "Invalid date format" });
    }
    const selectedBrand = normalizeOptionalReportFilter(req.query.brand);
    const selectedVendor = normalizeOptionalReportFilter(req.query.vendor);
    const normalizeSortKey = (value = "") =>
      String(value)
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "")
        .toLowerCase();
    const resolveSortOrder = ({
      token = "",
      explicitOrder = "",
      defaultOrder = "desc",
    }) => {
      const trimmedToken = String(token || "").trim();
      const tokenDirection = trimmedToken.startsWith("-")
        ? "desc"
        : trimmedToken.startsWith("+")
          ? "asc"
          : null;
      const normalizedExplicit = String(explicitOrder || "")
        .trim()
        .toLowerCase();
      if (normalizedExplicit === "asc" || normalizedExplicit === "desc") {
        return normalizedExplicit;
      }
      return tokenDirection || defaultOrder;
    };

    const rawAlignedSortToken = String(req.query.aligned_sort || "").trim();
    const rawAlignedSortBy = String(
      req.query.aligned_sort_by ?? req.query.alignedSortBy ?? "",
    ).trim();
    const alignedSortAliases = {
      po: "order_id",
      order: "order_id",
      orderid: "order_id",
      order_id: "order_id",
      vendor: "vendor",
      qc: "inspector_name",
      qcname: "inspector_name",
      qc_name: "inspector_name",
      inspector: "inspector_name",
      inspectorname: "inspector_name",
      inspector_name: "inspector_name",
      date: "request_date",
      requestdate: "request_date",
      request_date: "request_date",
    };
    const alignedSortBy =
      alignedSortAliases[
        normalizeSortKey(
          rawAlignedSortBy || rawAlignedSortToken.replace(/^[+-]/, ""),
        )
      ] || "request_date";
    const alignedSortOrder = resolveSortOrder({
      token: rawAlignedSortToken,
      explicitOrder: req.query.aligned_sort_order ?? req.query.alignedSortOrder,
      defaultOrder:
        alignedSortBy === "request_date"
          ? "desc"
          : "asc",
    });
    const alignedSortDirection = alignedSortOrder === "asc" ? 1 : -1;

    const rawInspectionSortToken = String(
      req.query.inspection_sort || "",
    ).trim();
    const rawInspectionSortBy = String(
      req.query.inspection_sort_by ?? req.query.inspectionSortBy ?? "",
    ).trim();
    const inspectionSortAliases = {
      po: "order_id",
      order: "order_id",
      orderid: "order_id",
      order_id: "order_id",
      date: "inspection_date",
      inspectiondate: "inspection_date",
      inspection_date: "inspection_date",
    };
    const inspectionSortBy =
      inspectionSortAliases[
        normalizeSortKey(
          rawInspectionSortBy || rawInspectionSortToken.replace(/^[+-]/, ""),
        )
      ] || "inspection_date";
    const inspectionSortOrder = resolveSortOrder({
      token: rawInspectionSortToken,
      explicitOrder:
        req.query.inspection_sort_order ?? req.query.inspectionSortOrder,
      defaultOrder: inspectionSortBy === "order_id" ? "asc" : "desc",
    });
    const inspectionSortDirection = inspectionSortOrder === "asc" ? 1 : -1;

    const compareText = (aValue, bValue) =>
      String(aValue || "").localeCompare(String(bValue || ""));
    const compareAlignedRows = (a, b) => {
      const primary = (() => {
        if (alignedSortBy === "order_id") {
          return compareText(a?.order_id, b?.order_id);
        }
        if (alignedSortBy === "vendor") {
          return compareText(a?.vendor, b?.vendor);
        }
        if (alignedSortBy === "inspector_name") {
          return compareText(a?.inspector?.name || "Unassigned", b?.inspector?.name || "Unassigned");
        }
        return toSortableTimestamp(a?.request_date) -
          toSortableTimestamp(b?.request_date);
      })();
      if (primary !== 0) return primary * alignedSortDirection;

      const secondary = (() => {
        if (alignedSortBy === "order_id") {
          return toSortableTimestamp(a?.request_date) -
            toSortableTimestamp(b?.request_date);
        }
        if (alignedSortBy === "vendor") {
          return compareText(a?.inspector?.name || "Unassigned", b?.inspector?.name || "Unassigned");
        }
        if (alignedSortBy === "inspector_name") {
          return compareText(a?.vendor, b?.vendor);
        }
        return compareText(a?.order_id, b?.order_id);
      })();
      if (secondary !== 0) {
        return alignedSortBy === "order_id" ? secondary * -1 : secondary;
      }

      const tertiary =
        toSortableTimestamp(b?.request_date) -
        toSortableTimestamp(a?.request_date);
      if (alignedSortBy !== "request_date" && tertiary !== 0) {
        return tertiary;
      }

      const quaternary = compareText(a?.order_id, b?.order_id);
      if (quaternary !== 0) return quaternary;

      return compareText(a?.item_code, b?.item_code);
    };

    const compareInspectionRows = (a, b) => {
      const primary =
        inspectionSortBy === "order_id"
          ? compareText(a?.order_id, b?.order_id)
          : toSortableTimestamp(a?.inspection_date) -
            toSortableTimestamp(b?.inspection_date);
      if (primary !== 0) return primary * inspectionSortDirection;

      const secondary =
        inspectionSortBy === "order_id"
          ? toSortableTimestamp(a?.inspection_date) -
            toSortableTimestamp(b?.inspection_date)
          : compareText(a?.order_id, b?.order_id);
      if (secondary !== 0) {
        return inspectionSortBy === "order_id" ? secondary * -1 : secondary;
      }
      return compareText(a?.item_code, b?.item_code);
    };
    const [reportYear, reportMonth, reportDay] = String(reportDate).split("-");
    const inspectionDateVariants = [
      reportDate,
      `${reportDay}/${reportMonth}/${reportYear}`,
      `${reportDay}-${reportMonth}-${reportYear}`,
    ];
    const reportDateStart = parseIsoDateToUtcDate(reportDate);
    const reportDateEnd = reportDateStart
      ? new Date(reportDateStart.getTime() + (24 * 60 * 60 * 1000))
      : null;
    const toReportDateKey = (value) => toISODateString(value) || "";
    const isOnOrBeforeReportDate = (value) => {
      const normalized = toReportDateKey(value);
      return Boolean(normalized) && normalized <= reportDate;
    };
    const isSameReportDateFromTimestamp = (value) => {
      if (!reportDateStart || !reportDateEnd || !value) return false;
      const timestamp = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(timestamp.getTime())) return false;
      return timestamp >= reportDateStart && timestamp < reportDateEnd;
    };
    const resolveInspectionStatusForReport = (inspection = {}) =>
      resolveInspectionRecordStatus({
        checked: inspection?.checked,
        passed: inspection?.passed,
        vendorOffered: inspection?.vendor_offered,
        labelsAdded: inspection?.labels_added,
        labelRanges: inspection?.label_ranges,
        goodsNotReady: inspection?.goods_not_ready,
        explicitStatus: inspection?.status,
      });
    const isTransferredStatusValue = (value) =>
      normalizeInspectionStatus(value) ===
      normalizeInspectionStatus(INSPECTION_RECORD_STATUS.TRANSFERRED);
    const isRejectedStatusValue = (value) =>
      normalizeInspectionStatus(value) ===
      normalizeInspectionStatus(INSPECTION_RECORD_STATUS.REJECTED);
    const isTransferredInspectionOnReportDate = (inspection = {}) =>
      isTransferredStatusValue(resolveInspectionStatusForReport(inspection))
      && isSameReportDateFromTimestamp(
        inspection?.updatedAt || inspection?.createdAt,
      );
    const isInspectionVisibleForReportDate = (inspection = {}) => {
      const resolvedInspectionStatus = resolveInspectionStatusForReport(inspection);
      const shouldUseMutationTimestamp =
        isTransferredStatusValue(resolvedInspectionStatus) ||
        isRejectedStatusValue(resolvedInspectionStatus);
      const effectiveDate = shouldUseMutationTimestamp
        ? inspection?.updatedAt || inspection?.createdAt || inspection?.inspection_date
        : inspection?.inspection_date || inspection?.createdAt;
      return isOnOrBeforeReportDate(effectiveDate);
    };
    const buildDailyRequestLookupKey = ({
      qcId = "",
      requestHistoryId = "",
      requestDate = "",
    } = {}) => {
      const normalizedQcId = String(qcId || "").trim();
      const normalizedRequestHistoryId = String(requestHistoryId || "").trim();
      if (normalizedRequestHistoryId) {
        return `history:${normalizedRequestHistoryId}`;
      }

      const normalizedRequestDate = toReportDateKey(requestDate);
      if (!normalizedQcId || !normalizedRequestDate) return "";
      return `legacy:${normalizedQcId}:${normalizedRequestDate}`;
    };

    const [alignedRequestsRaw, inspectionsRaw] = await Promise.all([
      QC.find({
        $or: [
          { request_date: { $lte: reportDate } },
          { request_history: { $elemMatch: { request_date: { $lte: reportDate } } } },
        ],
      })
        .select(
          "request_date request_type request_history order_meta item inspector quantities order cbm",
        )
        .populate("inspector", "name email role")
        .populate("request_history.inspector", "name email role")
        .populate({
          path: "order",
          select: "order_id status quantity shipment brand vendor archived",
          match: ACTIVE_ORDER_MATCH,
        })
        .sort({ createdAt: -1 })
        .lean(),
      Inspection.find({
        $or: [
          { inspection_date: { $in: inspectionDateVariants } },
          {
            status: INSPECTION_RECORD_STATUS.TRANSFERRED,
            ...(reportDateStart && reportDateEnd
              ? {
                  updatedAt: {
                    $gte: reportDateStart,
                    $lt: reportDateEnd,
                  },
                }
              : {}),
          },
        ],
      })
        .select(
          "inspection_date status inspector qc checked passed vendor_requested vendor_offered pending_after cbm labels_added label_ranges goods_not_ready remarks createdAt updatedAt",
        )
        .populate("inspector", "name email role")
        .populate({
          path: "qc",
          select: "item order_meta order cbm request_date request_type",
          populate: {
            path: "order",
            select: "order_id status quantity shipment brand vendor archived",
            match: ACTIVE_ORDER_MATCH,
          },
        })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const alignedRequestQcs = alignedRequestsRaw.filter((qc) => qc?.order);
    const inspections = inspectionsRaw.filter(
      (inspection) => inspection?.qc?.order,
    );
    const uniqueItemCodes = [
      ...new Set(
        [...alignedRequestQcs, ...inspections.map((inspection) => inspection?.qc)]
          .map((record) => normalizeText(record?.item?.item_code || ""))
          .filter(Boolean),
      ),
    ];
    const itemDocs = uniqueItemCodes.length > 0
      ? await Item.find({
          code: {
            $in: uniqueItemCodes.map(
              (itemCode) => new RegExp(`^${escapeRegex(itemCode)}$`, "i"),
            ),
          },
        })
          .select(
            "code cbm inspected_item_LBH inspected_item_sizes inspected_item_top_LBH inspected_item_bottom_LBH inspected_box_LBH inspected_box_sizes inspected_box_top_LBH inspected_box_bottom_LBH inspected_top_LBH inspected_bottom_LBH pis_item_LBH pis_item_sizes pis_item_top_LBH pis_item_bottom_LBH pis_box_LBH pis_box_sizes pis_box_top_LBH pis_box_bottom_LBH",
          )
          .lean()
      : [];
    const itemDocByCodeKey = new Map(
      itemDocs.map((itemDoc) => [normalizeItemCodeKey(itemDoc?.code), itemDoc]),
    );
    const alignedRequestQcIds = alignedRequestQcs
      .map((qc) => String(qc?._id || "").trim())
      .filter((value) => mongoose.Types.ObjectId.isValid(value));
    const alignedRequestInspections = alignedRequestQcIds.length > 0
      ? await Inspection.find({ qc: { $in: alignedRequestQcIds } })
        .select(
          "inspection_date requested_date request_history_id status qc inspector checked passed vendor_requested vendor_offered pending_after cbm labels_added label_ranges goods_not_ready remarks createdAt updatedAt",
        )
        .sort({ createdAt: -1 })
        .lean()
      : [];

    const alignedRequestInspectionsByQcId = new Map();
    for (const inspection of alignedRequestInspections) {
      if (!isInspectionVisibleForReportDate(inspection)) {
        continue;
      }

      const inspectionQcId = String(inspection?.qc || "").trim();
      if (!inspectionQcId) continue;

      const groupedInspections =
        alignedRequestInspectionsByQcId.get(inspectionQcId) || [];
      groupedInspections.push(inspection);
      alignedRequestInspectionsByQcId.set(inspectionQcId, groupedInspections);
    }

    const toInspectorSummary = (inspector = null) => {
      if (!inspector) return null;

      const inspectorId = inspector?._id || inspector || null;
      const inspectorName = normalizeText(inspector?.name || "");
      const inspectorEmail = normalizeText(inspector?.email || "");
      const inspectorRole = normalizeText(inspector?.role || "");

      if (!inspectorId && !inspectorName) return null;

      return {
        _id: inspectorId,
        name: inspectorName || "Unassigned",
        email: inspectorEmail,
        role: inspectorRole,
      };
    };

    const aligned_requests = alignedRequestQcs.flatMap((qc) => {
      const qcId = String(qc?._id || "").trim();
      if (!qcId) return [];

      const requestEntries =
        Array.isArray(qc?.request_history) && qc.request_history.length > 0
          ? qc.request_history.map((entry) => ({
              request_history_id: entry?._id || null,
              request_date: entry?.request_date || "",
              request_type: entry?.request_type || qc?.request_type,
              quantity_requested: entry?.quantity_requested,
              inspector: entry?.inspector || qc?.inspector || null,
              status: entry?.status || REQUEST_HISTORY_STATUS.OPEN,
              remarks: entry?.remarks || "",
              updated_at: entry?.updatedAt || null,
            }))
          : [
              {
                request_history_id: null,
                request_date: qc?.request_date || "",
                request_type: qc?.request_type,
                quantity_requested: qc?.quantities?.quantity_requested,
                inspector: qc?.inspector || null,
                status: REQUEST_HISTORY_STATUS.OPEN,
                remarks: "",
                updated_at: null,
              },
            ];

      return requestEntries
        .map((requestEntry) => {
          const requestDateKey = toReportDateKey(requestEntry?.request_date);
          if (!requestDateKey || requestDateKey > reportDate) return null;
          const normalizedRequestEntryStatus = normalizeRequestHistoryStatus(
            requestEntry?.status,
          );
          const isTransferredRequestOnReportDate =
            normalizedRequestEntryStatus ===
              normalizeRequestHistoryStatus(REQUEST_HISTORY_STATUS.TRANSFERRED)
            && isSameReportDateFromTimestamp(requestEntry?.updated_at);
          const isRejectedRequestOnReportDate =
            normalizedRequestEntryStatus ===
              normalizeRequestHistoryStatus(REQUEST_HISTORY_STATUS.REJECTED)
            && isSameReportDateFromTimestamp(requestEntry?.updated_at);

          const requestLookupKey = buildDailyRequestLookupKey({
            qcId,
            requestHistoryId: requestEntry?.request_history_id,
            requestDate: requestDateKey,
          });
          const latestInspection = resolveLatestInspectionRecordForRequestEntry(
            alignedRequestInspectionsByQcId.get(qcId) || [],
            requestEntry,
          );
          const hasInspectionActivity = hasInspectionRecordActivity({
            checked: latestInspection?.checked,
            passed: latestInspection?.passed,
            vendorOffered: latestInspection?.vendor_offered,
            labelsAdded: latestInspection?.labels_added,
            labelRanges: latestInspection?.label_ranges,
            goodsNotReady: latestInspection?.goods_not_ready,
            status: latestInspection?.status || requestEntry?.status,
          });
          const shouldIncludeRequest =
            requestDateKey === reportDate ||
            isTransferredRequestOnReportDate ||
            isRejectedRequestOnReportDate;

          if (!shouldIncludeRequest) return null;

          const itemCodeKey = normalizeItemCodeKey(qc?.item?.item_code || "");
          const itemDoc = itemDocByCodeKey.get(itemCodeKey) || null;
          const inspectedQty = Number(latestInspection?.checked || 0);
          const reportCbmPerUnit = resolveItemReportCbmPerUnit(
            itemDoc,
            latestInspection,
            { allowPlainInspectionFallback: false },
          );
          const hasReportCbm = reportCbmPerUnit > 0;
          const inspectedCbmTotal = hasReportCbm
            ? toRoundedNumber(reportCbmPerUnit * inspectedQty, 3)
            : null;
          const derivedInspectionStatus = resolveInspectionRecordStatus({
            checked: latestInspection?.checked,
            passed: latestInspection?.passed,
            vendorOffered: latestInspection?.vendor_offered,
            labelsAdded: latestInspection?.labels_added,
            labelRanges: latestInspection?.label_ranges,
            goodsNotReady: latestInspection?.goods_not_ready,
            explicitStatus: latestInspection?.status || requestEntry?.status,
            requestType: requestEntry?.request_type || qc?.request_type,
          });
          const inspectionStatus = String(
            derivedInspectionStatus || latestInspection?.status || requestEntry?.status,
          ).trim() || INSPECTION_RECORD_STATUS.PENDING;
          const normalizedInspectionStatus = normalizeInspectionStatus(
            inspectionStatus,
          );
          const goodsNotReady =
            normalizedInspectionStatus ===
            normalizeInspectionStatus(INSPECTION_RECORD_STATUS.GOODS_NOT_READY);
          const isTransferred =
            normalizedInspectionStatus ===
            normalizeInspectionStatus(INSPECTION_RECORD_STATUS.TRANSFERRED);
          const isRejected =
            normalizedInspectionStatus ===
            normalizeInspectionStatus(INSPECTION_RECORD_STATUS.REJECTED);
          const isInspectionDone =
            normalizedInspectionStatus ===
            normalizeInspectionStatus(INSPECTION_RECORD_STATUS.DONE);

          return {
            request_row_id: requestLookupKey || `${qcId}:${requestDateKey}`,
            qc_id: qc._id,
            request_history_id: requestEntry?.request_history_id || null,
            request_date: isTransferredRequestOnReportDate || isRejectedRequestOnReportDate
              ? reportDate
              : requestDateKey,
            order_id: qc?.order_meta?.order_id || qc?.order?.order_id || "N/A",
            brand: qc?.order_meta?.brand || qc?.order?.brand || "N/A",
            vendor: qc?.order_meta?.vendor || qc?.order?.vendor || "N/A",
            item_code: qc?.item?.item_code || "N/A",
            description: qc?.item?.description || "N/A",
            inspector: toInspectorSummary(requestEntry?.inspector),
            quantity_requested: Number(requestEntry?.quantity_requested || 0),
            quantity_inspected: inspectedQty,
            quantity_passed: Number(latestInspection?.passed || 0),
            quantity_pending: Number(
              latestInspection?.pending_after ?? qc?.quantities?.pending ?? 0,
            ),
            report_cbm_per_unit: hasReportCbm
              ? toRoundedNumber(reportCbmPerUnit, 3)
              : null,
            inspected_cbm_total: inspectedCbmTotal,
            inspection_status: inspectionStatus,
            order_status: resolveQcOrderStatus(qc, qc?.order),
            is_inspection_done: isInspectionDone,
            request_pending_action: !hasInspectionActivity,
            goods_not_ready: goodsNotReady,
            is_transferred: isTransferred,
            is_rejected: isRejected,
            transfer_note: isTransferred
              ? normalizeText(latestInspection?.remarks || requestEntry?.remarks || "")
              : "",
            rejection_reason: isRejected
              ? normalizeText(latestInspection?.remarks || requestEntry?.remarks || "")
              : "",
            goods_not_ready_reason: goodsNotReady
              ? getGoodsNotReadyReason(
                  latestInspection?.goods_not_ready,
                  latestInspection?.remarks || "",
                )
              : "",
          };
        })
        .filter(Boolean);
    });
    const inspection_rows = inspections.map((inspection) => {
      const inspectedQty = Number(inspection?.checked || 0);
      const qcRecord = inspection?.qc || {};
      const itemCodeKey = normalizeItemCodeKey(qcRecord?.item?.item_code || "");
      const itemDoc = itemDocByCodeKey.get(itemCodeKey) || null;
      const reportCbmPerUnit = resolveItemReportCbmPerUnit(
        itemDoc,
        inspection,
        { allowPlainInspectionFallback: false },
      );
      const hasReportCbm = reportCbmPerUnit > 0;
      const inspectedCbmTotal = hasReportCbm ? reportCbmPerUnit * inspectedQty : 0;
      const cbmSnapshot = buildNormalizedCbmSnapshot(
        inspection?.cbm && typeof inspection.cbm === "object"
          ? inspection.cbm
          : qcRecord?.cbm || {},
      );
      const inspectionStatus = resolveInspectionRecordStatus({
        checked: inspection?.checked,
        goodsNotReady: inspection?.goods_not_ready,
        explicitStatus: inspection?.status,
      });
      const isTransferred = isTransferredStatusValue(inspectionStatus);
      const isRejected = isRejectedStatusValue(inspectionStatus);

      return {
        inspection_id: inspection._id,
        inspection_date:
          isTransferredInspectionOnReportDate(inspection)
          ? reportDate
          : inspection.inspection_date || null,
        order_id:
          qcRecord?.order_meta?.order_id || qcRecord?.order?.order_id || "N/A",
        vendor: qcRecord?.order_meta?.vendor || qcRecord?.order?.vendor || "N/A",
        brand: qcRecord?.order_meta?.brand || qcRecord?.order?.brand || "N/A",
        item_code: qcRecord?.item?.item_code || "N/A",
        description: qcRecord?.item?.description || "N/A",
        inspected_quantity: inspectedQty,
        passed_quantity: Number(inspection?.passed || 0),
        vendor_requested: Number(inspection?.vendor_requested || 0),
        vendor_offered: Number(inspection?.vendor_offered || 0),
        pending_after: Number(inspection?.pending_after || 0),
        goods_not_ready: isGoodsNotReadyMarked(
          inspection?.goods_not_ready,
          inspectionStatus,
        ),
        inspection_status: inspectionStatus,
        is_transferred: isTransferred,
        is_rejected: isRejected,
        transfer_note: isTransferred
          ? normalizeText(inspection?.remarks || "")
          : "",
        rejection_reason: isRejected
          ? normalizeText(inspection?.remarks || "")
          : "",
        goods_not_ready_reason: getGoodsNotReadyReason(
          inspection?.goods_not_ready,
          inspection?.remarks || "",
        ),
        report_cbm_per_unit: hasReportCbm
          ? toRoundedNumber(reportCbmPerUnit, 3)
          : null,
        report_cbm_total: hasReportCbm
          ? toRoundedNumber(inspectedCbmTotal, 3)
          : null,
        inspected_cbm_total: inspectedCbmTotal,
        cbm: cbmSnapshot,
        remarks: inspection?.remarks || "",
        inspector: inspection?.inspector
          ? {
              _id: inspection.inspector._id,
              name: inspection.inspector.name,
              email: inspection.inspector.email,
              role: inspection.inspector.role,
            }
          : {
              _id: null,
              name: "Unassigned",
              email: "",
              role: "",
            },
      };
    });

    const allFilterableRows = [...aligned_requests, ...inspection_rows];
    const brandOptionsBase = selectedVendor
      ? allFilterableRows.filter((row) => String(row?.vendor || "") === selectedVendor)
      : allFilterableRows;
    const vendorOptionsBase = selectedBrand
      ? allFilterableRows.filter((row) => String(row?.brand || "") === selectedBrand)
      : allFilterableRows;
    const brand_options = normalizeDistinctValues(
      brandOptionsBase.map((row) => row?.brand || ""),
    );
    const vendor_options = normalizeDistinctValues(
      vendorOptionsBase.map((row) => row?.vendor || ""),
    );
    const matchesDailyReportFilters = (row = {}) => {
      if (selectedBrand && String(row?.brand || "") !== selectedBrand) return false;
      if (selectedVendor && String(row?.vendor || "") !== selectedVendor) return false;
      return true;
    };

    const sortedAlignedRequests = [...aligned_requests]
      .filter(matchesDailyReportFilters)
      .sort(compareAlignedRows);

    const filteredInspectionRows = inspection_rows.filter(matchesDailyReportFilters);

    const inspectorMap = new Map();
    let totalInspectedCbm = 0;
    for (const inspectionRow of filteredInspectionRows) {
      const inspectorId = String(
        inspectionRow?.inspector?._id || "unassigned",
      );

      if (!inspectorMap.has(inspectorId)) {
        inspectorMap.set(inspectorId, {
          inspector: inspectionRow?.inspector || {
            _id: null,
            name: "Unassigned",
            email: "",
            role: "",
          },
          total_inspected_quantity: 0,
          total_inspected_cbm: 0,
          inspections_count: 0,
          inspections: [],
        });
      }

      const entry = inspectorMap.get(inspectorId);
      entry.total_inspected_quantity += Number(
        inspectionRow?.inspected_quantity || 0,
      );
      entry.total_inspected_cbm += Number(
        inspectionRow?.inspected_cbm_total || 0,
      );
      totalInspectedCbm += Number(inspectionRow?.inspected_cbm_total || 0);
      entry.inspections_count += 1;
      entry.inspections.push(inspectionRow);
    }

    for (const inspectorEntry of inspectorMap.values()) {
      inspectorEntry.inspections = Array.isArray(inspectorEntry.inspections)
        ? [...inspectorEntry.inspections].sort(compareInspectionRows)
        : [];
    }

    const inspector_compiled = Array.from(inspectorMap.values()).sort((a, b) =>
      String(a?.inspector?.name || "").localeCompare(
        String(b?.inspector?.name || ""),
      ),
    );

    const totalInspectedQty = inspector_compiled.reduce(
      (sum, entry) => sum + Number(entry.total_inspected_quantity || 0),
      0,
    );

    res.json({
      date: reportDate,
      filters: {
        brand: selectedBrand,
        vendor: selectedVendor,
        brand_options,
        vendor_options,
      },
      summary: {
        aligned_requests_count: sortedAlignedRequests.length,
        inspectors_count: inspector_compiled.length,
        inspections_count: filteredInspectionRows.length,
        total_inspected_quantity: totalInspectedQty,
        total_inspected_cbm: toRoundedNumber(totalInspectedCbm, 3),
      },
      aligned_requests: sortedAlignedRequests,
      inspector_compiled,
      sort: {
        aligned: {
          sort_by: alignedSortBy,
          sort_order: alignedSortOrder,
        },
        inspection: {
          sort_by: inspectionSortBy,
          sort_order: inspectionSortOrder,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.uploadQcImages = async (req, res) => {
  const requestStartedAt = Date.now();
  try {
    const qcId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(qcId)) {
      return res.status(400).json({ success: false, message: "Invalid QC id" });
    }

    const qc = await QC.findById(qcId)
      .populate("inspector")
      .populate("order", "status quantity shipment order_id brand vendor");

    if (!qc) {
      return res.status(404).json({ success: false, message: "QC record not found" });
    }

    const uploadMode = String(
      req.body?.upload_mode || req.body?.uploadMode || QC_IMAGE_UPLOAD_MODES.SINGLE,
    )
      .trim()
      .toLowerCase();
    if (
      uploadMode !== QC_IMAGE_UPLOAD_MODES.SINGLE &&
      uploadMode !== QC_IMAGE_UPLOAD_MODES.BULK
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid QC image upload mode",
      });
    }

    const files = flattenUploadedFiles(req.files);
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: "No image uploaded" });
    }
    if (files.length > MAX_QC_IMAGE_UPLOAD_COUNT) {
      return res.status(400).json({
        success: false,
        message: `You can upload up to ${MAX_QC_IMAGE_UPLOAD_COUNT} QC images at once`,
      });
    }
    if (uploadMode === QC_IMAGE_UPLOAD_MODES.SINGLE && files.length !== 1) {
      return res.status(400).json({
        success: false,
        message: "Single image upload accepts exactly one image",
      });
    }

    if (!isWasabiConfigured()) {
      return res.status(500).json({
        success: false,
        message: "Wasabi storage is not configured",
      });
    }

    const singleImageComment =
      uploadMode === QC_IMAGE_UPLOAD_MODES.SINGLE
        ? normalizeText(req.body?.comment || "")
        : "";
    const uploadedBy = buildAuditActor(req.user);
    const {
      uploadedCount,
      skippedDuplicateCount,
      skippedDuplicates,
      failedCount,
      failures,
      optimizedCount,
      bytesSaved,
      processedCount,
      totalRequestedCount,
    } = await processQcImageBatch({
      qc,
      files,
      uploadMode,
      singleImageComment,
      uploadedBy,
      requestStartedAt,
    });

    let message = "QC image upload request processed";
    if (uploadedCount > 0) {
      message = `${uploadedCount} QC image${uploadedCount === 1 ? "" : "s"} uploaded successfully`;
    } else if (skippedDuplicateCount > 0 && failedCount === 0) {
      message = "All selected QC images were duplicates and were skipped";
    } else if (failedCount > 0 && uploadedCount === 0 && skippedDuplicateCount === 0) {
      message = "No QC images were uploaded";
    }

    if (skippedDuplicateCount > 0 && uploadedCount > 0) {
      message += `. ${skippedDuplicateCount} duplicate${skippedDuplicateCount === 1 ? "" : "s"} skipped.`;
    }
    if (failedCount > 0) {
      message += `${message.endsWith(".") ? "" : "."} ${failedCount} file${failedCount === 1 ? "" : "s"} failed.`;
    }

    return res.status(200).json({
      success: true,
      message,
      data: {
        qc_id: qc._id,
        uploaded_count: uploadedCount,
        skipped_duplicate_count: skippedDuplicateCount,
        skipped_duplicates: skippedDuplicates,
        failed_count: failedCount,
        failures,
        optimized_count: optimizedCount,
        bytes_saved: bytesSaved,
        processed_count: processedCount,
        total_requested_count: totalRequestedCount,
      },
    });
  } catch (error) {
    console.error("Upload QC Images Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to upload QC images",
    });
  } finally {
    const files = flattenUploadedFiles(req.files);
    await cleanupLocalQcImageFiles(files.map((file) => file?.path));
  }
};

exports.deleteQcImages = async (req, res) => {
  try {
    const qcId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(qcId)) {
      return res.status(400).json({ success: false, message: "Invalid QC id" });
    }

    const qc = await QC.findById(qcId)
      .populate("inspector")
      .populate("order", "status quantity shipment order_id brand vendor");

    if (!qc) {
      return res.status(404).json({ success: false, message: "QC record not found" });
    }

    const normalizedRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const isAdmin = normalizedRole === "admin";
    const isManager = normalizedRole === "manager";
    const hasElevatedAccess = isAdmin || isManager;
    const currentUserId = String(req.user?._id || req.user?.id || "").trim();
    const isInspectionDone = isQcOrderInspectionDone(qc, qc?.order);

    if (!hasElevatedAccess && isInspectionDone) {
      return res.status(403).json({
        success: false,
        message:
          "Only admin or manager can delete QC images after inspection is done",
      });
    }

    if (!hasElevatedAccess) {
      if (!currentUserId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const alignedInspectorId = String(
        qc?.inspector?._id || qc?.inspector || "",
      ).trim();
      if (!alignedInspectorId || alignedInspectorId !== currentUserId) {
        return res.status(403).json({
          success: false,
          message: "QC can delete images only for records aligned to them",
        });
      }
    }

    const rawImageIds = Array.isArray(req.body?.image_ids)
      ? req.body.image_ids
      : Array.isArray(req.body?.imageIds)
        ? req.body.imageIds
        : [];
    const rawImageKeys = Array.isArray(req.body?.image_keys)
      ? req.body.image_keys
      : Array.isArray(req.body?.imageKeys)
        ? req.body.imageKeys
        : [];

    const requestedImageIds = Array.from(
      new Set(rawImageIds.map((value) => String(value || "").trim()).filter(Boolean)),
    );
    const requestedImageKeys = Array.from(
      new Set(rawImageKeys.map((value) => normalizeText(value)).filter(Boolean)),
    );

    if (requestedImageIds.length === 0 && requestedImageKeys.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Select at least one QC image to delete",
      });
    }

    const qcImages = Array.isArray(qc?.qc_images) ? qc.qc_images : [];
    const imagesToDelete = qcImages.filter((image) => {
      const imageId = String(image?._id || "").trim();
      const imageKey = normalizeText(image?.key || "");
      return (
        (imageId && requestedImageIds.includes(imageId)) ||
        (imageKey && requestedImageKeys.includes(imageKey))
      );
    });

    if (imagesToDelete.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Selected QC images were not found",
      });
    }

    const objectIdsToDelete = imagesToDelete
      .map((image) => String(image?._id || "").trim())
      .filter((value) => mongoose.Types.ObjectId.isValid(value))
      .map((value) => new mongoose.Types.ObjectId(value));
    const objectKeysToDelete = imagesToDelete
      .map((image) => normalizeText(image?.key || ""))
      .filter(Boolean);

    const pullConditions = [];
    if (objectIdsToDelete.length > 0) {
      pullConditions.push({ _id: { $in: objectIdsToDelete } });
    }
    if (objectKeysToDelete.length > 0) {
      pullConditions.push({ key: { $in: objectKeysToDelete } });
    }

    if (pullConditions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Selected QC images are invalid",
      });
    }

    await QC.updateOne(
      { _id: qc._id },
      {
        $pull: {
          qc_images:
            pullConditions.length === 1
              ? pullConditions[0]
              : { $or: pullConditions },
        },
        $set: {
          updated_by: buildAuditActor(req.user),
        },
      },
    );

    const storageDeleteResults = await Promise.allSettled(
      objectKeysToDelete.map((key) => deleteObject(key)),
    );
    const failedStorageDeletes = storageDeleteResults.filter(
      (entry) => entry.status === "rejected",
    );

    return res.status(200).json({
      success: true,
      message:
        failedStorageDeletes.length > 0
          ? `${imagesToDelete.length} QC image${imagesToDelete.length === 1 ? "" : "s"} removed. Some storage objects could not be deleted.`
          : `${imagesToDelete.length} QC image${imagesToDelete.length === 1 ? "" : "s"} deleted successfully`,
      data: {
        qc_id: qc._id,
        deleted_count: imagesToDelete.length,
        storage_delete_failure_count: failedStorageDeletes.length,
      },
    });
  } catch (error) {
    console.error("Delete QC Images Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete QC images",
    });
  }
};

exports.getQCById = async (req, res) => {
  try {
    const qc = await QC.findById(req.params.id)
      .populate("inspector", "name email role")
      .populate("createdBy", "name email role")
      .populate("request_history.inspector", "name email role")
      .populate("request_history.createdBy", "name email role")
      .populate("request_history.updated_by.user", "name email role")
      .populate("updated_by.user", "name email role")
      .populate({
        path: "order",
        match: ACTIVE_ORDER_MATCH,
      })
      .populate({
        path: "inspection_record",
        options: { sort: { inspection_date: -1, createdAt: -1 } },
        populate: [
          { path: "inspector", select: "name email role" },
          { path: "updated_by.user", select: "name email role" },
        ],
      });

    if (!qc || !qc.order) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const normalizedRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const isQcUser = normalizedRole === "qc";
    if (isQcUser) {
      const currentUserId = String(req.user?._id || req.user?.id || "").trim();
      const alignedInspectorId = String(
        qc?.inspector?._id || qc?.inspector || "",
      ).trim();
      if (
        !currentUserId ||
        !alignedInspectorId ||
        alignedInspectorId !== currentUserId
      ) {
        return res.status(403).json({
          message: "QC can only view records aligned to them",
        });
      }
    }

    const qcData = qc.toObject();
    const itemCode = normalizeText(
      qcData?.item?.item_code || qcData?.order?.item?.item_code || "",
    );
    const itemMaster = itemCode
      ? await Item.findOne({
          code: {
            $regex: `^${escapeRegex(itemCode)}$`,
            $options: "i",
          },
        })
          .select(
            "code name description brand_name brands vendors finish inspected_weight pis_weight weight cbm pis_barcode pis_master_barcode pis_inner_barcode qc.barcode qc.master_barcode qc.inner_barcode inspected_item_LBH inspected_item_sizes inspected_item_top_LBH inspected_item_bottom_LBH pis_item_LBH pis_item_sizes pis_item_top_LBH pis_item_bottom_LBH item_LBH inspected_box_LBH inspected_box_sizes inspected_box_top_LBH inspected_box_bottom_LBH inspected_top_LBH inspected_bottom_LBH pis_box_LBH pis_box_sizes pis_box_top_LBH pis_box_bottom_LBH box_LBH image cad_file pis_file assembly_file",
          )
          .lean()
      : null;
    const itemFinishEntries = Array.isArray(itemMaster?.finish)
      ? itemMaster.finish
      : [];
    const finishIds = [
      ...new Set(
        itemFinishEntries
          .map((entry) => String(entry?.finish_id || "").trim())
          .filter((value) => mongoose.Types.ObjectId.isValid(value)),
      ),
    ];
    const finishUniqueCodes = [
      ...new Set(
        itemFinishEntries
          .map((entry) => String(entry?.unique_code || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    const finishDocs =
      finishIds.length > 0 || finishUniqueCodes.length > 0
        ? await Finish.find({
            $or: [
              ...(finishIds.length > 0
                ? [
                    {
                      _id: {
                        $in: finishIds.map(
                          (value) => new mongoose.Types.ObjectId(value),
                        ),
                      },
                    },
                  ]
                : []),
              ...(finishUniqueCodes.length > 0
                ? [{ unique_code: { $in: finishUniqueCodes } }]
                : []),
            ],
          })
            .select("_id unique_code image")
            .lean()
        : [];
    const finishDocById = new Map(
      finishDocs.map((finishDoc) => [
        String(finishDoc?._id || "").trim(),
        finishDoc,
      ]),
    );
    const finishDocByUniqueCode = new Map(
      finishDocs.map((finishDoc) => [
        String(finishDoc?.unique_code || "").trim().toUpperCase(),
        finishDoc,
      ]),
    );
    const signedFinishEntries = await Promise.all(
      itemFinishEntries.map(async (entry) => {
        const finishId = String(entry?.finish_id || "").trim();
        const uniqueCode = String(entry?.unique_code || "").trim().toUpperCase();
        const matchedFinish =
          (finishId ? finishDocById.get(finishId) : null) ||
          (uniqueCode ? finishDocByUniqueCode.get(uniqueCode) : null) ||
          null;

        return {
          ...entry,
          finish_id: matchedFinish?._id || null,
          image: matchedFinish?.image
            ? buildFinishImagePublicUrl(entry)
            : null,
        };
      }),
    );
    const itemMasterWithSignedUrls = itemMaster
      ? {
          ...itemMaster,
          finish: signedFinishEntries,
          image: await buildSignedItemImage(itemMaster?.image),
          cad_file: await buildSignedItemFile(itemMaster?.cad_file, {
            logLabel: "CAD file",
          }),
          pis_file: await buildSignedItemFile(itemMaster?.pis_file, {
            logLabel: "PIS file",
          }),
          assembly_file: await buildSignedItemFile(itemMaster?.assembly_file, {
            logLabel: "Assembly file",
          }),
        }
      : null;
    const qcImagesWithSignedUrls = await Promise.all(
      (Array.isArray(qcData?.qc_images) ? [...qcData.qc_images] : [])
        .sort(
          (a, b) =>
            toSortableTimestamp(b?.uploadedAt || b?.createdAt) -
            toSortableTimestamp(a?.uploadedAt || a?.createdAt),
        )
        .map(
        async (image) => {
          const signedImage = await buildSignedQcImage(image);
          return {
            ...image,
            ...(signedImage || {}),
            comment: normalizeText(image?.comment || ""),
          };
        },
      ),
    );
    const rejectedImageWithSignedUrl = qcData?.rejected_image
      ? await buildSignedQcImage(qcData.rejected_image)
      : null;
    const sortedLabels = normalizeLabels(qcData.labels);
    const sortedRequestHistory = Array.isArray(qcData.request_history)
      ? [...qcData.request_history].sort((a, b) => {
          const aTime = Math.max(
            toSortableTimestamp(a?.request_date),
            toSortableTimestamp(a?.createdAt),
          );
          const bTime = Math.max(
            toSortableTimestamp(b?.request_date),
            toSortableTimestamp(b?.createdAt),
          );
          return bTime - aTime;
        })
      : [];
    const sortedInspectionRecords = Array.isArray(qcData.inspection_record)
      ? [...qcData.inspection_record].sort((a, b) => {
          const aTime =
            toSortableTimestamp(a?.inspection_date) ||
            toSortableTimestamp(a?.createdAt);
          const bTime =
            toSortableTimestamp(b?.inspection_date) ||
            toSortableTimestamp(b?.createdAt);
          return bTime - aTime;
        })
      : [];

    if (qcData?.order) {
      qcData.order = {
        ...qcData.order,
        status: resolveQcOrderStatus(qcData, qcData.order),
      };
    }

    res.json({
      data: {
        ...qcData,
        item_master: itemMasterWithSignedUrls,
        qc_images: qcImagesWithSignedUrls,
        rejected_image: rejectedImageWithSignedUrl
          ? {
              ...qcData.rejected_image,
              ...rejectedImageWithSignedUrl,
            }
          : qcData?.rejected_image || null,
        labels: sortedLabels,
        request_history: sortedRequestHistory,
        inspection_record: sortedInspectionRecords,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.editInspectionRecords = async (req, res) => {
  try {
    const qcId = String(req.params.id || "").trim();
    const payloadRecords = Array.isArray(req.body?.records)
      ? req.body.records
      : [];

    if (!mongoose.Types.ObjectId.isValid(qcId)) {
      return res.status(400).json({ message: "Invalid QC id" });
    }

    if (payloadRecords.length === 0) {
      return res
        .status(400)
        .json({ message: "At least one inspection row is required" });
    }

    const qc = await QC.findById(qcId);
    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const inspectionDocs = await Inspection.find({ qc: qc._id });
    if (inspectionDocs.length === 0) {
      return res
        .status(404)
        .json({ message: "No inspection records found for this QC record" });
    }
    const beforeQcSnapshot = buildQcEditLogSnapshot(
      qc.toObject(),
      inspectionDocs.map((doc) => doc.toObject()),
    );
    const linkedOrderBefore =
      qc?.order && mongoose.Types.ObjectId.isValid(qc.order)
        ? await Order.findById(qc.order)
        : null;
    const beforeOrderSnapshot = buildOrderAuditSnapshotForQc(linkedOrderBefore);

    const inspectionMap = new Map(
      inspectionDocs.map((doc) => [String(doc._id), doc]),
    );
    const requestHistoryEntries = Array.isArray(qc?.request_history)
      ? qc.request_history
      : [];
    const requestHistoryEntryById = new Map(
      requestHistoryEntries.map((entry) => [String(entry?._id || "").trim(), entry]),
    );
    const touchedInspectors = new Set();
    const requestHistoryDateUpdates = new Map();
    const qcRequestedQuantityCap = resolveRequestedQuantityFromQc(qc);

    const parseRequiredDate = (value, fieldName) => {
      const rawValue = String(value || "").trim();
      if (!rawValue) {
        throw new Error(`${fieldName} is required`);
      }
      const normalizedIso = toISODateString(rawValue);
      if (!normalizedIso) {
        throw new Error(`${fieldName} must be a valid date`);
      }
      return normalizedIso;
    };

    const parseRequiredInspector = (value) => {
      const inspectorId = String(value || "").trim();
      if (!inspectorId) {
        throw new Error("Inspector is required");
      }
      if (!mongoose.Types.ObjectId.isValid(inspectorId)) {
        throw new Error("Inspector id is invalid");
      }
      return inspectorId;
    };

    const parseNonNegativeField = (value, fieldName) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${fieldName} must be a valid non-negative number`);
      }
      return parsed;
    };

    const buildLabelsFromRanges = (ranges = []) => {
      const normalizedRanges = [];
      const generatedLabels = [];

      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i] || {};
        const hasStart = String(range.start ?? "").trim() !== "";
        const hasEnd = String(range.end ?? "").trim() !== "";

        if (!hasStart && !hasEnd) continue;
        if (!hasStart || !hasEnd) {
          throw new Error(
            `Both start and end are required for label range ${i + 1}`,
          );
        }

        const start = Number(range.start);
        const end = Number(range.end);
        if (!Number.isInteger(start) || !Number.isInteger(end)) {
          throw new Error(`Label range ${i + 1} must contain integer values`);
        }
        if (start < 0 || end < 0) {
          throw new Error(
            `Label range ${i + 1} must contain non-negative values`,
          );
        }
        if (start > end) {
          throw new Error(
            `Start cannot be greater than end in label range ${i + 1}`,
          );
        }

        normalizedRanges.push({ start, end });
        for (let label = start; label <= end; label++) {
          generatedLabels.push(label);
        }
      }

      return { generatedLabels, normalizedRanges };
    };

    const resolveLinkedRequestHistoryEntry = (record) => {
      const requestHistoryId = String(record?.request_history_id || "").trim();
      if (requestHistoryId && requestHistoryEntryById.has(requestHistoryId)) {
        return requestHistoryEntryById.get(requestHistoryId) || null;
      }

      const recordRequestedDate = toISODateString(
        record?.requested_date || record?.inspection_date || record?.createdAt,
      );
      const recordInspectorId = String(
        record?.inspector?._id || record?.inspector || "",
      ).trim();

      if (!recordRequestedDate) return null;

      const exactMatch = requestHistoryEntries.find((entry) => {
        const entryRequestDate = toISODateString(entry?.request_date);
        const entryInspectorId = String(
          entry?.inspector?._id || entry?.inspector || "",
        ).trim();
        return (
          entryRequestDate === recordRequestedDate &&
          (!recordInspectorId || entryInspectorId === recordInspectorId)
        );
      });
      if (exactMatch) return exactMatch;

      return (
        requestHistoryEntries.find(
          (entry) => toISODateString(entry?.request_date) === recordRequestedDate,
        ) || null
      );
    };

    for (const row of payloadRecords) {
      const recordId = String(row?._id || row?.id || "").trim();
      if (!recordId || !mongoose.Types.ObjectId.isValid(recordId)) {
        throw new Error("Invalid inspection record id in payload");
      }

      const record = inspectionMap.get(recordId);
      if (!record) {
        throw new Error(
          `Inspection record ${recordId} does not belong to this QC`,
        );
      }

      const requestedDate = parseRequiredDate(
        row?.requested_date ?? row?.request_date ?? record.requested_date,
        "Requested date",
      );
      const inspectionDate = parseRequiredDate(
        row?.inspection_date ?? record.inspection_date,
        "Inspection date",
      );
      const inspectorId = parseRequiredInspector(
        row?.inspector ?? row?.inspector_id ?? record.inspector,
      );

      const rawVendorRequested =
        row?.vendor_requested ??
        record.vendor_requested ??
        qcRequestedQuantityCap;
      const vendorRequested = parseNonNegativeField(
        (
          Number(rawVendorRequested) > 0
            ? rawVendorRequested
            : qcRequestedQuantityCap
        ),
        "Vendor requested",
      );
      const vendorOffered = parseNonNegativeField(
        row?.vendor_offered ?? record.vendor_offered,
        "Vendor offered",
      );
      const checked = parseNonNegativeField(
        row?.checked ?? record.checked,
        "Checked quantity",
      );
      const passed = parseNonNegativeField(
        row?.passed ?? record.passed,
        "Passed quantity",
      );
      const pendingAfter = parseNonNegativeField(
        row?.pending_after ?? record.pending_after,
        "Pending after",
      );

      if (passed > checked) {
        throw new Error("Passed quantity cannot exceed checked quantity");
      }
      if (vendorOffered > vendorRequested) {
        throw new Error("offered quantity cannot exceed quantity requested");
      }
      if (checked > vendorOffered) {
        throw new Error("Checked quantity cannot exceed offered quantity");
      }
      if (passed > vendorOffered) {
        throw new Error("Passed quantity cannot exceed offered quantity");
      }

      const cbmInput = row?.cbm && typeof row.cbm === "object" ? row.cbm : null;
      const existingCbmSnapshot = buildNormalizedCbmSnapshot(record?.cbm);
      const hasExplicitBoxUpdate = hasExplicitCbmBoxInput(cbmInput);
      const hasExplicitTotalUpdate = cbmInput?.total !== undefined;
      let nextCbmSnapshot = existingCbmSnapshot;

      if (cbmInput) {
        if (hasExplicitBoxUpdate) {
          nextCbmSnapshot = buildNormalizedCbmSnapshot({
            box1:
              cbmInput?.box1 !== undefined
                ? cbmInput.box1
                : cbmInput?.top !== undefined
                  ? cbmInput.top
                  : existingCbmSnapshot.box1,
            box2:
              cbmInput?.box2 !== undefined
                ? cbmInput.box2
                : cbmInput?.bottom !== undefined
                  ? cbmInput.bottom
                  : existingCbmSnapshot.box2,
            box3:
              cbmInput?.box3 !== undefined
                ? cbmInput.box3
                : existingCbmSnapshot.box3,
            total:
              hasExplicitTotalUpdate
                ? cbmInput.total
                : existingCbmSnapshot.total,
          });
        } else if (hasExplicitTotalUpdate) {
          nextCbmSnapshot =
            toNonNegativeNumber(existingCbmSnapshot.total, 0) ===
            toNonNegativeNumber(cbmInput.total, 0)
              ? existingCbmSnapshot
              : buildSingleBoxCbmSnapshot(cbmInput.total);
        }
      }

      const hasLabelRangesField = Array.isArray(row?.label_ranges);
      const labelsFieldInput = Array.isArray(row?.labels_added)
        ? row.labels_added
        : Array.isArray(row?.labels)
          ? row.labels
          : null;
      const hasLabelsField = Array.isArray(labelsFieldInput);
      let nextLabelRanges = Array.isArray(record?.label_ranges)
        ? record.label_ranges
        : [];
      let nextLabelsAdded = normalizeLabels(
        Array.isArray(record?.labels_added) ? record.labels_added : [],
      );

      if (hasLabelRangesField || hasLabelsField) {
        let generatedFromRanges = [];
        let normalizedRanges = [];
        if (hasLabelRangesField) {
          const rangeResult = buildLabelsFromRanges(row?.label_ranges || []);
          generatedFromRanges = rangeResult.generatedLabels;
          normalizedRanges = rangeResult.normalizedRanges;
        }

        if (hasLabelsField) {
          const parsedLabels = labelsFieldInput.map(Number);
          if (
            parsedLabels.some(
              (label) => !Number.isInteger(label) || label < 0,
            )
          ) {
            throw new Error("Labels added must be non-negative integers");
          }
          nextLabelsAdded = normalizeLabels(parsedLabels);
        } else {
          nextLabelsAdded = normalizeLabels(generatedFromRanges);
        }

        nextLabelRanges = hasLabelRangesField ? normalizedRanges : [];
      }

      const remarks =
        row?.remarks !== undefined
          ? String(row.remarks || "")
          : String(record?.remarks || "");
      const linkedRequestHistoryEntry = resolveLinkedRequestHistoryEntry(record);
      const linkedRequestHistoryId = String(
        linkedRequestHistoryEntry?._id || record?.request_history_id || "",
      ).trim();

      if (linkedRequestHistoryId) {
        const previousRequestedDate = requestHistoryDateUpdates.get(
          linkedRequestHistoryId,
        );
        if (
          previousRequestedDate &&
          previousRequestedDate !== requestedDate
        ) {
          throw new Error(
            "Rows linked to the same request history must use the same request date",
          );
        }
        requestHistoryDateUpdates.set(linkedRequestHistoryId, requestedDate);
      }

      touchedInspectors.add(String(record.inspector || ""));
      touchedInspectors.add(inspectorId);

      record.request_history_id = linkedRequestHistoryId || record.request_history_id || null;
      record.requested_date = requestedDate;
      record.inspection_date = inspectionDate;
      record.inspector = inspectorId;
      record.vendor_requested = vendorRequested;
      record.vendor_offered = vendorOffered;
      record.checked = checked;
      record.passed = passed;
      record.pending_after = pendingAfter;
      record.cbm = nextCbmSnapshot;
      record.status = resolveInspectionRecordStatus({
        checked,
        passed,
        vendorOffered,
        labelsAdded: nextLabelsAdded,
        labelRanges: nextLabelRanges,
        goodsNotReady: record?.goods_not_ready,
        requestType: qc?.request_type,
      });
      record.label_ranges = nextLabelRanges;
      record.labels_added = nextLabelsAdded;
      record.remarks = remarks;
      record.updated_by = buildAuditActor(req.user);
    }

    const requestHistoryUpdatedAt = new Date();
    for (const [requestHistoryId, nextRequestedDate] of requestHistoryDateUpdates) {
      const requestHistoryEntry = requestHistoryEntryById.get(requestHistoryId);
      if (!requestHistoryEntry) continue;

      if (String(requestHistoryEntry?.request_date || "") !== nextRequestedDate) {
        requestHistoryEntry.request_date = nextRequestedDate;
        stampRequestHistoryEntry(requestHistoryEntry, {
          user: req.user,
          updatedAt: requestHistoryUpdatedAt,
        });
      }
    }

    await Promise.all(inspectionDocs.map((doc) => doc.save()));

    const refreshedInspections = await Inspection.find({ qc: qc._id })
      .select(
        "inspection_date requested_date request_history_id inspector checked passed vendor_requested vendor_offered labels_added label_ranges goods_not_ready status createdAt",
      )
      .lean();

    const mergedLabels = normalizeLabels(
      refreshedInspections.flatMap((record) =>
        Array.isArray(record?.labels_added) ? record.labels_added : [],
      ),
    );

    recalculateQcAggregateQuantities(qc, refreshedInspections);
    qc.labels = mergedLabels;

    syncQcRequestHistoryStatuses(qc, refreshedInspections, {
      user: req.user,
    });
    syncQcCurrentRequestFieldsFromHistory(qc, refreshedInspections);

    if (refreshedInspections.length > 0) {
      const latestRecord = [...refreshedInspections].sort((a, b) => {
        const aTime = Math.max(
          toSortableTimestamp(a?.inspection_date),
          toSortableTimestamp(a?.createdAt),
        );
        const bTime = Math.max(
          toSortableTimestamp(b?.inspection_date),
          toSortableTimestamp(b?.createdAt),
        );
        return bTime - aTime;
      })[0];

      qc.last_inspected_date = String(
        latestRecord?.inspection_date ||
          toDateInputValue(latestRecord?.createdAt) ||
          qc.request_date ||
          qc.last_inspected_date ||
          "",
      );
    } else {
      qc.last_inspected_date = String(
        qc.request_date || qc.last_inspected_date || "",
      );
    }

    qc.updated_by = buildAuditActor(req.user);
    await qc.save();

    const orderId = qc?.order?._id || qc.order;
    const orderRecord = await Order.findById(orderId);
    if (orderRecord && !CLOSED_ORDER_STATUSES.includes(orderRecord.status)) {
      applyQcOrderStatus(qc, orderRecord);
      orderRecord.updated_by = buildAuditActor(req.user);
      await applyQcOrderPoCbm(orderRecord);
      await orderRecord.save();
    }

    const inspectorIdsToRecalculate = [...touchedInspectors]
      .map((value) => String(value || "").trim())
      .filter((value) => mongoose.Types.ObjectId.isValid(value));

    await recalculateInspectorUsedLabels(inspectorIdsToRecalculate);

    await createQcEditLog({
      reqUser: req.user,
      qcDoc: qc,
      beforeSnapshot: beforeQcSnapshot,
      afterSnapshot: buildQcEditLogSnapshot(qc.toObject(), refreshedInspections),
      operationType: "qc_inspection_record_edit",
      extraRemarks: ["Inspection records edited through admin route."],
    });
    if (orderRecord) {
      await createOrderEditLogFromQc({
        reqUser: req.user,
        orderDoc: orderRecord,
        beforeSnapshot: beforeOrderSnapshot,
        afterSnapshot: buildOrderAuditSnapshotForQc(orderRecord),
        extraRemarks: ["Order status recalculated from inspection record edit."],
      });
    }

    try {
      await upsertItemFromQc(qc);
    } catch (itemSyncError) {
      console.error("Item sync after inspection edit failed:", {
        qcId: qc?._id,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    return res.status(200).json({
      message: "Inspection records updated successfully",
      data: qc,
    });
  } catch (err) {
    console.error("Edit Inspection Records Error:", err);
    return res
      .status(400)
      .json({ message: err.message || "Failed to edit inspection records" });
  }
};

exports.deleteInspectionRecord = async (req, res) => {
  try {
    const qcId = String(req.params.id || "").trim();
    const recordId = String(req.params.recordId || "").trim();

    if (!mongoose.Types.ObjectId.isValid(qcId)) {
      return res.status(400).json({ message: "Invalid QC id" });
    }

    if (!mongoose.Types.ObjectId.isValid(recordId)) {
      return res.status(400).json({ message: "Invalid inspection record id" });
    }

    const qc = await QC.findById(qcId);
    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const inspection = await Inspection.findOne({
      _id: recordId,
      qc: qc._id,
    });
    if (!inspection) {
      return res.status(404).json({ message: "Inspection record not found" });
    }
    const existingInspectionDocs = await Inspection.find({ qc: qc._id }).lean();
    const beforeQcSnapshot = buildQcEditLogSnapshot(qc.toObject(), existingInspectionDocs);
    const linkedOrderBefore =
      qc?.order && mongoose.Types.ObjectId.isValid(qc.order)
        ? await Order.findById(qc.order)
        : null;
    const beforeOrderSnapshot = buildOrderAuditSnapshotForQc(linkedOrderBefore);

    qc.inspection_record = (
      Array.isArray(qc.inspection_record) ? qc.inspection_record : []
    ).filter((entryId) => String(entryId) !== String(inspection._id));

    const deletedRequestHistoryId = String(
      inspection?.request_history_id || "",
    ).trim();

    const remainingInspections = await Inspection.find({
      qc: qc._id,
      _id: { $ne: inspection._id },
    })
      .select(
        "inspection_date requested_date createdAt inspector labels_added request_history_id checked passed vendor_requested vendor_offered label_ranges goods_not_ready status",
      )
      .lean();

    if (
      deletedRequestHistoryId &&
      Array.isArray(qc.request_history) &&
      !remainingInspections.some(
        (entry) =>
          String(entry?.request_history_id || "").trim() ===
          deletedRequestHistoryId,
      )
    ) {
      qc.request_history = qc.request_history.filter(
        (entry) => String(entry?._id || "").trim() !== deletedRequestHistoryId,
      );
    }

    const recalculatedLabels = normalizeLabels(
      remainingInspections.flatMap((entry) =>
        Array.isArray(entry?.labels_added) ? entry.labels_added : [],
      ),
    );
    const shouldDeleteQcRecord = remainingInspections.length === 0;

    if (!shouldDeleteQcRecord) {
      recalculateQcAggregateQuantities(qc, remainingInspections);
      qc.labels = recalculatedLabels;

      syncQcRequestHistoryStatuses(qc, remainingInspections, {
        user: req.user,
      });
      syncQcCurrentRequestFieldsFromHistory(qc, remainingInspections);

      const latestRecord = [...remainingInspections].sort((a, b) => {
        const aTime = Math.max(
          toSortableTimestamp(a?.inspection_date),
          toSortableTimestamp(a?.createdAt),
        );
        const bTime = Math.max(
          toSortableTimestamp(b?.inspection_date),
          toSortableTimestamp(b?.createdAt),
        );
        return bTime - aTime;
      })[0];

      qc.last_inspected_date = String(
        latestRecord?.inspection_date ||
          toDateInputValue(latestRecord?.createdAt) ||
          qc.request_date ||
          qc.last_inspected_date ||
          "",
      );

      qc.updated_by = buildAuditActor(req.user);
      await qc.save();
    }

    await Inspection.deleteOne({ _id: inspection._id });

    await recalculateInspectorUsedLabels([inspection.inspector]);

    const orderId = qc?.order?._id || qc.order;
    const orderRecord = await Order.findById(orderId);

    if (shouldDeleteQcRecord) {
      if (orderRecord) {
        orderRecord.qc_record = null;
        orderRecord.status = "Pending";
        orderRecord.total_po_cbm = 0;
        orderRecord.updated_by = buildAuditActor(req.user);
        await orderRecord.save();
      }

      await QC.deleteOne({ _id: qc._id });

      await createQcEditLog({
        reqUser: req.user,
        qcDoc: qc,
        beforeSnapshot: beforeQcSnapshot,
        afterSnapshot: {},
        operationType: "qc_inspection_record_delete",
        extraRemarks: [
          "Last inspection record deleted. QC record removed.",
        ],
      });
      if (orderRecord) {
        await createOrderEditLogFromQc({
          reqUser: req.user,
          orderDoc: orderRecord,
          beforeSnapshot: beforeOrderSnapshot,
          afterSnapshot: buildOrderAuditSnapshotForQc(orderRecord),
          extraRemarks: ["Order reset after QC record deletion."],
        });
      }

      return res.status(200).json({
        message:
          "Last inspection record deleted. QC record removed and order moved to Pending.",
        qc_deleted: true,
        data: null,
      });
    }

    if (orderRecord && !CLOSED_ORDER_STATUSES.includes(orderRecord.status)) {
      applyQcOrderStatus(qc, orderRecord);
      orderRecord.updated_by = buildAuditActor(req.user);
      await applyQcOrderPoCbm(orderRecord);
      await orderRecord.save();
    }

    await createQcEditLog({
      reqUser: req.user,
      qcDoc: qc,
      beforeSnapshot: beforeQcSnapshot,
      afterSnapshot: buildQcEditLogSnapshot(qc.toObject(), remainingInspections),
      operationType: "qc_inspection_record_delete",
      extraRemarks: ["Inspection record deleted through admin route."],
    });
    if (orderRecord) {
      await createOrderEditLogFromQc({
        reqUser: req.user,
        orderDoc: orderRecord,
        beforeSnapshot: beforeOrderSnapshot,
        afterSnapshot: buildOrderAuditSnapshotForQc(orderRecord),
        extraRemarks: ["Order status recalculated after inspection deletion."],
      });
    }

    try {
      await upsertItemFromQc(qc);
    } catch (itemSyncError) {
      console.error("Item sync after inspection deletion failed:", {
        qcId: qc?._id,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

    return res.status(200).json({
      message: "Inspection record deleted successfully",
      data: qc,
    });
  } catch (err) {
    console.error("Delete Inspection Record Error:", err);
    return res.status(500).json({ message: err.message });
  }
};

exports.syncInspectionStatuses = async (req, res) => {
  try {
    const inspections = await Inspection.find({})
      .select(
        "qc status checked passed vendor_offered labels_added label_ranges goods_not_ready",
      )
      .populate("qc", "request_type")
      .lean();

    const bulkOps = [];
    const inspectionRecordsByQcId = new Map();

    for (const inspection of inspections) {
      const nextStatus = resolveInspectionRecordStatus({
        checked: inspection?.checked,
        passed: inspection?.passed,
        vendorOffered: inspection?.vendor_offered,
        labelsAdded: inspection?.labels_added,
        labelRanges: inspection?.label_ranges,
        goodsNotReady: inspection?.goods_not_ready,
        requestType: inspection?.qc?.request_type,
      });

      if (String(inspection?.status || "") !== nextStatus) {
        bulkOps.push({
          updateOne: {
            filter: { _id: inspection._id },
            update: {
              $set: {
                status: nextStatus,
                updated_by: buildAuditActor(req.user, "System Sync"),
              },
            },
          },
        });
      }

      const qcId = String(inspection?.qc?._id || inspection?.qc || "").trim();
      if (!qcId) continue;
      if (!inspectionRecordsByQcId.has(qcId)) {
        inspectionRecordsByQcId.set(qcId, []);
      }
      inspectionRecordsByQcId.get(qcId).push({
        ...inspection,
        status: nextStatus,
      });
    }

    if (bulkOps.length > 0) {
      await Inspection.bulkWrite(bulkOps, { ordered: false });
    }

    const qcIds = [...inspectionRecordsByQcId.keys()].filter((value) =>
      mongoose.Types.ObjectId.isValid(value),
    );
    const qcDocs = qcIds.length > 0
      ? await QC.find({ _id: { $in: qcIds } })
      : [];

    let updatedQcCount = 0;
    for (const qcDoc of qcDocs) {
      const hasChanges = syncQcRequestHistoryStatuses(
        qcDoc,
        inspectionRecordsByQcId.get(String(qcDoc?._id || "").trim()) || [],
        {
          user: req.user,
          fallbackName: "System Sync",
        },
      );
      if (!hasChanges) continue;
      qcDoc.updated_by = buildAuditActor(req.user, "System Sync");
      await qcDoc.save();
      updatedQcCount += 1;
    }

    return res.status(200).json({
      success: true,
      message: "Inspection statuses synced successfully",
      summary: {
        processed: inspections.length,
        updated_inspections: bulkOps.length,
        updated_qcs: updatedQcCount,
      },
    });
  } catch (err) {
    console.error("Sync Inspection Statuses Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to sync inspection statuses",
      error: err.message,
    });
  }
};

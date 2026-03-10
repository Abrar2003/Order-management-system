const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const Inspector = require("../models/inspector.model");
const Item = require("../models/item.model");
const XLSX = require("xlsx");

const Order = require("../models/order.model")
const mongoose = require("mongoose");
const { upsertItemFromQc } = require("../services/itemSync");

const normalizeLabels = (labels = []) => {
  if (!Array.isArray(labels)) return [];
  const numericLabels = labels
    .map((label) => Number(label))
    .filter((label) => Number.isFinite(label));
  return [...new Set(numericLabels)].sort((a, b) => a - b);
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
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
const CLOSED_ORDER_STATUSES = ["Shipped", "Cancelled"];
const MANAGER_ALLOWED_PAST_DAYS = 2;
const QC_ALLOWED_PAST_DAYS = 1;
const ACTIVE_ORDER_MATCH = {
  archived: { $ne: true },
  status: { $ne: "Cancelled" },
};
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
const computeAqlSampleQuantity = (quantity) => {
  const safeQuantity = toNonNegativeNumber(quantity, 0);
  if (safeQuantity <= 0) return 0;
  return Math.max(1, Math.ceil(safeQuantity * 0.1));
};

const parseDateFromPartsToIso = (year, month, day) => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return "";
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return "";
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    return "";
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
};

const toISODateString = (value) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return parseDateFromPartsToIso(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsedValue = new Date(value);
    if (Number.isNaN(parsedValue.getTime())) return "";
    return parseDateFromPartsToIso(
      parsedValue.getUTCFullYear(),
      parsedValue.getUTCMonth() + 1,
      parsedValue.getUTCDate(),
    );
  }

  const asString = normalizeText(value);
  if (!asString) return "";

  const ymdWithOptionalTime = asString.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (ymdWithOptionalTime) {
    return parseDateFromPartsToIso(
      Number(ymdWithOptionalTime[1]),
      Number(ymdWithOptionalTime[2]),
      Number(ymdWithOptionalTime[3]),
    );
  }

  const dmySlash = asString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) {
    return parseDateFromPartsToIso(
      Number(dmySlash[3]),
      Number(dmySlash[2]),
      Number(dmySlash[1]),
    );
  }

  const dmyDash = asString.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyDash) {
    return parseDateFromPartsToIso(
      Number(dmyDash[3]),
      Number(dmyDash[2]),
      Number(dmyDash[1]),
    );
  }

  const shouldTryNativeParse =
    /[a-zA-Z]/.test(asString) || asString.includes(",") || asString.includes(" ");
  if (!shouldTryNativeParse) return "";

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return "";
  return parseDateFromPartsToIso(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
  );
};

const parseIsoDateToUtcDate = (isoDate) => {
  const normalized = toISODateString(isoDate);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const isIsoDateWithinPastDaysInclusive = (isoDate, daysBack = 0) => {
  const target = parseIsoDateToUtcDate(isoDate);
  if (!target) return false;

  const now = new Date();
  const todayUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const minAllowedUtc = new Date(todayUtc);
  minAllowedUtc.setUTCDate(minAllowedUtc.getUTCDate() - Math.max(0, Number(daysBack) || 0));

  return target >= minAllowedUtc && target <= todayUtc;
};

const isIsoDateExactlyDaysBack = (isoDate, daysBack = 0) => {
  const target = parseIsoDateToUtcDate(isoDate);
  if (!target) return false;

  const now = new Date();
  const todayUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const offsetDays = Number(daysBack) || 0;
  const expectedUtc = new Date(todayUtc);
  expectedUtc.setUTCDate(expectedUtc.getUTCDate() - offsetDays);

  return target.getTime() === expectedUtc.getTime();
};

const formatDateDDMMYYYY = (value, fallback = "") => {
  const isoDate = toISODateString(value);
  if (!isoDate) return fallback;
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
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

const normalizeItemCodeKey = (value) => normalizeText(value).toLowerCase();
const getItemInspectedCbmTotal = (itemDoc = {}) =>
  normalizeText(
    itemDoc?.cbm?.calculated_inspected_total
      ?? itemDoc?.cbm?.inspected_total
      ?? itemDoc?.cbm?.calculated_total
      ?? itemDoc?.cbm?.qc_total
      ?? itemDoc?.cbm?.total
      ?? "",
  );
const getItemWeightNet = (itemDoc = {}) =>
  toNonNegativeNumber(
    itemDoc?.inspected_weight?.net ?? itemDoc?.pis_weight?.net ?? itemDoc?.weight?.net,
    0,
  );
const getItemWeightGross = (itemDoc = {}) =>
  toNonNegativeNumber(
    itemDoc?.inspected_weight?.gross ?? itemDoc?.pis_weight?.gross ?? itemDoc?.weight?.gross,
    0,
  );
const getItemItemLbh = (itemDoc = {}) =>
  itemDoc?.inspected_item_LBH || itemDoc?.pis_item_LBH || itemDoc?.item_LBH || {};
const getItemBoxLbh = (itemDoc = {}) =>
  itemDoc?.inspected_box_LBH || itemDoc?.pis_box_LBH || itemDoc?.box_LBH || {};

const hasMeaningfulItemQcDetails = (itemDoc) => {
  if (!itemDoc || typeof itemDoc !== "object") return false;

  const itemDescription = normalizeText(itemDoc?.description || itemDoc?.name || "");
  const cbmTotal = getItemInspectedCbmTotal(itemDoc);
  const itemQc = itemDoc?.qc || {};
  const barcode = Number(itemQc?.barcode || 0);
  const lastInspectedDate = normalizeText(itemQc?.last_inspected_date || "");

  return Boolean(
    itemDescription
      || (cbmTotal && cbmTotal !== "0")
      || barcode > 0
      || itemQc?.packed_size === true
      || itemQc?.finishing === true
      || itemQc?.branding === true
      || lastInspectedDate,
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
  const itemDescription = normalizeText(itemDoc?.description || itemDoc?.name || "");
  const itemCode = normalizeText(itemDoc?.code || qcSnapshot?.item?.item_code || "");
  const cbmTotal = getItemInspectedCbmTotal(itemDoc);
  const itemQc = itemDoc?.qc || {};
  const barcode = Math.max(0, Number(itemQc?.barcode || 0));
  const lastInspectedDate = normalizeText(itemQc?.last_inspected_date || "");

  if (itemDescription && normalizeText(qcSnapshot?.item?.description) !== itemDescription) {
    set["item.description"] = itemDescription;
  }

  if (itemCode && normalizeText(qcSnapshot?.item?.item_code) !== itemCode) {
    set["item.item_code"] = itemCode;
  }

  if (cbmTotal && cbmTotal !== "0" && normalizeText(qcSnapshot?.cbm?.total) !== cbmTotal) {
    set["cbm.total"] = cbmTotal;
  }

  if (barcode > 0 && Number(qcSnapshot?.barcode || 0) !== barcode) {
    set.barcode = barcode;
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
    lastInspectedDate
    && normalizeText(qcSnapshot?.last_inspected_date) !== lastInspectedDate
  ) {
    set.last_inspected_date = lastInspectedDate;
  }

  if (Object.keys(set).length === 0) {
    return { set: null, reason: "no_changes" };
  }

  return { set, reason: "updated" };
};

const applyQcItemDetailsPatch = (qcDoc, patch = {}) => {
  if (!qcDoc || typeof qcDoc.set !== "function" || !patch || typeof patch !== "object") {
    return;
  }

  for (const [path, value] of Object.entries(patch)) {
    qcDoc.set(path, value);
  }
};

const resolveLatestRequestEntry = (requestHistory = []) => {
  if (!Array.isArray(requestHistory) || requestHistory.length === 0) return null;
  return requestHistory[requestHistory.length - 1] || null;
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
  addChecked = 0,
  addPassed = 0,
  addProvision = 0,
  appendLabelRanges = [],
  appendLabels = [],
  replaceCbmSnapshot = false,
  allowRequestedDateFallback = true,
}) => {
  if (!qcDoc?._id) return null;

  const resolvedInspectorId = String(inspectorId || "").trim();
  const resolvedRequestDate = String(requestDate || "").trim();
  const resolvedInspectionDate = String(inspectionDate || resolvedRequestDate).trim();

  if (!resolvedInspectorId || !resolvedRequestDate || !resolvedInspectionDate || !createdBy) {
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
      ((qcDoc?.quantities?.client_demand || 0) - (qcDoc?.quantities?.qc_passed || 0)),
    0,
  );
  const labelRangesToAppend = Array.isArray(appendLabelRanges) ? appendLabelRanges : [];
  const labelsToAppend = normalizeLabels(appendLabels);

  if (!inspectionRecord) {
    inspectionRecord = await Inspection.create({
      qc: qcDoc._id,
      inspector: resolvedInspectorId,
      inspection_date: resolvedInspectionDate,
      request_history_id: requestHistoryId || null,
      requested_date: resolvedRequestDate,
      checked: toNonNegativeNumber(addChecked, 0),
      passed: toNonNegativeNumber(addPassed, 0),
      vendor_requested: requestedQty,
      vendor_offered: toNonNegativeNumber(addProvision, 0),
      pending_after: pendingAfter,
      cbm: {
        top: String(qcDoc?.cbm?.top ?? "0"),
        bottom: String(qcDoc?.cbm?.bottom ?? "0"),
        total: String(qcDoc?.cbm?.total ?? "0"),
      },
      label_ranges: labelRangesToAppend,
      labels_added: labelsToAppend,
      remarks: String(remarks || "").trim(),
      createdBy,
    });

    qcDoc.inspection_record = qcDoc.inspection_record || [];
    if (!qcDoc.inspection_record.some((entry) => String(entry) === String(inspectionRecord._id))) {
      qcDoc.inspection_record.push(inspectionRecord._id);
    }

    return inspectionRecord;
  }

  inspectionRecord.inspector = resolvedInspectorId;
  inspectionRecord.requested_date = resolvedRequestDate;
  inspectionRecord.request_history_id = requestHistoryId || inspectionRecord.request_history_id || null;
  inspectionRecord.inspection_date = resolvedInspectionDate;
  inspectionRecord.vendor_requested = requestedQty;

  const nextChecked =
    toNonNegativeNumber(inspectionRecord.checked, 0) + toNonNegativeNumber(addChecked, 0);
  const nextPassed =
    toNonNegativeNumber(inspectionRecord.passed, 0) + toNonNegativeNumber(addPassed, 0);
  const nextOffered =
    toNonNegativeNumber(inspectionRecord.vendor_offered, 0) + toNonNegativeNumber(addProvision, 0);

  inspectionRecord.checked = nextChecked;
  inspectionRecord.passed = nextPassed;
  inspectionRecord.vendor_offered = nextOffered;
  inspectionRecord.pending_after = pendingAfter;

  if (replaceCbmSnapshot) {
    inspectionRecord.cbm = {
      top: String(qcDoc?.cbm?.top ?? "0"),
      bottom: String(qcDoc?.cbm?.bottom ?? "0"),
      total: String(qcDoc?.cbm?.total ?? "0"),
    };
  }

  if (labelRangesToAppend.length > 0) {
    const existingRanges = Array.isArray(inspectionRecord.label_ranges)
      ? inspectionRecord.label_ranges
      : [];
    const rangeKeys = new Set(
      existingRanges.map((range) => `${Number(range?.start)}-${Number(range?.end)}`),
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
    inspectionRecord.labels_added = normalizeLabels([...existingLabels, ...labelsToAppend]);
  }

  if (String(remarks || "").trim()) {
    inspectionRecord.remarks = String(remarks || "").trim();
  }

  await inspectionRecord.save();

  qcDoc.inspection_record = qcDoc.inspection_record || [];
  if (!qcDoc.inspection_record.some((entry) => String(entry) === String(inspectionRecord._id))) {
    qcDoc.inspection_record.push(inspectionRecord._id);
  }

  return inspectionRecord;
};

/**
 * GET /qclist
 * Fetch all QC records (pagination optional)
 */
const escapeRegex = (value = "") =>
  String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toDateInputValue = (value = new Date()) => {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const offsetMs = parsed.getTimezoneOffset() * 60000;
    return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 10);
  }
  return toISODateString(value) || null;
};

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

const toUtcDayStart = (value = new Date()) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ));
};

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

const resolveTimelineRange = ({
  timeline = "1m",
  customDays = "",
} = {}) => {
  const normalizedTimelineInput = String(timeline || "").trim().toLowerCase();
  const timelineKey = Object.prototype.hasOwnProperty.call(
    REPORT_TIMELINE_DAYS,
    normalizedTimelineInput,
  )
    ? normalizedTimelineInput
    : (normalizedTimelineInput === "custom" ? "custom" : "1m");

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

const getWeekStartIsoDate = (value) => {
  const dayStart = toUtcDateOnly(value);
  if (!dayStart) return "";

  const dayOfWeek = dayStart.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = addUtcDays(dayStart, diffToMonday);
  return monday ? toISODateString(monday) : "";
};

const toRoundedNumber = (value, decimals = 3) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const precision = 10 ** Math.max(0, Number(decimals) || 0);
  return Math.round(numeric * precision) / precision;
};

const resolveOrderStatusFromSet = (statuses = []) => {
  const ORDER_STATUS_SEQUENCE = [
    "Pending",
    "Under Inspection",
    "Inspection Done",
    "Partial Shipped",
    "Shipped",
  ];
  const normalizedStatuses = [...new Set(
    (Array.isArray(statuses) ? statuses : [])
      .map((status) => String(status || "").trim())
      .filter(Boolean),
  )];

  if (normalizedStatuses.length === 0) return "Pending";
  if (normalizedStatuses.length === 1) return normalizedStatuses[0];

  const indexes = normalizedStatuses
    .map((status) => ORDER_STATUS_SEQUENCE.indexOf(status))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return normalizedStatuses[0];
  const earliestIndex = Math.min(...indexes);
  return ORDER_STATUS_SEQUENCE[earliestIndex] || normalizedStatuses[0];
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

const requestDateToDateExpression = buildStringDateToDateExpression("$request_date");
const inspectionDateToDateExpression = buildStringDateToDateExpression("$inspection_date");

const normalizeDistinctValues = (values = []) =>
  [...new Set(
    values
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));

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
    const requestedInspectorId = String(inspector || "").trim();
    const normalizedRole = String(req.user?.role || "").trim().toLowerCase();
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
            { $unwind: { path: "$inspector", preserveNullAndEmptyArrays: true } },
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
        { $group: { _id: "$order_meta.vendor" } },
        { $project: { _id: 0, value: "$_id" } },
      ]).allowDiskUse(true),
      QC.aggregate([
        { $match: buildQcListMatch({ ...filterInput, includeOrder: false }) },
        buildActiveOrderLookupStage("order"),
        { $unwind: { path: "$order", preserveNullAndEmptyArrays: false } },
        { $group: { _id: "$order_meta.order_id" } },
        { $project: { _id: 0, value: "$_id" } },
      ]).allowDiskUse(true),
      QC.aggregate([
        { $match: buildQcListMatch({ ...filterInput, includeSearch: false }) },
        buildActiveOrderLookupStage("order"),
        { $unwind: { path: "$order", preserveNullAndEmptyArrays: false } },
        { $group: { _id: "$item.item_code" } },
        { $project: { _id: 0, value: "$_id" } },
      ]).allowDiskUse(true),
    ]);

    const data = result?.[0]?.data || [];
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
        vendors: normalizeDistinctValues(vendorsRaw.map((entry) => entry?.value)),
        orders: normalizeDistinctValues(ordersRaw.map((entry) => entry?.value)),
        item_codes: normalizeDistinctValues(itemCodesRaw.map((entry) => entry?.value)),
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
    const exportFormat = String(format || "").trim().toLowerCase() === "csv"
      ? "csv"
      : "xlsx";

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

    const qcRows = await QC.aggregate(pipeline).allowDiskUse(true);
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
            inspected_item_top_LBH: 1,
            inspected_item_bottom_LBH: 1,
            pis_item_LBH: 1,
            pis_item_top_LBH: 1,
            pis_item_bottom_LBH: 1,
            item_LBH: 1,
            inspected_box_LBH: 1,
            inspected_box_top_LBH: 1,
            inspected_box_bottom_LBH: 1,
            inspected_top_LBH: 1,
            inspected_bottom_LBH: 1,
            pis_box_LBH: 1,
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
      { key: "cbm_top", header: "CBM Top" },
      { key: "cbm_bottom", header: "CBM Bottom" },
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
      { key: "shipment_rows", header: "Shipment Rows (Date/Container/Qty/Pending/Remarks)" },
    ];

    const exportRows = qcRows.map((entry) => {
      const qcItemCode = normalizeText(entry?.item?.item_code || "");
      const qcItemDescription = normalizeText(entry?.item?.description || "");
      const orderItemCode = normalizeText(entry?.order?.item?.item_code || "");
      const orderItemDescription = normalizeText(entry?.order?.item?.description || "");
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
        normalizeText(entry?.createdByUser?.name)
        || normalizeText(entry?.createdByUser?.email)
        || "";

      return {
        po: normalizeText(entry?.order_meta?.order_id || entry?.order?.order_id || ""),
        brand: normalizeText(entry?.order_meta?.brand || entry?.order?.brand || ""),
        vendor: normalizeText(entry?.order_meta?.vendor || entry?.order?.vendor || ""),
        qc_request_type: normalizeQcRequestType(entry?.request_type),
        item_code: qcItemCode,
        description: qcItemDescription,
        order_item_code: orderItemCode,
        order_item_description: orderItemDescription,
        item_master_code: normalizeText(itemMaster?.code || ""),
        item_master_name: normalizeText(itemMaster?.name || ""),
        item_master_description: normalizeText(itemMaster?.description || ""),
        item_master_brands: Array.isArray(itemMaster?.brands)
          ? itemMaster.brands.map((brandValue) => normalizeText(brandValue)).filter(Boolean).join(" | ")
          : "",
        item_master_vendors: Array.isArray(itemMaster?.vendors)
          ? itemMaster.vendors.map((vendorValue) => normalizeText(vendorValue)).filter(Boolean).join(" | ")
          : "",
        item_master_weight_net: getItemWeightNet(itemMaster),
        item_master_weight_gross: getItemWeightGross(itemMaster),
        item_master_cbm_total: getItemInspectedCbmTotal(itemMaster),
        item_master_item_lbh: formatLbh(getItemItemLbh(itemMaster)),
        item_master_box_lbh: formatLbh(getItemBoxLbh(itemMaster)),
        request_date: formatDateDDMMYYYY(entry?.request_date, ""),
        last_inspected_date: formatDateDDMMYYYY(entry?.last_inspected_date, ""),
        order_date: formatDateDDMMYYYY(entry?.order?.order_date, ""),
        etd: formatDateDDMMYYYY(entry?.order?.ETD, ""),
        order_status: normalizeText(entry?.order?.status || ""),
        order_quantity: toNonNegativeNumber(entry?.order?.quantity, 0),
        quantity_requested: toNonNegativeNumber(entry?.quantities?.quantity_requested, 0),
        vendor_provision: toNonNegativeNumber(entry?.quantities?.vendor_provision, 0),
        qc_checked: toNonNegativeNumber(entry?.quantities?.qc_checked, 0),
        qc_passed: toNonNegativeNumber(entry?.quantities?.qc_passed, 0),
        pending: toNonNegativeNumber(entry?.quantities?.pending, 0),
        qc_rejected: toNonNegativeNumber(entry?.quantities?.qc_rejected, 0),
        cbm_top: normalizeText(entry?.cbm?.top || "0"),
        cbm_bottom: normalizeText(entry?.cbm?.bottom || "0"),
        cbm_total: normalizeText(entry?.cbm?.total || "0"),
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
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`,
    );
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
      quantities?.quantity_requested ?? quantities?.vendor_provision
    );
    const normalizedRequestType = normalizeQcRequestType(
      request_type ?? quantities?.request_type,
    );
    const hasVendorProvisionInput =
      quantities?.vendor_provision !== undefined &&
      quantities?.vendor_provision !== null &&
      quantities?.vendor_provision !== "";
    const vendorProvision =
      !hasVendorProvisionInput
        ? 0
        : Number(quantities?.vendor_provision);

    const quantityRequested =
      normalizedRequestType === QC_REQUEST_TYPES.AQL
        ? computeAqlSampleQuantity(clientDemand)
        : quantityRequestedInput;

    if (
      Number.isNaN(clientDemand) ||
      Number.isNaN(vendorProvision) ||
      (normalizedRequestType === QC_REQUEST_TYPES.FULL && Number.isNaN(quantityRequestedInput))
    ) {
      return res.status(400).json({
        message:
          "client demand, quantity requested and vendor provision must be valid numbers",
      });
    }

    if (
      clientDemand < 0 ||
      vendorProvision < 0 ||
      (normalizedRequestType === QC_REQUEST_TYPES.FULL && quantityRequestedInput < 0)
    ) {
      return res.status(400).json({
        message: "Quantity values must be valid non-negative numbers",
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
      return res.status(400).json({ message: "request date must be a valid date" });
    }

    const normalizedRole = String(req.user?.role || "").trim().toLowerCase();
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

      if (clientDemand < existingQC.quantities.qc_passed) {
        return res.status(400).json({
          message: "client demand cannot be less than already passed quantity",
        });
      }

      const existingPendingRaw = Number(
        existingQC?.quantities?.pending ??
          ((existingQC?.quantities?.client_demand || 0) -
            (existingQC?.quantities?.qc_passed || 0)),
      );
      const existingPendingQuantity = Number.isFinite(existingPendingRaw)
        ? Math.max(0, existingPendingRaw)
        : 0;

      if (quantityRequested > existingPendingQuantity) {
        return res.status(400).json({
          message: "quantity requested cannot be greater than pending quantity",
        });
      }

      if (hasVendorProvisionInput && vendorProvision < existingQC.quantities.qc_passed) {
        return res.status(400).json({
          message: "vendor provision cannot be less than already passed quantity",
        });
      }

      const totalOffered =
        (hasVendorProvisionInput
          ? vendorProvision
          : (existingQC.quantities.vendor_provision || 0));

      if ((existingQC.quantities.qc_checked || 0) > totalOffered) {
        return res.status(400).json({
          message: "vendor provision cannot be less than already checked quantity",
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
      };
      existingQC.request_history.push(requestHistoryEntry);

      await upsertInspectionRecordForRequest({
        qcDoc: existingQC,
        inspectorId,
        requestDate: requestDateValue,
        requestHistoryId: resolveLatestRequestEntry(existingQC.request_history)?._id || null,
        requestedQuantity: quantityRequested,
        inspectionDate: requestDateValue,
        remarks: remarks || "",
        createdBy: req.user._id,
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
        const passedQty = Number(existingQC.quantities?.qc_passed || 0);
        const clientDemandQty = Number(existingQC.quantities?.client_demand || 0);
        orderRecord.status =
          clientDemandQty > 0 && passedQty >= clientDemandQty
            ? "Inspection Done"
            : "Under Inspection";
        orderRecord.qc_record = existingQC._id;
        await orderRecord.save();
      }

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

    const requestHistoryEntry = {
      request_date: requestDateValue,
      request_type: normalizedRequestType,
      quantity_requested: quantityRequested,
      inspector: inspectorId,
      status: "open",
      remarks: remarks || "",
      createdBy: req.user._id,
    };

    const qc = await QC.create({
      order, 
      item,
      inspector: inspectorId,
      request_type: normalizedRequestType,
      order_meta: {
        order_id: orderRecord.order_id,
        vendor: orderRecord.vendor,
        brand: orderRecord.brand
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
      request_history: [
        requestHistoryEntry,
      ],
      remarks,
      createdBy: req.user._id,
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
      requestHistoryId: resolveLatestRequestEntry(qc.request_history)?._id || null,
      requestedQuantity: quantityRequested,
      inspectionDate: requestDateValue,
      remarks: remarks || "",
      createdBy: req.user._id,
      addChecked: 0,
      addPassed: 0,
      addProvision: 0,
      appendLabelRanges: [],
      appendLabels: [],
      replaceCbmSnapshot: true,
      allowRequestedDateFallback: false,
    });


    orderRecord.status = "Under Inspection";
    orderRecord.qc_record = qc._id;

    await qc.save();
    await orderRecord.save();

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
      packed_size,
      finishing,
      branding,
      last_inspected_date,
      CBM_top,
      CBM_bottom,
      CBM,
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
        .populate("order", "status");

      if (!qc) {
        return res.status(404).json({ message: "QC record not found" });
      }

      const normalizedRole = String(req.user?.role || "").trim().toLowerCase();
      const isAdmin = normalizedRole === "admin";
      const isManager = normalizedRole === "manager";
      const isQcUser = normalizedRole === "qc";
      const hasElevatedAccess = isAdmin || isManager;
      const currentUserId = String(req.user?._id || req.user?.id || "").trim();
      const isInspectionDone = qc?.order?.status === "Inspection Done";

      if (!hasElevatedAccess && isInspectionDone) {
        return res.status(403).json({
          message: "Only admin or manager can update this QC record after inspection is done",
        });
      }

      const requestedInspectorId =
        inspector !== undefined && inspector !== null && String(inspector).trim() !== ""
          ? String(inspector).trim()
          : null;

      const hasStartedInspection =
        Number(qc.quantities?.qc_checked || 0) > 0 ||
        Number(qc.quantities?.qc_passed || 0) > 0 ||
        Number(qc.quantities?.vendor_provision || 0) > 0 ||
        normalizeLabels(qc.labels).length > 0;

      const latestRequestEntry = resolveLatestRequestEntry(qc?.request_history || []);
      const latestRequestedQuantity =
        latestRequestEntry?.quantity_requested !== undefined
          ? toNonNegativeNumber(latestRequestEntry.quantity_requested, 0)
          : toNonNegativeNumber(qc?.quantities?.quantity_requested, 0);
      const hasQcRequest =
        (Array.isArray(qc?.request_history) && qc.request_history.length > 0) ||
        latestRequestedQuantity > 0;

      if (!hasQcRequest) {
        return res.status(400).json({
          message: "QC is not requested yet. Align QC request before updating.",
        });
      }

      const inspectionDateForPermissionRaw =
        last_inspected_date !== undefined && String(last_inspected_date).trim() !== ""
          ? String(last_inspected_date).trim()
          : String(qc?.last_inspected_date || qc?.request_date || "").trim();
      const inspectionDateForPermission = toISODateString(inspectionDateForPermissionRaw);

      if (!hasElevatedAccess) {
        if (!inspectionDateForPermission) {
          return res.status(400).json({
            message: "last_inspected_date must be a valid date in DD/MM/YYYY or YYYY-MM-DD format",
          });
        }
        if (!isIsoDateWithinPastDaysInclusive(inspectionDateForPermission, QC_ALLOWED_PAST_DAYS)) {
          return res.status(403).json({
            message: "QC can update only for today and previous 1 day",
          });
        }

        const isOneDayBackdatedEntry = isIsoDateExactlyDaysBack(
          inspectionDateForPermission,
          1,
        );
        if (isQcUser && isOneDayBackdatedEntry) {
          if (!mongoose.Types.ObjectId.isValid(currentUserId)) {
            return res.status(401).json({ message: "Unauthorized" });
          }
          const existingOneDayBackdatedUpdate = await Inspection.exists({
            qc: qc._id,
            inspector: new mongoose.Types.ObjectId(currentUserId),
            inspection_date: inspectionDateForPermission,
            $or: [
              { checked: { $gt: 0 } },
              { passed: { $gt: 0 } },
              { vendor_offered: { $gt: 0 } },
              { "labels_added.0": { $exists: true } },
            ],
          });
          if (existingOneDayBackdatedUpdate) {
            return res.status(403).json({
              message: "QC can update a 1-day backdated entry only once",
            });
          }
        }
      }

      if (!hasElevatedAccess) {
        if (!currentUserId) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        const alignedInspectorId = String(qc?.inspector?._id || qc?.inspector || "").trim();
        if (!alignedInspectorId || alignedInspectorId !== currentUserId) {
          return res.status(403).json({
            message: "QC can update only records aligned to them",
          });
        }

        if (requestedInspectorId && requestedInspectorId !== currentUserId) {
          return res.status(403).json({
            message: "QC can only assign themselves",
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

      const hasCbmUpdate = CBM !== undefined || CBM_top !== undefined || CBM_bottom !== undefined;

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
      const parsedCbmTop = parseCbmField(CBM_top, "CBM top");
      const parsedCbmBottom = parseCbmField(CBM_bottom, "CBM bottom");

      const parseLbhPayload = (value, fieldName) => {
        if (value === undefined) return null;
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(`${fieldName} must be an object with L, B and H`);
        }

        const hasAnyInput =
          value.L !== undefined || value.B !== undefined || value.H !== undefined;
        if (!hasAnyInput) return null;

        if (value.L === undefined || value.B === undefined || value.H === undefined) {
          throw new Error(`${fieldName} must include L, B and H`);
        }

        const L = toNonNegativeNumber(value.L, NaN);
        const B = toNonNegativeNumber(value.B, NaN);
        const H = toNonNegativeNumber(value.H, NaN);
        if (!Number.isFinite(L) || !Number.isFinite(B) || !Number.isFinite(H) || L <= 0 || B <= 0 || H <= 0) {
          throw new Error(`${fieldName} values must be valid numbers greater than 0`);
        }

        return { L, B, H };
      };
      const parseInspectedWeightPayloadField = (value, fieldName) => {
        if (value === undefined) return { hasInput: false, value: null };
        const normalized = String(value ?? "").trim();
        if (!normalized) {
          throw new Error(`${fieldName} must be greater than 0`);
        }

        const parsed = toNonNegativeNumber(normalized, NaN);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`${fieldName} must be greater than 0`);
        }
        return { hasInput: true, value: parsed };
      };
      const isSameLbhValue = (left = {}, right = {}) =>
        toNonNegativeNumber(left?.L, 0) === toNonNegativeNumber(right?.L, 0)
        && toNonNegativeNumber(left?.B, 0) === toNonNegativeNumber(right?.B, 0)
        && toNonNegativeNumber(left?.H, 0) === toNonNegativeNumber(right?.H, 0);
      const hasSameNumericValue = (left, right) =>
        Math.abs(toNonNegativeNumber(left, 0) - toNonNegativeNumber(right, 0)) < 0.000001;

      const nextInspectedItemLbh = parseLbhPayload(
        inspected_item_LBH,
        "inspected_item_LBH",
      );
      const nextInspectedItemTopLbh = parseLbhPayload(
        inspected_item_top_LBH,
        "inspected_item_top_LBH",
      );
      const nextInspectedItemBottomLbh = parseLbhPayload(
        inspected_item_bottom_LBH,
        "inspected_item_bottom_LBH",
      );
      const nextInspectedBoxLbh = parseLbhPayload(
        inspected_box_LBH,
        "inspected_box_LBH",
      );
      const nextInspectedTopLbh = parseLbhPayload(
        inspected_box_top_LBH !== undefined ? inspected_box_top_LBH : inspected_top_LBH,
        "inspected_box_top_LBH",
      );
      const nextInspectedBottomLbh = parseLbhPayload(
        inspected_box_bottom_LBH !== undefined ? inspected_box_bottom_LBH : inspected_bottom_LBH,
        "inspected_box_bottom_LBH",
      );
      const hasInspectedLbhUpdate = Boolean(
        nextInspectedItemLbh
        || nextInspectedItemTopLbh
        || nextInspectedItemBottomLbh
        || nextInspectedBoxLbh
        || nextInspectedTopLbh
        || nextInspectedBottomLbh,
      );

      if (
        inspected_weight !== undefined
        && (inspected_weight === null
          || typeof inspected_weight !== "object"
          || Array.isArray(inspected_weight))
      ) {
        return res.status(400).json({
          message: "inspected_weight must be an object with net and/or gross",
        });
      }
      const parsedInspectedWeightNet = parseInspectedWeightPayloadField(
        inspected_weight?.net,
        "inspected_weight.net",
      );
      const parsedInspectedWeightGross = parseInspectedWeightPayloadField(
        inspected_weight?.gross,
        "inspected_weight.gross",
      );
      const hasInspectedWeightUpdate =
        parsedInspectedWeightNet.hasInput || parsedInspectedWeightGross.hasInput;

      const hasItemMasterUpdate = hasInspectedLbhUpdate || hasInspectedWeightUpdate;
      const itemCodeForInspectedLbhUpdate = (hasItemMasterUpdate || hasCbmUpdate)
        ? normalizeText(qc?.item?.item_code || "")
        : "";
      if ((hasItemMasterUpdate || hasCbmUpdate) && !itemCodeForInspectedLbhUpdate) {
        return res.status(400).json({
          message: "Item code is required to update inspected LBH/weight or CBM fields",
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

      if (hasInspectedLbhUpdate) {
        const assertWriteOnceLbh = (incomingValue, existingValue, fieldName) => {
          if (!incomingValue) return;
          if (hasCompletePositiveLbh(existingValue) && !isSameLbhValue(existingValue, incomingValue)) {
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
          itemDocForInspectedLbhUpdate?.inspected_box_top_LBH
            || itemDocForInspectedLbhUpdate?.inspected_top_LBH,
          "inspected_box_top_LBH",
        );
        assertWriteOnceLbh(
          nextInspectedBottomLbh,
          itemDocForInspectedLbhUpdate?.inspected_box_bottom_LBH
            || itemDocForInspectedLbhUpdate?.inspected_bottom_LBH,
          "inspected_box_bottom_LBH",
        );
      }

      if (hasInspectedWeightUpdate) {
        const existingInspectedNetWeight = toNonNegativeNumber(
          itemDocForInspectedLbhUpdate?.inspected_weight?.net,
          0,
        );
        const existingInspectedGrossWeight = toNonNegativeNumber(
          itemDocForInspectedLbhUpdate?.inspected_weight?.gross,
          0,
        );

        if (
          parsedInspectedWeightNet.hasInput
          && existingInspectedNetWeight > 0
          && !hasSameNumericValue(existingInspectedNetWeight, parsedInspectedWeightNet.value)
        ) {
          throw new Error("inspected_weight.net can only be set once");
        }

        if (
          parsedInspectedWeightGross.hasInput
          && existingInspectedGrossWeight > 0
          && !hasSameNumericValue(existingInspectedGrossWeight, parsedInspectedWeightGross.value)
        ) {
          throw new Error("inspected_weight.gross can only be set once");
        }
      }

      const effectiveInspectedItemLbh = nextInspectedItemLbh
        || itemDocForInspectedLbhUpdate?.inspected_item_LBH
        || itemDocForInspectedLbhUpdate?.item_LBH
        || {};
      const effectiveInspectedItemTopLbh = nextInspectedItemTopLbh
        || itemDocForInspectedLbhUpdate?.inspected_item_top_LBH
        || {};
      const effectiveInspectedItemBottomLbh = nextInspectedItemBottomLbh
        || itemDocForInspectedLbhUpdate?.inspected_item_bottom_LBH
        || {};
      const effectiveInspectedBoxLbh = nextInspectedBoxLbh
        || itemDocForInspectedLbhUpdate?.inspected_box_LBH
        || itemDocForInspectedLbhUpdate?.box_LBH
        || {};
      const effectiveInspectedTopLbh = nextInspectedTopLbh
        || itemDocForInspectedLbhUpdate?.inspected_box_top_LBH
        || itemDocForInspectedLbhUpdate?.inspected_top_LBH
        || {};
      const effectiveInspectedBottomLbh = nextInspectedBottomLbh
        || itemDocForInspectedLbhUpdate?.inspected_box_bottom_LBH
        || itemDocForInspectedLbhUpdate?.inspected_bottom_LBH
        || {};
      const cbmLockedByLbh =
        hasCompletePositiveLbh(effectiveInspectedItemLbh)
        || hasCompletePositiveLbh(effectiveInspectedItemTopLbh)
        || hasCompletePositiveLbh(effectiveInspectedItemBottomLbh)
        || hasCompletePositiveLbh(effectiveInspectedBoxLbh)
        || hasCompletePositiveLbh(effectiveInspectedTopLbh)
        || hasCompletePositiveLbh(effectiveInspectedBottomLbh);

      if (hasCbmUpdate && cbmLockedByLbh) {
        return res.status(400).json({
          message: "CBM fields are locked because inspected LBH is present. Update LBH instead.",
        });
      }

      if (hasCbmUpdate) {
        const existingTotal = toNonNegativeNumber(qc?.cbm?.total, 0);
        const existingTop = toNonNegativeNumber(qc?.cbm?.top, 0);
        const existingBottom = toNonNegativeNumber(qc?.cbm?.bottom, 0);

        let nextTotal = parsedCbmTotal.hasInput ? parsedCbmTotal.value : existingTotal;
        let nextTop = parsedCbmTop.hasInput ? parsedCbmTop.value : existingTop;
        let nextBottom = parsedCbmBottom.hasInput ? parsedCbmBottom.value : existingBottom;

        const hasTopAndBottom = nextTop > 0 && nextBottom > 0;
        if (hasTopAndBottom) {
          nextTotal = nextTop + nextBottom;
        }

        qc.cbm = {
          top: toNormalizedCbmString(nextTop),
          bottom: toNormalizedCbmString(nextBottom),
          total: toNormalizedCbmString(nextTotal),
        };
      }

      if (last_inspected_date !== undefined) {
        const normalizedLastInspectedDate = toISODateString(last_inspected_date);
        if (!normalizedLastInspectedDate) {
          return res.status(400).json({
            message: "last_inspected_date must be a valid date in DD/MM/YYYY or YYYY-MM-DD format",
          });
        }
        if (
          isManager &&
          !isIsoDateWithinPastDaysInclusive(
            normalizedLastInspectedDate,
            MANAGER_ALLOWED_PAST_DAYS,
          )
        ) {
          return res.status(403).json({
            message: "Manager can update QC only for today and previous 2 days",
          });
        }
        qc.last_inspected_date = normalizedLastInspectedDate;
      }

      /* ────────────────────────
         🔢 BARCODE
      ──────────────────────── */

      if (barcode !== undefined) {
        if (qc.barcode > 0 && Number(barcode) !== qc.barcode) {
          return res.status(400).json({ message: "barcode can only be set once" });
        }
        qc.barcode = Number(barcode);
      }

      /* ────────────────────────
         ✅ BOOLEAN FLAGS
      ──────────────────────── */

      const setOnceBoolean = (field, value, name) => {
        if (value === undefined) return;
        if (typeof value !== "boolean") {
          throw new Error(`${name} must be boolean`);
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

      const addChecked = Number(qc_checked || 0);
      const addPassed = Number(qc_passed || 0);
      const addProvision = Number(vendor_provision || 0);
      const requestType = normalizeQcRequestType(qc?.request_type);
      const isAqlRequest = requestType === QC_REQUEST_TYPES.AQL;
      const clientDemandQuantity = toNonNegativeNumber(
        qc?.quantities?.client_demand,
        0,
      );
      const aqlSampleQuantity = computeAqlSampleQuantity(clientDemandQuantity);

      if ([addChecked, addPassed, addProvision].some((v) => v < 0 || Number.isNaN(v))) {
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

      // If user is updating passed quantity or labels, they must provide checked in same visit
      if (
        (addPassed ||
          (Array.isArray(labels) && labels.length) ||
          hasLabelRangePayload) &&
        addChecked <= 0
      ) {
        return res.status(400).json({
          message: "qc_checked must be greater than 0 when updating quantities or labels",
        });
      }

      if (isAqlRequest && addChecked > aqlSampleQuantity) {
        return res.status(400).json({
          message: `AQL checked quantity cannot exceed 10% sample (${aqlSampleQuantity})`,
        });
      }

      if (isAqlRequest && addPassed > addChecked) {
        return res.status(400).json({
          message: "For AQL, passed quantity cannot exceed checked quantity",
        });
      }

      const nextVendorProvision = qc.quantities.vendor_provision + addProvision;

      const nextChecked = qc.quantities.qc_checked + addChecked;
      const nextPassedInput = qc.quantities.qc_passed + addPassed;
      const shouldAutoPassAql = isAqlRequest && addChecked > 0;
      const nextPassed = shouldAutoPassAql
        ? clientDemandQuantity
        : nextPassedInput;

      if (nextVendorProvision < 0) {
        return res.status(400).json({ message: "offered quantity cannot be negative" });
      }

      if (isAqlRequest && nextChecked > aqlSampleQuantity) {
        return res.status(400).json({
          message: `AQL checked quantity cannot exceed 10% sample (${aqlSampleQuantity})`,
        });
      }

      const quantityRequestedCap = Number(
        qc.quantities.quantity_requested > 0
          ? qc.quantities.quantity_requested
          : (qc.quantities.client_demand ?? 0)
      );

      const parsedPendingQuantityLimit = Number(
        qc.quantities?.pending ??
          ((qc.quantities?.client_demand || 0) - (qc.quantities?.qc_passed || 0))
      );
      const pendingQuantityLimit = Number.isFinite(parsedPendingQuantityLimit)
        ? Math.max(0, parsedPendingQuantityLimit)
        : 0;

      if (hasStartedInspection) {
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

      if (!isAqlRequest && nextPassed > nextChecked) {
        return res.status(400).json({
          message: "qc_passed cannot exceed qc_checked",
        });
      }

      const inspectedQuantityForLabels = Math.max(0, nextChecked);
      const baseLabelLimit = inspectedQuantityForLabels;
      const cbmTopValue = toNonNegativeNumber(qc?.cbm?.top, 0);
      const cbmBottomValue = toNonNegativeNumber(qc?.cbm?.bottom, 0);
      const hasTopBottomBoxLbhForLabels =
        hasCompletePositiveLbh(effectiveInspectedTopLbh)
        && hasCompletePositiveLbh(effectiveInspectedBottomLbh);
      const hasTopBottomItemLbhForLabels =
        hasCompletePositiveLbh(effectiveInspectedItemTopLbh)
        && hasCompletePositiveLbh(effectiveInspectedItemBottomLbh);
      const hasTopBottomLbhForLabels =
        hasTopBottomBoxLbhForLabels || hasTopBottomItemLbhForLabels;
      const hasTopBottomCbm =
        (cbmTopValue > 0 && cbmBottomValue > 0) || hasTopBottomLbhForLabels;
      const maxLabelsAllowed = hasTopBottomCbm ? baseLabelLimit * 2 : baseLabelLimit;

      qc.quantities.vendor_provision = nextVendorProvision;
      qc.quantities.qc_checked = nextChecked;
      qc.quantities.qc_passed = nextPassed;
      qc.quantities.pending = qc.quantities.client_demand - qc.quantities.qc_passed;

      /* ────────────────────────
         🏷️ LABELS (UNCHANGED LOGIC)
      ──────────────────────── */

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

      let labelsAddedThisVisit = [];
      let labelRangesUsedThisVisit = [];
      if (hasLabelsPayload) {
        const inspectionInspectorUserId = qc.inspector?._id
          ? qc.inspector._id
          : qc.inspector;
        const inspector = await Inspector.findOne({ user: inspectionInspectorUserId });

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
          parsedDirectLabels.length > 0 ? parsedDirectLabels : generatedFromRanges;
        const uniqueIncoming = [...new Set(labelsForUpdate)];
        const existingSet = new Set(normalizeLabels(qc.labels || []));
        const incomingNew = uniqueIncoming.filter((label) => !existingSet.has(label));
        const allocatedSet = new Set(normalizeLabels(inspector.alloted_labels || []));
        const usedSet = new Set(normalizeLabels(inspector.used_labels || []));

        const unallocatedIncoming = incomingNew.filter(
          (label) => !allocatedSet.has(label),
        );
        if (unallocatedIncoming.length > 0) {
          const preview = unallocatedIncoming.slice(0, 10).join(", ");
          return res.status(400).json({
            message: `Only allocated labels are accepted. Unallocated labels: ${preview}${unallocatedIncoming.length > 10 ? "..." : ""}`,
          });
        }

        const alreadyUsedIncoming = incomingNew.filter((label) => usedSet.has(label));
        if (alreadyUsedIncoming.length > 0) {
          const preview = alreadyUsedIncoming.slice(0, 10).join(", ");
          return res.status(400).json({
            message: `Some labels are already used and cannot be reused: ${preview}${alreadyUsedIncoming.length > 10 ? "..." : ""}`,
          });
        }

        const totalLabels = existingSet.size + incomingNew.length;
        if (totalLabels > maxLabelsAllowed) {
          return res.status(400).json({
            message: hasTopBottomCbm
              ? `Total labels cannot exceed double inspected quantity (${maxLabelsAllowed}) when CBM top and bottom are set`
              : `Total labels cannot exceed inspected quantity (${maxLabelsAllowed})`,
          });
        }

        qc.labels = [...new Set([...(qc.labels || []), ...incomingNew])];

        inspector.used_labels = [
          ...new Set([...(inspector.used_labels || []), ...incomingNew]),
        ];

        await inspector.save();

        labelsAddedThisVisit = incomingNew;
      }

      if (remarks) qc.remarks = remarks;

      /* ────────────────────────
         🧾 CREATE INSPECTION RECORD (NEW)
         We create a record only when there's a "visit update"
      ──────────────────────── */

      const isVisitUpdate =
        addChecked > 0 ||
        addPassed > 0 ||
        addProvision > 0 ||
        (labelsAddedThisVisit && labelsAddedThisVisit.length > 0);
      const addPassedForInspectionRecord =
        shouldAutoPassAql
          ? Math.max(
              0,
              Math.min(addChecked, addPassed > 0 ? addPassed : addChecked),
            )
          : addPassed;

      const shouldUpdateInspectionRecord =
        isVisitUpdate ||
        hasCbmUpdate ||
        (last_inspected_date !== undefined && String(last_inspected_date).trim() !== "") ||
        String(remarks || "").trim() !== "";

      if (shouldUpdateInspectionRecord) {
        const inspectionInspectorId = qc.inspector?._id
          ? qc.inspector._id
          : qc.inspector;
        if (!inspectionInspectorId) {
          return res
            .status(400)
            .json({ message: "Inspector is required before updating inspection quantities" });
        }

        const inspectionDateForRecordRaw =
          last_inspected_date !== undefined && String(last_inspected_date).trim() !== ""
            ? String(last_inspected_date).trim()
            : String(qc.last_inspected_date || qc.request_date || "").trim();
        const inspectionDateForRecord = toISODateString(inspectionDateForRecordRaw);

        if (!inspectionDateForRecord) {
          return res.status(400).json({
            message: "last_inspected_date is required for inspection records",
          });
        }
        if (
          isManager &&
          !isIsoDateWithinPastDaysInclusive(
            inspectionDateForRecord,
            MANAGER_ALLOWED_PAST_DAYS,
          )
        ) {
          return res.status(403).json({
            message: "Manager can update QC only for today and previous 2 days",
          });
        }

        const latestRequestEntry = resolveLatestRequestEntry(qc.request_history);
        const requestedDateForRecordRaw = String(
          latestRequestEntry?.request_date || qc.request_date || inspectionDateForRecord,
        ).trim();
        const requestedDateForRecord = toISODateString(requestedDateForRecordRaw);
        if (!requestedDateForRecord) {
          return res.status(400).json({
            message: "request_date is invalid for inspection records",
          });
        }

        const requestedQuantityForRecord =
          latestRequestEntry?.quantity_requested !== undefined
            ? Number(latestRequestEntry.quantity_requested)
            : quantityRequestedCap;

        const inspectionRecord = await upsertInspectionRecordForRequest({
          qcDoc: qc,
          inspectorId: inspectionInspectorId,
          requestDate: requestedDateForRecord,
          requestHistoryId: latestRequestEntry?._id || null,
          requestedQuantity: requestedQuantityForRecord,
          inspectionDate: inspectionDateForRecord,
          remarks: remarks || "",
          createdBy: req.user._id,
          addChecked: isVisitUpdate ? addChecked : 0,
          addPassed: isVisitUpdate ? addPassedForInspectionRecord : 0,
          addProvision: isVisitUpdate ? addProvision : 0,
          appendLabelRanges: isVisitUpdate ? labelRangesUsedThisVisit : [],
          appendLabels: isVisitUpdate ? labelsAddedThisVisit : [],
          replaceCbmSnapshot: hasCbmUpdate || isVisitUpdate,
        });

        if (latestRequestEntry && inspectionRecord && isVisitUpdate) {
          latestRequestEntry.status = "inspected";
        }
      }

      if (hasItemMasterUpdate) {
        const itemDoc = itemDocForInspectedLbhUpdate;
        let hasItemDocChanges = false;
        const setLbhPath = (path, value) => {
          if (!value) return false;
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

        if (hasInspectedLbhUpdate) {
          hasItemDocChanges =
            setLbhPath("inspected_item_LBH", nextInspectedItemLbh) || hasItemDocChanges;
          hasItemDocChanges =
            setLbhPath("inspected_item_top_LBH", nextInspectedItemTopLbh) || hasItemDocChanges;
          hasItemDocChanges =
            setLbhPath("inspected_item_bottom_LBH", nextInspectedItemBottomLbh)
            || hasItemDocChanges;
          hasItemDocChanges =
            setLbhPath("inspected_box_LBH", nextInspectedBoxLbh) || hasItemDocChanges;

          if (setLbhPath("inspected_box_top_LBH", nextInspectedTopLbh)) {
            hasItemDocChanges = true;
            setLbhPath("inspected_top_LBH", nextInspectedTopLbh);
          }

          if (setLbhPath("inspected_box_bottom_LBH", nextInspectedBottomLbh)) {
            hasItemDocChanges = true;
            setLbhPath("inspected_bottom_LBH", nextInspectedBottomLbh);
          }
        }

        if (hasInspectedWeightUpdate) {
          const nextInspectedWeight = {
            net: parsedInspectedWeightNet.hasInput
              ? parsedInspectedWeightNet.value
              : toNonNegativeNumber(itemDoc?.inspected_weight?.net, 0),
            gross: parsedInspectedWeightGross.hasInput
              ? parsedInspectedWeightGross.value
              : toNonNegativeNumber(itemDoc?.inspected_weight?.gross, 0),
          };
          const existingInspectedWeight = {
            net: toNonNegativeNumber(itemDoc?.inspected_weight?.net, 0),
            gross: toNonNegativeNumber(itemDoc?.inspected_weight?.gross, 0),
          };
          if (
            !hasSameNumericValue(existingInspectedWeight.net, nextInspectedWeight.net)
            || !hasSameNumericValue(existingInspectedWeight.gross, nextInspectedWeight.gross)
          ) {
            itemDoc.set("inspected_weight", nextInspectedWeight);
            itemDoc.markModified("inspected_weight");
            hasItemDocChanges = true;
          }
        }

        if (hasInspectedLbhUpdate) {
          const calculatedInspectedTopCbm = calculateCbmFromLbh(
            itemDoc?.inspected_box_top_LBH
            || itemDoc?.inspected_top_LBH
            || itemDoc?.inspected_item_top_LBH
            || {},
          );
          const calculatedInspectedBottomCbm = calculateCbmFromLbh(
            itemDoc?.inspected_box_bottom_LBH
            || itemDoc?.inspected_bottom_LBH
            || itemDoc?.inspected_item_bottom_LBH
            || {},
          );
          const hasTopAndBottomInspectedCbm =
            toNonNegativeNumber(calculatedInspectedTopCbm, 0) > 0
            && toNonNegativeNumber(calculatedInspectedBottomCbm, 0) > 0;

          const calculatedInspectedCbmFromBox = calculateCbmFromLbh(
            itemDoc?.inspected_box_LBH
            || itemDoc?.box_LBH
            || itemDoc?.inspected_item_LBH
            || itemDoc?.item_LBH
            || {},
          );
          const calculatedInspectedCbm = hasTopAndBottomInspectedCbm
            ? toNormalizedCbmString(
                toNonNegativeNumber(calculatedInspectedTopCbm, 0)
                + toNonNegativeNumber(calculatedInspectedBottomCbm, 0),
              )
            : calculatedInspectedCbmFromBox;
          const calculatedPisCbm = calculateCbmFromLbh(
            itemDoc?.pis_box_LBH
            || itemDoc?.box_LBH
            || itemDoc?.pis_item_LBH
            || itemDoc?.item_LBH
            || {},
          );

          itemDoc.cbm = {
            ...(itemDoc.cbm || {}),
            inspected_top: calculatedInspectedTopCbm,
            inspected_bottom: calculatedInspectedBottomCbm,
            inspected_total: calculatedInspectedCbm,
            calculated_inspected_total: calculatedInspectedCbm,
            calculated_pis_total: calculatedPisCbm,
            calculated_total: calculatedInspectedCbm,
          };
          hasItemDocChanges = true;

          if (nextInspectedBoxLbh || nextInspectedTopLbh || nextInspectedBottomLbh) {
            qc.cbm = {
              ...(qc.cbm || {}),
              top: calculatedInspectedTopCbm,
              bottom: calculatedInspectedBottomCbm,
              total: calculatedInspectedCbm,
            };
          }
        }

        if (hasItemDocChanges) {
          await itemDoc.save();
        }
      }

      await qc.save();

      const orderId = qc?.order?._id || qc.order;
      const orderRecord = await Order.findById(orderId);
      if (orderRecord && !CLOSED_ORDER_STATUSES.includes(orderRecord.status)) {
        const passedQty = Number(qc.quantities?.qc_passed || 0);
        const clientDemandQty = Number(qc.quantities?.client_demand || 0);

        orderRecord.status =
          clientDemandQty > 0 && passedQty >= clientDemandQty
            ? "Inspection Done"
            : "Under Inspection";
        await orderRecord.save();
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
    const timelineRange = resolveTimelineRange({
      timeline: req.query.timeline,
      customDays: req.query.custom_days ?? req.query.customDays,
    });
    if (!timelineRange) {
      return res.status(400).json({ message: "Invalid timeline filters" });
    }

    const inspectionsRaw = await Inspection.find({
      createdAt: {
        $gte: timelineRange.from_date_utc,
        $lt: timelineRange.to_date_exclusive_utc,
      },
    })
      .select("inspector inspection_date createdAt checked passed cbm qc")
      .populate("inspector", "name email")
      .populate({
        path: "qc",
        select: "order_meta item order",
        populate: {
          path: "order",
          select: "order_id brand vendor status archived",
          match: ACTIVE_ORDER_MATCH,
        },
      })
      .sort({ createdAt: -1 })
      .lean();

    const inspections = inspectionsRaw.filter((entry) => entry?.qc?.order);
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

    let totalChecked = 0;
    let totalPassed = 0;
    let totalInspectedCbm = 0;

    for (const inspection of inspections) {
      const inspectedQty = toNonNegativeNumber(inspection?.checked, 0);
      const passedQty = toNonNegativeNumber(inspection?.passed, 0);
      const cbmPerUnit = toNonNegativeNumber(inspection?.cbm?.total, 0);
      const inspectedCbm = cbmPerUnit * inspectedQty;
      const inspectionDateIso =
        toISODateString(inspection?.inspection_date)
        || toISODateString(inspection?.createdAt)
        || "";
      const weekStartIso = getWeekStartIsoDate(inspectionDateIso || inspection?.createdAt);
      const inspectorId = String(inspection?.inspector?._id || inspection?.inspector || "unassigned");
      const orderId = String(
        inspection?.qc?.order_meta?.order_id
          || inspection?.qc?.order?.order_id
          || "",
      ).trim();

      const inspectorEntry = upsertBucket(
        inspectorMap,
        inspectorId,
        () => ({
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
          total_checked: 0,
          total_passed: 0,
          total_inspected_cbm: 0,
          order_keys: new Set(),
          daily: new Map(),
          weekly: new Map(),
        }),
      );
      if (!inspectorEntry) continue;

      inspectorEntry.total_inspections += 1;
      inspectorEntry.total_checked += inspectedQty;
      inspectorEntry.total_passed += passedQty;
      inspectorEntry.total_inspected_cbm += inspectedCbm;
      if (orderId) {
        inspectorEntry.order_keys.add(orderId);
      }

      totalChecked += inspectedQty;
      totalPassed += passedQty;
      totalInspectedCbm += inspectedCbm;

      if (inspectionDateIso) {
        const dailyBucket = upsertBucket(
          inspectorEntry.daily,
          inspectionDateIso,
          (bucketKey) => ({
            date: bucketKey,
            checked_quantity: 0,
            passed_quantity: 0,
            inspections_count: 0,
            inspected_cbm: 0,
          }),
        );
        if (dailyBucket) {
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
            checked_quantity: 0,
            passed_quantity: 0,
            inspections_count: 0,
            inspected_cbm: 0,
          }),
        );
        if (globalDaily) {
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
            checked_quantity: 0,
            passed_quantity: 0,
            inspections_count: 0,
            inspected_cbm: 0,
          }),
        );
        if (weeklyBucket) {
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
            checked_quantity: 0,
            passed_quantity: 0,
            inspections_count: 0,
            inspected_cbm: 0,
          }),
        );
        if (globalWeekly) {
          globalWeekly.checked_quantity += inspectedQty;
          globalWeekly.passed_quantity += passedQty;
          globalWeekly.inspections_count += 1;
          globalWeekly.inspected_cbm += inspectedCbm;
        }
      }
    }

    const sortByDateDesc = (a, b, key) =>
      (toSortableTimestamp(b?.[key]) - toSortableTimestamp(a?.[key]));

    const inspectors = Array.from(inspectorMap.values())
      .map((entry) => ({
        inspector: entry.inspector,
        total_inspections: entry.total_inspections,
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
        String(a?.inspector?.name || "").localeCompare(String(b?.inspector?.name || "")),
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

    return res.status(200).json({
      filters: {
        timeline: timelineRange.timeline,
        custom_days: timelineRange.timeline === "custom" ? timelineRange.days : null,
        from_date: timelineRange.from_date_iso,
        to_date: timelineRange.to_date_iso,
      },
      summary: {
        inspectors_count: inspectors.length,
        inspections_count: inspections.length,
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
    return res.status(500).json({ message: err.message || "Failed to fetch inspector reports" });
  }
};

exports.getVendorReports = async (req, res) => {
  try {
    const selectedBrand = normalizeOptionalReportFilter(req.query.brand);
    const selectedVendor = normalizeOptionalReportFilter(req.query.vendor);
    const timelineRange = resolveTimelineRange({
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
        "order_id brand vendor status order_date ETD quantity item shipment",
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
        orderDateUtc
        && (!entry.order_date_utc || orderDateUtc.getTime() < entry.order_date_utc.getTime())
      ) {
        entry.order_date_utc = orderDateUtc;
      }

      const plannedEtdUtc = toUtcDateOnly(row?.ETD);
      if (
        plannedEtdUtc
        && (!entry.etd_utc || plannedEtdUtc.getTime() > entry.etd_utc.getTime())
      ) {
        entry.etd_utc = plannedEtdUtc;
      }

      for (const shipment of Array.isArray(row?.shipment) ? row.shipment : []) {
        const shipmentDateUtc = toUtcDateOnly(shipment?.stuffing_date);
        if (
          shipmentDateUtc
          && (!entry.latest_shipment_utc
            || shipmentDateUtc.getTime() > entry.latest_shipment_utc.getTime())
        ) {
          entry.latest_shipment_utc = shipmentDateUtc;
        }
      }
    }

    const todayUtc = toUtcDayStart(new Date());
    const timelineOrders = [...orderGroupMap.values()].filter((entry) => {
      if (!entry?.order_date_utc) return false;
      return (
        entry.order_date_utc.getTime() >= timelineRange.from_date_utc.getTime()
        && entry.order_date_utc.getTime() < timelineRange.to_date_exclusive_utc.getTime()
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

    const vendorMap = new Map();
    let delayedOrdersCount = 0;
    let ordersWithEtdCount = 0;
    let totalDelayDaysDelayedOnly = 0;

    for (const orderEntry of filteredOrders) {
      const status = resolveOrderStatusFromSet([...orderEntry.statuses]);
      const plannedEtdUtc = orderEntry.etd_utc;
      const hasPlannedEtd = Boolean(plannedEtdUtc);
      const hasShippedStatus = String(status || "").trim() === "Shipped";
      const actualShippedDateUtc = orderEntry.latest_shipment_utc;
      const hasEtdCrossed = Boolean(
        hasPlannedEtd
          && todayUtc
          && plannedEtdUtc.getTime() < todayUtc.getTime(),
      );

      let delayDays = 0;
      let isDelayed = false;
      let delayReference = hasShippedStatus ? "latest_shipment_date" : "today";

      if (hasPlannedEtd && hasShippedStatus) {
        if (actualShippedDateUtc && actualShippedDateUtc.getTime() > plannedEtdUtc.getTime()) {
          isDelayed = true;
          delayReference = "latest_shipment_date";
        }
      } else if (hasPlannedEtd && hasEtdCrossed) {
        isDelayed = true;
        delayReference = "today";
      }

      if (isDelayed) {
        const delayEndDate = hasShippedStatus
          ? actualShippedDateUtc
          : todayUtc;
        if (delayEndDate) {
          const rawDelay = Math.floor(
            (delayEndDate.getTime() - plannedEtdUtc.getTime()) / MS_PER_DAY,
          );
          delayDays = Math.max(0, rawDelay);
        }
      }

      if (hasPlannedEtd) {
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
      if (hasPlannedEtd) {
        vendorEntry.orders_with_etd_count += 1;
      }

      vendorEntry.brands.add(orderEntry.brand);
      vendorEntry.orders.push({
        order_id: orderEntry.order_id,
        brand: orderEntry.brand,
        vendor: orderEntry.vendor,
        status,
        order_date: orderEntry.order_date_utc ? toISODateString(orderEntry.order_date_utc) : "",
        etd: plannedEtdUtc ? toISODateString(plannedEtdUtc) : "",
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
      .map((entry) => ({
        vendor: entry.vendor,
        brands: [...entry.brands].sort((a, b) => String(a || "").localeCompare(String(b || ""))),
        orders_count: entry.orders_count,
        delayed_orders_count: entry.delayed_orders_count,
        orders_with_etd_count: entry.orders_with_etd_count,
        total_delay_days: entry.total_delay_days,
        average_delay_days: entry.delayed_orders_count > 0
          ? toRoundedNumber(entry.total_delay_days / entry.delayed_orders_count, 2)
          : 0,
        orders: [...entry.orders].sort((a, b) => {
          const aDelay = Number.isFinite(a?.delay_days) ? a.delay_days : -1;
          const bDelay = Number.isFinite(b?.delay_days) ? b.delay_days : -1;
          if (aDelay !== bDelay) return bDelay - aDelay;
          return toSortableTimestamp(b?.order_date) - toSortableTimestamp(a?.order_date);
        }),
      }))
      .sort((a, b) => {
        const avgDiff = Number(b?.average_delay_days || 0) - Number(a?.average_delay_days || 0);
        if (avgDiff !== 0) return avgDiff;
        return String(a?.vendor || "").localeCompare(String(b?.vendor || ""));
      });

    return res.status(200).json({
      filters: {
        timeline: timelineRange.timeline,
        custom_days: timelineRange.timeline === "custom" ? timelineRange.days : null,
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
        average_delay_days: delayedOrdersCount > 0
          ? toRoundedNumber(totalDelayDaysDelayedOnly / delayedOrdersCount, 2)
          : 0,
      },
      vendors,
    });
  } catch (err) {
    console.error("Vendor Reports Error:", err);
    return res.status(500).json({ message: err.message || "Failed to fetch vendor reports" });
  }
};

exports.getDailyReport = async (req, res) => {
  try {
    const reportDate = resolveReportDate(req.query.date);
    if (!reportDate) {
      return res.status(400).json({ message: "Invalid date format" });
    }
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
      const normalizedExplicit = String(explicitOrder || "").trim().toLowerCase();
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
      defaultOrder: alignedSortBy === "order_id" ? "asc" : "desc",
    });
    const alignedSortDirection = alignedSortOrder === "asc" ? 1 : -1;

    const rawInspectionSortToken = String(req.query.inspection_sort || "").trim();
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
      const primary =
        alignedSortBy === "order_id"
          ? compareText(a?.order_id, b?.order_id)
          : toSortableTimestamp(a?.request_date) - toSortableTimestamp(b?.request_date);
      if (primary !== 0) return primary * alignedSortDirection;

      const secondary =
        alignedSortBy === "order_id"
          ? toSortableTimestamp(a?.request_date) - toSortableTimestamp(b?.request_date)
          : compareText(a?.order_id, b?.order_id);
      if (secondary !== 0) {
        return alignedSortBy === "order_id" ? secondary * -1 : secondary;
      }
      return compareText(a?.item_code, b?.item_code);
    };

    const compareInspectionRows = (a, b) => {
      const primary =
        inspectionSortBy === "order_id"
          ? compareText(a?.order_id, b?.order_id)
          : toSortableTimestamp(a?.inspection_date)
            - toSortableTimestamp(b?.inspection_date);
      if (primary !== 0) return primary * inspectionSortDirection;

      const secondary =
        inspectionSortBy === "order_id"
          ? toSortableTimestamp(a?.inspection_date)
            - toSortableTimestamp(b?.inspection_date)
          : compareText(a?.order_id, b?.order_id);
      if (secondary !== 0) {
        return inspectionSortBy === "order_id" ? secondary * -1 : secondary;
      }
      return compareText(a?.item_code, b?.item_code);
    };

    const [reportYear, reportMonth, reportDay] = String(reportDate)
      .split("-");
    const inspectionDateVariants = [
      reportDate,
      `${reportDay}/${reportMonth}/${reportYear}`,
      `${reportDay}-${reportMonth}-${reportYear}`,
    ];

    const [alignedRequestsRaw, inspectionsRaw] = await Promise.all([
      QC.find({ request_date: reportDate })
        .select("request_date order_meta item inspector quantities order")
        .populate("inspector", "name email role")
        .populate({
          path: "order",
          select: "order_id status quantity brand vendor archived",
          match: ACTIVE_ORDER_MATCH,
        })
        .sort({ createdAt: -1 })
        .lean(),
      Inspection.find({ inspection_date: { $in: inspectionDateVariants } })
        .select(
          "inspection_date inspector qc checked passed vendor_requested vendor_offered pending_after cbm remarks createdAt",
        )
        .populate("inspector", "name email role")
        .populate({
          path: "qc",
          select: "item order_meta order cbm request_date",
          populate: {
            path: "order",
            select: "order_id status quantity brand vendor archived",
            match: ACTIVE_ORDER_MATCH,
          },
        })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const alignedRequests = alignedRequestsRaw.filter((qc) => qc?.order);
    const inspections = inspectionsRaw.filter((inspection) => inspection?.qc?.order);

    const aligned_requests = alignedRequests.map((qc) => ({
      qc_id: qc._id,
      request_date: qc.request_date,
      order_id: qc?.order_meta?.order_id || qc?.order?.order_id || "N/A",
      brand: qc?.order_meta?.brand || qc?.order?.brand || "N/A",
      vendor: qc?.order_meta?.vendor || qc?.order?.vendor || "N/A",
      item_code: qc?.item?.item_code || "N/A",
      description: qc?.item?.description || "N/A",
      inspector: qc?.inspector
        ? {
            _id: qc.inspector._id,
            name: qc.inspector.name,
            email: qc.inspector.email,
            role: qc.inspector.role,
          }
        : null,
      quantity_requested: Number(qc?.quantities?.quantity_requested || 0),
      quantity_inspected: Number(qc?.quantities?.qc_checked || 0),
      quantity_passed: Number(qc?.quantities?.qc_passed || 0),
      quantity_pending: Number(qc?.quantities?.pending || 0),
      order_status: qc?.order?.status || "N/A",
    }));
    const sortedAlignedRequests = [...aligned_requests].sort(compareAlignedRows);

    const inspectorMap = new Map();
    const inspectorCbmKeyMap = new Map();
    const globalCbmKeys = new Set();
    let totalInspectedCbm = 0;
    for (const inspection of inspections) {
      const inspectorId = String(
        inspection?.inspector?._id || inspection?.inspector || "unassigned",
      );

      if (!inspectorMap.has(inspectorId)) {
        inspectorMap.set(inspectorId, {
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
          total_inspected_quantity: 0,
          total_inspected_cbm: 0,
          inspections_count: 0,
          inspections: [],
        });
      }

      const entry = inspectorMap.get(inspectorId);
      const inspectedQty = Number(inspection?.checked || 0);
      const qcRecord = inspection?.qc || {};
      const cbmSnapshot =
        inspection?.cbm && typeof inspection.cbm === "object"
          ? inspection.cbm
          : (qcRecord?.cbm || {});
      const cbmTotal = Number(cbmSnapshot?.total || 0);
      const safeCbmTotal = Number.isFinite(cbmTotal) ? cbmTotal : 0;
      const orderIdForKey = String(
        qcRecord?.order_meta?.order_id || qcRecord?.order?.order_id || "",
      ).trim();
      const itemCodeForKey = String(qcRecord?.item?.item_code || "").trim();
      const cbmKey =
        orderIdForKey && itemCodeForKey
          ? `${orderIdForKey}__${itemCodeForKey}`
          : `inspection:${inspection._id}`;

      entry.total_inspected_quantity += inspectedQty;
      if (!inspectorCbmKeyMap.has(inspectorId)) {
        inspectorCbmKeyMap.set(inspectorId, new Set());
      }
      const inspectorCbmKeys = inspectorCbmKeyMap.get(inspectorId);
      if (!inspectorCbmKeys.has(cbmKey)) {
        entry.total_inspected_cbm += safeCbmTotal;
        inspectorCbmKeys.add(cbmKey);
      }

      if (!globalCbmKeys.has(cbmKey)) {
        totalInspectedCbm += safeCbmTotal;
        globalCbmKeys.add(cbmKey);
      }

      entry.inspections_count += 1;
      entry.inspections.push({
        inspection_id: inspection._id,
        inspection_date: inspection.inspection_date || null,
        order_id: qcRecord?.order_meta?.order_id || qcRecord?.order?.order_id || "N/A",
        item_code: qcRecord?.item?.item_code || "N/A",
        description: qcRecord?.item?.description || "N/A",
        inspected_quantity: inspectedQty,
        passed_quantity: Number(inspection?.passed || 0),
        vendor_requested: Number(inspection?.vendor_requested || 0),
        vendor_offered: Number(inspection?.vendor_offered || 0),
        pending_after: Number(inspection?.pending_after || 0),
        cbm: {
          top: String(cbmSnapshot?.top ?? "0"),
          bottom: String(cbmSnapshot?.bottom ?? "0"),
          total: String(cbmSnapshot?.total ?? "0"),
        },
        remarks: inspection?.remarks || "",
      });
    }

    for (const inspectorEntry of inspectorMap.values()) {
      inspectorEntry.inspections = Array.isArray(inspectorEntry.inspections)
        ? [...inspectorEntry.inspections].sort(compareInspectionRows)
        : [];
    }

    const inspector_compiled = Array.from(inspectorMap.values()).sort((a, b) =>
      String(a?.inspector?.name || "").localeCompare(String(b?.inspector?.name || "")),
    );

    const totalInspectedQty = inspector_compiled.reduce(
      (sum, entry) => sum + Number(entry.total_inspected_quantity || 0),
      0,
    );

    res.json({
      date: reportDate,
      summary: {
        aligned_requests_count: sortedAlignedRequests.length,
        inspectors_count: inspector_compiled.length,
        inspections_count: inspections.length,
        total_inspected_quantity: totalInspectedQty,
        total_inspected_cbm: totalInspectedCbm,
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



exports.getQCById = async (req, res) => {
  try {
    const qc = await QC.findById(req.params.id)
      .populate("inspector", "name email role")
      .populate("createdBy", "name email role")
      .populate("request_history.inspector", "name email role")
      .populate("request_history.createdBy", "name email role")
      .populate({
        path: "order",
        match: ACTIVE_ORDER_MATCH,
      })
      .populate({
        path: "inspection_record",
        options: { sort: { inspection_date: -1, createdAt: -1 } },
        populate: { path: "inspector", select: "name email role" },
      });

    if (!qc || !qc.order) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const normalizedRole = String(req.user?.role || "").trim().toLowerCase();
    const isQcUser = normalizedRole === "qc";
    if (isQcUser) {
      const currentUserId = String(req.user?._id || req.user?.id || "").trim();
      const alignedInspectorId = String(qc?.inspector?._id || qc?.inspector || "").trim();
      if (!currentUserId || !alignedInspectorId || alignedInspectorId !== currentUserId) {
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
            "code name description brand_name brands vendors inspected_weight pis_weight weight cbm inspected_item_LBH inspected_item_top_LBH inspected_item_bottom_LBH pis_item_LBH pis_item_top_LBH pis_item_bottom_LBH item_LBH inspected_box_LBH inspected_box_top_LBH inspected_box_bottom_LBH inspected_top_LBH inspected_bottom_LBH pis_box_LBH pis_box_top_LBH pis_box_bottom_LBH box_LBH",
          )
          .lean()
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
            toSortableTimestamp(a?.inspection_date) || toSortableTimestamp(a?.createdAt);
          const bTime =
            toSortableTimestamp(b?.inspection_date) || toSortableTimestamp(b?.createdAt);
          return bTime - aTime;
        })
      : [];

    res.json({
      data: {
        ...qcData,
        item_master: itemMaster || null,
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
    const payloadRecords = Array.isArray(req.body?.records) ? req.body.records : [];

    if (!mongoose.Types.ObjectId.isValid(qcId)) {
      return res.status(400).json({ message: "Invalid QC id" });
    }

    if (payloadRecords.length === 0) {
      return res.status(400).json({ message: "At least one inspection row is required" });
    }

    const qc = await QC.findById(qcId);
    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const inspectionDocs = await Inspection.find({ qc: qc._id });
    if (inspectionDocs.length === 0) {
      return res.status(404).json({ message: "No inspection records found for this QC record" });
    }

    const inspectionMap = new Map(
      inspectionDocs.map((doc) => [String(doc._id), doc]),
    );
    const touchedInspectors = new Set();

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

    for (const row of payloadRecords) {
      const recordId = String(row?._id || row?.id || "").trim();
      if (!recordId || !mongoose.Types.ObjectId.isValid(recordId)) {
        throw new Error("Invalid inspection record id in payload");
      }

      const record = inspectionMap.get(recordId);
      if (!record) {
        throw new Error(`Inspection record ${recordId} does not belong to this QC`);
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

      const vendorRequested = parseNonNegativeField(
        row?.vendor_requested ?? record.vendor_requested,
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

      const cbmInput =
        row?.cbm && typeof row.cbm === "object" ? row.cbm : null;
      const cbmTop = cbmInput?.top !== undefined
        ? String(cbmInput.top ?? "0")
        : String(record?.cbm?.top ?? "0");
      const cbmBottom = cbmInput?.bottom !== undefined
        ? String(cbmInput.bottom ?? "0")
        : String(record?.cbm?.bottom ?? "0");
      const cbmTotal = cbmInput?.total !== undefined
        ? String(cbmInput.total ?? "0")
        : String(record?.cbm?.total ?? "0");

      const remarks = row?.remarks !== undefined
        ? String(row.remarks || "")
        : String(record?.remarks || "");

      touchedInspectors.add(String(record.inspector || ""));
      touchedInspectors.add(inspectorId);

      record.requested_date = requestedDate;
      record.inspection_date = inspectionDate;
      record.inspector = inspectorId;
      record.vendor_requested = vendorRequested;
      record.vendor_offered = vendorOffered;
      record.checked = checked;
      record.passed = passed;
      record.pending_after = pendingAfter;
      record.cbm = {
        top: cbmTop,
        bottom: cbmBottom,
        total: cbmTotal,
      };
      record.remarks = remarks;
    }

    await Promise.all(inspectionDocs.map((doc) => doc.save()));

    const refreshedInspections = await Inspection.find({ qc: qc._id })
      .select(
        "inspection_date requested_date request_history_id inspector checked passed vendor_offered labels_added label_ranges createdAt",
      )
      .lean();

    const totalChecked = refreshedInspections.reduce(
      (sum, record) => sum + toNonNegativeNumber(record?.checked, 0),
      0,
    );
    const totalPassed = refreshedInspections.reduce(
      (sum, record) => sum + toNonNegativeNumber(record?.passed, 0),
      0,
    );
    const totalVendorOffered = refreshedInspections.reduce(
      (sum, record) => sum + toNonNegativeNumber(record?.vendor_offered, 0),
      0,
    );
    const mergedLabels = normalizeLabels(
      refreshedInspections.flatMap((record) =>
        Array.isArray(record?.labels_added) ? record.labels_added : [],
      ),
    );

    const clientDemandQty = toNonNegativeNumber(qc?.quantities?.client_demand, 0);
    qc.quantities.qc_checked = totalChecked;
    qc.quantities.qc_passed = totalPassed;
    qc.quantities.vendor_provision = totalVendorOffered;
    qc.quantities.pending = Math.max(0, clientDemandQty - totalPassed);
    qc.quantities.qc_rejected = Math.max(0, totalChecked - totalPassed);
    qc.labels = mergedLabels;

    if (Array.isArray(qc.request_history)) {
      const inspectionStatusByRequestId = new Map();
      for (const record of refreshedInspections) {
        const requestHistoryId = String(record?.request_history_id || "").trim();
        if (!requestHistoryId) continue;
        const hasActivity =
          toNonNegativeNumber(record?.checked, 0) > 0
          || toNonNegativeNumber(record?.passed, 0) > 0
          || toNonNegativeNumber(record?.vendor_offered, 0) > 0
          || (Array.isArray(record?.labels_added) && record.labels_added.length > 0)
          || (Array.isArray(record?.label_ranges) && record.label_ranges.length > 0);

        if (!inspectionStatusByRequestId.has(requestHistoryId)) {
          inspectionStatusByRequestId.set(requestHistoryId, hasActivity);
        } else if (hasActivity) {
          inspectionStatusByRequestId.set(requestHistoryId, true);
        }
      }

      for (const entry of qc.request_history) {
        const requestId = String(entry?._id || "").trim();
        if (!requestId) continue;
        entry.status = inspectionStatusByRequestId.get(requestId)
          ? "inspected"
          : "open";
      }
    }

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
        latestRecord?.inspection_date
          || toDateInputValue(latestRecord?.createdAt)
          || qc.request_date
          || qc.last_inspected_date
          || "",
      );
    } else {
      qc.last_inspected_date = String(qc.request_date || qc.last_inspected_date || "");
    }

    await qc.save();

    const orderId = qc?.order?._id || qc.order;
    const orderRecord = await Order.findById(orderId);
    if (orderRecord && !CLOSED_ORDER_STATUSES.includes(orderRecord.status)) {
      orderRecord.status =
        clientDemandQty > 0 && totalPassed >= clientDemandQty
          ? "Inspection Done"
          : "Under Inspection";
      await orderRecord.save();
    }

    const inspectorIdsToRecalculate = [...touchedInspectors]
      .map((value) => String(value || "").trim())
      .filter((value) => mongoose.Types.ObjectId.isValid(value));

    for (const inspectorUserId of inspectorIdsToRecalculate) {
      const inspectorDoc = await Inspector.findOne({ user: inspectorUserId });
      if (!inspectorDoc) continue;

      const labelUsageRecords = await Inspection.find({ inspector: inspectorUserId })
        .select("labels_added")
        .lean();

      inspectorDoc.used_labels = normalizeLabels(
        labelUsageRecords.flatMap((entry) =>
          Array.isArray(entry?.labels_added) ? entry.labels_added : [],
        ),
      );
      await inspectorDoc.save();
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
    return res.status(400).json({ message: err.message || "Failed to edit inspection records" });
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

    qc.inspection_record = (Array.isArray(qc.inspection_record) ? qc.inspection_record : [])
      .filter((entryId) => String(entryId) !== String(inspection._id));

    const currentChecked = Number(qc?.quantities?.qc_checked || 0);
    const currentPassed = Number(qc?.quantities?.qc_passed || 0);
    const currentProvision = Number(qc?.quantities?.vendor_provision || 0);
    const currentClientDemand = Number(qc?.quantities?.client_demand || 0);

    const removedChecked = Number(inspection?.checked || 0);
    const removedPassed = Number(inspection?.passed || 0);
    const removedProvision = Number(inspection?.vendor_offered || 0);

    qc.quantities.qc_checked = Math.max(0, currentChecked - removedChecked);
    qc.quantities.qc_passed = Math.max(0, currentPassed - removedPassed);
    qc.quantities.vendor_provision = Math.max(
      0,
      currentProvision - removedProvision,
    );
    qc.quantities.pending = Math.max(0, currentClientDemand - qc.quantities.qc_passed);

    const remainingInspections = await Inspection.find({
      qc: qc._id,
      _id: { $ne: inspection._id },
    })
      .select("inspection_date createdAt labels_added")
      .lean();

    const recalculatedLabels = normalizeLabels(
      remainingInspections.flatMap((entry) =>
        Array.isArray(entry?.labels_added) ? entry.labels_added : [],
      ),
    );
    const shouldDeleteQcRecord = remainingInspections.length === 0;

    if (!shouldDeleteQcRecord) {
      qc.labels = recalculatedLabels;

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
        latestRecord?.inspection_date
          || toDateInputValue(latestRecord?.createdAt)
          || qc.request_date
          || qc.last_inspected_date
          || "",
      );

      await qc.save();
    }

    await Inspection.deleteOne({ _id: inspection._id });

    const inspectorDoc = await Inspector.findOne({ user: inspection.inspector });
    if (inspectorDoc) {
      const stillUsedRecords = await Inspection.find({ inspector: inspection.inspector })
        .select("labels_added")
        .lean();

      const stillUsedLabels = new Set(
        stillUsedRecords.flatMap((entry) =>
          (Array.isArray(entry?.labels_added) ? entry.labels_added : [])
            .map((label) => Number(label))
            .filter((label) => Number.isFinite(label)),
        ),
      );

      const nextUsedLabels = normalizeLabels(
        (Array.isArray(inspectorDoc.used_labels) ? inspectorDoc.used_labels : [])
          .map((label) => Number(label))
          .filter((label) => Number.isFinite(label) && stillUsedLabels.has(label)),
      );

      inspectorDoc.used_labels = nextUsedLabels;
      await inspectorDoc.save();
    }

    const orderId = qc?.order?._id || qc.order;
    const orderRecord = await Order.findById(orderId);

    if (shouldDeleteQcRecord) {
      if (orderRecord) {
        orderRecord.qc_record = null;
        orderRecord.status = "Pending";
        await orderRecord.save();
      }

      await QC.deleteOne({ _id: qc._id });

      return res.status(200).json({
        message: "Last inspection record deleted. QC record removed and order moved to Pending.",
        qc_deleted: true,
        data: null,
      });
    }

    if (orderRecord && !CLOSED_ORDER_STATUSES.includes(orderRecord.status)) {
      const passedQty = Number(qc.quantities?.qc_passed || 0);
      const clientDemandQty = Number(qc.quantities?.client_demand || 0);

      orderRecord.status =
        clientDemandQty > 0 && passedQty >= clientDemandQty
          ? "Inspection Done"
          : "Under Inspection";
      await orderRecord.save();
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

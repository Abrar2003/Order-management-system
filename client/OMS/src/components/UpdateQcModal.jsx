import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/axios";
import { getUserFromToken } from "../auth/auth.utils";
import {
  isAdminLikeRole,
  isManagerLikeRole,
  normalizeUserRole,
} from "../auth/permissions";
import { scanQcBarcodeFile } from "../services/qcBarcode.service";
import {
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import {
  BOX_CARTON_REMARK_OPTIONS as BOX_CARTON_REMARK_OPTIONS_UTIL,
  BOX_ENTRY_TYPES as BOX_ENTRY_TYPES_UTIL,
  BOX_PACKAGING_MODES as BOX_PACKAGING_MODES_UTIL,
  BOX_SIZE_REMARK_OPTIONS as BOX_SIZE_REMARK_OPTIONS_UTIL,
  buildMeasuredSizeEntriesFromLegacy as buildMeasuredSizeEntriesFromLegacyUtil,
  convertMeasuredBoxEntriesMode as convertMeasuredBoxEntriesModeUtil,
  createEmptyMeasuredSizeEntry as createEmptyMeasuredSizeEntryUtil,
  deriveLegacyFromMeasuredSizeEntries as deriveLegacyFromMeasuredSizeEntriesUtil,
  detectBoxPackagingMode as detectBoxPackagingModeUtil,
  ensureMeasuredSizeEntryCount as ensureMeasuredSizeEntryCountUtil,
  parseMeasuredSizeEntries as parseMeasuredSizeEntriesUtil,
  SIZE_ENTRY_LIMIT as SIZE_ENTRY_LIMIT_UTIL,
} from "../utils/measuredSizeForm";
import { getQcUserUpdateRequestAvailability } from "../utils/qcRequests";
import { formatNumberInputValue } from "../utils/measurementDisplay";
import {
  buildUpdateQcPastDaysMessage,
  getUpdateQcPastDaysLimit,
  isLabelExemptUser,
} from "../utils/qcUpdateAccess";
import "../App.css";
import AllocateLabelsModal from "./AllocateLabelsModal";

const NON_NEGATIVE_FIELDS = new Set([
  "qc_checked",
  "qc_passed",
  "offeredQuantity",
  "barcode",
  "inner_barcode",
  "inspected_weight_top_net",
  "inspected_weight_top_gross",
  "inspected_weight_bottom_net",
  "inspected_weight_bottom_gross",
  "inspected_weight_total_net",
  "inspected_weight_total_gross",
  "inspected_item_L",
  "inspected_item_B",
  "inspected_item_H",
  "inspected_box_L",
  "inspected_box_B",
  "inspected_box_H",
  "inspected_top_L",
  "inspected_top_B",
  "inspected_top_H",
  "inspected_bottom_L",
  "inspected_bottom_B",
  "inspected_bottom_H",
  "inspected_item_top_L",
  "inspected_item_top_B",
  "inspected_item_top_H",
  "inspected_item_bottom_L",
  "inspected_item_bottom_B",
  "inspected_item_bottom_H",
]);

const INSPECTED_WEIGHT_FIELDS = Object.freeze([
  {
    formKey: "inspected_weight_top_net",
    payloadKey: "top_net",
    label: "Top Net Weight",
    shortLabel: "Net",
  },
  {
    formKey: "inspected_weight_top_gross",
    payloadKey: "top_gross",
    label: "Top Gross Weight",
    shortLabel: "Gross",
  },
  {
    formKey: "inspected_weight_bottom_net",
    payloadKey: "bottom_net",
    label: "Bottom Net Weight",
    shortLabel: "Net",
  },
  {
    formKey: "inspected_weight_bottom_gross",
    payloadKey: "bottom_gross",
    label: "Bottom Gross Weight",
    shortLabel: "Gross",
  },
  {
    formKey: "inspected_weight_total_net",
    payloadKey: "total_net",
    label: "Total Net Weight",
    shortLabel: "Net",
  },
  {
    formKey: "inspected_weight_total_gross",
    payloadKey: "total_gross",
    label: "Total Gross Weight",
    shortLabel: "Gross",
  },
]);

const INSPECTED_WEIGHT_GROUPS = Object.freeze([
  {
    key: "top",
    label: "Top Weight (Net/Gross)",
    fields: [INSPECTED_WEIGHT_FIELDS[0], INSPECTED_WEIGHT_FIELDS[1]],
  },
  {
    key: "bottom",
    label: "Bottom Weight (Net/Gross)",
    fields: [INSPECTED_WEIGHT_FIELDS[2], INSPECTED_WEIGHT_FIELDS[3]],
  },
  {
    key: "total",
    label: "Total Weight (Net/Gross)",
    fields: [INSPECTED_WEIGHT_FIELDS[4], INSPECTED_WEIGHT_FIELDS[5]],
  },
]);

const INSPECTED_WEIGHT_TOP_FORM_KEYS = Object.freeze([
  "inspected_weight_top_net",
  "inspected_weight_top_gross",
]);
const INSPECTED_WEIGHT_BOTTOM_FORM_KEYS = Object.freeze([
  "inspected_weight_bottom_net",
  "inspected_weight_bottom_gross",
]);
const INSPECTED_WEIGHT_TOTAL_FORM_KEYS = Object.freeze([
  "inspected_weight_total_net",
  "inspected_weight_total_gross",
]);
const INSPECTED_ITEM_TOTAL_LBH_FORM_KEYS = Object.freeze([
  "inspected_item_L",
  "inspected_item_B",
  "inspected_item_H",
]);
const INSPECTED_ITEM_TOP_LBH_FORM_KEYS = Object.freeze([
  "inspected_item_top_L",
  "inspected_item_top_B",
  "inspected_item_top_H",
]);
const INSPECTED_ITEM_BOTTOM_LBH_FORM_KEYS = Object.freeze([
  "inspected_item_bottom_L",
  "inspected_item_bottom_B",
  "inspected_item_bottom_H",
]);
const INSPECTED_BOX_TOTAL_LBH_FORM_KEYS = Object.freeze([
  "inspected_box_L",
  "inspected_box_B",
  "inspected_box_H",
]);
const INSPECTED_BOX_TOP_LBH_FORM_KEYS = Object.freeze([
  "inspected_top_L",
  "inspected_top_B",
  "inspected_top_H",
]);
const INSPECTED_BOX_BOTTOM_LBH_FORM_KEYS = Object.freeze([
  "inspected_bottom_L",
  "inspected_bottom_B",
  "inspected_bottom_H",
]);

const LEGACY_INSPECTED_WEIGHT_FALLBACK_BY_KEY = Object.freeze({
  total_net: "net",
  total_gross: "gross",
});

const createEmptyLabelRange = () => ({ start: "", end: "" });
const buildClearedFormFields = (fieldKeys = []) =>
  fieldKeys.reduce((accumulator, fieldKey) => {
    accumulator[fieldKey] = "";
    return accumulator;
  }, {});
const toDimensionInputValue = (value) => formatNumberInputValue(value);
const getWeightValueFromModel = (weightData = {}, payloadKey = "") => {
  const normalizedPayloadKey = String(payloadKey || "").trim();
  if (!normalizedPayloadKey) return 0;

  const legacyKey = LEGACY_INSPECTED_WEIGHT_FALLBACK_BY_KEY[normalizedPayloadKey];
  const rawValue =
    weightData?.[normalizedPayloadKey]
    ?? (legacyKey ? weightData?.[legacyKey] : undefined)
    ?? 0;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const hasAnyLbhInput = (values = []) =>
  values.some((value) => String(value ?? "").trim() !== "");
const hasCompletePositiveLbh = (dimensions = {}) =>
  Number(dimensions?.L || 0) > 0 &&
  Number(dimensions?.B || 0) > 0 &&
  Number(dimensions?.H || 0) > 0;

const toStrictLbhInputGroup = (dimensions = {}) => {
  const L = toDimensionInputValue(dimensions?.L);
  const B = toDimensionInputValue(dimensions?.B);
  const H = toDimensionInputValue(dimensions?.H);
  if (L && B && H) return { L, B, H };
  return { L: "", B: "", H: "" };
};
const SIZE_ENTRY_LIMIT = SIZE_ENTRY_LIMIT_UTIL;
const SIZE_COUNT_OPTIONS = Array.from({ length: SIZE_ENTRY_LIMIT }, (_, index) =>
  String(index + 1),
);
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  { value: "top", label: "Top" },
  { value: "base", label: "Base" },
  { value: "item1", label: "Item 1" },
  { value: "item2", label: "Item 2" },
  { value: "item3", label: "Item 3" },
  { value: "item4", label: "Item 4" },
]);
const BOX_PACKAGING_MODES = BOX_PACKAGING_MODES_UTIL;
const BOX_ENTRY_TYPES = BOX_ENTRY_TYPES_UTIL;
const BOX_SIZE_REMARK_OPTIONS = BOX_SIZE_REMARK_OPTIONS_UTIL;
const BOX_CARTON_REMARK_OPTIONS = BOX_CARTON_REMARK_OPTIONS_UTIL;
const createEmptyMeasuredSizeEntry = (options = {}) =>
  createEmptyMeasuredSizeEntryUtil(options);
const normalizeSizeCount = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > SIZE_ENTRY_LIMIT) {
    return fallback;
  }
  return parsed;
};
const ensureMeasuredSizeEntryCount = (entries = [], count = 1, options = {}) =>
  ensureMeasuredSizeEntryCountUtil(entries, count, options);
const hasMeaningfulMeasuredSize = (entry = {}) =>
  String(entry?.L || "").trim() !== "" ||
  String(entry?.B || "").trim() !== "" ||
  String(entry?.H || "").trim() !== "" ||
  String(entry?.weight || "").trim() !== "" ||
  String(entry?.remark || "").trim() !== "" ||
  String(entry?.item_count_in_inner || "").trim() !== "" ||
  String(entry?.box_count_in_master || "").trim() !== "";
const buildMeasuredSizeEntriesFromLegacy = ({
  primaryEntries = [],
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  singleLbh = {},
  topLbh = {},
  bottomLbh = {},
  totalWeight = 0,
  topWeight = 0,
  bottomWeight = 0,
  weightKey = "",
  topRemark = "top",
  bottomRemark = "base",
} = {}) =>
  buildMeasuredSizeEntriesFromLegacyUtil({
    primaryEntries,
    mode,
    singleLbh,
    topLbh,
    bottomLbh,
    totalWeight,
    topWeight,
    bottomWeight,
    weightKey,
    topRemark,
    bottomRemark,
  });
const deriveLegacyFromMeasuredSizeEntries = (
  entries = [],
  options = {},
) => deriveLegacyFromMeasuredSizeEntriesUtil(entries, options);
const getRemarkValues = (options = []) =>
  options.map((option) => String(option?.value || "").trim().toLowerCase()).filter(Boolean);
const getRemarkLabel = (options = [], remark = "") =>
  options.find((option) => option.value === remark)?.label || remark;
const parseMeasuredSizeEntries = ({
  entries = [],
  count = 1,
  groupLabel = "Sizes",
  remarkOptions = [],
  payloadWeightKey = "",
  weightFieldLabel = "Weight",
  treatEmptyAsInput = false,
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
} = {}) => {
  const parsed = parseMeasuredSizeEntriesUtil({
    entries,
    count,
    groupLabel,
    remarkOptions,
    payloadWeightKey,
    weightFieldLabel,
    mode,
  });

  if (!parsed.hasAnyInput && treatEmptyAsInput) {
    return {
      ...parsed,
      hasAnyInput: true,
      hasMeaningfulInput: false,
    };
  }

  return {
    ...parsed,
    hasMeaningfulInput: parsed.hasAnyInput,
  };
};
const detectBoxPackagingMode = (mode = "", entries = []) =>
  detectBoxPackagingModeUtil(mode, entries);
const convertMeasuredBoxEntriesMode = (entries = [], nextMode = BOX_PACKAGING_MODES.INDIVIDUAL) =>
  convertMeasuredBoxEntriesModeUtil(entries, nextMode);

const getUtcDayOffsetFromToday = (isoDateValue) => {
  const normalizedIso = toISODateString(isoDateValue);
  if (!normalizedIso) return null;
  const [year, month, day] = normalizedIso.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const targetUtc = Date.UTC(year, month - 1, day);
  const todayIso = toISODateString(new Date());
  if (!todayIso) return null;
  const [todayYear, todayMonth, todayDay] = todayIso.split("-").map(Number);
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.round((todayUtc - targetUtc) / oneDayMs);
};

const toSortableTimestamp = (value) => {
  const isoDate = toISODateString(value);
  if (isoDate) {
    const parsed = new Date(`${isoDate}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const normalizeLabels = (labels = []) => {
  if (!Array.isArray(labels)) return [];
  const numericLabels = labels
    .map((label) => Number(label))
    .filter((label) => Number.isInteger(label) && label >= 0);
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

    ranges.push({ start: String(start), end: String(end) });
    start = label;
    end = label;
  }

  ranges.push({ start: String(start), end: String(end) });
  return ranges;
};

const getInitialLabelRanges = (record) => {
  const existingRanges = Array.isArray(record?.label_ranges)
    ? record.label_ranges
        .map((range) => ({
          start: String(range?.start ?? "").trim(),
          end: String(range?.end ?? "").trim(),
        }))
        .filter((range) => range.start !== "" || range.end !== "")
    : [];

  if (existingRanges.length > 0) return existingRanges;

  const rangesFromLabels = buildLabelRangesFromLabels(record?.labels_added);
  return rangesFromLabels.length > 0 ? rangesFromLabels : [createEmptyLabelRange()];
};

const getLatestInspectionRecord = (qc = {}) =>
  (Array.isArray(qc?.inspection_record) ? [...qc.inspection_record] : [])
    .sort((left, right) => {
      const leftTime = Math.max(
        toSortableTimestamp(left?.inspection_date),
        toSortableTimestamp(left?.createdAt),
      );
      const rightTime = Math.max(
        toSortableTimestamp(right?.inspection_date),
        toSortableTimestamp(right?.createdAt),
      );
      return rightTime - leftTime;
    })[0] || null;

const getLatestRequestEntry = (qc = {}) =>
  (Array.isArray(qc?.request_history) ? [...qc.request_history] : [])
    .sort((left, right) => {
      const leftTime = Math.max(
        toSortableTimestamp(left?.request_date),
        toSortableTimestamp(left?.updatedAt),
        toSortableTimestamp(left?.createdAt),
      );
      const rightTime = Math.max(
        toSortableTimestamp(right?.request_date),
        toSortableTimestamp(right?.updatedAt),
        toSortableTimestamp(right?.createdAt),
      );
      return rightTime - leftTime;
    })[0] || null;

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
    if (String(record?.status || "").trim().toLowerCase() === "transfered") {
      return false;
    }
    return Number(record?.checked || 0) <= 0;
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

  if (requestHistoryId) {
    const exactRequestHistoryMatch = findLatestMatchingRecord(
      (record) =>
        String(record?.request_history_id || "").trim() === requestHistoryId,
    );
    if (exactRequestHistoryMatch) {
      return exactRequestHistoryMatch;
    }
  }

  if (!requestDateKey) return null;

  return (
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
    }) ||
    findLatestMatchingRecord((record) => {
      if (!canUseDateFallbackRecord(record)) return false;

      const recordRequestedDate = toISODateString(
        record?.requested_date || record?.inspection_date || record?.createdAt,
      );
      return recordRequestedDate === requestDateKey;
    }) ||
    null
  );
};

const toQuantityInputValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "";
  return String(parsed);
};

const getEffectiveRequestPassedQuantity = ({
  requestType = "",
  samplePassed = 0,
  requestedQuantity = 0,
}) => {
  const safeSamplePassed = Math.max(0, Number(samplePassed) || 0);
  if (String(requestType || "").trim().toUpperCase() !== "AQL") {
    return safeSamplePassed;
  }

  return safeSamplePassed > 0 ? Math.max(0, Number(requestedQuantity) || 0) : 0;
};

const getQcLabelRequirement = ({
  totalPassed = 0,
  boxSizesCount = 0,
}) => {
  const safePassed = Math.max(0, Number(totalPassed) || 0);
  const safeBoxSizesCount = Math.max(0, Number(boxSizesCount) || 0);

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

  return `Total labels must equal passed quantity × box sizes count (${requirement.requiredCount}). Actual total labels: ${Math.max(0, Number(actualCount) || 0)}. Expected: ${requirement.basisQuantity} × ${requirement.boxSizesCount}.`;
};

const getLatestRequestedQuantity = (qc = {}) => {
  const requestHistory = Array.isArray(qc?.request_history) ? qc.request_history : [];
  const latestRequestEntry = getLatestRequestEntry(qc);
  const latestRequestedQuantity = Number(latestRequestEntry?.quantity_requested);
  if (Number.isFinite(latestRequestedQuantity) && latestRequestedQuantity > 0) {
    return latestRequestedQuantity;
  }

  const fallbackRequestedQuantity = Number(qc?.quantities?.quantity_requested);
  if (Number.isFinite(fallbackRequestedQuantity) && fallbackRequestedQuantity > 0) {
    return fallbackRequestedQuantity;
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

  if (Number.isFinite(fallbackRequestedQuantity) && fallbackRequestedQuantity >= 0) {
    return fallbackRequestedQuantity;
  }

  const clientDemandQuantity = Number(qc?.quantities?.client_demand);
  if (Number.isFinite(clientDemandQuantity) && clientDemandQuantity > 0) {
    return clientDemandQuantity;
  }

  return 0;
};

const PREFERRED_BARCODE_FORMATS = [
  "code_128",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "codabar",
];

const UpdateQcModal = ({ qc, onClose, onUpdated, isAdmin = false }) => {
  const user = getUserFromToken();
  const currentUserId = String(user?.id || user?._id || "").trim();
  const normalizedRole = normalizeUserRole(user?.role);
  const isActualAdmin = isAdminLikeRole(normalizedRole);
  const isQcUser = normalizedRole === "qc";
  const isManager = isManagerLikeRole(normalizedRole) && !isActualAdmin;
  const canRewriteLatestInspectionRecord = isActualAdmin || Boolean(isAdmin);
  const hasElevatedAccess = canRewriteLatestInspectionRecord || isManager;
  const canManageLabels = isManagerLikeRole(normalizedRole);
  const isCurrentUserLabelExempt =
    isActualAdmin || isLabelExemptUser(currentUserId);
  const todayIso = toISODateString(new Date());
  const updateQcPastDaysLimit = getUpdateQcPastDaysLimit({
    role: normalizedRole,
    userId: currentUserId,
  });
  const updateQcMinAllowedDateIso = (() => {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - updateQcPastDaysLimit);
    return toISODateString(minDate);
  })();


  const [form, setForm] = useState({
    inspector: "",
    qc_checked: "",
    qc_passed: "",
    offeredQuantity: "",
    barcode: "",
    inner_barcode: "",
    packed_size: false,
    finishing: false,
    branding: false,
    labelRanges: [createEmptyLabelRange()],
    remarks: "",
    inspected_weight_top_net: "",
    inspected_weight_top_gross: "",
    inspected_weight_bottom_net: "",
    inspected_weight_bottom_gross: "",
    inspected_weight_total_net: "",
    inspected_weight_total_gross: "",
    inspected_item_L: "",
    inspected_item_B: "",
    inspected_item_H: "",
    inspected_box_L: "",
    inspected_box_B: "",
    inspected_box_H: "",
    inspected_top_L: "",
    inspected_top_B: "",
    inspected_top_H: "",
    inspected_bottom_L: "",
    inspected_bottom_B: "",
    inspected_bottom_H: "",
    inspected_item_top_L: "",
    inspected_item_top_B: "",
    inspected_item_top_H: "",
    inspected_item_bottom_L: "",
    inspected_item_bottom_B: "",
    inspected_item_bottom_H: "",
    inspected_item_count: "1",
    inspected_box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
    inspected_box_count: "1",
    inspected_item_sizes: [createEmptyMeasuredSizeEntry()],
    inspected_box_sizes: [createEmptyMeasuredSizeEntry()],
    last_inspected_date: "",
  });
  const [inspectors, setInspectors] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false);
  const [barcodeScannerTarget, setBarcodeScannerTarget] = useState("barcode");
  const [barcodeScannerError, setBarcodeScannerError] = useState("");
  const [barcodeScannerStatus, setBarcodeScannerStatus] = useState("");
  const [barcodeScannedInSession, setBarcodeScannedInSession] = useState(false);
  const [innerBarcodeScannedInSession, setInnerBarcodeScannedInSession] = useState(false);
  const [barcodeUploadLoading, setBarcodeUploadLoading] = useState(false);
  const [barcodeUploadError, setBarcodeUploadError] = useState("");
  const [barcodeUploadStatus, setBarcodeUploadStatus] = useState("");
  const barcodeVideoRef = useRef(null);
  const barcodeStreamRef = useRef(null);
  const barcodeDetectorRef = useRef(null);
  const barcodeReaderRef = useRef(null);
  const barcodeReaderControlsRef = useRef(null);
  const barcodeUploadInputRef = useRef(null);
  const canEditLockedQcFields = canRewriteLatestInspectionRecord || isQcUser;
  const canEditLockedQcSizeFields =
    canRewriteLatestInspectionRecord || isQcUser || isManager;
  const lockBarcodeField =
    (qc?.master_barcode || qc?.barcode) > 0 && !canEditLockedQcFields;
  const lockInnerBarcodeField = qc?.inner_barcode > 0 && !canEditLockedQcFields;
  const latestInspectionRecord = getLatestInspectionRecord(qc);
  const latestRequestEntry = getLatestRequestEntry(qc);
  const qcUserRequestAvailability = useMemo(
    () => getQcUserUpdateRequestAvailability(qc, { currentUserId }),
    [qc, currentUserId],
  );
  const isQcUpdateBlockedByMissingRequest =
    isQcUser && !qcUserRequestAvailability.isAvailable;

  useEffect(() => {
    if (isQcUser) {
      setInspectors([]);
      return;
    }

    const fetchInspectors = async () => {
      try {
        const res = await api.get("/auth/?role=QC");
        setInspectors(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setInspectors([]);
      }
    };

    fetchInspectors();
  }, [isQcUser]);

  useEffect(() => {
    if (!qc) return;
    const assignedInspectorId = String(qc?.inspector?._id || qc?.inspector || "");
    const adminRecord = canRewriteLatestInspectionRecord ? latestInspectionRecord : null;
    const defaultInspectorId = String(
      adminRecord?.inspector?._id ||
        adminRecord?.inspector ||
        assignedInspectorId,
    );
    const initialLabelRanges = adminRecord
      ? getInitialLabelRanges(adminRecord)
      : [createEmptyLabelRange()];
    const initialRemarks =
      adminRecord?.remarks !== undefined
        ? String(adminRecord.remarks || "")
        : String(qc?.remarks || "");
    const itemMaster = qc?.item_master || {};
    const inspectedItemLbh = itemMaster?.inspected_item_LBH || itemMaster?.item_LBH || {};
    const inspectedBoxLbh = itemMaster?.inspected_box_LBH || itemMaster?.box_LBH || {};
    const inspectedTopLbh =
      itemMaster?.inspected_box_top_LBH
      || itemMaster?.inspected_top_LBH
      || {};
    const inspectedBottomLbh =
      itemMaster?.inspected_box_bottom_LBH
      || itemMaster?.inspected_bottom_LBH
      || {};
    const inspectedItemTopLbh = itemMaster?.inspected_item_top_LBH || {};
    const inspectedItemBottomLbh = itemMaster?.inspected_item_bottom_LBH || {};
    const inspectedWeight = itemMaster?.inspected_weight || {};
    const inspectedBoxMode = detectBoxPackagingMode(
      itemMaster?.inspected_box_mode,
      itemMaster?.inspected_box_sizes,
    );
    const strictInspectedItemLbh = toStrictLbhInputGroup(inspectedItemLbh);
    const strictInspectedBoxLbh = toStrictLbhInputGroup(inspectedBoxLbh);
    const strictInspectedTopLbh = toStrictLbhInputGroup(inspectedTopLbh);
    const strictInspectedBottomLbh = toStrictLbhInputGroup(inspectedBottomLbh);
    const strictInspectedItemTopLbh = toStrictLbhInputGroup(inspectedItemTopLbh);
    const strictInspectedItemBottomLbh = toStrictLbhInputGroup(inspectedItemBottomLbh);
    const inspectedItemSizeEntries = buildMeasuredSizeEntriesFromLegacy({
      primaryEntries: itemMaster?.inspected_item_sizes,
      singleLbh: inspectedItemLbh,
      topLbh: inspectedItemTopLbh,
      bottomLbh: inspectedItemBottomLbh,
      totalWeight: getWeightValueFromModel(inspectedWeight, "total_net"),
      topWeight: getWeightValueFromModel(inspectedWeight, "top_net"),
      bottomWeight: getWeightValueFromModel(inspectedWeight, "bottom_net"),
      weightKey: "net_weight",
      topRemark: "top",
      bottomRemark: "base",
    });
    const inspectedBoxSizeEntries = buildMeasuredSizeEntriesFromLegacy({
      primaryEntries: itemMaster?.inspected_box_sizes,
      mode: inspectedBoxMode,
      singleLbh: inspectedBoxLbh,
      topLbh: inspectedTopLbh,
      bottomLbh: inspectedBottomLbh,
      totalWeight: getWeightValueFromModel(inspectedWeight, "total_gross"),
      topWeight: getWeightValueFromModel(inspectedWeight, "top_gross"),
      bottomWeight: getWeightValueFromModel(inspectedWeight, "bottom_gross"),
      weightKey: "gross_weight",
      topRemark: "top",
      bottomRemark: "base",
    });
    const hasStoredInspectedItemSizes =
      Array.isArray(itemMaster?.inspected_item_sizes)
      && itemMaster.inspected_item_sizes.length > 0;
    const hasStoredInspectedBoxSizes =
      Array.isArray(itemMaster?.inspected_box_sizes)
      && itemMaster.inspected_box_sizes.length > 0;
    const initialInspectedItemCount = hasStoredInspectedItemSizes
      ? normalizeSizeCount(inspectedItemSizeEntries.length, 1)
      : 1;
    const initialInspectedBoxCount =
      inspectedBoxMode === BOX_PACKAGING_MODES.CARTON
        ? 2
        : hasStoredInspectedBoxSizes
          ? normalizeSizeCount(inspectedBoxSizeEntries.length, 1)
          : 1;

    setForm({
      inspector: defaultInspectorId,
      qc_checked: adminRecord ? toQuantityInputValue(adminRecord?.checked) : "",
      qc_passed: adminRecord ? toQuantityInputValue(adminRecord?.passed) : "",
      offeredQuantity: adminRecord
        ? toQuantityInputValue(adminRecord?.vendor_offered)
        : "",
      barcode:
        (qc?.master_barcode || qc?.barcode) > 0
          ? String(qc?.master_barcode || qc?.barcode)
          : "",
      inner_barcode: qc?.inner_barcode > 0 ? String(qc.inner_barcode) : "",
      packed_size: Boolean(qc?.packed_size),
      finishing: Boolean(qc?.finishing),
      branding: Boolean(qc?.branding),
      labelRanges: initialLabelRanges,
      remarks: canRewriteLatestInspectionRecord ? initialRemarks : "",
      inspected_weight_top_net: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "top_net"),
      ),
      inspected_weight_top_gross: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "top_gross"),
      ),
      inspected_weight_bottom_net: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "bottom_net"),
      ),
      inspected_weight_bottom_gross: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "bottom_gross"),
      ),
      inspected_weight_total_net: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "total_net"),
      ),
      inspected_weight_total_gross: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "total_gross"),
      ),
      inspected_item_L: strictInspectedItemLbh.L,
      inspected_item_B: strictInspectedItemLbh.B,
      inspected_item_H: strictInspectedItemLbh.H,
      inspected_box_L: strictInspectedBoxLbh.L,
      inspected_box_B: strictInspectedBoxLbh.B,
      inspected_box_H: strictInspectedBoxLbh.H,
      inspected_top_L: strictInspectedTopLbh.L,
      inspected_top_B: strictInspectedTopLbh.B,
      inspected_top_H: strictInspectedTopLbh.H,
      inspected_bottom_L: strictInspectedBottomLbh.L,
      inspected_bottom_B: strictInspectedBottomLbh.B,
      inspected_bottom_H: strictInspectedBottomLbh.H,
      inspected_item_top_L: strictInspectedItemTopLbh.L,
      inspected_item_top_B: strictInspectedItemTopLbh.B,
      inspected_item_top_H: strictInspectedItemTopLbh.H,
      inspected_item_bottom_L: strictInspectedItemBottomLbh.L,
      inspected_item_bottom_B: strictInspectedItemBottomLbh.B,
      inspected_item_bottom_H: strictInspectedItemBottomLbh.H,
      inspected_item_count: String(initialInspectedItemCount),
      inspected_box_mode: inspectedBoxMode,
      inspected_box_count: String(initialInspectedBoxCount),
      inspected_item_sizes: ensureMeasuredSizeEntryCount(
        inspectedItemSizeEntries,
        initialInspectedItemCount,
      ),
      inspected_box_sizes: ensureMeasuredSizeEntryCount(
        inspectedBoxSizeEntries,
        initialInspectedBoxCount,
        { mode: inspectedBoxMode },
      ),
      last_inspected_date: toDDMMYYYYInputValue(
        adminRecord?.inspection_date ||
          latestRequestEntry?.request_date ||
          qc.request_date ||
          qc.last_inspected_date,
        "",
      ),
    });
    setBarcodeScannedInSession(false);
    setInnerBarcodeScannedInSession(false);
    setBarcodeScannerStatus("");
    setBarcodeScannerError("");
    setBarcodeUploadLoading(false);
    setBarcodeUploadError("");
    setBarcodeUploadStatus("");
    setBarcodeScannerTarget("barcode");
    setBarcodeScannerOpen(false);
    if (barcodeUploadInputRef.current) {
      barcodeUploadInputRef.current.value = "";
    }
  }, [qc, canRewriteLatestInspectionRecord, latestInspectionRecord, latestRequestEntry]);

  useEffect(() => {
    const shouldCloseScanner =
      barcodeScannerOpen &&
      ((barcodeScannerTarget === "barcode" && lockBarcodeField) ||
        (barcodeScannerTarget === "inner_barcode" &&
          (lockInnerBarcodeField ||
            form.inspected_box_mode !== BOX_PACKAGING_MODES.CARTON)));

    if (shouldCloseScanner) {
      setBarcodeScannerOpen(false);
    }
  }, [
    lockBarcodeField,
    lockInnerBarcodeField,
    barcodeScannerOpen,
    barcodeScannerTarget,
    form.inspected_box_mode,
  ]);

  useEffect(() => {
    if (!barcodeScannerOpen) return undefined;

    const BarcodeDetectorApi = globalThis?.BarcodeDetector;
    const mediaDevices = globalThis?.navigator?.mediaDevices;
    let animationFrameId = null;
    let cancelled = false;

    const stopScannerResources = () => {
      if (animationFrameId) {
        globalThis.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      if (barcodeReaderControlsRef.current?.stop) {
        try {
          barcodeReaderControlsRef.current.stop();
        } catch {
          // No-op
        }
      }
      barcodeReaderControlsRef.current = null;

      if (barcodeReaderRef.current?.reset) {
        try {
          barcodeReaderRef.current.reset();
        } catch {
          // No-op
        }
      }
      barcodeReaderRef.current = null;

      if (barcodeStreamRef.current) {
        barcodeStreamRef.current.getTracks().forEach((track) => track.stop());
        barcodeStreamRef.current = null;
      }

      if (barcodeVideoRef.current) {
        const attachedStream = barcodeVideoRef.current.srcObject;
        if (attachedStream && typeof attachedStream.getTracks === "function") {
          attachedStream.getTracks().forEach((track) => track.stop());
        }
        barcodeVideoRef.current.srcObject = null;
      }

      barcodeDetectorRef.current = null;
    };

    const applyDetectedBarcode = (rawValue) => {
      const parsedNumericBarcode = String(rawValue || "").trim().replace(/\D/g, "");
      if (!parsedNumericBarcode) return false;

      setBarcodeUploadError("");
      setBarcodeUploadStatus("");
      setForm((prev) => ({
        ...prev,
        [barcodeScannerTarget]: parsedNumericBarcode,
      }));
      if (barcodeScannerTarget === "inner_barcode") {
        setInnerBarcodeScannedInSession(true);
        setBarcodeScannerStatus(`Inner barcode scanned: ${parsedNumericBarcode}`);
      } else {
        setBarcodeScannedInSession(true);
        setBarcodeScannerStatus(`Master barcode scanned: ${parsedNumericBarcode}`);
      }
      setBarcodeScannerOpen(false);
      return true;
    };

    const startNativeScanner = async () => {
      if (!BarcodeDetectorApi) {
        throw new Error("BarcodeDetector not available");
      }
      setBarcodeScannerError("");
      setBarcodeScannerStatus("Starting camera...");

      if (typeof BarcodeDetectorApi.getSupportedFormats === "function") {
        const supportedFormats = await BarcodeDetectorApi.getSupportedFormats();
        const usableFormats = PREFERRED_BARCODE_FORMATS.filter((format) =>
          supportedFormats.includes(format),
        );
        barcodeDetectorRef.current = usableFormats.length
          ? new BarcodeDetectorApi({ formats: usableFormats })
          : new BarcodeDetectorApi();
      } else {
        barcodeDetectorRef.current = new BarcodeDetectorApi();
      }

      const stream = await mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      barcodeStreamRef.current = stream;

      const videoElement = barcodeVideoRef.current;
      if (!videoElement) {
        throw new Error("Unable to start scanner preview.");
      }

      videoElement.srcObject = stream;
      await videoElement.play();
      setBarcodeScannerStatus("Scanning...");

      const scanFrame = async () => {
        if (cancelled) return;

        const detector = barcodeDetectorRef.current;
        const activeVideo = barcodeVideoRef.current;
        if (!detector || !activeVideo) {
          animationFrameId = globalThis.requestAnimationFrame(scanFrame);
          return;
        }

        try {
          const codes = await detector.detect(activeVideo);
          const rawValue = String(codes?.[0]?.rawValue || "").trim();
          if (applyDetectedBarcode(rawValue)) {
            return;
          }
        } catch {
          // Keep scanning frames; transient camera decode errors are expected.
        }

        animationFrameId = globalThis.requestAnimationFrame(scanFrame);
      };

      animationFrameId = globalThis.requestAnimationFrame(scanFrame);
    };

    const startZxingScanner = async () => {
      setBarcodeScannerError("");
      setBarcodeScannerStatus("Starting camera...");

      const { BrowserMultiFormatReader } = await import("@zxing/browser");

      if (cancelled) return;

      const videoElement = barcodeVideoRef.current;
      if (!videoElement) {
        throw new Error("Unable to start scanner preview.");
      }

      const reader = new BrowserMultiFormatReader();
      barcodeReaderRef.current = reader;

      setBarcodeScannerStatus("Scanning...");

      const controls = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
          },
          audio: false,
        },
        videoElement,
        (result, decodeError) => {
          if (cancelled) return;

          if (result) {
            const rawValue =
              typeof result.getText === "function"
                ? result.getText()
                : String(result?.text || "");
            if (applyDetectedBarcode(rawValue)) {
              return;
            }
          }

          if (decodeError && decodeError?.name !== "NotFoundException") {
            setBarcodeScannerStatus("Scanning...");
          }
        },
      );

      barcodeReaderControlsRef.current = controls;
    };

    const startScanner = async () => {
      if (!mediaDevices?.getUserMedia) {
        setBarcodeScannerError("Camera access is not available in this browser.");
        setBarcodeScannerStatus("");
        return;
      }

      try {
        if (BarcodeDetectorApi) {
          await startNativeScanner();
          return;
        }
      } catch {
        // Fall through to ZXing fallback.
      }

      try {
        await startZxingScanner();
      } catch (scannerError) {
        setBarcodeScannerError(
          scannerError?.message
            ? `Unable to start scanner: ${scannerError.message}`
            : "Unable to start scanner. Please allow camera access and retry. Use HTTPS/localhost.",
        );
        setBarcodeScannerStatus("");
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopScannerResources();
    };
  }, [barcodeScannerOpen, barcodeScannerTarget]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (isQcUser && (name === "barcode" || name === "inner_barcode")) {
      return;
    }

    if (NON_NEGATIVE_FIELDS.has(name) && value !== "") {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return;
      }
    }

    if (name === "barcode") {
      setBarcodeUploadError("");
      setBarcodeUploadStatus("");
    }

    setForm((prev) => {
      const nextValue = type === "checkbox" ? checked : value;

      if (name === "inspected_box_mode") {
        const nextMode = detectBoxPackagingMode(nextValue, prev.inspected_box_sizes);
        if (nextMode !== BOX_PACKAGING_MODES.CARTON) {
          setInnerBarcodeScannedInSession(false);
        }
        return {
          ...prev,
          inspected_box_mode: nextMode,
          inner_barcode:
            nextMode === BOX_PACKAGING_MODES.CARTON ? prev.inner_barcode : "",
          inspected_box_count:
            nextMode === BOX_PACKAGING_MODES.CARTON
              ? "2"
              : String(normalizeSizeCount(prev.inspected_box_count, 1)),
          inspected_box_sizes: ensureMeasuredSizeEntryCount(
            convertMeasuredBoxEntriesMode(prev.inspected_box_sizes, nextMode),
            nextMode === BOX_PACKAGING_MODES.CARTON ? 2 : prev.inspected_box_count,
            { mode: nextMode },
          ),
        };
      }

      if (name === "inspected_item_count" || name === "inspected_box_count") {
        const safeCount = String(normalizeSizeCount(nextValue, 1));
        const entriesKey =
          name === "inspected_item_count"
            ? "inspected_item_sizes"
            : "inspected_box_sizes";
        const modeOption =
          name === "inspected_box_count"
            ? { mode: prev.inspected_box_mode }
            : {};
        return {
          ...prev,
          [name]: safeCount,
          [entriesKey]: ensureMeasuredSizeEntryCount(prev[entriesKey], safeCount, modeOption),
        };
      }

      if (INSPECTED_WEIGHT_TOTAL_FORM_KEYS.includes(name)) {
        const hasTotalWeightValue = String(nextValue).trim() !== "";
        return {
          ...prev,
          [name]: nextValue,
          ...(hasTotalWeightValue
            ? buildClearedFormFields([
                ...INSPECTED_WEIGHT_TOP_FORM_KEYS,
                ...INSPECTED_WEIGHT_BOTTOM_FORM_KEYS,
              ])
            : {}),
        };
      }

      if (
        INSPECTED_WEIGHT_TOP_FORM_KEYS.includes(name) ||
        INSPECTED_WEIGHT_BOTTOM_FORM_KEYS.includes(name)
      ) {
        const hasSplitWeightValue = String(nextValue).trim() !== "";
        return {
          ...prev,
          [name]: nextValue,
          ...(hasSplitWeightValue
            ? buildClearedFormFields(INSPECTED_WEIGHT_TOTAL_FORM_KEYS)
            : {}),
        };
      }

      if (INSPECTED_ITEM_TOTAL_LBH_FORM_KEYS.includes(name)) {
        const hasTotalItemLbhValue = String(nextValue).trim() !== "";
        return {
          ...prev,
          [name]: nextValue,
          ...(hasTotalItemLbhValue
            ? buildClearedFormFields([
                ...INSPECTED_ITEM_TOP_LBH_FORM_KEYS,
                ...INSPECTED_ITEM_BOTTOM_LBH_FORM_KEYS,
              ])
            : {}),
        };
      }

      if (
        INSPECTED_ITEM_TOP_LBH_FORM_KEYS.includes(name) ||
        INSPECTED_ITEM_BOTTOM_LBH_FORM_KEYS.includes(name)
      ) {
        const hasSplitItemLbhValue = String(nextValue).trim() !== "";
        return {
          ...prev,
          [name]: nextValue,
          ...(hasSplitItemLbhValue
            ? buildClearedFormFields(INSPECTED_ITEM_TOTAL_LBH_FORM_KEYS)
            : {}),
        };
      }

      if (INSPECTED_BOX_TOTAL_LBH_FORM_KEYS.includes(name)) {
        const hasTotalBoxLbhValue = String(nextValue).trim() !== "";
        return {
          ...prev,
          [name]: nextValue,
          ...(hasTotalBoxLbhValue
            ? buildClearedFormFields([
                ...INSPECTED_BOX_TOP_LBH_FORM_KEYS,
                ...INSPECTED_BOX_BOTTOM_LBH_FORM_KEYS,
              ])
            : {}),
        };
      }

      if (
        INSPECTED_BOX_TOP_LBH_FORM_KEYS.includes(name) ||
        INSPECTED_BOX_BOTTOM_LBH_FORM_KEYS.includes(name)
      ) {
        const hasSplitBoxLbhValue = String(nextValue).trim() !== "";
        return {
          ...prev,
          [name]: nextValue,
          ...(hasSplitBoxLbhValue
            ? buildClearedFormFields(INSPECTED_BOX_TOTAL_LBH_FORM_KEYS)
            : {}),
        };
      }

      if (
        name.startsWith("inspected_item_")
        || name.startsWith("inspected_box_")
        || name.startsWith("inspected_top_")
        || name.startsWith("inspected_bottom_")
        || name.startsWith("inspected_item_top_")
        || name.startsWith("inspected_item_bottom_")
      ) {
        return {
          ...prev,
          [name]: nextValue,
        };
      }

      return {
        ...prev,
        [name]: nextValue,
      };
    });
  };

  const toggleBarcodeScanner = (targetField) => {
    setBarcodeScannerError("");
    setBarcodeScannerStatus("");
    if (barcodeScannerOpen && barcodeScannerTarget === targetField) {
      setBarcodeScannerOpen(false);
      return;
    }
    setBarcodeScannerTarget(targetField);
    setBarcodeScannerOpen(true);
  };

  const openBarcodeUploadDialog = () => {
    if (lockBarcodeField || barcodeUploadLoading) {
      return;
    }

    setBarcodeUploadError("");
    setBarcodeUploadStatus("");
    if (barcodeUploadInputRef.current) {
      barcodeUploadInputRef.current.click();
    }
  };

  const handleBarcodeUploadChange = async (event) => {
    const file = event?.target?.files?.[0];
    if (event?.target) {
      event.target.value = "";
    }

    if (!file) {
      return;
    }

    setBarcodeUploadError("");
    setBarcodeUploadStatus("Uploading barcode file...");
    setBarcodeUploadLoading(true);

    try {
      const response = await scanQcBarcodeFile(file);
      const scannedBarcode = String(response?.data?.barcode || "").trim();

      if (!scannedBarcode) {
        throw new Error("No barcode value was returned from the scan.");
      }

      setForm((prev) => ({
        ...prev,
        barcode: scannedBarcode,
      }));

      if (isQcUser) {
        setBarcodeScannedInSession(true);
      }

      setBarcodeScannerOpen(false);
      setBarcodeScannerError("");
      setBarcodeScannerStatus("");
      setBarcodeUploadStatus(`Barcode scanned: ${scannedBarcode}`);
    } catch (error) {
      setBarcodeUploadStatus("");
      setBarcodeUploadError(
        error?.response?.data?.message ||
          error?.response?.data?.details ||
          error?.message ||
          "Failed to scan barcode file.",
      );
    } finally {
      setBarcodeUploadLoading(false);
      if (barcodeUploadInputRef.current) {
        barcodeUploadInputRef.current.value = "";
      }
    }
  };

  const handleSizeEntryChange = (groupKey, index, field, value) => {
    if (field !== "remark" && value !== "") {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return;
      }
    }

    setForm((prev) => ({
      ...prev,
      [groupKey]: ensureMeasuredSizeEntryCount(
        prev[groupKey].map((entry, entryIndex) =>
          entryIndex === index
            ? {
                ...entry,
                [field]:
                  field === "remark"
                    ? String(value || "").trim().toLowerCase()
                    : value,
              }
            : entry,
        ),
        prev[groupKey]?.length || 1,
        groupKey === "inspected_box_sizes"
          ? { mode: prev.inspected_box_mode }
          : {},
      ),
    }));
  };

  const handleLabelRangeChange = (index, field, value) => {
    if (value !== "") {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return;
      }
    }

    setForm((prev) => ({
      ...prev,
      labelRanges: prev.labelRanges.map((range, rangeIndex) =>
        rangeIndex === index ? { ...range, [field]: value } : range,
      ),
    }));
  };

  const addLabelRange = () => {
    setForm((prev) => ({
      ...prev,
      labelRanges: [...prev.labelRanges, createEmptyLabelRange()],
    }));
  };

  const removeLabelRange = (index) => {
    setForm((prev) => {
      if (prev.labelRanges.length <= 1) {
        return { ...prev, labelRanges: [createEmptyLabelRange()] };
      }

      return {
        ...prev,
        labelRanges: prev.labelRanges.filter((_, rangeIndex) => rangeIndex !== index),
      };
    });
  };

  const parseLabelRanges = (ranges = []) => {
    const enteredRanges = ranges.filter((range) => {
      const hasStart = String(range?.start ?? "").trim() !== "";
      const hasEnd = String(range?.end ?? "").trim() !== "";
      return hasStart || hasEnd;
    });

    if (enteredRanges.length === 0) {
      return { ranges: [], labels: [] };
    }

    const labels = [];
    const normalizedRanges = [];

    for (let i = 0; i < enteredRanges.length; i++) {
      const range = enteredRanges[i];
      const hasStart = String(range.start ?? "").trim() !== "";
      const hasEnd = String(range.end ?? "").trim() !== "";

      if (!hasStart || !hasEnd) {
        return {
          error: `Both start and end are required for range ${i + 1}.`,
        };
      }

      const startNum = Number(range.start);
      const endNum = Number(range.end);

      if (!Number.isInteger(startNum) || !Number.isInteger(endNum)) {
        return {
          error: `Range ${i + 1} must use integer values.`,
        };
      }

      if (startNum < 0 || endNum < 0) {
        return {
          error: `Range ${i + 1} cannot contain negative values.`,
        };
      }

      if (startNum > endNum) {
        return {
          error: `Start label cannot be greater than end label in range ${i + 1}.`,
        };
      }

      normalizedRanges.push({ start: startNum, end: endNum });
      for (let label = startNum; label <= endNum; label++) {
        labels.push(label);
      }
    }

    return { ranges: normalizedRanges, labels };
  };

  const handleSubmit = async () => {
    if (!qc) return;
    setError("");

    if (isQcUpdateBlockedByMissingRequest) {
      setError(
        qcUserRequestAvailability.reason ||
          "A new QC request is required before QC can update this record.",
      );
      return;
    }

    const qcChecked = form.qc_checked === "" ? 0 : Number(form.qc_checked);
    const qcPassed = form.qc_passed === "" ? 0 : Number(form.qc_passed);
    const offeredQuantity =
      form.offeredQuantity === "" ? 0 : Number(form.offeredQuantity);

    if (
      [qcChecked, qcPassed, offeredQuantity].some((value) =>
        Number.isNaN(value),
      )
    ) {
      setError("QC quantities must be valid numbers.");
      return;
    }

    if (
      [qcChecked, qcPassed, offeredQuantity].some(
        (value) => value < 0,
      )
    ) {
      setError("QC quantities cannot be negative.");
      return;
    }

    const parsedLabelRangeData = parseLabelRanges(form.labelRanges);
    if (parsedLabelRangeData.error) {
      setError(parsedLabelRangeData.error);
      return;
    }
    const labels = parsedLabelRangeData.labels;
    const normalizedLabelRanges = parsedLabelRangeData.ranges;
    const labelsForUpdate = normalizeLabels(labels);
    const isAdminRewriteMode =
      canRewriteLatestInspectionRecord && Boolean(latestInspectionRecord?._id);
    const hasQuantityUpdate = isAdminRewriteMode
      ? qcChecked > 0 || qcPassed > 0 || offeredQuantity > 0
      : (
        form.qc_checked !== "" ||
        form.qc_passed !== "" ||
        form.offeredQuantity !== ""
      );
    const hasLabelUpdate =
      labelsForUpdate.length > 0 || normalizedLabelRanges.length > 0;
    const selectedInspectorId = String(form.inspector || "").trim();
    const currentInspectorId = String(
      qc?.inspector?._id || qc?.inspector || "",
    ).trim();
    const normalizedRemarks = String(form.remarks || "").trim();
    const clientDemandQuantity = Number(qc?.quantities?.client_demand || 0) || 0;
    const requestType = String(qc?.request_type || "").trim().toUpperCase();
    const inspectionRecords = Array.isArray(qc?.inspection_record)
      ? qc.inspection_record
      : [];
    const latestRequestEntry = getLatestRequestEntry(qc);
    const currentRequestInspectionRecord = resolveLatestInspectionRecordForRequestEntry(
      inspectionRecords,
      latestRequestEntry,
    );
    const requestedQuantityLimit = getLatestRequestedQuantity(qc);
    const aqlRequestedQuantity =
      requestedQuantityLimit > 0 ? requestedQuantityLimit : clientDemandQuantity;
    const currentRequestRequestedQuantity = Math.max(
      0,
      Number(
        currentRequestInspectionRecord?.vendor_requested ||
          latestRequestEntry?.quantity_requested ||
          requestedQuantityLimit ||
          aqlRequestedQuantity ||
          0,
      ) || 0,
    );
    const currentRequestCheckedBefore = Math.max(
      0,
      Number(currentRequestInspectionRecord?.checked || 0) || 0,
    );
    const currentRequestPassedBefore = Math.max(
      0,
      Number(currentRequestInspectionRecord?.passed || 0) || 0,
    );
    const currentRequestOfferedBefore = Math.max(
      0,
      Number(currentRequestInspectionRecord?.vendor_offered || 0) || 0,
    );
    const currentSamplePassedTotal = inspectionRecords.reduce(
      (sum, record) => sum + (Number(record?.passed || 0) || 0),
      0,
    );
    const currentEffectivePassedTotal = Math.max(
      0,
      Number(qc?.quantities?.qc_passed || 0) || 0,
    );
    const currentRequestEffectivePassedBefore = getEffectiveRequestPassedQuantity({
      requestType,
      samplePassed: currentRequestPassedBefore,
      requestedQuantity: currentRequestRequestedQuantity,
    });

    if ((qcPassed > 0 || hasLabelUpdate) && qcChecked <= 0) {
      setError("QC checked must be greater than 0 for updates.");
      return;
    }

    if (qcPassed > qcChecked && qcChecked > 0) {
      setError("Passed cannot exceed checked quantity.");
      return;
    }

    const existingItemMaster = qc?.item_master || {};
    const existingInspectedWeight = existingItemMaster?.inspected_weight || {};
    const existingInspectedBoxMode = detectBoxPackagingMode(
      existingItemMaster?.inspected_box_mode,
      existingItemMaster?.inspected_box_sizes,
    );
    const existingItemSizeEntries = buildMeasuredSizeEntriesFromLegacy({
      primaryEntries: existingItemMaster?.inspected_item_sizes,
      singleLbh: existingItemMaster?.inspected_item_LBH || existingItemMaster?.item_LBH,
      topLbh: existingItemMaster?.inspected_item_top_LBH,
      bottomLbh: existingItemMaster?.inspected_item_bottom_LBH,
      totalWeight: getWeightValueFromModel(existingInspectedWeight, "total_net"),
      topWeight: getWeightValueFromModel(existingInspectedWeight, "top_net"),
      bottomWeight: getWeightValueFromModel(existingInspectedWeight, "bottom_net"),
      weightKey: "net_weight",
      topRemark: "top",
      bottomRemark: "base",
    }).filter((entry) => hasMeaningfulMeasuredSize(entry));
    const existingBoxSizeEntries = buildMeasuredSizeEntriesFromLegacy({
      primaryEntries: existingItemMaster?.inspected_box_sizes,
      mode: existingInspectedBoxMode,
      singleLbh: existingItemMaster?.inspected_box_LBH || existingItemMaster?.box_LBH,
      topLbh:
        existingItemMaster?.inspected_box_top_LBH || existingItemMaster?.inspected_top_LBH,
      bottomLbh:
        existingItemMaster?.inspected_box_bottom_LBH || existingItemMaster?.inspected_bottom_LBH,
      totalWeight: getWeightValueFromModel(existingInspectedWeight, "total_gross"),
      topWeight: getWeightValueFromModel(existingInspectedWeight, "top_gross"),
      bottomWeight: getWeightValueFromModel(existingInspectedWeight, "bottom_gross"),
      weightKey: "gross_weight",
      topRemark: "top",
      bottomRemark: "base",
    }).filter((entry) => hasMeaningfulMeasuredSize(entry));
    const lockInspectedItemSection =
      !canEditLockedQcSizeFields && existingItemSizeEntries.length > 0;
    const lockInspectedBoxSection =
      !canEditLockedQcSizeFields && existingBoxSizeEntries.length > 0;
    const inspectedItemSizePayload = parseMeasuredSizeEntries({
      entries: form.inspected_item_sizes,
      count: form.inspected_item_count,
      groupLabel: "Inspected item size",
      remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
      payloadWeightKey: "net_weight",
      weightFieldLabel: "Net weight",
      treatEmptyAsInput: isAdminRewriteMode,
    });
    if (inspectedItemSizePayload.error) {
      setError(inspectedItemSizePayload.error);
      return;
    }

    const inspectedBoxSizePayload = parseMeasuredSizeEntries({
      entries: form.inspected_box_sizes,
      count: form.inspected_box_count,
      groupLabel: "Inspected box size",
      remarkOptions: BOX_SIZE_REMARK_OPTIONS,
      payloadWeightKey: "gross_weight",
      weightFieldLabel: "Gross weight",
      treatEmptyAsInput: isAdminRewriteMode,
      mode: form.inspected_box_mode,
    });
    if (inspectedBoxSizePayload.error) {
      setError(inspectedBoxSizePayload.error);
      return;
    }

    const itemLegacyValues = deriveLegacyFromMeasuredSizeEntries(
      inspectedItemSizePayload.value,
      {
        count: inspectedItemSizePayload.count,
        weightKey: "net_weight",
        remarkOrder: getRemarkValues(ITEM_SIZE_REMARK_OPTIONS),
      },
    );
    const boxLegacyValues = deriveLegacyFromMeasuredSizeEntries(
      inspectedBoxSizePayload.value,
      {
        count: inspectedBoxSizePayload.count,
        weightKey: "gross_weight",
        remarkOrder: getRemarkValues(BOX_SIZE_REMARK_OPTIONS),
        mode: inspectedBoxSizePayload.mode || form.inspected_box_mode,
      },
    );

    const inspectedItemLbh = {
      hasAnyInput: Boolean(itemLegacyValues.single),
      value: itemLegacyValues.single,
    };
    const inspectedItemTopLbh = {
      hasAnyInput: Boolean(itemLegacyValues.top),
      value: itemLegacyValues.top,
    };
    const inspectedItemBottomLbh = {
      hasAnyInput: Boolean(itemLegacyValues.bottom),
      value: itemLegacyValues.bottom,
    };
    const inspectedBoxLbh = {
      hasAnyInput: Boolean(boxLegacyValues.single),
      value: boxLegacyValues.single,
    };
    const inspectedTopLbh = {
      hasAnyInput: Boolean(boxLegacyValues.top),
      value: boxLegacyValues.top,
    };
    const inspectedBottomLbh = {
      hasAnyInput: Boolean(boxLegacyValues.bottom),
      value: boxLegacyValues.bottom,
    };
    const inspectedWeightInputs = {
      top_net: {
        hasAnyInput: itemLegacyValues.topWeight !== null,
        value: itemLegacyValues.topWeight,
      },
      bottom_net: {
        hasAnyInput: itemLegacyValues.bottomWeight !== null,
        value: itemLegacyValues.bottomWeight,
      },
      total_net: {
        hasAnyInput: itemLegacyValues.totalWeight !== null,
        value: itemLegacyValues.totalWeight,
      },
      top_gross: {
        hasAnyInput: boxLegacyValues.topWeight !== null,
        value: boxLegacyValues.topWeight,
      },
      bottom_gross: {
        hasAnyInput: boxLegacyValues.bottomWeight !== null,
        value: boxLegacyValues.bottomWeight,
      },
      total_gross: {
        hasAnyInput: boxLegacyValues.totalWeight !== null,
        value: boxLegacyValues.totalWeight,
      },
    };

    const lastInspectedDateValue = form.last_inspected_date.trim();
    const lastInspectedDateIso = toISODateString(lastInspectedDateValue);

    if (lastInspectedDateValue && (!isValidDDMMYYYY(lastInspectedDateValue) || !lastInspectedDateIso)) {
      setError("Last inspected date must be in DD/MM/YYYY format.");
      return;
    }
    if (
      isManager &&
      lastInspectedDateIso &&
      (
        lastInspectedDateIso < updateQcMinAllowedDateIso
        || lastInspectedDateIso > todayIso
      )
    ) {
      setError(buildUpdateQcPastDaysMessage(normalizedRole, updateQcPastDaysLimit));
      return;
    }
    if (isQcUser && lastInspectedDateIso) {
      const qcDateOffset = getUtcDayOffsetFromToday(lastInspectedDateIso);
      if (
        qcDateOffset === null
        || qcDateOffset < 0
        || qcDateOffset > updateQcPastDaysLimit
      ) {
        setError(buildUpdateQcPastDaysMessage(normalizedRole, updateQcPastDaysLimit));
        return;
      }
    }

    const existingBoxTopLbhForLabels =
      existingItemMaster?.inspected_box_top_LBH
      || existingItemMaster?.inspected_top_LBH
      || {};
    const existingBoxBottomLbhForLabels =
      existingItemMaster?.inspected_box_bottom_LBH
      || existingItemMaster?.inspected_bottom_LBH
      || {};
    const existingItemTopLbhForLabels =
      existingItemMaster?.inspected_item_top_LBH
      || {};
    const existingItemBottomLbhForLabels =
      existingItemMaster?.inspected_item_bottom_LBH
      || {};
    const currentBoxTopLbhForLabels = inspectedTopLbh.hasAnyInput
      ? (inspectedTopLbh.value || {})
      : existingBoxTopLbhForLabels;
    const currentBoxBottomLbhForLabels = inspectedBottomLbh.hasAnyInput
      ? (inspectedBottomLbh.value || {})
      : existingBoxBottomLbhForLabels;
    const currentItemTopLbhForLabels = inspectedItemTopLbh.hasAnyInput
      ? (inspectedItemTopLbh.value || {})
      : existingItemTopLbhForLabels;
    const currentItemBottomLbhForLabels = inspectedItemBottomLbh.hasAnyInput
      ? (inspectedItemBottomLbh.value || {})
      : existingItemBottomLbhForLabels;
    const hasTopBottomBoxLbhForLabels =
      hasCompletePositiveLbh(currentBoxTopLbhForLabels)
      && hasCompletePositiveLbh(currentBoxBottomLbhForLabels);
    const hasTopBottomItemLbhForLabels =
      hasCompletePositiveLbh(currentItemTopLbhForLabels)
      && hasCompletePositiveLbh(currentItemBottomLbhForLabels);
    const hasTopBottomLbh =
      hasTopBottomBoxLbhForLabels || hasTopBottomItemLbhForLabels;
    // Calculate size counts for label limit validation
    const boxSizesForLabelValidation = inspectedBoxSizePayload.hasAnyInput
      ? inspectedBoxSizePayload.value
      : existingBoxSizeEntries;
    const boxSizesCount = Array.isArray(boxSizesForLabelValidation)
      ? boxSizesForLabelValidation.length
      : 0;

    // Validate box sizes when labels are being added
    if (!isCurrentUserLabelExempt && hasLabelUpdate) {
      if (boxSizesCount === 0) {
        setError("At least 1 box size is required to add labels.");
        return;
      }
    }

    const isVisitUpdate = hasQuantityUpdate || hasLabelUpdate;
    if ((isVisitUpdate || isAdminRewriteMode) && !selectedInspectorId) {
      setError("Inspector is required for inspection updates.");
      return;
    }

    if ((isVisitUpdate || isAdminRewriteMode) && !lastInspectedDateValue) {
      setError("Last inspected date is required.");
      return;
    }

    const isCartonPackagingMode =
      form.inspected_box_mode === BOX_PACKAGING_MODES.CARTON;
    const barcodeValue = form.barcode.trim();
    const innerBarcodeValue = isCartonPackagingMode
      ? form.inner_barcode.trim()
      : "";
    const currentMasterBarcodeValue = Number(qc?.master_barcode || qc?.barcode || 0);
    const currentInnerBarcodeValue = Number(qc?.inner_barcode || 0);
    const barcodeParsed = barcodeValue === "" ? null : Number(barcodeValue);
    const innerBarcodeParsed =
      innerBarcodeValue === "" ? null : Number(innerBarcodeValue);
    const effectiveMasterBarcodeValue =
      barcodeParsed !== null ? barcodeParsed : currentMasterBarcodeValue;
    const effectiveInnerBarcodeValue =
      innerBarcodeParsed !== null ? innerBarcodeParsed : currentInnerBarcodeValue;

    if (
      barcodeParsed !== null &&
      (!Number.isInteger(barcodeParsed) || barcodeParsed <= 0)
    ) {
      setError("Master barcode must be a positive integer.");
      return;
    }

    if (
      innerBarcodeParsed !== null &&
      (!Number.isInteger(innerBarcodeParsed) || innerBarcodeParsed <= 0)
    ) {
      setError("Inner carton barcode must be a positive integer.");
      return;
    }

    if (isQcUser && (!Number.isInteger(effectiveMasterBarcodeValue) || effectiveMasterBarcodeValue <= 0)) {
      setError("QC users must scan the master barcode before updating this QC record.");
      return;
    }

    if (
      isQcUser &&
      isCartonPackagingMode &&
      (!Number.isInteger(effectiveInnerBarcodeValue) || effectiveInnerBarcodeValue <= 0)
    ) {
      setError("QC users must scan the inner carton barcode before updating this QC record.");
      return;
    }

    const buildQcPayload = () => {
      const shouldSendAdminItemMasterFields =
        isAdminRewriteMode && Boolean(qc?.item_master?._id);
      const payload = isAdminRewriteMode
        ? {
            admin_rewrite_latest_record: true,
            remarks: normalizedRemarks,
            packed_size: Boolean(form.packed_size),
            finishing: Boolean(form.finishing),
            branding: Boolean(form.branding),
            last_inspected_date: lastInspectedDateIso,
          }
        : {
            remarks: normalizedRemarks || undefined,
          };

      if (!isAdminRewriteMode) {
        if (form.qc_checked !== "") payload.qc_checked = qcChecked;
        if (form.qc_passed !== "") payload.qc_passed = qcPassed;
        if (form.offeredQuantity !== "") payload.vendor_provision = offeredQuantity;
        if (labelsForUpdate.length > 0) {
          payload.labels = labelsForUpdate;
        }
        if (normalizedLabelRanges.length > 0) {
          payload.label_ranges = normalizedLabelRanges;
        }
      }

      if (
        selectedInspectorId &&
        (isAdminRewriteMode || selectedInspectorId !== currentInspectorId)
      ) {
        payload.inspector = selectedInspectorId;
      }



      if (isAdminRewriteMode) {
        payload.barcode = barcodeParsed ?? 0;
        payload.master_barcode = barcodeParsed ?? 0;
        if (isCartonPackagingMode) {
          payload.inner_barcode = innerBarcodeParsed ?? 0;
        }
      } else if (barcodeParsed !== null && barcodeParsed !== currentMasterBarcodeValue) {
        payload.barcode = barcodeParsed;
        payload.master_barcode = barcodeParsed;
        if (isQcUser) {
          payload.barcode_scanned = barcodeScannedInSession;
        }
      }

      if (
        isCartonPackagingMode &&
        innerBarcodeParsed !== null &&
        innerBarcodeParsed !== currentInnerBarcodeValue
      ) {
        payload.inner_barcode = innerBarcodeParsed;
        if (isQcUser) {
          payload.inner_barcode_scanned = innerBarcodeScannedInSession;
        }
      }

      if (lastInspectedDateValue && !isAdminRewriteMode) {
        payload.last_inspected_date = lastInspectedDateIso;
      }

      const shouldSendItemSizeFields =
        shouldSendAdminItemMasterFields ||
        (!lockInspectedItemSection && inspectedItemSizePayload.hasAnyInput);
      const shouldSendBoxSizeFields =
        shouldSendAdminItemMasterFields ||
        (!lockInspectedBoxSection && inspectedBoxSizePayload.hasAnyInput);

      if (shouldSendItemSizeFields) {
        payload.inspected_item_sizes = inspectedItemSizePayload.value;
      }

      if (shouldSendBoxSizeFields) {
        payload.inspected_box_mode = form.inspected_box_mode;
        payload.inspected_box_sizes = inspectedBoxSizePayload.value;
      }

      if (!isAdminRewriteMode) {
        if (Boolean(qc?.packed_size) !== Boolean(form.packed_size)) {
          payload.packed_size = Boolean(form.packed_size);
        }
        if (Boolean(qc?.finishing) !== Boolean(form.finishing)) {
          payload.finishing = Boolean(form.finishing);
        }
        if (Boolean(qc?.branding) !== Boolean(form.branding)) {
          payload.branding = Boolean(form.branding);
        }
      }

      return payload;
    };

    if (isAdminRewriteMode) {
      const rewriteTargetRecord = currentRequestInspectionRecord || latestInspectionRecord;
      if (!rewriteTargetRecord?._id) {
        setError("Latest inspection record could not be resolved for rewrite.");
        return;
      }
      const otherInspectionRecords = (Array.isArray(qc?.inspection_record)
        ? qc.inspection_record
        : []
      ).filter(
        (record) =>
          String(record?._id || "") !== String(rewriteTargetRecord?._id || ""),
      );
      const otherChecked = otherInspectionRecords.reduce(
        (sum, record) => sum + (Number(record?.checked || 0) || 0),
        0,
      );
      const otherPassed = otherInspectionRecords.reduce(
        (sum, record) => sum + (Number(record?.passed || 0) || 0),
        0,
      );
      const otherEffectivePassed = Math.max(
        0,
        currentEffectivePassedTotal - currentRequestEffectivePassedBefore,
      );
      const otherOffered = otherInspectionRecords.reduce(
        (sum, record) => sum + (Number(record?.vendor_offered || 0) || 0),
        0,
      );
      const otherLabels = normalizeLabels(
        otherInspectionRecords.flatMap((record) =>
          Array.isArray(record?.labels_added) ? record.labels_added : [],
        ),
      );
      const allLabelsAfterRewrite = normalizeLabels([
        ...otherLabels,
        ...labelsForUpdate,
      ]);
      const rawTotalOfferedAfterRewrite = otherOffered + offeredQuantity;
      const totalCheckedAfterRewrite = otherChecked + qcChecked;
      const totalOfferedAfterRewrite = rawTotalOfferedAfterRewrite;
      const totalSamplePassedAfterRewrite = otherPassed + qcPassed;
      const currentRequestEffectivePassedAfterRewrite = getEffectiveRequestPassedQuantity({
        requestType,
        samplePassed: qcPassed,
        requestedQuantity: currentRequestRequestedQuantity,
      });
      const totalEffectivePassedAfterRewrite =
        otherEffectivePassed + currentRequestEffectivePassedAfterRewrite;
      const rewriteRecordLabelsAfter = normalizeLabels(labelsForUpdate);
      const requiredLabelsAfterRewrite = getQcLabelRequirement({
        totalPassed: qcPassed,
        boxSizesCount,
      }).requiredCount;
      const requiresBoxSizeForLabelsAfterRewrite =
        qcPassed > 0 || rewriteRecordLabelsAfter.length > 0;
      const pendingAfterRewrite = Math.max(
        0,
        clientDemandQuantity - totalEffectivePassedAfterRewrite,
      );
      const requestedDateIso = toISODateString(
        rewriteTargetRecord?.requested_date ||
          rewriteTargetRecord?.request_date ||
          qc?.request_date ||
          lastInspectedDateIso,
      );

      if (!requestedDateIso) {
        setError("Requested date is missing on the latest inspection record.");
        return;
      }

      if (totalCheckedAfterRewrite > totalOfferedAfterRewrite) {
        setError("QC checked cannot exceed offered quantity.");
        return;
      }

      if (totalSamplePassedAfterRewrite > totalOfferedAfterRewrite) {
        setError("Passed quantity cannot exceed offered quantity.");
        return;
      }

      if (
        !isCurrentUserLabelExempt &&
        requiresBoxSizeForLabelsAfterRewrite &&
        boxSizesCount === 0
      ) {
        setError("At least 1 box size is required to validate labels.");
        return;
      }

      if (
        !isCurrentUserLabelExempt &&
        rewriteRecordLabelsAfter.length !== requiredLabelsAfterRewrite
      ) {
        setError(
          buildQcLabelRequirementMessage({
            totalPassed: qcPassed,
            boxSizesCount,
            actualCount: rewriteRecordLabelsAfter.length,
          }),
        );
        return;
      }

      const qcPayload = buildQcPayload();
      qcPayload.vendor_provision = totalOfferedAfterRewrite;
      qcPayload.qc_checked = totalCheckedAfterRewrite;
      qcPayload.qc_passed = totalSamplePassedAfterRewrite;
      qcPayload.labels = allLabelsAfterRewrite;

      try {
        setSaving(true);
        const qcResponse = await api.patch(`/qc/update-qc/${qc._id}`, qcPayload);
        const updatedQc = qcResponse?.data?.data || qc;
        await api.patch(`/qc/${qc._id}/inspection-records`, {
          records: [
            {
              _id: rewriteTargetRecord._id,
              requested_date: requestedDateIso,
              inspection_date: lastInspectedDateIso,
              inspector: selectedInspectorId,
              vendor_requested:
                Number(rewriteTargetRecord?.vendor_requested || 0)
                || requestedQuantityLimit
                || aqlRequestedQuantity
                || 0,
              vendor_offered: offeredQuantity,
              checked: qcChecked,
              passed: qcPassed,
              pending_after: pendingAfterRewrite,
              cbm: {
                box1: Number(updatedQc?.cbm?.box1 ?? updatedQc?.cbm?.top ?? 0) || 0,
                box2: Number(updatedQc?.cbm?.box2 ?? updatedQc?.cbm?.bottom ?? 0) || 0,
                box3: Number(updatedQc?.cbm?.box3 ?? 0) || 0,
                total: Number(updatedQc?.cbm?.total ?? 0) || 0,
              },
              label_ranges: normalizedLabelRanges,
              labels_added: labelsForUpdate,
              remarks: normalizedRemarks,
            },
          ],
        });
        alert("QC updated successfully.");
        onUpdated?.();
        onClose();
      } catch (err) {
        setError(err.response?.data?.message || "Failed to update QC record.");
      } finally {
        setSaving(false);
      }
      return;
    }

    const rawNextNetOffered =
      (qc.quantities?.vendor_provision || 0) + offeredQuantity;
    const totalOfferedNext = rawNextNetOffered;
    const nextChecked = (qc.quantities?.qc_checked || 0) + qcChecked;
    const nextCurrentRequestChecked =
      currentRequestCheckedBefore + qcChecked;
    const nextCurrentRequestSamplePassed =
      currentRequestPassedBefore + qcPassed;
    const nextCurrentRequestOffered =
      currentRequestOfferedBefore + offeredQuantity;
    const nextSamplePassedTotal = currentSamplePassedTotal + qcPassed;
    const existingLabelsSet = new Set(normalizeLabels(qc?.labels));
    const incomingNewLabels = labelsForUpdate.filter(
      (label) => !existingLabelsSet.has(label),
    );
    const currentRequestLabelsBefore = normalizeLabels(
      currentRequestInspectionRecord?.labels_added || [],
    );
    const currentRequestLabelsAfterUpdate = normalizeLabels([
      ...currentRequestLabelsBefore,
      ...incomingNewLabels,
    ]);
    if (totalOfferedNext < 0) {
      setError("Offered quantity cannot be negative.");
      return;
    }

    if (nextCurrentRequestChecked > nextCurrentRequestOffered) {
      setError("QC checked cannot exceed offered quantity.");
      return;
    }

    if (nextCurrentRequestSamplePassed > nextCurrentRequestChecked) {
      setError("Passed cannot exceed checked quantity.");
      return;
    }

    if (nextCurrentRequestSamplePassed > nextCurrentRequestOffered) {
      setError("Passed quantity cannot exceed offered quantity.");
      return;
    }

    const requiredLabelsAfterUpdate = getQcLabelRequirement({
      totalPassed: nextCurrentRequestSamplePassed,
      boxSizesCount,
    }).requiredCount;
    const requiresBoxSizeForLabels =
      nextCurrentRequestSamplePassed > 0 || currentRequestLabelsAfterUpdate.length > 0;

    if (
      !isCurrentUserLabelExempt &&
      requiresBoxSizeForLabels &&
      boxSizesCount === 0
    ) {
      setError("At least 1 box size is required to validate labels.");
      return;
    }

    if (
      !isCurrentUserLabelExempt &&
      currentRequestLabelsAfterUpdate.length !== requiredLabelsAfterUpdate
    ) {
      setError(
        buildQcLabelRequirementMessage({
          totalPassed: nextCurrentRequestSamplePassed,
          boxSizesCount,
          actualCount: currentRequestLabelsAfterUpdate.length,
        }),
      );
      return;
    }

    const payload = buildQcPayload();

    try {
      setSaving(true);
      await api.patch(`/qc/update-qc/${qc._id}`, payload);
      alert("QC updated successfully.");
      onUpdated?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update QC record.");
    } finally {
      setSaving(false);
    }
  };

  if (!qc) return null;
  const requestedInspectorId = String(qc?.inspector?._id || qc?.inspector || "").trim();
  const requestedInspectorName = String(
    qc?.inspector?.name
      || (
        requestedInspectorId
        && requestedInspectorId === currentUserId
        && user?.name
      )
      || "",
  ).trim();
  const disableInspectorSelection =
    isQcUser || (!hasElevatedAccess && (qc?.quantities?.qc_checked || 0) > 0);
  const existingItemMaster = qc?.item_master || {};
  const existingInspectedWeight = existingItemMaster?.inspected_weight || {};
  const existingInspectedBoxMode = detectBoxPackagingMode(
    existingItemMaster?.inspected_box_mode,
    existingItemMaster?.inspected_box_sizes,
  );
  const existingItemSizeEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: existingItemMaster?.inspected_item_sizes,
    singleLbh: existingItemMaster?.inspected_item_LBH || existingItemMaster?.item_LBH,
    topLbh: existingItemMaster?.inspected_item_top_LBH,
    bottomLbh: existingItemMaster?.inspected_item_bottom_LBH,
    totalWeight: getWeightValueFromModel(existingInspectedWeight, "total_net"),
    topWeight: getWeightValueFromModel(existingInspectedWeight, "top_net"),
    bottomWeight: getWeightValueFromModel(existingInspectedWeight, "bottom_net"),
    weightKey: "net_weight",
    topRemark: "top",
    bottomRemark: "base",
  }).filter((entry) => hasMeaningfulMeasuredSize(entry));
  const existingBoxSizeEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: existingItemMaster?.inspected_box_sizes,
    mode: existingInspectedBoxMode,
    singleLbh: existingItemMaster?.inspected_box_LBH || existingItemMaster?.box_LBH,
    topLbh:
      existingItemMaster?.inspected_box_top_LBH || existingItemMaster?.inspected_top_LBH,
    bottomLbh:
      existingItemMaster?.inspected_box_bottom_LBH || existingItemMaster?.inspected_bottom_LBH,
    totalWeight: getWeightValueFromModel(existingInspectedWeight, "total_gross"),
    topWeight: getWeightValueFromModel(existingInspectedWeight, "top_gross"),
    bottomWeight: getWeightValueFromModel(existingInspectedWeight, "bottom_gross"),
    weightKey: "gross_weight",
    topRemark: "top",
    bottomRemark: "base",
  }).filter((entry) => hasMeaningfulMeasuredSize(entry));
  const lockInspectedItemSection =
    !canEditLockedQcSizeFields && existingItemSizeEntries.length > 0;
  const lockInspectedBoxSection =
    !canEditLockedQcSizeFields && existingBoxSizeEntries.length > 0;
  const hasLockedInspectedWeight = lockInspectedItemSection || lockInspectedBoxSection;
  const hasAnyLockedInspectedLbh = hasLockedInspectedWeight;
  const displayedItemEntries = ensureMeasuredSizeEntryCount(
    form.inspected_item_sizes,
    form.inspected_item_count,
  );
  const displayedBoxEntries = ensureMeasuredSizeEntryCount(
    form.inspected_box_sizes,
    form.inspected_box_count,
    { mode: form.inspected_box_mode },
  );
  const renderMeasuredSizeSection = ({
    title,
    countName,
    countValue,
    entriesKey,
    entries,
    remarkOptions,
    weightLabel,
    locked,
    countLabel,
    mode = BOX_PACKAGING_MODES.INDIVIDUAL,
    modeName = "",
    showModeSelector = false,
  }) => {
    const isCartonMode = mode === BOX_PACKAGING_MODES.CARTON;
    const safeCount = isCartonMode ? 2 : normalizeSizeCount(countValue, 1);
    const entryColumnClass = safeCount > 1 ? "col-md-2" : "col-md-3";

    return (
      <>
        <div className="col-md-2">
          {showModeSelector ? (
            <>
              <label className="form-label">Packaging Mode</label>
              <select
                className="form-select"
                name={modeName}
                value={mode}
                onChange={handleChange}
                disabled={locked}
              >
                <option value={BOX_PACKAGING_MODES.INDIVIDUAL}>Individual Boxes</option>
                <option value={BOX_PACKAGING_MODES.CARTON}>Inner + Master Carton</option>
              </select>
            </>
          ) : (
            <>
              <label className="form-label">{countLabel}</label>
              <select
                className="form-select"
                name={countName}
                value={String(safeCount)}
                onChange={handleChange}
                disabled={locked}
              >
                {SIZE_COUNT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </>
          )}
          {showModeSelector && countName && (
            <>
              <label className="form-label mt-3">{countLabel}</label>
              {isCartonMode ? (
                <input
                  type="text"
                  className="form-control"
                  value="2"
                  disabled
                  readOnly
                />
              ) : (
                <select
                  className="form-select"
                  name={countName}
                  value={String(safeCount)}
                  onChange={handleChange}
                  disabled={locked}
                >
                  {SIZE_COUNT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
        <div className="col-md-10">
          <label className="form-label">{title}</label>
          <div className="d-grid gap-2">
            {entries.slice(0, safeCount).map((entry, index) => (
              <div key={`${entriesKey}-${index}`} className="border rounded p-3">
                <div className="small text-secondary mb-2">
                  {isCartonMode
                    ? index === 0
                      ? "Inner carton"
                      : "Master carton"
                    : safeCount === 1
                    ? "Single entry"
                    : `Entry ${index + 1}${entry.remark ? ` | ${getRemarkLabel(remarkOptions, entry.remark)}` : ""}`}
                </div>
                <div className="row g-2">
                  {safeCount > 1 && (
                    <div className="col-md-3">
                      <label className="form-label small text-secondary">Remark</label>
                      {isCartonMode ? (
                        <input
                          type="text"
                          className="form-control"
                          value={getRemarkLabel(remarkOptions, entry.remark)}
                          disabled
                          readOnly
                        />
                      ) : (
                        <select
                          className="form-select"
                          value={entry.remark}
                          onChange={(event) =>
                            handleSizeEntryChange(
                              entriesKey,
                              index,
                              "remark",
                              event.target.value,
                            )
                          }
                          disabled={locked}
                        >
                          <option value="">Select remark</option>
                          {remarkOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  <div className={entryColumnClass}>
                    <label className="form-label small text-secondary">L</label>
                    <input
                      type="number"
                      className="form-control"
                      value={entry.L}
                      onChange={(event) =>
                        handleSizeEntryChange(entriesKey, index, "L", event.target.value)
                      }
                      min="0"
                      step="any"
                      disabled={locked}
                    />
                  </div>
                  <div className={entryColumnClass}>
                    <label className="form-label small text-secondary">B</label>
                    <input
                      type="number"
                      className="form-control"
                      value={entry.B}
                      onChange={(event) =>
                        handleSizeEntryChange(entriesKey, index, "B", event.target.value)
                      }
                      min="0"
                      step="any"
                      disabled={locked}
                    />
                  </div>
                  <div className={entryColumnClass}>
                    <label className="form-label small text-secondary">H</label>
                    <input
                      type="number"
                      className="form-control"
                      value={entry.H}
                      onChange={(event) =>
                        handleSizeEntryChange(entriesKey, index, "H", event.target.value)
                      }
                      min="0"
                      step="any"
                      disabled={locked}
                    />
                  </div>
                  <div className={safeCount > 1 ? "col-md-3" : "col-md-3"}>
                    <label className="form-label small text-secondary">{weightLabel}</label>
                    <input
                      type="number"
                      className="form-control"
                      value={entry.weight}
                      onChange={(event) =>
                        handleSizeEntryChange(entriesKey, index, "weight", event.target.value)
                      }
                      min="0"
                      step="any"
                      disabled={locked}
                    />
                  </div>
                  {isCartonMode && index === 0 && (
                    <div className="col-md-3">
                      <label className="form-label small text-secondary">Item Count In Inner</label>
                      <input
                        type="number"
                        className="form-control"
                        value={entry.item_count_in_inner}
                        onChange={(event) =>
                          handleSizeEntryChange(
                            entriesKey,
                            index,
                            "item_count_in_inner",
                            event.target.value,
                          )
                        }
                        min="0"
                        step="1"
                        disabled={locked}
                      />
                    </div>
                  )}
                  {isCartonMode && index === 1 && (
                    <div className="col-md-3">
                      <label className="form-label small text-secondary">Box Count In Master</label>
                      <input
                        type="number"
                        className="form-control"
                        value={entry.box_count_in_master}
                        onChange={(event) =>
                          handleSizeEntryChange(
                            entriesKey,
                            index,
                            "box_count_in_master",
                            event.target.value,
                          )
                        }
                        min="0"
                        step="1"
                        disabled={locked}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {safeCount === 1 && !isCartonMode && (
            <div className="small text-secondary mt-2">
              Single-entry measurements do not use remarks.
            </div>
          )}
          {isCartonMode && (
            <div className="small text-secondary mt-2">
              Master carton CBM is treated as the final effective box CBM.
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div
      className="modal d-block om-modal-backdrop"
      tabIndex="-1"
      role="dialog"
    >
      <div
        className="modal-dialog modal-dialog-centered modal-xl"
        role="document"
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Update QC Record</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
            />
          </div>

          <div style={{ marginBottom: "30px"}} className="modal-body d-grid gap-3">
            <div className="row g-3 qc-modal-summary-row">
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Order ID</div>
                <div className="fw-semibold">{qc.order?.order_id || "N/A"}</div>
              </div>
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Item</div>
                <div className="fw-semibold">{qc.item?.item_code || "N/A"}</div>
              </div>
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Order Quantity</div>
                <div className="fw-semibold">
                  {qc.quantities?.client_demand ?? "N/A"}
                </div>
              </div>
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Requested Quantity</div>
                <div className="fw-semibold">
                  {qc.quantities?.quantity_requested ?? "N/A"}
                </div>
              </div>
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Passed</div>
                <div className="fw-semibold">
                  {qc.quantities?.qc_passed ?? "N/A"}
                </div>
              </div>

              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Pending</div>
                <div className="fw-semibold">
                  {qc.quantities?.pending ?? "N/A"}
                </div>
              </div>
            </div>

            {canRewriteLatestInspectionRecord && latestInspectionRecord && (
              <div className="small text-secondary">
                Admin updates rewrite the latest inspection record and sync the QC totals.
              </div>
            )}

            {isQcUpdateBlockedByMissingRequest && (
              <div className="alert alert-warning mb-0">
                {qcUserRequestAvailability.reason ||
                  "A new QC request is required before QC can update this record."}
              </div>
            )}

            <div className="row g-3">
              <div className="col-md-12">
                <label className="form-label">QC Inspector</label>
                {isQcUser ? (
                  <input
                    type="text"
                    className="form-control"
                    value={requestedInspectorName || "N/A"}
                    disabled
                    readOnly
                  />
                ) : (
                  <select
                    className="form-select"
                    name="inspector"
                    value={form.inspector}
                    onChange={handleChange}
                    disabled={disableInspectorSelection}
                  >
                    <option value="">Select Inspector</option>
                    {inspectors.map((qcInspector) => (
                      <option key={qcInspector._id} value={qcInspector._id}>
                        {qcInspector.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="col-12">
                <h6 className="mb-0">Inspected Measurements</h6>
              </div>

              {hasAnyLockedInspectedLbh && !canEditLockedQcSizeFields && (
                <div className="col-12">
                  <div className="small text-secondary">
                    Existing inspected measurement entries are locked after first update.
                  </div>
                </div>
              )}

              {renderMeasuredSizeSection({
                title: "Inspected Item Sizes (cm) and Net Weight",
                countName: "inspected_item_count",
                countValue: form.inspected_item_count,
                entriesKey: "inspected_item_sizes",
                entries: displayedItemEntries,
                remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
                weightLabel: "Net Weight",
                locked: lockInspectedItemSection,
                countLabel: "Item Sets",
              })}

              {renderMeasuredSizeSection({
                title: "Inspected Box Sizes (cm) and Gross Weight",
                countName: "inspected_box_count",
                countValue: form.inspected_box_count,
                entriesKey: "inspected_box_sizes",
                entries: displayedBoxEntries,
                remarkOptions:
                  form.inspected_box_mode === BOX_PACKAGING_MODES.CARTON
                    ? BOX_CARTON_REMARK_OPTIONS
                    : BOX_SIZE_REMARK_OPTIONS,
                weightLabel: "Gross Weight",
                locked: lockInspectedBoxSection,
                countLabel: "Box Sets",
                mode: form.inspected_box_mode,
                modeName: "inspected_box_mode",
                showModeSelector: true,
              })}

              <div className="col-md-6">
                <label className="form-label">Last Inspected Date</label>
                <input
                  type="date"
                  lang="en-GB"
                  className="form-control"
                  name="last_inspected_date"
                  value={toISODateString(form.last_inspected_date)}
                  min={(isManager || isQcUser) ? updateQcMinAllowedDateIso : undefined}
                  max={(isManager || isQcUser) ? todayIso : undefined}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      last_inspected_date: toDDMMYYYYInputValue(e.target.value, ""),
                    }))
                  }
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">
                  {form.inspected_box_mode === BOX_PACKAGING_MODES.CARTON
                    ? "Master Carton Barcode"
                    : "Barcode"}
                </label>
                <div className="d-flex flex-wrap gap-2 align-items-stretch">
                  <div className="input-group flex-grow-1">
                    <input
                      type="number"
                      className="form-control"
                      name="barcode"
                      value={form.barcode}
                      onChange={handleChange}
                      min="1"
                      step="1"
                      disabled={lockBarcodeField}
                      readOnly={isQcUser}
                      placeholder={
                        lockBarcodeField
                          ? "Already set"
                          : isQcUser
                            ? "Scan master barcode"
                            : "Enter master barcode"
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => toggleBarcodeScanner("barcode")}
                      disabled={lockBarcodeField}
                    >
                      {barcodeScannerOpen && barcodeScannerTarget === "barcode"
                        ? "Stop Scan"
                        : "Scan"}
                    </button>
                  </div>
                  {isCurrentUserLabelExempt && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary flex-shrink-0"
                      onClick={openBarcodeUploadDialog}
                      disabled={lockBarcodeField || barcodeUploadLoading}
                    >
                      {barcodeUploadLoading ? "Uploading..." : "Upload Barcode"}
                    </button>
                  )}
                </div>
                <input
                  ref={barcodeUploadInputRef}
                  type="file"
                  className="d-none"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/*,application/pdf"
                  onChange={handleBarcodeUploadChange}
                />
                {barcodeScannerOpen && barcodeScannerTarget === "barcode" && (
                  <div className="border rounded p-2 mt-2">
                    <video
                      ref={barcodeVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-100 rounded"
                      style={{ maxHeight: "240px", objectFit: "cover", background: "#111827" }}
                    />
                    {barcodeScannerStatus && (
                      <div className="small text-muted mt-2">{barcodeScannerStatus}</div>
                    )}
                    {barcodeScannerError && (
                      <div className="small text-danger mt-1">{barcodeScannerError}</div>
                    )}
                  </div>
                )}
                {isQcUser && !lockBarcodeField && (
                  <div className="small text-secondary mt-2">
                    QC users must scan the master barcode before saving.
                  </div>
                )}
                {isCurrentUserLabelExempt && (
                  <div className="small text-secondary mt-1">
                    Upload a barcode photo or PDF to auto-fill the master barcode.
                  </div>
                )}
                {barcodeUploadStatus && (
                  <div className="small text-success mt-1">{barcodeUploadStatus}</div>
                )}
                {barcodeUploadError && (
                  <div className="small text-danger mt-1">{barcodeUploadError}</div>
                )}
              </div>
              {form.inspected_box_mode === BOX_PACKAGING_MODES.CARTON && (
                <div className="col-md-6">
                  <label className="form-label">Inner Carton Barcode</label>
                  <div className="input-group">
                    <input
                      type="number"
                      className="form-control"
                      name="inner_barcode"
                      value={form.inner_barcode}
                      onChange={handleChange}
                      min="1"
                      step="1"
                      disabled={lockInnerBarcodeField}
                      readOnly={isQcUser}
                      placeholder={
                        lockInnerBarcodeField
                          ? "Already set"
                          : isQcUser
                            ? "Scan inner carton barcode"
                            : "Enter inner carton barcode"
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => toggleBarcodeScanner("inner_barcode")}
                      disabled={lockInnerBarcodeField}
                    >
                      {barcodeScannerOpen && barcodeScannerTarget === "inner_barcode"
                        ? "Stop Scan"
                        : "Scan"}
                    </button>
                  </div>
                  {barcodeScannerOpen && barcodeScannerTarget === "inner_barcode" && (
                    <div className="border rounded p-2 mt-2">
                      <video
                        ref={barcodeVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className="w-100 rounded"
                        style={{ maxHeight: "240px", objectFit: "cover", background: "#111827" }}
                      />
                      {barcodeScannerStatus && (
                        <div className="small text-muted mt-2">{barcodeScannerStatus}</div>
                      )}
                      {barcodeScannerError && (
                        <div className="small text-danger mt-1">{barcodeScannerError}</div>
                      )}
                    </div>
                  )}
                  {isQcUser && !lockInnerBarcodeField && (
                    <div className="small text-secondary mt-2">
                      QC users must scan the inner carton barcode before saving.
                    </div>
                  )}
                </div>
              )}

              <div className="col-md-12">{"   "}</div>

              <div className="col-md-4">
                <label className="form-label">Quantity Offered</label>
                <input
                  type="number"
                  className="form-control"
                  name="offeredQuantity"
                  value={form.offeredQuantity}
                  onChange={handleChange}
                  min="0"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">QC Inspected</label>
                <input
                  type="number"
                  className="form-control"
                  name="qc_checked"
                  value={form.qc_checked}
                  onChange={handleChange}
                  min="0"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">QC Passed</label>
                <input
                  type="number"
                  className="form-control"
                  name="qc_passed"
                  value={form.qc_passed}
                  onChange={handleChange}
                  min="0"
                />
              </div>

              <div className="col-md-2">
                <label className="form-label">Packed Size</label>
                <div className="form-check border rounded p-2 qc-bool-check">
                  <input
                    id="packed_size"
                    type="checkbox"
                    className="form-check-input qc-bool-check-input"
                    name="packed_size"
                    checked={form.packed_size}
                    onChange={handleChange}
                    disabled={!canEditLockedQcFields && qc.packed_size}
                  />
                  <label
                    htmlFor="packed_size"
                    className="form-check-label qc-bool-check-label"
                  >
                    {form.packed_size ? "Yes" : "No"}
                  </label>
                </div>
              </div>

              

              <div className="col-md-2">
                <label className="form-label">Finishing</label>
                <div className="form-check border rounded p-2 qc-bool-check">
                  <input
                    id="finishing"
                    type="checkbox"
                    className="form-check-input qc-bool-check-input"
                    name="finishing"
                    checked={form.finishing}
                    onChange={handleChange}
                    disabled={!canEditLockedQcFields && qc.finishing}
                  />
                  <label
                    htmlFor="finishing"
                    className="form-check-label qc-bool-check-label"
                  >
                    {form.finishing ? "Yes" : "No"}
                  </label>
                </div>
              </div>

              <div className="col-md-2">
                <label className="form-label">Branding</label>
                <div className="form-check border rounded p-2 qc-bool-check">
                  <input
                    id="branding"
                    type="checkbox"
                    className="form-check-input qc-bool-check-input"
                    name="branding"
                    checked={form.branding}
                    onChange={handleChange}
                    disabled={!canEditLockedQcFields && qc.branding}
                  />
                  <label
                    htmlFor="branding"
                    className="form-check-label qc-bool-check-label"
                  >
                    {form.branding ? "Yes" : "No"}
                  </label>
                </div>
              </div>

              <div className="col-md-6 d-flex flex-column">{canManageLabels && (
                <>
                <label
                    htmlFor="branding"
                    className="form-label"
                  >
                    Allocate Label
                  </label>
                  <div>
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => {
                              setShowAllocateModal(true);
                            }}
                            >
                            Allocate 
                          </button>
                              </div>
                            </>
                        )}</div>

              <div className="col-md-6">
                <label className="form-label d-block">Label Ranges</label>
                <div className="d-grid gap-2">
                  {form.labelRanges.map((range, index) => (
                    <div
                      key={`label-range-${index}`}
                      className="row g-2 align-items-end"
                    >
                      <div className="col-sm-5">
                        <input
                          type="number"
                          className="form-control"
                          value={range.start}
                          onChange={(e) =>
                            handleLabelRangeChange(index, "start", e.target.value)
                          }
                          min="0"
                          step="1"
                          placeholder={`Start label ${index + 1}`}
                        />
                      </div>
                      <div className="col-sm-5">
                        <input
                          type="number"
                          className="form-control"
                          value={range.end}
                          onChange={(e) =>
                            handleLabelRangeChange(index, "end", e.target.value)
                          }
                          min="0"
                          step="1"
                          placeholder={`End label ${index + 1}`}
                        />
                      </div>
                      <div className="col-sm-2 d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={addLabelRange}
                          title="Add another range"
                        >
                          +
                        </button>
                        {form.labelRanges.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            onClick={() => removeLabelRange(index)}
                            title="Remove this range"
                          >
                            -
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* <div className="col-md-12">{"   "}</div> */}

              <div className="col-6">
                <label className="form-label">Remarks</label>
                <textarea
                  className="form-control"
                  name="remarks"
                  value={form.remarks}
                  onChange={handleChange}
                  rows="3"
                />
              </div>
            </div>

            {error && <div className="alert alert-danger mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={saving || isQcUpdateBlockedByMissingRequest}
            >
              {saving ? "Updating..." : "Update"}
            </button>
          </div>
        </div>
      </div>
      {showAllocateModal && (
              <AllocateLabelsModal
                onClose={() => {
                  setShowAllocateModal(false);
                }}
              />
            )}
    </div>
  );
};

export default UpdateQcModal;

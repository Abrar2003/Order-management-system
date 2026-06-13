const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const User = require("../models/user.model");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");
const PisUpdateLog = require("../models/pisUpdateLog.model");
const mongoose = require("mongoose");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const XLSX = require("xlsx");
const { syncAllItemsFromOrdersAndQc } = require("../services/itemSync");
const { syncTotalPoCbmForItem } = require("../services/orderCbm.service");
const {
  QUEUE_NAMES,
  enqueuePisFileProcessing,
} = require("../queues");
const {
  isConfigured: isWasabiConfigured,
  createStorageKey,
  getObjectUrl,
  getSignedObjectUrl,
  uploadBuffer,
  deleteObject,
} = require("../services/wasabiStorage.service");
const { convertExcelToPdf } = require("../services/convertXlsxToPDF.service");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const { notifyUsers } = require("../services/notificationService");
const {
  deriveOrderProgress,
  deriveOrderStatus,
} = require("../helpers/orderStatus");
const {
  BOX_PACKAGING_MODES,
  BOX_SIZE_REMARK_OPTIONS,
  buildBoxMeasurementCbmSummary,
  detectBoxPackagingMode,
} = require("../helpers/boxMeasurement");
const {
  FINAL_PIS_CHECK_ITEM_SELECT,
  buildFinalPisCheckRows,
  buildFinalPisCheckPayload,
  buildFinalPisCheckReportPayload,
  buildFinalPisCheckOptions,
  filterFinalPisCheckRowsByDiffField,
  normalizeFinalPisCheckSortBy,
  normalizeSortOrder,
  sortFinalPisCheckRows,
} = require("../helpers/finalPisCheck");
const {
  compareInspectionSizeSnapshot,
} = require("../helpers/inspectionSizeSnapshot");
const {
  compareBoxSizeDimensionVariance,
  compareItemSizeDimensionVariance,
  compareWeightVariance,
} = require("../helpers/measurementMismatchRules");
const {
  NOT_SET_STATUS,
  PD_STATUSES,
  ProductDatabaseError,
  applyProductDatabaseApprove,
  applyProductDatabaseCheck,
  applyProductDatabaseSave,
  buildProductDatabaseRow,
  normalizePdStatus,
} = require("../helpers/productDatabase");
const {
  buildProductTypeSnapshot,
  mapUploadedRowToProductSpecs,
  normalizeProductSpecsPayload,
  normalizeTemplateKey,
} = require("../helpers/productTypeTemplates");
const {
  AUDIT_SCOPES,
  buildItemUpdateAuditSnapshot,
  buildItemUpdateLogPayload,
} = require("../helpers/itemUpdateAudit");
const { appendItemUpdateHistory } = require("../helpers/itemUpdateHistory");
const { formatEan13BarcodeDisplay } = require("../helpers/barcodeFormat");
const { isSuperAdminLikeRole, normalizeUserRoleKey } = require("../helpers/userRole");
const {
  buildComparisonRows,
} = require("../helpers/pisInspectionMasterComparison");
const {
  cleanupLegacyItemSizeFields,
} = require("../helpers/itemLegacySizeCleanup");
const {
  cleanupExpiredFormDrafts,
  deleteFormDraft,
  findFormDraft,
  getDraftUserId,
  serializeFormDraft,
  upsertFormDraft,
} = require("../helpers/formDrafts");

const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeFilterValue = (value) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return null;
  }
  return normalized;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const normalizeTextField = (value) => String(value ?? "").trim();

const toNonNegativeNumber = (value, fieldLabel) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel} must be a non-negative number`);
  }
  return parsed;
};

const toBooleanValue = (value, fieldLabel) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n", ""].includes(normalized)) return false;

  throw new Error(`${fieldLabel} must be a boolean`);
};

const toNormalizedDecimalText = (value, fieldLabel) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return "0";

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel} must be a non-negative number`);
  }

  const fixed = parsed.toFixed(6);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const calculateCbmFromLbh = (box = {}) => {
  const length = Math.max(0, Number(box?.L || 0));
  const breadth = Math.max(0, Number(box?.B || 0));
  const height = Math.max(0, Number(box?.H || 0));
  if (!Number.isFinite(length) || !Number.isFinite(breadth) || !Number.isFinite(height)) {
    return "0";
  }
  if (length <= 0 || breadth <= 0 || height <= 0) return "0";

  const cubicMeters = (length * breadth * height) / 1000000;
  const fixed = cubicMeters.toFixed(6);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const toPositiveCbmNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

const SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  "item",
  "top",
  "base",
  "item1",
  "item2",
  "item3",
]);
const WEIGHT_FIELD_KEYS = Object.freeze([
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

const hasCompletePositiveLbh = (dimensions = {}) =>
  Number(dimensions?.L || 0) > 0 &&
  Number(dimensions?.B || 0) > 0 &&
  Number(dimensions?.H || 0) > 0;

const normalizeStoredSizeEntries = (entries = [], { weightKey = "" } = {}) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const L = toSafeNumber(entry?.L, 0);
      const B = toSafeNumber(entry?.B, 0);
      const H = toSafeNumber(entry?.H, 0);
      const remark = normalizeTextField(entry?.remark || entry?.type || "").toLowerCase();
      const normalizedEntry = { L, B, H, remark };
      if (weightKey) {
        normalizedEntry[weightKey] = toSafeNumber(entry?.[weightKey], 0);
      }
      return normalizedEntry;
    })
    .filter((entry) => hasCompletePositiveLbh(entry))
    .slice(0, SIZE_ENTRY_LIMIT);

const sortSizeEntriesByRemark = (entries = [], remarkOptions = []) =>
  [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftIndex = remarkOptions.indexOf(
      normalizeTextField(left?.remark || "").toLowerCase(),
    );
    const rightIndex = remarkOptions.indexOf(
      normalizeTextField(right?.remark || "").toLowerCase(),
    );
    const safeLeftIndex = leftIndex >= 0 ? leftIndex : SIZE_ENTRY_LIMIT + 1;
    const safeRightIndex = rightIndex >= 0 ? rightIndex : SIZE_ENTRY_LIMIT + 1;
    return safeLeftIndex - safeRightIndex;
  });

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
      ...(weightKey ? { [weightKey]: toSafeNumber(topWeight, 0) } : {}),
    });
  }
  if (hasCompletePositiveLbh(bottomLbh)) {
    legacyEntries.push({
      ...bottomLbh,
      remark: bottomRemark,
      ...(weightKey ? { [weightKey]: toSafeNumber(bottomWeight, 0) } : {}),
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
      ...(weightKey ? { [weightKey]: toSafeNumber(totalWeight, 0) } : {}),
    },
  ];
};

const buildWeightRecord = (weight = {}) =>
  WEIGHT_FIELD_KEYS.reduce((accumulator, fieldKey) => {
    const legacyKey = LEGACY_WEIGHT_FALLBACK_BY_KEY[fieldKey];
    accumulator[fieldKey] = toSafeNumber(
      weight?.[fieldKey] ?? (legacyKey ? weight?.[legacyKey] : undefined),
      0,
    );
    return accumulator;
  }, {});

const hasPositiveSizeEntryValue = (entry = {}, fields = []) =>
  fields.some((field) => toSafeNumber(entry?.[field], 0) > 0);

const getMeaningfulPdItemSizeEntries = (entries = []) =>
  (Array.isArray(entries) ? entries : []).filter((entry) =>
    hasPositiveSizeEntryValue(entry, ["L", "B", "H", "net_weight"]),
  );

const getMeaningfulPdBoxSizeEntries = (entries = []) =>
  (Array.isArray(entries) ? entries : []).filter((entry) =>
    hasPositiveSizeEntryValue(entry, [
      "L",
      "B",
      "H",
      "gross_weight",
      "item_count_in_inner",
      "box_count_in_master",
    ]),
  );

const hasSyncableProductDatabaseData = (item = {}) =>
  getMeaningfulPdItemSizeEntries(item?.pd_item_sizes).length > 0 ||
  getMeaningfulPdBoxSizeEntries(item?.pd_box_sizes).length > 0 ||
  Boolean(normalizeTextField(item?.pd_master_barcode || item?.pd_barcode)) ||
  Boolean(normalizeTextField(item?.pd_inner_barcode)) ||
  item?.kd === true;

const buildPisProductDatabaseSyncActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name:
    normalizeTextField(user?.name) ||
    normalizeTextField(user?.email) ||
    normalizeTextField(user?.username) ||
    normalizeTextField(user?.role) ||
    "Unknown",
  created_at: new Date(),
  updated_at: new Date(),
});

const toComparableValue = (value) => {
  if (Array.isArray(value)) return value.map(toComparableValue);
  if (!value || typeof value !== "object") return value ?? null;
  if (typeof value.toObject === "function") {
    return toComparableValue(value.toObject());
  }

  return Object.keys(value)
    .filter((key) => key !== "_id")
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = toComparableValue(value[key]);
      return accumulator;
    }, {});
};

const areNormalizedValuesEqual = (left, right) =>
  JSON.stringify(toComparableValue(left)) === JSON.stringify(toComparableValue(right));

const getPayloadWeightField = (payloadWeight = {}, fieldKey = "", fieldLabelPrefix = "weight") => {
  if (!payloadWeight || typeof payloadWeight !== "object") {
    return { provided: false, value: 0 };
  }

  if (hasOwn(payloadWeight, fieldKey)) {
    return {
      provided: true,
      value: toNonNegativeNumber(payloadWeight[fieldKey], `${fieldLabelPrefix}.${fieldKey}`),
    };
  }

  const legacyKey = LEGACY_WEIGHT_FALLBACK_BY_KEY[fieldKey];
  if (legacyKey && hasOwn(payloadWeight, legacyKey)) {
    return {
      provided: true,
      value: toNonNegativeNumber(payloadWeight[legacyKey], `${fieldLabelPrefix}.${legacyKey}`),
    };
  }

  return { provided: false, value: 0 };
};

const buildMeasurementCbmSummary = ({
  sizes = [],
  singleLbh = null,
  topLbh = null,
  bottomLbh = null,
  remarkOptions = [],
} = {}) => {
  const normalizedEntries = sortSizeEntriesByRemark(
    buildSizeEntriesFromLegacy({
      sizes,
      singleLbh,
      topLbh,
      bottomLbh,
    }),
    remarkOptions,
  ).slice(0, SIZE_ENTRY_LIMIT);

  if (normalizedEntries.length > 0) {
    const first = calculateCbmFromLbh(normalizedEntries[0] || {});
    const second = calculateCbmFromLbh(normalizedEntries[1] || {});
    const third = calculateCbmFromLbh(normalizedEntries[2] || {});
    const total = normalizedEntries.reduce(
      (sum, entry) => sum + toPositiveCbmNumber(calculateCbmFromLbh(entry)),
      0,
    );

    return {
      first,
      second,
      third,
      total: toNormalizedDecimalText(total, "cbm.total"),
    };
  }

  const first = calculateCbmFromLbh(topLbh || {});
  const second = calculateCbmFromLbh(bottomLbh || {});
  const topAndBottomTotal =
    toPositiveCbmNumber(first) > 0 && toPositiveCbmNumber(second) > 0
      ? toPositiveCbmNumber(first) + toPositiveCbmNumber(second)
      : 0;

  return {
    first,
    second,
    third: "0",
    total:
      topAndBottomTotal > 0
        ? toNormalizedDecimalText(topAndBottomTotal, "cbm.total")
        : calculateCbmFromLbh(singleLbh || {}),
  };
};

const parseSizeEntriesPayload = (
  entries = [],
  {
    fieldLabel = "size entries",
    remarkOptions = [],
    weightKey = "",
    weightLabel = "weight",
    mode = "",
    allowIncomplete = false,
  } = {},
) => {
  if (!Array.isArray(entries)) {
    throw new Error(`${fieldLabel} must be an array`);
  }

  if (entries.length > SIZE_ENTRY_LIMIT) {
    throw new Error(`${fieldLabel} cannot exceed ${SIZE_ENTRY_LIMIT} entries`);
  }

  const seenRemarks = new Set();
  const isBoxSizeField =
    fieldLabel === "inspected_box_sizes" ||
    fieldLabel === "pis_box_sizes" ||
    fieldLabel === "master_box_sizes";
  const resolvedBoxMode =
    isBoxSizeField
      ? detectBoxPackagingMode(mode, entries)
      : BOX_PACKAGING_MODES.INDIVIDUAL;
  const allowedRemarkValues = new Set(
    (Array.isArray(remarkOptions) ? remarkOptions : [])
      .map((option) => normalizeTextField(option).toLowerCase())
      .filter(Boolean),
  );
  const allowedRemarkList = [...allowedRemarkValues].join(", ");

  return entries.map((entry, index) => {
    const entryLabel = `${fieldLabel} ${index + 1}`;
    const L = toNonNegativeNumber(entry?.L, `${entryLabel}.L`);
    const B = toNonNegativeNumber(entry?.B, `${entryLabel}.B`);
    const H = toNonNegativeNumber(entry?.H, `${entryLabel}.H`);

    if (!allowIncomplete && (L <= 0 || B <= 0 || H <= 0)) {
      throw new Error(`${entryLabel} must have positive L, B, and H values`);
    }

    const isCartonBoxEntry =
      isBoxSizeField && resolvedBoxMode === BOX_PACKAGING_MODES.CARTON;
    const cartonRemark = isCartonBoxEntry ? (index === 0 ? "inner" : "master") : "";
    const defaultSingleRemark = isBoxSizeField ? "box" : "item";
    const normalizedRemark = isCartonBoxEntry
      ? cartonRemark
      : normalizeTextField(entry?.remark || "").toLowerCase();
    if (entries.length > 1 && !isCartonBoxEntry) {
      if (!normalizedRemark) {
        if (!allowIncomplete) {
          throw new Error(`${entryLabel}.remark is required`);
        }
      }
      if (
        normalizedRemark &&
        allowedRemarkValues.size > 0 &&
        !allowedRemarkValues.has(normalizedRemark)
      ) {
        throw new Error(`${entryLabel}.remark must be one of: ${allowedRemarkList}`);
      }
      if (seenRemarks.has(normalizedRemark)) {
        throw new Error(`${fieldLabel} remarks must be unique`);
      }
      if (normalizedRemark) {
        seenRemarks.add(normalizedRemark);
      }
    }

    const parsedEntry = {
      L,
      B,
      H,
      remark: entries.length > 1 ? normalizedRemark : normalizedRemark || defaultSingleRemark,
    };

    if (weightKey) {
      const parsedWeight = toNonNegativeNumber(
        entry?.[weightKey],
        `${entryLabel}.${weightLabel}`,
      );
      if (!allowIncomplete && parsedWeight <= 0) {
        throw new Error(`${entryLabel}.${weightLabel} must be greater than 0`);
      }
      parsedEntry[weightKey] = parsedWeight;
    }

    if (isBoxSizeField) {
      if (resolvedBoxMode === BOX_PACKAGING_MODES.CARTON) {
        const entryType = cartonRemark;
        parsedEntry.remark = entryType;
        parsedEntry.box_type = entryType;
        parsedEntry.item_count_in_inner =
          entryType === "inner"
            ? toNonNegativeNumber(entry?.item_count_in_inner, `${entryLabel}.item_count_in_inner`)
            : 0;
        parsedEntry.box_count_in_master =
          entryType === "master"
            ? toNonNegativeNumber(
                entry?.box_count_in_master,
                `${entryLabel}.box_count_in_master`,
              )
            : 0;

        if (
          !allowIncomplete &&
          entryType === "inner" &&
          parsedEntry.item_count_in_inner <= 0
        ) {
          throw new Error(`${entryLabel}.item_count_in_inner must be greater than 0`);
        }
        if (
          !allowIncomplete &&
          entryType === "master" &&
          parsedEntry.box_count_in_master <= 0
        ) {
          throw new Error(`${entryLabel}.box_count_in_master must be greater than 0`);
        }
      } else {
        parsedEntry.box_type = "individual";
        parsedEntry.item_count_in_inner = 0;
        parsedEntry.box_count_in_master = 0;
      }
    }

    return parsedEntry;
  });
};

const applyCalculatedCbmTotals = (item, setPath) => {
  const inspectedBoxMode = detectBoxPackagingMode(
    item?.inspected_box_mode,
    item?.inspected_box_sizes,
  );
  const inspectedBoxSummary = buildBoxMeasurementCbmSummary({
    sizes: item?.inspected_box_sizes,
    mode: inspectedBoxMode,
    singleLbh: item?.inspected_box_LBH || item?.box_LBH,
    topLbh:
      inspectedBoxMode === BOX_PACKAGING_MODES.CARTON
        ? null
        : item?.inspected_box_top_LBH || item?.inspected_top_LBH,
    bottomLbh:
      inspectedBoxMode === BOX_PACKAGING_MODES.CARTON
        ? null
        : item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH,
  });
  const inspectedSummary =
    toPositiveCbmNumber(inspectedBoxSummary.total) > 0
      ? inspectedBoxSummary
      : buildMeasurementCbmSummary({
          sizes: item?.inspected_item_sizes,
          singleLbh: item?.inspected_item_LBH || item?.item_LBH,
          topLbh: item?.inspected_item_top_LBH,
          bottomLbh: item?.inspected_item_bottom_LBH,
          remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        });

  const pisBoxMode = detectBoxPackagingMode(
    item?.pis_box_mode,
    item?.pis_box_sizes,
  );
  const pisBoxSummary = buildBoxMeasurementCbmSummary({
    sizes: item?.pis_box_sizes,
    mode: pisBoxMode,
    singleLbh: item?.pis_box_LBH || item?.box_LBH,
    topLbh: pisBoxMode === BOX_PACKAGING_MODES.CARTON ? null : item?.pis_box_top_LBH,
    bottomLbh:
      pisBoxMode === BOX_PACKAGING_MODES.CARTON ? null : item?.pis_box_bottom_LBH,
  });
  const pisSummary =
    toPositiveCbmNumber(pisBoxSummary.total) > 0
      ? pisBoxSummary
      : buildMeasurementCbmSummary({
          sizes: item?.pis_item_sizes,
          singleLbh: item?.pis_item_LBH || item?.item_LBH,
          topLbh: item?.pis_item_top_LBH,
          bottomLbh: item?.pis_item_bottom_LBH,
          remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        });

  const hasDerivedInspectedCbm = toPositiveCbmNumber(inspectedSummary.total) > 0;
  const hasDerivedPisCbm = toPositiveCbmNumber(pisSummary.total) > 0;

  setPath(
    "cbm.inspected_top",
    hasDerivedInspectedCbm
      ? inspectedSummary.first
      : toNormalizedDecimalText(item?.cbm?.inspected_top ?? 0, "cbm.inspected_top"),
  );
  setPath(
    "cbm.inspected_bottom",
    hasDerivedInspectedCbm
      ? inspectedSummary.second
      : toNormalizedDecimalText(item?.cbm?.inspected_bottom ?? 0, "cbm.inspected_bottom"),
  );
  setPath(
    "cbm.inspected_total",
    hasDerivedInspectedCbm
      ? inspectedSummary.total
      : toNormalizedDecimalText(item?.cbm?.inspected_total ?? 0, "cbm.inspected_total"),
  );
  setPath(
    "cbm.calculated_inspected_total",
    hasDerivedInspectedCbm
      ? inspectedSummary.total
      : toNormalizedDecimalText(
          item?.cbm?.calculated_inspected_total ?? item?.cbm?.inspected_total ?? 0,
          "cbm.calculated_inspected_total",
        ),
  );
  setPath(
    "cbm.top",
    hasDerivedPisCbm
      ? pisSummary.first
      : toNormalizedDecimalText(item?.cbm?.top ?? 0, "cbm.top"),
  );
  setPath(
    "cbm.bottom",
    hasDerivedPisCbm
      ? pisSummary.second
      : toNormalizedDecimalText(item?.cbm?.bottom ?? 0, "cbm.bottom"),
  );
  setPath(
    "cbm.total",
    hasDerivedPisCbm
      ? pisSummary.total
      : toNormalizedDecimalText(item?.cbm?.total ?? 0, "cbm.total"),
  );
  setPath(
    "cbm.calculated_pis_total",
    hasDerivedPisCbm
      ? pisSummary.total
      : toNormalizedDecimalText(
          item?.cbm?.calculated_pis_total ?? item?.cbm?.total ?? 0,
          "cbm.calculated_pis_total",
        ),
  );
  setPath(
    "cbm.calculated_total",
    hasDerivedInspectedCbm
      ? inspectedSummary.total
      : toNormalizedDecimalText(
          item?.cbm?.calculated_total
          ?? item?.cbm?.calculated_inspected_total
          ?? item?.cbm?.inspected_total
          ?? 0,
          "cbm.calculated_total",
        ),
  );
};

const normalizeDistinctValues = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));

const PIS_UPDATE_LOG_OPERATION_TYPES = new Set([
  "pis_update",
  "pis_diff_update",
  "pis_database_sync",
  "product_database_update",
  "product_database_check",
  "product_database_approve",
  "master_update",
]);

const normalizePisUpdateLogScope = (value = "") => {
  const normalized = normalizeTextField(value).toLowerCase();
  if (normalized === "pd") return AUDIT_SCOPES.PD;
  if (normalized === "master") return AUDIT_SCOPES.MASTER;
  if (normalized === "item") return AUDIT_SCOPES.ITEM;
  if (normalized === "pis") return AUDIT_SCOPES.PIS;
  return "";
};

const createPisUpdateLog = async ({
  reqUser = {},
  beforeSnapshot = {},
  afterSnapshot = {},
  operationType = "pis_update",
  pageName = "PIS Update Modal",
  source = "pis_update_modal",
  dataScopes = [AUDIT_SCOPES.PIS],
  extraRemarks = [],
  metadata = {},
} = {}) => {
  try {
    await PisUpdateLog.create(
      buildItemUpdateLogPayload({
        reqUser,
        beforeSnapshot,
        afterSnapshot,
        operationType,
        pageName,
        source,
        dataScopes,
        extraRemarks,
        metadata,
      }),
    );
  } catch (error) {
    console.error("PIS update log save failed:", {
      item_code: afterSnapshot?.item_code || beforeSnapshot?.item_code,
      operationType,
      error: error?.message || String(error),
    });
  }
};

const ACTIVE_ORDER_MATCH = {
  archived: { $ne: true },
  status: { $ne: "Cancelled" },
};

const getShippedQuantity = (shipmentEntries = []) =>
  (Array.isArray(shipmentEntries) ? shipmentEntries : []).reduce(
    (sum, entry) => sum + Math.max(0, toSafeNumber(entry?.quantity, 0)),
    0,
  );

const getOpenQuantity = (order = {}) => {
  return deriveOrderProgress({ orderEntry: order }).pending_inspection_quantity;
};

const ITEM_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const ITEM_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const ITEM_PDF_MIME_TYPES = new Set(["application/pdf"]);
const ITEM_PDF_EXTENSIONS = new Set([".pdf"]);
const ITEM_PRESENTATION_MIME_TYPES = new Set([
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
]);
const ITEM_PRESENTATION_EXTENSIONS = new Set([".ppt", ".pptx", ".pptm"]);
const ITEM_FILE_CONFIG = Object.freeze({
  product_image: {
    field: "image",
    folder: "item-image",
    label: "Product image",
    mimeTypes: ITEM_IMAGE_MIME_TYPES,
    extensions: ITEM_IMAGE_EXTENSIONS,
    defaultExtension: ".jpg",
    invalidTypeMessage:
      "Only JPG, JPEG, and PNG files are allowed for product images",
  },
  cad_file: {
    field: "cad_file",
    folder: "item-cad",
    label: "CAD file",
    mimeTypes: ITEM_PDF_MIME_TYPES,
    extensions: ITEM_PDF_EXTENSIONS,
    defaultExtension: ".pdf",
    invalidTypeMessage: "Only PDF files are allowed for CAD files",
  },
  pis_file: {
    field: "pis_file",
    folder: "item-pis",
    label: "PIS file",
    mimeTypes: ITEM_PDF_MIME_TYPES,
    extensions: ITEM_PDF_EXTENSIONS,
    defaultExtension: ".pdf",
    invalidTypeMessage: "Only PDF files are allowed for PIS files",
  },
  assembly_file: {
    field: "assembly_file",
    folder: "item-assembly",
    label: "Assembly file",
    mimeTypes: ITEM_PDF_MIME_TYPES,
    extensions: ITEM_PDF_EXTENSIONS,
    defaultExtension: ".pdf",
    invalidTypeMessage: "Only PDF files are allowed for Assembly files",
  },
  mounting_file: {
    field: "mounting_file",
    folder: "item-mounting",
    label: "Mounting file",
    mimeTypes: ITEM_PDF_MIME_TYPES,
    extensions: ITEM_PDF_EXTENSIONS,
    defaultExtension: ".pdf",
    invalidTypeMessage: "Only PDF files are allowed for Mounting files",
    requiresMountingFileNeeded: true,
  },
  packeging_ppt: {
    field: "packeging_ppt",
    folder: "item-packaging-ppt",
    label: "Packaging PPT",
    mimeTypes: ITEM_PRESENTATION_MIME_TYPES,
    extensions: ITEM_PRESENTATION_EXTENSIONS,
    defaultExtension: ".pptx",
    invalidTypeMessage: "Only PPT, PPTX, or PPTM files are allowed for Packaging PPT",
  },
});
const ALLOWED_ITEM_FILE_TYPES = new Set(Object.keys(ITEM_FILE_CONFIG));
const ITEM_FILE_URL_EXPIRES_IN = 24 * 60 * 60;
const PIS_SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);
const PIS_SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/excel",
  "application/x-excel",
  "application/x-msexcel",
  "application/xls",
  "application/x-xls",
  "text/csv",
  "application/csv",
  "text/plain",
]);
const PIS_JOB_INPUT_DIR = path.resolve(__dirname, "../uploads/job-inputs");

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const getItemFileConfig = (fileType = "") =>
  ITEM_FILE_CONFIG[normalizeTextField(fileType).toLowerCase()] || null;

const isItemFileAllowedForItem = (item = {}, fileConfig = {}) =>
  !fileConfig?.requiresMountingFileNeeded || item?.mounting_file_needed === true;

const normalizeStoredItemFile = (file = {}) => {
  const parsedSize = Number(file?.size || 0);
  const key = normalizeTextField(file?.key || file?.public_id);
  const link = normalizeTextField(file?.link || file?.url);
  return {
    key,
    originalName: normalizeTextField(file?.originalName),
    contentType: normalizeTextField(file?.contentType),
    size: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0,
    link,
    public_id: normalizeTextField(file?.public_id || key),
    url: link,
  };
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const sanitizeBaseFilename = (value = "", fallback = "file") => {
  const safeValue = normalizeTextField(value)
    .replace(/\.[^.]+$/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return safeValue || fallback;
};

const getRequestedItemId = (req) =>
  normalizeTextField(req?.params?.itemId || req?.params?.id);

const buildStoredWasabiItemFile = (file = {}) => {
  const normalizedFile = normalizeStoredItemFile(file);
  const link =
    normalizedFile.link
    || (
      normalizedFile.key && isWasabiConfigured()
        ? getObjectUrl(normalizedFile.key)
        : ""
    );

  return {
    key: normalizedFile.key,
    originalName: normalizedFile.originalName,
    contentType: normalizedFile.contentType,
    size: normalizedFile.size,
    link,
    public_id: normalizedFile.public_id || normalizedFile.key,
  };
};

const buildItemFileDownloadName = ({
  file = {},
  itemCode = "",
  fallbackBaseName = "item-file",
  extension = ".pdf",
} = {}) => {
  const normalizedFile = normalizeStoredItemFile(file);
  if (normalizedFile.originalName) {
    return normalizedFile.originalName;
  }

  return `${sanitizeBaseFilename(itemCode || fallbackBaseName, fallbackBaseName)}${extension}`;
};

const buildItemFileResponse = async (
  file = {},
  {
    itemCode = "",
    fallbackBaseName = "item-file",
    extension = ".pdf",
    requireStorageKey = false,
  } = {},
) => {
  const normalizedFile = normalizeStoredItemFile(file);
  if (requireStorageKey && !normalizedFile.key) {
    return null;
  }

  if (!normalizedFile.key && !normalizedFile.link) {
    return null;
  }

  let link = normalizedFile.link;
  if (normalizedFile.key) {
    if (!isWasabiConfigured()) {
      throw createHttpError(500, "Wasabi storage is not configured");
    }

    link = await getSignedObjectUrl(normalizedFile.key, {
      expiresIn: ITEM_FILE_URL_EXPIRES_IN,
      filename: buildItemFileDownloadName({
        file: normalizedFile,
        itemCode,
        fallbackBaseName,
        extension,
      }),
    });
  }

  return {
    key: normalizedFile.key,
    originalName: buildItemFileDownloadName({
      file: normalizedFile,
      itemCode,
      fallbackBaseName,
      extension,
    }),
    contentType: normalizedFile.contentType,
    size: normalizedFile.size,
    link,
    public_id: normalizedFile.public_id || normalizedFile.key,
  };
};

const shouldIncludeProductImageThumbnails = (req) => {
  const rawValue =
    req?.query?.include_product_image_thumbnail
    ?? req?.query?.includeProductImageThumbnail
    ?? req?.query?.include_product_image_thumb
    ?? "";
  return ["1", "true", "yes"].includes(String(rawValue || "").trim().toLowerCase());
};

const hasStoredProductImage = (file = {}) => {
  const normalizedFile = normalizeStoredItemFile(file);
  return Boolean(normalizedFile.key || normalizedFile.link);
};

const buildProductImageThumbnailPayload = async (item = {}) => {
  if (!hasStoredProductImage(item?.image)) {
    return {
      product_image: normalizeStoredItemFile(item?.image || {}),
      product_image_url: "",
    };
  }

  const filePayload = await buildItemFileResponse(item.image, {
    itemCode: normalizeTextField(item?.code || item?._id),
    fallbackBaseName: "product-image",
    extension: ITEM_FILE_CONFIG.product_image.defaultExtension,
  });

  return {
    product_image: filePayload
      ? {
          key: filePayload.key,
          originalName: filePayload.originalName,
          contentType: filePayload.contentType,
          size: filePayload.size,
          public_id: filePayload.public_id,
        }
      : normalizeStoredItemFile(item?.image || {}),
    product_image_url: filePayload?.link || "",
  };
};

const attachProductImageThumbnails = async (rows = [], itemLookup = new Map(), include = false) => {
  if (!include || !Array.isArray(rows) || rows.length === 0) {
    return rows;
  }

  return Promise.all(
    rows.map(async (row) => {
      const itemId = normalizeTextField(row?.id || row?._id);
      const sourceItem = itemLookup.get(itemId) || row;
      const thumbnailPayload = await buildProductImageThumbnailPayload(sourceItem);
      return {
        ...row,
        ...thumbnailPayload,
      };
    }),
  );
};

const validatePisSpreadsheetUpload = (file) => {
  if (!file) {
    throw createHttpError(400, "No spreadsheet file uploaded");
  }

  if (!Buffer.isBuffer(file?.buffer)) {
    throw createHttpError(400, "Uploaded spreadsheet file is invalid");
  }

  if (file.buffer.length <= 0) {
    throw createHttpError(400, "Uploaded spreadsheet file is empty");
  }

  const originalName = normalizeTextField(file?.originalname);
  const extension = path.extname(originalName).toLowerCase();
  if (!PIS_SPREADSHEET_EXTENSIONS.has(extension)) {
    throw createHttpError(400, "Only .xlsx, .xls, and .csv files are allowed for PIS uploads");
  }

  const mimeType = normalizeTextField(file?.mimetype).toLowerCase();
  if (
    mimeType
    && mimeType !== "application/octet-stream"
    && !PIS_SPREADSHEET_MIME_TYPES.has(mimeType)
  ) {
    throw createHttpError(400, "Only .xlsx, .xls, and .csv files are allowed for PIS uploads");
  }

  return {
    originalName,
    extension,
    mimeType,
  };
};

const buildPisPdfOriginalName = ({
  spreadsheetOriginalName = "",
  itemCode = "",
  itemId = "",
} = {}) => {
  const spreadsheetBaseName = sanitizeBaseFilename(
    path.parse(path.basename(spreadsheetOriginalName)).name,
    sanitizeBaseFilename(itemCode || itemId || "item-pis", "item-pis"),
  );

  return `${spreadsheetBaseName}.pdf`;
};

const parseJsonBodyField = (value, fieldLabel) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return undefined;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw createHttpError(400, `${fieldLabel} must be valid JSON`);
  }
};

const resolveProductTypeTemplateSelection = (payload = {}) => ({
  templateId: normalizeTextField(
    payload?.product_type_template_id ||
      payload?.product_type_template ||
      payload?.product_type?.template ||
      "",
  ),
  templateKey: normalizeTemplateKey(
    payload?.product_type_key || payload?.product_type?.key || "",
  ),
  templateVersion: Number.parseInt(
    String(payload?.product_type?.version ?? payload?.product_type_version ?? "").trim(),
    10,
  ),
});

const findProductTypeTemplateForItemPayload = async (payload = {}) => {
  const { templateId, templateKey, templateVersion } =
    resolveProductTypeTemplateSelection(payload);

  if (templateId) {
    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      throw createHttpError(400, "product_type template id is invalid");
    }

    const templateDoc = await ProductTypeTemplate.findOne({
      _id: templateId,
      status: { $ne: "archived" },
    });
    if (!templateDoc) {
      throw createHttpError(404, "Selected product type template was not found");
    }
    return templateDoc;
  }

  if (!templateKey) return null;

  const templateMatch = {
    key: templateKey,
    status: "active",
  };
  if (Number.isFinite(templateVersion) && templateVersion > 0) {
    templateMatch.version = templateVersion;
  }

  const templateDoc = await ProductTypeTemplate.findOne(templateMatch)
    .sort({ version: -1, updatedAt: -1 });

  if (!templateDoc) {
    throw createHttpError(
      404,
      `Active product type template not found for key ${templateKey}`,
    );
  }

  return templateDoc;
};

const resolveItemProductTypeContext = async (payload = {}) => {
  const parsedProductRow = parseJsonBodyField(
    payload?.product_row ?? payload?.uploaded_row,
    "product_row",
  );
  const parsedProductSpecs = parseJsonBodyField(
    payload?.product_specs,
    "product_specs",
  );

  if (parsedProductRow !== undefined && parsedProductSpecs !== undefined) {
    throw createHttpError(
      400,
      "Provide either product_row or product_specs, not both",
    );
  }

  const templateDoc = await findProductTypeTemplateForItemPayload(payload);
  const needsTemplate = Boolean(
    templateDoc || parsedProductRow !== undefined || parsedProductSpecs !== undefined,
  );

  if (!needsTemplate) {
    return {
      templateDoc: null,
      productTypeSnapshot: null,
      productSpecs: null,
      commonFields: {},
    };
  }

  if (!templateDoc) {
    throw createHttpError(
      400,
      "product_type template selection is required when product_row or product_specs is provided",
    );
  }

  let productSpecs = null;
  let commonFields = {};

  if (parsedProductRow !== undefined) {
    const mappedSpecs = mapUploadedRowToProductSpecs(
      parsedProductRow,
      templateDoc.toObject({ depopulate: true }),
    );
    commonFields = mappedSpecs.common_fields || {};
    productSpecs = normalizeProductSpecsPayload(mappedSpecs);
  } else if (parsedProductSpecs !== undefined) {
    productSpecs = normalizeProductSpecsPayload(parsedProductSpecs);
  }

  return {
    templateDoc,
    productTypeSnapshot: buildProductTypeSnapshot(templateDoc),
    productSpecs,
    commonFields,
  };
};

const uploadPisSpreadsheetForItem = async ({
  itemCode = "",
  itemId = "",
  file,
}) => {
  const spreadsheetFile = validatePisSpreadsheetUpload(file);

  if (!isWasabiConfigured()) {
    throw createHttpError(500, "Wasabi storage is not configured");
  }

  const pdfOriginalName = buildPisPdfOriginalName({
    spreadsheetOriginalName: spreadsheetFile.originalName,
    itemCode,
    itemId,
  });

  let convertedFile = null;
  let uploadResult = null;

  try {
    convertedFile = await convertExcelToPdf({
      buffer: file.buffer,
      originalName: spreadsheetFile.originalName,
    });

    uploadResult = await uploadBuffer({
      buffer: convertedFile.pdfBuffer,
      key: createStorageKey({
        folder: ITEM_FILE_CONFIG.pis_file.folder,
        originalName: pdfOriginalName,
        extension: ".pdf",
      }),
      originalName: pdfOriginalName,
      contentType: "application/pdf",
    });

    return buildStoredWasabiItemFile({
      ...uploadResult,
      originalName: pdfOriginalName,
      contentType: "application/pdf",
    });
  } catch (error) {
    if (uploadResult?.key) {
      try {
        await deleteObject(uploadResult.key);
      } catch (rollbackError) {
        console.error("Rollback uploaded PIS PDF failed:", {
          itemId,
          itemCode,
          storageKey: uploadResult.key,
          error: rollbackError?.message || String(rollbackError),
        });
      }
    }
    throw error;
  } finally {
    if (convertedFile?.cleanup) {
      try {
        await convertedFile.cleanup();
      } catch (cleanupError) {
        console.error("PIS upload cleanup failed:", {
          itemId,
          itemCode,
          error: cleanupError?.details || cleanupError?.message || String(cleanupError),
        });
      }
    }
  }
};

const parseAsyncRequest = (req) =>
  ["1", "true", "yes", "y", "on"].includes(
    String(req?.body?.async ?? req?.query?.async ?? "")
      .trim()
      .toLowerCase(),
  );

const safeDeleteLocalFile = async (filePath = "") => {
  const normalizedPath = normalizeTextField(filePath);
  if (!normalizedPath) return;
  await fs.rm(normalizedPath, { force: true }).catch(() => {});
};

const stagePisSpreadsheetForJob = async (file) => {
  const spreadsheetFile = validatePisSpreadsheetUpload(file);
  await fs.mkdir(PIS_JOB_INPUT_DIR, { recursive: true });

  const checksum = crypto
    .createHash("sha256")
    .update(file.buffer)
    .digest("hex");
  const safeBaseName = sanitizeBaseFilename(
    path.parse(spreadsheetFile.originalName).name,
    "item-pis",
  );
  const tempFilePath = path.join(
    PIS_JOB_INPUT_DIR,
    `${Date.now()}-${checksum.slice(0, 16)}-${safeBaseName}${spreadsheetFile.extension}`,
  );

  await fs.writeFile(tempFilePath, file.buffer);

  return {
    tempFilePath,
    checksum,
    originalName: spreadsheetFile.originalName,
  };
};

const toTimestamp = (value) => {
  if (!value) return 0;
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  const asString = String(value).trim();
  if (!asString) return 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    const parsed = new Date(`${asString}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(asString)) {
    const [day, month, year] = asString.split(/[/-]/).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const toDisplayDateString = (value = "") => {
  const timestamp = toTimestamp(value);
  if (!timestamp) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
};

const resolveInspectorName = (inspectorValue) => {
  if (!inspectorValue) return "";
  if (typeof inspectorValue === "string") return inspectorValue.trim();
  return String(
    inspectorValue?.name || inspectorValue?.email || inspectorValue?._id || "",
  ).trim();
};

const buildItemMatch = ({ search, brand, vendor } = {}) => {
  const conditions = [];
  const normalizedSearch = normalizeFilterValue(search);
  const normalizedBrand = normalizeFilterValue(brand);
  const normalizedVendor = normalizeFilterValue(vendor);

  if (normalizedSearch) {
    const escaped = escapeRegex(normalizedSearch);
    conditions.push({
      $or: [
        { code: { $regex: escaped, $options: "i" } },
        { name: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { brand: { $regex: escaped, $options: "i" } },
        { brand_name: { $regex: escaped, $options: "i" } },
      ],
    });
  }

  if (normalizedBrand) {
    conditions.push({
      $or: [
        { brand: normalizedBrand },
        { brands: normalizedBrand },
        { brand_name: normalizedBrand },
      ],
    });
  }

  if (normalizedVendor) {
    conditions.push({ vendors: normalizedVendor });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
};

const PRODUCT_DATABASE_ITEM_SELECT = [
  "code",
  "name",
  "description",
  "brand",
  "brand_name",
  "brands",
  "vendors",
  "image",
  "country_of_origin",
  "pd_barcode",
  "pd_master_barcode",
  "pd_inner_barcode",
  "kd",
  "mounting_file_needed",
  "mounting_file",
  "product_type",
  "product_specs",
  "pd_item_sizes",
  "pd_box_sizes",
  "pd_box_mode",
  "pd_checked",
  "pd_created_by",
  "pd_checked_by",
  "pd_approved_by",
  "pd_last_changed_by",
  "pd_history",
  "updatedAt",
].join(" ");
const ITEM_DETAILS_SELECT = [
  "code",
  "name",
  "description",
  "brand",
  "brand_name",
  "brands",
  "vendors",
  "country_of_origin",
  "image",
  "cad_file",
  "pis_file",
  "assembly_file",
  "mounting_file",
  "packeging_ppt",
  "mounting_file_needed",
  "finish",
  "pis_item_sizes",
  "pis_box_sizes",
  "pis_box_mode",
  "pis_weight",
  "pis_barcode",
  "pis_master_barcode",
  "pis_inner_barcode",
  "inspected_item_sizes",
  "inspected_box_sizes",
  "inspected_box_mode",
  "inspected_weight",
  "qc",
  "cbm",
  "master_item_sizes",
  "master_box_sizes",
  "master_box_mode",
  "master_barcode",
  "master_master_barcode",
  "master_inner_barcode",
  "master_country_of_origin",
  "pd_barcode",
  "pd_master_barcode",
  "pd_inner_barcode",
  "pd_item_sizes",
  "pd_box_sizes",
  "pd_box_mode",
  "pd_checked",
  "pd_created_by",
  "pd_checked_by",
  "pd_approved_by",
  "pd_last_changed_by",
  "pd_history",
  "product_type",
  "product_specs",
  "kd",
  "barcode_exempted",
  "updatedAt",
].join(" ");

const buildProductDatabaseStatusMatch = (status) => {
  const normalizedStatus = String(status ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!normalizedStatus || normalizedStatus === "all") return {};

  if (normalizedStatus === NOT_SET_STATUS || normalizedStatus === "not_set") {
    return {
      $or: [
        { pd_checked: { $exists: false } },
        { pd_checked: null },
        { pd_checked: "" },
        { pd_checked: "not set" },
      ],
    };
  }

  const statusValue = normalizePdStatus(normalizedStatus);
  return statusValue ? { pd_checked: statusValue } : {};
};

const combineMongoMatches = (...matches) => {
  const activeMatches = matches.filter((match) => match && Object.keys(match).length > 0);
  if (activeMatches.length === 0) return {};
  if (activeMatches.length === 1) return activeMatches[0];
  return { $and: activeMatches };
};

const ITEM_DATA_ACCESS_FIELDS = {
  brandFields: ["brand", "brand_name", "brands"],
  vendorFields: ["vendors"],
};

const applyItemDataAccess = (match = {}, user = {}) =>
  applyDataAccessMatch(match, user, ITEM_DATA_ACCESS_FIELDS);

const buildItemFileViewMatch = (fileType = "") => {
  const normalizedFileType = normalizeTextField(fileType).toLowerCase();
  if (normalizedFileType === "mounting_file") {
    return { mounting_file_needed: true };
  }
  if (normalizedFileType !== "assembly_file") return {};

  return {
    kd: true,
  };
};

const handleProductDatabaseError = (res, error, fallbackMessage) => {
  if (error instanceof ProductDatabaseError) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({
    success: false,
    message: error?.message || fallbackMessage,
  });
};

const normalizeLookupKey = (value) => normalizeTextField(value).toLowerCase();

const MEASUREMENT_COMPARE_TOLERANCE = 0.0001;
const CBM_COMPARE_TOLERANCE = 0.03;
const CBM_COMPARE_EPSILON = 0.000000001;
const CBM_COMPARE_DECIMALS = 2;

const buildMeasurementEntryKey = (entry = {}, index = 0) => {
  const normalizedRemark = normalizeTextField(entry?.remark || entry?.type).toLowerCase();
  return normalizedRemark || `entry${index + 1}`;
};

const hasAnyPositiveMeasurementLbh = (dimensions = {}) =>
  Number(dimensions?.L || 0) > 0
  || Number(dimensions?.B || 0) > 0
  || Number(dimensions?.H || 0) > 0;

const hasPositiveMeasurementWeight = (value) => Number(value || 0) > 0;

const roundCbmForComparison = (value) => {
  const parsed = toSafeNumber(value, 0);
  return Number(parsed.toFixed(CBM_COMPARE_DECIMALS));
};

const compareRoundedCbmValues = (inspectedValue, pisValue) => {
  const inspected = roundCbmForComparison(inspectedValue);
  const pis = roundCbmForComparison(pisValue);
  const hasInspected = inspected > 0;
  const hasPis = pis > 0;
  const delta = inspected - pis;

  return {
    mismatch:
      hasInspected !== hasPis ||
      (hasInspected && hasPis && Math.abs(delta) > CBM_COMPARE_TOLERANCE + CBM_COMPARE_EPSILON),
    hasData: hasInspected || hasPis,
    hasInspected,
    hasPis,
    inspected,
    pis,
    delta,
  };
};

const getNormalizedWeightFieldValue = (weight = {}, fieldKey = "") =>
  buildWeightRecord(weight)?.[fieldKey] ?? 0;

const buildComparableMeasurementEntries = ({
  sizes = [],
  singleLbh = null,
  topLbh = null,
  bottomLbh = null,
  weight = {},
  totalWeightKey = "",
  topWeightKey = "",
  bottomWeightKey = "",
  weightKey = "",
  remarkOptions = [],
  topRemark = "top",
  bottomRemark = "base",
} = {}) =>
  sortSizeEntriesByRemark(
    buildSizeEntriesFromLegacy({
      sizes,
      singleLbh,
      topLbh,
      bottomLbh,
      totalWeight: getNormalizedWeightFieldValue(weight, totalWeightKey),
      topWeight: getNormalizedWeightFieldValue(weight, topWeightKey),
      bottomWeight: getNormalizedWeightFieldValue(weight, bottomWeightKey),
      weightKey,
      topRemark,
      bottomRemark,
    }).filter((entry) => {
      const hasSize = hasAnyPositiveMeasurementLbh(entry);
      const hasWeight = weightKey
        ? hasPositiveMeasurementWeight(entry?.[weightKey])
        : false;
      return hasSize || hasWeight;
    }),
    remarkOptions,
  ).slice(0, SIZE_ENTRY_LIMIT);

const compareMeasurementEntryGroups = (
  inspectedEntries = [],
  pisEntries = [],
  {
    weightKey = "",
    sizeComparator = compareItemSizeDimensionVariance,
  } = {},
) => {
  const inspectedNormalized = Array.isArray(inspectedEntries) ? inspectedEntries : [];
  const pisNormalized = Array.isArray(pisEntries) ? pisEntries : [];

  const inspectedEntriesWithKeys = inspectedNormalized.map((entry, index) => ({
    ...entry,
    __key: buildMeasurementEntryKey(entry, index),
  }));
  const pisEntriesWithKeys = pisNormalized.map((entry, index) => ({
    ...entry,
    __key: buildMeasurementEntryKey(entry, index),
  }));

  const inspectedMap = new Map(
    inspectedEntriesWithKeys.map((entry) => [entry.__key, entry]),
  );
  const pisMap = new Map(pisEntriesWithKeys.map((entry) => [entry.__key, entry]));
  const orderedKeys = [
    ...new Set([
      ...inspectedEntriesWithKeys.map((entry) => entry.__key),
      ...pisEntriesWithKeys.map((entry) => entry.__key),
    ]),
  ];

  let sizeMismatch = false;
  let weightMismatch = false;

  orderedKeys.forEach((key) => {
    const inspectedEntry = inspectedMap.get(key) || null;
    const pisEntry = pisMap.get(key) || null;
    const hasInspectedSize = hasAnyPositiveMeasurementLbh(inspectedEntry || {});
    const hasPisSize = hasAnyPositiveMeasurementLbh(pisEntry || {});

    if (hasInspectedSize && hasPisSize) {
      ["L", "B", "H"].forEach((axis) => {
        const comparison = sizeComparator(inspectedEntry?.[axis], pisEntry?.[axis]);
        if (comparison.mismatch) {
          sizeMismatch = true;
        }
      });
    }

    if (!weightKey) return;

    const hasInspectedWeight = hasPositiveMeasurementWeight(inspectedEntry?.[weightKey]);
    const hasPisWeight = hasPositiveMeasurementWeight(pisEntry?.[weightKey]);
    if (hasInspectedWeight && hasPisWeight) {
      if (compareWeightVariance(inspectedEntry?.[weightKey], pisEntry?.[weightKey]).mismatch) {
        weightMismatch = true;
      }
    }
  });

  return {
    hasInspectedData: inspectedEntriesWithKeys.some(
      (entry) =>
        hasAnyPositiveMeasurementLbh(entry)
        || (weightKey ? hasPositiveMeasurementWeight(entry?.[weightKey]) : false),
    ),
    sizeMismatch,
    weightMismatch,
  };
};

const buildPisDiffSummary = (item = {}) => {
  const inspectedItemEntries = buildComparableMeasurementEntries({
    sizes: item?.inspected_item_sizes,
    singleLbh: item?.inspected_item_LBH,
    topLbh: item?.inspected_item_top_LBH,
    bottomLbh: item?.inspected_item_bottom_LBH,
    weight: item?.inspected_weight,
    totalWeightKey: "total_net",
    topWeightKey: "top_net",
    bottomWeightKey: "bottom_net",
    weightKey: "net_weight",
    remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
  });
  const pisItemEntries = buildComparableMeasurementEntries({
    sizes: item?.pis_item_sizes,
    singleLbh: item?.pis_item_LBH,
    topLbh: item?.pis_item_top_LBH,
    bottomLbh: item?.pis_item_bottom_LBH,
    weight: item?.pis_weight,
    totalWeightKey: "total_net",
    topWeightKey: "top_net",
    bottomWeightKey: "bottom_net",
    weightKey: "net_weight",
    remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
  });
  const inspectedBoxEntries = buildComparableMeasurementEntries({
    sizes: item?.inspected_box_sizes,
    singleLbh: item?.inspected_box_LBH,
    topLbh: item?.inspected_box_top_LBH || item?.inspected_top_LBH,
    bottomLbh: item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH,
    weight: item?.inspected_weight,
    totalWeightKey: "total_gross",
    topWeightKey: "top_gross",
    bottomWeightKey: "bottom_gross",
    weightKey: "gross_weight",
    remarkOptions: BOX_SIZE_REMARK_OPTIONS,
  });
  const pisBoxEntries = buildComparableMeasurementEntries({
    sizes: item?.pis_box_sizes,
    singleLbh: item?.pis_box_LBH,
    topLbh: item?.pis_box_top_LBH,
    bottomLbh: item?.pis_box_bottom_LBH,
    weight: item?.pis_weight,
    totalWeightKey: "total_gross",
    topWeightKey: "top_gross",
    bottomWeightKey: "bottom_gross",
    weightKey: "gross_weight",
    remarkOptions: BOX_SIZE_REMARK_OPTIONS,
  });

  const itemComparison = compareMeasurementEntryGroups(
    inspectedItemEntries,
    pisItemEntries,
    { weightKey: "net_weight" },
  );
  const boxComparison = compareMeasurementEntryGroups(
    inspectedBoxEntries,
    pisBoxEntries,
    {
      weightKey: "gross_weight",
      sizeComparator: compareBoxSizeDimensionVariance,
    },
  );

  const pisBarcode = normalizeTextField(
    item?.pis_master_barcode || item?.pis_barcode,
  );
  const inspectedBarcode =
    Number(item?.qc?.master_barcode || item?.qc?.barcode || 0) > 0
      ? String(item?.qc?.master_barcode || item?.qc?.barcode).trim()
      : "";
  const barcodeMismatch =
    item?.barcode_exempted === true
      ? false
      : Boolean(pisBarcode || inspectedBarcode) && pisBarcode !== inspectedBarcode;
  const cbmComparison = compareRoundedCbmValues(
    item?.cbm?.calculated_inspected_total,
    item?.cbm?.calculated_pis_total,
  );

  const hasInspectedData =
    itemComparison.hasInspectedData
    || boxComparison.hasInspectedData
    || cbmComparison.hasInspected
    || Boolean(inspectedBarcode);
  if (!hasInspectedData) {
    return null;
  }

  const diffFields = [];
  if (barcodeMismatch) diffFields.push("Barcode");
  if (itemComparison.sizeMismatch) diffFields.push("Item Size");
  if (itemComparison.weightMismatch) diffFields.push("Item Weight");
  if (boxComparison.sizeMismatch) diffFields.push("Box Size");
  if (boxComparison.weightMismatch) diffFields.push("Box Weight");
  if (cbmComparison.mismatch) diffFields.push("CBM");

  if (diffFields.length === 0) {
    return null;
  }

  return {
    fields: diffFields,
    flags: {
      barcode: barcodeMismatch,
      item_size: itemComparison.sizeMismatch,
      item_weight: itemComparison.weightMismatch,
      box_size: boxComparison.sizeMismatch,
      box_weight: boxComparison.weightMismatch,
      cbm: cbmComparison.mismatch,
    },
  };
};

const PIS_DIFF_ITEM_SELECT = [
  "code",
  "name",
  "description",
  "brand",
  "brand_name",
  "brands",
  "vendors",
  "country_of_origin",
  "barcode_exempted",
  "pis_barcode",
  "pis_master_barcode",
  "pis_inner_barcode",
  "kd",
  "master_country_of_origin",
  "master_barcode",
  "master_master_barcode",
  "master_inner_barcode",
  "mounting_file_needed",
  "mounting_file",
  "pis_weight",
  "inspected_weight",
  "pis_item_LBH",
  "pis_item_sizes",
  "pis_item_top_LBH",
  "pis_item_bottom_LBH",
  "pis_box_LBH",
  "pis_box_sizes",
  "pis_box_mode",
  "pis_box_top_LBH",
  "pis_box_bottom_LBH",
  "inspected_item_LBH",
  "inspected_item_sizes",
  "inspected_item_top_LBH",
  "inspected_item_bottom_LBH",
  "inspected_box_LBH",
  "inspected_box_sizes",
  "inspected_box_mode",
  "inspected_box_top_LBH",
  "inspected_box_bottom_LBH",
  "inspected_top_LBH",
  "inspected_bottom_LBH",
  "cbm",
  "pis_checked_flag",
  "qc.barcode",
  "qc.master_barcode",
  "qc.inner_barcode",
  "image",
  "updatedAt",
].join(" ");

const ITEM_MASTER_SELECT = [
  "code",
  "name",
  "description",
  "brand",
  "brand_name",
  "brands",
  "vendors",
  "country_of_origin",
  "product_type",
  "pis_checked_flag",
  "pis_item_sizes",
  "pis_box_sizes",
  "pis_box_mode",
  "master_item_sizes",
  "master_box_sizes",
  "master_box_mode",
  "updatedAt",
].join(" ");

const PIS_INSPECTION_MASTER_ITEM_SELECT = [
  "code",
  "name",
  "description",
  "brand",
  "brand_name",
  "brands",
  "vendors",
  "pis_item_sizes",
  "pis_box_sizes",
  "pis_box_mode",
  "master_item_sizes",
  "master_box_sizes",
  "master_box_mode",
  "pis_barcode",
  "pis_master_barcode",
  "pis_inner_barcode",
  "master_barcode",
  "master_master_barcode",
  "master_inner_barcode",
  "pis_weight",
  "cbm",
].join(" ");

const ITEM_SIZE_COMPARISON_FIELDS = Object.freeze([
  { key: "L", label: "L" },
  { key: "B", label: "B" },
  { key: "H", label: "H" },
  { key: "net_weight", label: "Net Weight" },
  { key: "gross_weight", label: "Gross Weight" },
]);

const BOX_SIZE_COMPARISON_FIELDS = Object.freeze([
  { key: "L", label: "L" },
  { key: "B", label: "B" },
  { key: "H", label: "H" },
  { key: "net_weight", label: "Net Weight" },
  { key: "gross_weight", label: "Gross Weight" },
  { key: "box_type", label: "Box Type" },
  { key: "item_count_in_inner", label: "Item Count In Inner" },
  { key: "box_count_in_master", label: "Box Count In Master" },
]);

const ITEM_MASTER_ELIGIBLE_MATCH = Object.freeze({
  $or: [
    { "master_item_sizes.0": { $exists: true } },
    { "master_box_sizes.0": { $exists: true } },
    { pis_checked_flag: true },
  ],
});

const getPisDiffBrand = (item = {}) =>
  item?.brand_name
  || item?.brand
  || (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : "");

const getPisDiffVendors = (item = {}) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.join(", ")
    : "";

const formatPisDiffRemarkLabel = (remark = "", fallback = "Value") => {
  const normalized = normalizeTextField(remark).toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
  return normalized.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const formatMeasurementNumberDisplay = (value, { decimals = 2 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Not Set";
  return parsed.toFixed(decimals).replace(/\.?0+$/, "");
};

const formatMeasurementLbhDisplay = (entry = {}) => {
  const L = Number(entry?.L || 0);
  const B = Number(entry?.B || 0);
  const H = Number(entry?.H || 0);
  if (!(L > 0 && B > 0 && H > 0)) return "Not Set";
  return `${formatMeasurementNumberDisplay(L)} x ${formatMeasurementNumberDisplay(B)} x ${formatMeasurementNumberDisplay(H)}`;
};

const formatMeasurementBlockForReport = (
  entries = [],
  { weightKey = "", fallbackWeight = "Not Set" } = {},
) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      sizeDisplay: "Not Set",
      weightDisplay: fallbackWeight,
    };
  }

  const sizeDisplay = entries
    .map((entry, index) => {
      const label = formatPisDiffRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      const sizeValue = formatMeasurementLbhDisplay(entry);
      if (entries.length === 1 && !normalizeTextField(entry?.remark)) {
        return sizeValue;
      }
      return `${label}: ${sizeValue}`;
    })
    .join(" | ");

  const weightDisplay = entries
    .map((entry, index) => {
      const label = formatPisDiffRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      const weightValue = formatMeasurementNumberDisplay(entry?.[weightKey], {
        decimals: 2,
      });
      if (entries.length === 1 && !normalizeTextField(entry?.remark)) {
        return weightValue;
      }
      return `${label}: ${weightValue}`;
    })
    .join(" | ");

  return {
    sizeDisplay,
    weightDisplay,
  };
};

const buildPisDiffMeasurementEntries = ({
  item = {},
  source = "pis",
  group = "item",
} = {}) => {
  const isPis = source === "pis";
  const isItemGroup = group === "item";
  const weight = isPis ? item?.pis_weight : item?.inspected_weight;

  return buildComparableMeasurementEntries({
    sizes: isPis
      ? (isItemGroup ? item?.pis_item_sizes : item?.pis_box_sizes)
      : (isItemGroup ? item?.inspected_item_sizes : item?.inspected_box_sizes),
    singleLbh: isPis
      ? (isItemGroup ? item?.pis_item_LBH : item?.pis_box_LBH)
      : (isItemGroup ? item?.inspected_item_LBH : item?.inspected_box_LBH),
    topLbh: isPis
      ? (isItemGroup ? item?.pis_item_top_LBH : item?.pis_box_top_LBH)
      : (isItemGroup
          ? item?.inspected_item_top_LBH
          : item?.inspected_box_top_LBH || item?.inspected_top_LBH),
    bottomLbh: isPis
      ? (isItemGroup ? item?.pis_item_bottom_LBH : item?.pis_box_bottom_LBH)
      : (isItemGroup
          ? item?.inspected_item_bottom_LBH
          : item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH),
    weight,
    totalWeightKey: isItemGroup ? "total_net" : "total_gross",
    topWeightKey: isItemGroup ? "top_net" : "top_gross",
    bottomWeightKey: isItemGroup ? "bottom_net" : "bottom_gross",
    weightKey: isItemGroup ? "net_weight" : "gross_weight",
    remarkOptions: isItemGroup ? ITEM_SIZE_REMARK_OPTIONS : BOX_SIZE_REMARK_OPTIONS,
  });
};

const buildPisDiffRows = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => {
      const pisDiff = buildPisDiffSummary(item);
      if (!pisDiff) return null;
      return {
        ...item,
        pis_diff: pisDiff,
      };
    })
    .filter(Boolean);

const getPisDiffRowsForMatch = async (match = {}, sort = { updatedAt: -1, code: 1 }) => {
  const items = await Item.find(match)
    .select(PIS_DIFF_ITEM_SELECT)
    .sort(sort)
    .lean();
  return buildPisDiffRows(items);
};

const formatPisDiffValueWithUnit = (value, unit = "") => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Not Set";
  const formatted = parsed.toFixed(2).replace(/\.?0+$/, "");
  return unit ? `${formatted} ${unit}` : formatted;
};

const formatPisDiffSignedDelta = (delta, unit = "") => {
  const parsed = Number(delta);
  if (!Number.isFinite(parsed) || Math.abs(parsed) < MEASUREMENT_COMPARE_TOLERANCE) {
    return "0";
  }
  const formatted = Math.abs(parsed).toFixed(2).replace(/\.?0+$/, "");
  return `${parsed > 0 ? "+" : "-"}${formatted}${unit ? ` ${unit}` : ""}`;
};

const formatPisDiffAbsDelta = (delta, unit = "") => {
  const parsed = Number(delta);
  if (!Number.isFinite(parsed)) return `0${unit ? ` ${unit}` : ""}`;
  const formatted = Math.abs(parsed).toFixed(2).replace(/\.?0+$/, "");
  return `${formatted}${unit ? ` ${unit}` : ""}`;
};

const formatPisDiffCbmValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Not Set";
  return `${parsed.toFixed(CBM_COMPARE_DECIMALS)} cbm`;
};

const formatPisDiffSignedCbmDelta = (delta) => {
  const parsed = Number(delta);
  if (!Number.isFinite(parsed) || parsed === 0) return "0.00 cbm";
  return `${parsed > 0 ? "+" : "-"}${Math.abs(parsed).toFixed(CBM_COMPARE_DECIMALS)} cbm`;
};

const getPisDiffEntryLabel = (entry = null, key = "", fallback = "Value") => {
  const explicitLabel = formatPisDiffRemarkLabel(entry?.remark || "", "");
  if (explicitLabel) return explicitLabel;

  const normalizedKey = normalizeTextField(key).toLowerCase();
  if (!normalizedKey || /^entry\d+$/.test(normalizedKey)) return fallback;
  return formatPisDiffRemarkLabel(normalizedKey, fallback);
};

const getPisDiffOrderedEntryKeys = (inspectedEntries = [], pisEntries = []) => [
  ...new Set([
    ...(Array.isArray(inspectedEntries) ? inspectedEntries : [])
      .map((entry, index) => buildMeasurementEntryKey(entry, index)),
    ...(Array.isArray(pisEntries) ? pisEntries : [])
      .map((entry, index) => buildMeasurementEntryKey(entry, index)),
  ]),
];

const buildPisDiffDetailNote = ({
  subject = "",
  inspected = "",
  pis = "",
  delta = 0,
  unit = "",
  missingSide = "",
} = {}) => {
  if (missingSide === "pis") {
    return `Inspected ${subject} is ${inspected}, while PIS is not set.`;
  }
  if (missingSide === "inspected") {
    return `PIS ${subject} is ${pis}, while inspected value is not set.`;
  }

  const direction = Number(delta) > 0 ? "greater" : "smaller";
  return `Inspected ${subject} is ${formatPisDiffAbsDelta(delta, unit)} ${direction} than PIS (${inspected} vs ${pis}).`;
};

const buildPisDiffMeasurementDetails = ({
  item = {},
  group = "item",
  sizeSection = "Item Size",
  weightSection = "Item Weight",
  weightLabel = "Net Weight",
  weightKey = "net_weight",
  baseLabel = "Item",
  sizeComparator = compareItemSizeDimensionVariance,
} = {}) => {
  const inspectedEntries = buildPisDiffMeasurementEntries({
    item,
    source: "inspected",
    group,
  });
  const pisEntries = buildPisDiffMeasurementEntries({ item, source: "pis", group });
  const inspectedEntriesWithKeys = inspectedEntries.map((entry, index) => ({
    ...entry,
    __key: buildMeasurementEntryKey(entry, index),
  }));
  const pisEntriesWithKeys = pisEntries.map((entry, index) => ({
    ...entry,
    __key: buildMeasurementEntryKey(entry, index),
  }));
  const inspectedMap = new Map(
    inspectedEntriesWithKeys.map((entry) => [entry.__key, entry]),
  );
  const pisMap = new Map(pisEntriesWithKeys.map((entry) => [entry.__key, entry]));
  const orderedKeys = getPisDiffOrderedEntryKeys(inspectedEntries, pisEntries);
  const details = [];

  orderedKeys.forEach((key, index) => {
    const inspectedEntry = inspectedMap.get(key) || null;
    const pisEntry = pisMap.get(key) || null;
    const segment = getPisDiffEntryLabel(
      inspectedEntry || pisEntry,
      key,
      baseLabel,
    );
    const hasInspectedSize = hasAnyPositiveMeasurementLbh(inspectedEntry || {});
    const hasPisSize = hasAnyPositiveMeasurementLbh(pisEntry || {});

    if (hasInspectedSize && hasPisSize) {
      ["L", "B", "H"].forEach((axis) => {
        const inspectedValueRaw = Number(inspectedEntry?.[axis] || 0);
        const pisValueRaw = Number(pisEntry?.[axis] || 0);
        const comparison = sizeComparator(inspectedValueRaw, pisValueRaw);
        if (!comparison.mismatch) {
          return;
        }
        const delta = comparison.delta;

        const inspectedValue = formatPisDiffValueWithUnit(inspectedValueRaw, "cm");
        const pisValue = formatPisDiffValueWithUnit(pisValueRaw, "cm");

        details.push({
          key: `${group}-${key}-${axis}-${index}`,
          section: sizeSection,
          segment,
          attribute: axis,
          inspected: inspectedValue,
          pis: pisValue,
          delta: formatPisDiffSignedDelta(delta, "cm"),
          note: buildPisDiffDetailNote({
            subject: `${segment} ${axis}`,
            inspected: inspectedValue,
            pis: pisValue,
            delta,
            unit: "cm",
          }),
        });
      });
    }

    if (!weightKey) return;

    const inspectedWeight = Number(inspectedEntry?.[weightKey] || 0);
    const pisWeight = Number(pisEntry?.[weightKey] || 0);
    const comparison = compareWeightVariance(inspectedWeight, pisWeight);
    if (!comparison.mismatch) return;

    const inspectedValue = formatPisDiffValueWithUnit(inspectedWeight, "kg");
    const pisValue = formatPisDiffValueWithUnit(pisWeight, "kg");
    const delta = comparison.delta;

    details.push({
      key: `${group}-${key}-${weightKey}-${index}`,
      section: weightSection,
      segment,
      attribute: weightLabel,
      inspected: inspectedValue,
      pis: pisValue,
      delta: formatPisDiffSignedDelta(delta, "kg"),
      note: buildPisDiffDetailNote({
        subject: `${segment} ${weightLabel.toLowerCase()}`,
        inspected: inspectedValue,
        pis: pisValue,
        delta,
        unit: "kg",
      }),
    });
  });

  return details;
};

const buildPisDiffCbmDetails = (item = {}) => {
  const comparison = compareRoundedCbmValues(
    item?.cbm?.calculated_inspected_total,
    item?.cbm?.calculated_pis_total,
  );
  if (!comparison.mismatch) return [];

  const inspectedValue = comparison.hasInspected
    ? formatPisDiffCbmValue(comparison.inspected)
    : "Not Set";
  const pisValue = comparison.hasPis
    ? formatPisDiffCbmValue(comparison.pis)
    : "Not Set";

  return [
    {
      key: "cbm-calculated-total",
      section: "CBM",
      segment: "Calculated",
      attribute: "Total CBM",
      inspected: inspectedValue,
      pis: pisValue,
      delta:
        comparison.hasInspected && comparison.hasPis
          ? formatPisDiffSignedCbmDelta(comparison.delta)
          : (comparison.hasInspected ? "PIS not set" : "Inspected not set"),
      note: buildPisDiffDetailNote({
        subject: "calculated total CBM",
        inspected: inspectedValue,
        pis: pisValue,
        delta: comparison.delta,
        unit: "cbm",
        missingSide: comparison.hasInspected === comparison.hasPis
          ? ""
          : (comparison.hasInspected ? "pis" : "inspected"),
      }),
    },
  ];
};

const buildPisDiffDetailedComparisons = (item = {}) => {
  const details = [
    ...buildPisDiffMeasurementDetails({
      item,
      group: "item",
      sizeSection: "Item Size",
      weightSection: "Item Weight",
      weightLabel: "Net Weight",
      weightKey: "net_weight",
      baseLabel: "Item",
    }),
    ...buildPisDiffMeasurementDetails({
      item,
      group: "box",
      sizeSection: "Box Size",
      weightSection: "Box Weight",
      weightLabel: "Gross Weight",
      weightKey: "gross_weight",
      baseLabel: "Box",
      sizeComparator: compareBoxSizeDimensionVariance,
    }),
    ...buildPisDiffCbmDetails(item),
  ];

  const pisBarcode =
    normalizeTextField(item?.pis_master_barcode || item?.pis_barcode) || "Not Set";
  const inspectedBarcode =
    Number(item?.qc?.master_barcode || item?.qc?.barcode || 0) > 0
      ? normalizeTextField(item?.qc?.master_barcode || item?.qc?.barcode)
      : "Not Set";

  if (
    item?.barcode_exempted !== true
    && item?.pis_diff?.flags?.barcode
    && pisBarcode.toLowerCase() !== inspectedBarcode.toLowerCase()
  ) {
    details.push({
      key: "barcode-master",
      section: "Barcode",
      segment: "Master",
      attribute: "Barcode",
      inspected: formatEan13BarcodeDisplay(inspectedBarcode),
      pis: formatEan13BarcodeDisplay(pisBarcode),
      delta: "Mismatch",
      note: `Inspected barcode ${formatEan13BarcodeDisplay(inspectedBarcode)} does not match PIS barcode ${formatEan13BarcodeDisplay(pisBarcode)}.`,
    });
  }

  return details;
};

const buildPisDiffReportPreviewRow = (item = {}) => {
  const inspectedItemBlock = formatMeasurementBlockForReport(
    buildPisDiffMeasurementEntries({ item, source: "inspected", group: "item" }),
    { weightKey: "net_weight" },
  );
  const pisItemBlock = formatMeasurementBlockForReport(
    buildPisDiffMeasurementEntries({ item, source: "pis", group: "item" }),
    { weightKey: "net_weight" },
  );
  const inspectedBoxBlock = formatMeasurementBlockForReport(
    buildPisDiffMeasurementEntries({ item, source: "inspected", group: "box" }),
    { weightKey: "gross_weight" },
  );
  const pisBoxBlock = formatMeasurementBlockForReport(
    buildPisDiffMeasurementEntries({ item, source: "pis", group: "box" }),
    { weightKey: "gross_weight" },
  );

  return {
    id: String(item?._id || item?.code || ""),
    code: normalizeTextField(item?.code) || "N/A",
    description: normalizeTextField(item?.description || item?.name) || "N/A",
    brand: getPisDiffBrand(item) || "N/A",
    vendors: getPisDiffVendors(item) || "N/A",
    diff_fields: Array.isArray(item?.pis_diff?.fields) ? item.pis_diff.fields : [],
    updated_at: item?.updatedAt ? new Date(item.updatedAt).toISOString().slice(0, 10) : "",
    inspection_report_mismatch: Boolean(item?.inspection_report_mismatch),
    inspection_report_mismatch_count: Number(item?.inspection_report_mismatch_count || 0),
    measurements: {
      inspected_item: inspectedItemBlock,
      pis_item: pisItemBlock,
      inspected_box: inspectedBoxBlock,
      pis_box: pisBoxBlock,
    },
    differences: buildPisDiffDetailedComparisons(item),
  };
};

const formatPisDiffMismatchStatus = (row = {}) => {
  if (row?.inspection_report_mismatch) return "Inspection report mismatch";
  const diffFields = Array.isArray(row?.diff_fields)
    ? row.diff_fields
    : Array.isArray(row?.pis_diff?.fields)
      ? row.pis_diff.fields
      : [];
  return diffFields.length > 0 ? "PIS mismatch" : "No mismatch";
};

const buildPisDiffReportPayload = ({
  checkedDiffRows = [],
  search = "",
  brand = "",
  vendor = "",
} = {}) => {
  const rows = checkedDiffRows.map((item) => buildPisDiffReportPreviewRow(item));
  const uniqueBrands = normalizeDistinctValues(
    checkedDiffRows.map((item) => getPisDiffBrand(item)),
  );
  const uniqueVendors = normalizeDistinctValues(
    checkedDiffRows.flatMap((item) => Array.isArray(item?.vendors) ? item.vendors : []),
  );

  return {
    generated_at: new Date().toISOString(),
    filters: {
      search: normalizeTextField(search) || "All",
      brand: normalizeTextField(brand) || "All",
      vendor: normalizeTextField(vendor) || "All",
    },
    summary: {
      checked_diff_items: rows.length,
      detailed_difference_rows: rows.reduce(
        (sum, row) => sum + (Array.isArray(row?.differences) ? row.differences.length : 0),
        0,
      ),
      unique_brands: uniqueBrands,
      unique_vendors: uniqueVendors,
    },
    rows,
  };
};

const getCheckedPisDiffRowsForReport = async ({ search, brand, vendor } = {}) => {
  const match = {
    ...buildItemMatch({ search, brand, vendor }),
    pis_checked_flag: true,
  };

  const checkedItems = await Item.find(match)
    .select(PIS_DIFF_ITEM_SELECT)
    .sort({ updatedAt: -1, code: 1 })
    .lean();
  const mismatchLookup = await buildInspectionReportMismatchLookup(checkedItems);

  return buildPisDiffRows(checkedItems)
    .filter((item) => item?.pis_checked_flag === true)
    .map((item) => {
      const mismatchEntry = mismatchLookup.get(normalizeLookupKey(item?.code)) || {};
      return {
        ...item,
        inspection_report_mismatch: Boolean(mismatchEntry?.inspection_report_mismatch),
        inspection_report_mismatch_count: Number(
          mismatchEntry?.inspection_report_mismatch_count || 0,
        ),
      };
    });
};

const buildFinalPisCheckMatch = ({ search, brand, vendor } = {}) => {
  const conditions = [
    { pis_checked_flag: true },
    {
      $or: [
        { "master_item_sizes.0": { $exists: true } },
        { "master_box_sizes.0": { $exists: true } },
        { master_barcode: { $exists: true, $ne: "" } },
        { master_master_barcode: { $exists: true, $ne: "" } },
        { master_inner_barcode: { $exists: true, $ne: "" } },
      ],
    },
  ];
  const normalizedSearch = normalizeFilterValue(search);
  const normalizedBrand = normalizeFilterValue(brand);
  const normalizedVendor = normalizeFilterValue(vendor);

  if (normalizedSearch) {
    const escaped = escapeRegex(normalizedSearch);
    conditions.push({
      $or: [
        { code: { $regex: escaped, $options: "i" } },
        { name: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
      ],
    });
  }

  if (normalizedBrand) {
    conditions.push({
      $or: [
        { brand: normalizedBrand },
        { brands: normalizedBrand },
        { brand_name: normalizedBrand },
      ],
    });
  }

  if (normalizedVendor) {
    conditions.push({ vendors: normalizedVendor });
  }

  return { $and: conditions };
};

const buildInspectedWeightFromInspection = (inspection = {}) => {
  const sumEntries = (entries = [], key = "") =>
    (Array.isArray(entries) ? entries : []).reduce(
      (sum, entry) => sum + Math.max(0, toSafeNumber(entry?.[key], 0)),
      0,
    );

  return {
    top_net: 0,
    top_gross: 0,
    bottom_net: 0,
    bottom_gross: 0,
    total_net: sumEntries(inspection?.inspected_item_sizes, "net_weight"),
    total_gross: sumEntries(inspection?.inspected_box_sizes, "gross_weight"),
  };
};

const buildCbmSnapshotFromInspection = (inspection = {}, existingCbm = {}) => {
  const total = normalizeTextField(inspection?.cbm?.total);
  return {
    ...(existingCbm || {}),
    inspected_top: normalizeTextField(inspection?.cbm?.box1) || existingCbm?.inspected_top || "0",
    inspected_bottom:
      normalizeTextField(inspection?.cbm?.box2) || existingCbm?.inspected_bottom || "0",
    inspected_total: total || existingCbm?.inspected_total || "0",
    calculated_inspected_total: total || existingCbm?.calculated_inspected_total || "0",
  };
};

const buildLatestFinalPisInspectionLookup = async (items = []) => {
  const itemCodes = [...new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => normalizeTextField(item?.code))
      .filter(Boolean),
  )];

  if (itemCodes.length === 0) return new Map();

  const itemCodeMatchers = itemCodes.map((code) => ({
    "item.item_code": new RegExp(`^\\s*${escapeRegex(code)}\\s*$`, "i"),
  }));
  const qcRows = await QC.find({ $or: itemCodeMatchers })
    .select("_id item.item_code")
    .lean();
  const qcIdToItemCode = new Map(
    (Array.isArray(qcRows) ? qcRows : []).map((qcDoc) => [
      String(qcDoc?._id || ""),
      normalizeLookupKey(qcDoc?.item?.item_code),
    ]),
  );
  const qcIds = [...qcIdToItemCode.keys()].filter((value) =>
    mongoose.Types.ObjectId.isValid(value),
  );

  if (qcIds.length === 0) return new Map();

  const inspections = await Inspection.find({
    qc: { $in: qcIds.map((value) => new mongoose.Types.ObjectId(value)) },
    $or: [
      { "inspected_item_sizes.0": { $exists: true } },
      { "inspected_box_sizes.0": { $exists: true } },
      { master_barcode: { $exists: true, $ne: "" } },
      { inner_barcode: { $exists: true, $ne: "" } },
      { barcode: { $exists: true, $ne: "" } },
    ],
  })
    .select(
      "qc createdAt updatedAt inspection_date status checked passed cbm barcode master_barcode inner_barcode inspected_item_sizes inspected_box_sizes inspected_box_mode",
    )
    .lean();

  const latestByItemCode = new Map();
  (Array.isArray(inspections) ? inspections : []).forEach((inspection) => {
    if (!isCompletedInspectionForComparison(inspection)) return;
    const itemCodeKey = qcIdToItemCode.get(String(inspection?.qc || ""));
    if (!itemCodeKey) return;
    const inspectionDateTimestamp = toTimestamp(inspection?.inspection_date);
    const sortTimestamp = Math.max(
      inspectionDateTimestamp,
      toTimestamp(inspection?.updatedAt),
      toTimestamp(inspection?.createdAt),
    );
    if (!sortTimestamp) return;

    const previous = latestByItemCode.get(itemCodeKey);
    if (previous && previous.sortTimestamp >= sortTimestamp) return;

    latestByItemCode.set(itemCodeKey, {
      inspection,
      sortTimestamp,
      inspection_date:
        toDisplayDateString(inspection?.inspection_date) ||
        toDisplayDateString(inspection?.createdAt),
    });
  });

  return latestByItemCode;
};

const applyLatestFinalPisInspectionSnapshots = async (items = []) => {
  const latestInspectionLookup = await buildLatestFinalPisInspectionLookup(items);
  return (Array.isArray(items) ? items : []).map((item) => {
    const latestEntry = latestInspectionLookup.get(normalizeLookupKey(item?.code));
    const inspection = latestEntry?.inspection;
    if (!inspection) return item;

    return {
      ...item,
      inspected_item_sizes: Array.isArray(inspection?.inspected_item_sizes)
        ? inspection.inspected_item_sizes
        : [],
      inspected_box_sizes: Array.isArray(inspection?.inspected_box_sizes)
        ? inspection.inspected_box_sizes
        : [],
      inspected_box_mode: inspection?.inspected_box_mode || item?.inspected_box_mode,
      inspected_weight: buildInspectedWeightFromInspection(inspection),
      qc: {
        ...(item?.qc || {}),
        barcode: inspection?.barcode || "",
        master_barcode: inspection?.master_barcode || inspection?.barcode || "",
        inner_barcode: inspection?.inner_barcode || "",
        last_inspected_date: latestEntry?.inspection_date || "",
      },
      cbm: buildCbmSnapshotFromInspection(inspection, item?.cbm || {}),
      updatedAt: latestEntry?.inspection_date || item?.updatedAt,
      final_pis_latest_inspection: {
        inspection_id: String(inspection?._id || ""),
        qc_id: String(inspection?.qc || ""),
        inspection_date: latestEntry?.inspection_date || "",
      },
    };
  });
};

const getFinalPisCheckRowsForQuery = async ({
  search,
  brand,
  vendor,
  diffField,
  sortBy,
  sortOrder,
} = {}) => {
  const match = buildFinalPisCheckMatch({ search, brand, vendor });
  const items = await Item.find(match)
    .select(FINAL_PIS_CHECK_ITEM_SELECT)
    .sort({ updatedAt: -1, code: 1 })
    .lean();
  const latestInspectionItems = await applyLatestFinalPisInspectionSnapshots(items);
  const mismatchLookup = await buildInspectionReportMismatchLookup(latestInspectionItems);

  const rows = buildFinalPisCheckRows(latestInspectionItems).map((row) => {
    const mismatchEntry = mismatchLookup.get(normalizeLookupKey(row?.code)) || {};
    return {
      ...row,
      inspection_report_mismatch: Boolean(mismatchEntry?.inspection_report_mismatch),
      inspection_report_mismatch_count: Number(
        mismatchEntry?.inspection_report_mismatch_count || 0,
      ),
    };
  });
  const filteredRows = filterFinalPisCheckRowsByDiffField(rows, diffField);

  return sortFinalPisCheckRows(filteredRows, {
    sortBy: normalizeFinalPisCheckSortBy(sortBy),
    sortOrder: normalizeSortOrder(sortOrder),
  });
};

const FINAL_PIS_COMMENT_ROLE_KEYS = new Set([
  "manager",
  "product_manager",
  "inspection_manager",
]);

const canCreateFinalPisComment = (user = {}) =>
  FINAL_PIS_COMMENT_ROLE_KEYS.has(normalizeUserRoleKey(user?.role));

const getActorDisplayName = (user = {}) =>
  normalizeTextField(user?.name || user?.username || user?.email || user?.role) || "User";

const notifyAdminsForFinalPisComment = async ({ item = {}, comment = {}, actor = {}, req }) => {
  const adminUsers = await User.find({
    role: { $in: ["admin", "super admin"] },
  })
    .select("_id role")
    .lean();
  const adminUserIds = (Array.isArray(adminUsers) ? adminUsers : [])
    .filter((user) =>
      normalizeUserRoleKey(user?.role) === "admin" || isSuperAdminLikeRole(user?.role))
    .map((user) => user?._id)
    .filter(Boolean);

  if (adminUserIds.length === 0) return [];

  const itemCode = normalizeTextField(item?.code);
  const actorName = getActorDisplayName(actor);
  return notifyUsers(
    adminUserIds,
    {
      type: "pis_update_comment",
      title: "PIS update Comment",
      message: `${actorName} commented on item ${itemCode}: ${comment?.comment || ""}`,
      priority: "critical",
      category: "comment",
      entity_type: "item",
      entity_id: item?._id,
      deep_link: `/final-pis-check?search=${encodeURIComponent(itemCode)}`,
      metadata: {
        item_code: itemCode,
        comment_id: String(comment?._id || ""),
        comment: comment?.comment || "",
        actor_name: actorName,
        actor_role: normalizeTextField(actor?.role),
        source: "final_pis_check",
      },
      created_by: actor?._id || actor?.id || null,
    },
    { realtimeSource: req, dedupe: false },
  );
};

const buildLatestInspectionReportLookup = async (itemCodes = []) => {
  const normalizedCodes = [...new Set(
    (Array.isArray(itemCodes) ? itemCodes : [])
      .map((code) => normalizeTextField(code))
      .filter(Boolean),
  )];

  if (normalizedCodes.length === 0) {
    return new Map();
  }

  const qcRows = await QC.find({
    $or: normalizedCodes.map((code) => ({
      "item.item_code": new RegExp(`^\\s*${escapeRegex(code)}\\s*$`, "i"),
    })),
  })
    .select("_id item.item_code last_inspected_date inspection_record updatedAt createdAt")
    .lean();

  const latestByItemCode = new Map();

  (Array.isArray(qcRows) ? qcRows : []).forEach((qcDoc) => {
    const itemCodeKey = normalizeLookupKey(qcDoc?.item?.item_code);
    if (!itemCodeKey) return;

    const hasInspectionReport =
      Boolean(normalizeTextField(qcDoc?.last_inspected_date))
      || (Array.isArray(qcDoc?.inspection_record) && qcDoc.inspection_record.length > 0);
    if (!hasInspectionReport) return;

    const sortTimestamp = Math.max(
      toTimestamp(qcDoc?.last_inspected_date),
      toTimestamp(qcDoc?.updatedAt),
      toTimestamp(qcDoc?.createdAt),
    );
    const previousEntry = latestByItemCode.get(itemCodeKey);
    if (previousEntry && previousEntry.sortTimestamp >= sortTimestamp) {
      return;
    }

    latestByItemCode.set(itemCodeKey, {
      qc_id: String(qcDoc?._id || "").trim(),
      last_inspected_date: normalizeTextField(qcDoc?.last_inspected_date),
      sortTimestamp,
    });
  });

  return latestByItemCode;
};

const buildInspectionReportMismatchLookup = async (items = []) => {
  const itemByCode = new Map(
    (Array.isArray(items) ? items : [])
      .map((item) => [normalizeLookupKey(item?.code), item])
      .filter(([key]) => Boolean(key)),
  );
  const itemCodes = [...itemByCode.keys()];

  if (itemCodes.length === 0) {
    return new Map();
  }

  const qcRows = await QC.find({
    $or: itemCodes.map((codeKey) => ({
      "item.item_code": new RegExp(`^\\s*${escapeRegex(codeKey)}\\s*$`, "i"),
    })),
  })
    .select("_id item.item_code")
    .lean();

  const qcIdToItemCode = new Map(
    (Array.isArray(qcRows) ? qcRows : []).map((qcDoc) => [
      String(qcDoc?._id || ""),
      normalizeLookupKey(qcDoc?.item?.item_code),
    ]),
  );
  const qcIds = [...qcIdToItemCode.keys()].filter((value) =>
    mongoose.Types.ObjectId.isValid(value),
  );

  if (qcIds.length === 0) {
    return new Map();
  }

  const inspections = await Inspection.find({
    qc: {
      $in: qcIds.map((value) => new mongoose.Types.ObjectId(value)),
    },
  })
    .select("qc inspected_item_sizes inspected_box_sizes inspected_box_mode")
    .lean();

  const mismatchLookup = new Map();

  (Array.isArray(inspections) ? inspections : []).forEach((inspection) => {
    const itemCodeKey = qcIdToItemCode.get(String(inspection?.qc || ""));
    const currentItemDoc = itemByCode.get(itemCodeKey);
    if (!itemCodeKey || !currentItemDoc) return;

    const mismatch = compareInspectionSizeSnapshot(inspection, currentItemDoc);
    const currentEntry = mismatchLookup.get(itemCodeKey) || {
      inspection_report_mismatch: false,
      inspection_report_mismatch_count: 0,
    };

    if (mismatch.has_mismatch) {
      currentEntry.inspection_report_mismatch = true;
      currentEntry.inspection_report_mismatch_count += 1;
    }

    mismatchLookup.set(itemCodeKey, currentEntry);
  });

  return mismatchLookup;
};

exports.getProductDatabaseItems = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const status = req.query.status;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const baseMatch = applyItemDataAccess(
      buildItemMatch({ search, brand, vendor }),
      req.user,
    );
    const statusMatch = buildProductDatabaseStatusMatch(status);
    const match = combineMongoMatches(baseMatch, statusMatch);

    const [
      items,
      totalRecords,
      brandsRaw,
      brandNamesRaw,
      brandsPrimaryRaw,
      vendorsRaw,
      notSetCount,
      createdCount,
      checkedCount,
      approvedCount,
    ] = await Promise.all([
      Item.find(match)
        .select(PRODUCT_DATABASE_ITEM_SELECT)
        .sort({ updatedAt: -1, code: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Item.countDocuments(match),
      Item.distinct("brands", applyItemDataAccess(buildItemMatch({ search, vendor }), req.user)),
      Item.distinct("brand_name", applyItemDataAccess(buildItemMatch({ search, vendor }), req.user)),
      Item.distinct("brand", applyItemDataAccess(buildItemMatch({ search, vendor }), req.user)),
      Item.distinct("vendors", applyItemDataAccess(buildItemMatch({ search, brand }), req.user)),
      Item.countDocuments(
        combineMongoMatches(baseMatch, buildProductDatabaseStatusMatch(NOT_SET_STATUS)),
      ),
      Item.countDocuments(
        combineMongoMatches(baseMatch, buildProductDatabaseStatusMatch(PD_STATUSES.CREATED)),
      ),
      Item.countDocuments(
        combineMongoMatches(baseMatch, buildProductDatabaseStatusMatch(PD_STATUSES.CHECKED)),
      ),
      Item.countDocuments(
        combineMongoMatches(baseMatch, buildProductDatabaseStatusMatch(PD_STATUSES.APPROVED)),
      ),
    ]);

    const itemLookup = new Map(
      (Array.isArray(items) ? items : []).map((item) => [normalizeTextField(item?._id), item]),
    );
    const rows = (Array.isArray(items) ? items : []).map((item) =>
      buildProductDatabaseRow(item, req.user),
    );
    const rowsWithThumbnails = await attachProductImageThumbnails(
      rows,
      itemLookup,
      shouldIncludeProductImageThumbnails(req),
    );

    return res.status(200).json({
      success: true,
      rows: rowsWithThumbnails,
      summary: {
        not_set: notSetCount,
        created: createdCount,
        checked: checkedCount,
        approved: approvedCount,
      },
      filters: {
        search: normalizeFilterValue(search) || "",
        brand: normalizeFilterValue(brand) || "",
        vendor: normalizeFilterValue(vendor) || "",
        status: String(status || "").trim() || "all",
        brand_options: normalizeDistinctValues([
          ...(brandsPrimaryRaw || []),
          ...(brandsRaw || []),
          ...(brandNamesRaw || []),
        ]),
        vendor_options: normalizeDistinctValues(vendorsRaw),
      },
      pagination: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
      },
    });
  } catch (error) {
    console.error("Get Product Database Items Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Product Database items",
    });
  }
};

const RUNNING_ORDER_STATUSES = ["Pending", "Under Inspection", "Inspection Done", "Partial Shipped"];

const buildRunningPoLookup = async (itemCodes = []) => {
  const normalizedCodes = [...new Set(
    (Array.isArray(itemCodes) ? itemCodes : [])
      .map((code) => normalizeTextField(code))
      .filter(Boolean),
  )];

  if (normalizedCodes.length === 0) {
    return new Map();
  }

  const rows = await Order.aggregate([
    {
      $match: {
        archived: { $ne: true },
        status: { $in: RUNNING_ORDER_STATUSES },
        $expr: {
          $in: [
            { $toLower: { $trim: { input: "$item.item_code" } } },
            normalizedCodes.map((code) => normalizeLookupKey(code)),
          ],
        },
      },
    },
    {
      $group: {
        _id: { $toLower: { $trim: { input: "$item.item_code" } } },
        count: { $sum: 1 },
        order_ids: { $addToSet: "$order_id" },
      },
    },
  ]);

  return new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      normalizeLookupKey(row?._id),
      {
        count: Number(row?.count || 0),
        order_ids: normalizeDistinctValues(row?.order_ids || []),
      },
    ]),
  );
};

const buildItemDatabaseRow = ({
  item = {},
  productDatabaseRow = {},
  runningPo = {},
  latestInspectionReport = {},
} = {}) => ({
  id: String(item?._id || productDatabaseRow?.id || ""),
  item_code: item?.code || productDatabaseRow?.code || "",
  brand: item?.brand || item?.brand_name || productDatabaseRow?.brand || productDatabaseRow?.brand_name || "",
  brands: Array.isArray(item?.brands) ? item.brands : [],
  vendor:
    Array.isArray(item?.vendors) && item.vendors.length > 0
      ? item.vendors.filter(Boolean).join(", ")
      : "",
  vendors: Array.isArray(item?.vendors) ? item.vendors : [],
  current_running_pos: Number(runningPo?.count || 0),
  current_running_po_ids: Array.isArray(runningPo?.order_ids) ? runningPo.order_ids : [],
  last_inspected_date: latestInspectionReport?.last_inspected_date || "",
  latest_inspection_report_qc_id: latestInspectionReport?.qc_id || "",
  product_database_status: productDatabaseRow?.pd_checked || NOT_SET_STATUS,
  product_database: productDatabaseRow,
});

exports.getItemDatabaseItems = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const status = req.query.status;
    const runningPo = String(req.query.running_po || "all").trim().toLowerCase();
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const baseMatch = applyItemDataAccess(
      buildItemMatch({ search, brand, vendor }),
      req.user,
    );
    const statusMatch = buildProductDatabaseStatusMatch(status);
    const match = combineMongoMatches(baseMatch, statusMatch);

    const [
      allMatchedItems,
      brandsRaw,
      brandNamesRaw,
      brandsPrimaryRaw,
      vendorsRaw,
    ] = await Promise.all([
      Item.find(match)
        .select(PRODUCT_DATABASE_ITEM_SELECT)
        .sort({ updatedAt: -1, code: 1 })
        .lean(),
      Item.distinct("brands", applyItemDataAccess(buildItemMatch({ search, vendor }), req.user)),
      Item.distinct("brand_name", applyItemDataAccess(buildItemMatch({ search, vendor }), req.user)),
      Item.distinct("brand", applyItemDataAccess(buildItemMatch({ search, vendor }), req.user)),
      Item.distinct("vendors", applyItemDataAccess(buildItemMatch({ search, brand }), req.user)),
    ]);

    const itemCodes = (Array.isArray(allMatchedItems) ? allMatchedItems : []).map((item) => item?.code);
    const [runningPoLookup, latestInspectionReportLookup] = await Promise.all([
      buildRunningPoLookup(itemCodes),
      buildLatestInspectionReportLookup(itemCodes),
    ]);

    const allRows = (Array.isArray(allMatchedItems) ? allMatchedItems : [])
      .map((item) => {
        const itemCodeKey = normalizeLookupKey(item?.code);
        return buildItemDatabaseRow({
          item,
          productDatabaseRow: buildProductDatabaseRow(item, req.user),
          runningPo: runningPoLookup.get(itemCodeKey) || {},
          latestInspectionReport: latestInspectionReportLookup.get(itemCodeKey) || {},
        });
      })
      .filter((row) => {
        if (runningPo === "yes" || runningPo === "running") {
          return Number(row?.current_running_pos || 0) > 0;
        }
        if (runningPo === "no" || runningPo === "none") {
          return Number(row?.current_running_pos || 0) === 0;
        }
        return true;
      });

    const totalRecords = allRows.length;
    const rows = allRows.slice(skip, skip + limit);
    const itemLookup = new Map(
      (Array.isArray(allMatchedItems) ? allMatchedItems : [])
        .map((item) => [normalizeTextField(item?._id), item]),
    );
    const rowsWithThumbnails = await attachProductImageThumbnails(
      rows,
      itemLookup,
      shouldIncludeProductImageThumbnails(req),
    );

    return res.status(200).json({
      success: true,
      rows: rowsWithThumbnails,
      filters: {
        search: normalizeFilterValue(search) || "",
        brand: normalizeFilterValue(brand) || "",
        vendor: normalizeFilterValue(vendor) || "",
        status: String(status || "").trim() || "all",
        running_po: runningPo || "all",
        brand_options: normalizeDistinctValues([
          ...(brandsPrimaryRaw || []),
          ...(brandsRaw || []),
          ...(brandNamesRaw || []),
        ]),
        vendor_options: normalizeDistinctValues(vendorsRaw),
      },
      pagination: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
      },
    });
  } catch (error) {
    console.error("Get Item Database Items Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Item Database items",
    });
  }
};

exports.getItemDatabaseProductDetails = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id.",
      });
    }

    const item = await Item.findById(id).select(PRODUCT_DATABASE_ITEM_SELECT).lean();
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found.",
      });
    }

    const itemCode = item?.code || "";
    const [runningPoLookup, latestInspectionReportLookup] = await Promise.all([
      buildRunningPoLookup([itemCode]),
      buildLatestInspectionReportLookup([itemCode]),
    ]);
    const itemCodeKey = normalizeLookupKey(itemCode);
    const productDatabaseRow = buildProductDatabaseRow(item, req.user);

    return res.status(200).json({
      success: true,
      data: buildItemDatabaseRow({
        item,
        productDatabaseRow,
        runningPo: runningPoLookup.get(itemCodeKey) || {},
        latestInspectionReport: latestInspectionReportLookup.get(itemCodeKey) || {},
      }),
    });
  } catch (error) {
    console.error("Get Item Database Product Details Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Product Database details",
    });
  }
};

exports.getPisUpdateLogs = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(100, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const search = normalizeFilterValue(req.query.search);
    const brand = normalizeFilterValue(req.query.brand);
    const vendor = normalizeFilterValue(req.query.vendor);
    const dataScope = normalizePisUpdateLogScope(
      req.query.data_scope ?? req.query.dataScope,
    );
    const operationType = normalizeTextField(
      req.query.operation_type ?? req.query.operationType,
    ).toLowerCase();
    const missingOnly =
      String(req.query.missing_only ?? req.query.missingOnly ?? "")
        .trim()
        .toLowerCase() === "true";

    const match = {};

    if (search) {
      const escaped = escapeRegex(search);
      match.$or = [
        { item_code: { $regex: escaped, $options: "i" } },
        { item_name: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
      ];
    }

    if (brand) {
      match.brand = brand;
    }

    if (vendor) {
      match.vendors = vendor;
    }

    if (dataScope) {
      match.data_scope = dataScope;
    }

    if (operationType && PIS_UPDATE_LOG_OPERATION_TYPES.has(operationType)) {
      match.operation_type = operationType;
    }

    if (missingOnly) {
      match.missing_fields_count = { $gt: 0 };
    }

    const [logs, totalRecords, brandsRaw, vendorsRaw, scopesRaw, operationsRaw, totalsRaw] =
      await Promise.all([
        PisUpdateLog.find(match)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        PisUpdateLog.countDocuments(match),
        PisUpdateLog.distinct("brand", match),
        PisUpdateLog.distinct("vendors", match),
        PisUpdateLog.distinct("data_scope", match),
        PisUpdateLog.distinct("operation_type", match),
        PisUpdateLog.aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              total_logs: { $sum: 1 },
              total_field_changes: { $sum: "$changed_fields_count" },
              total_missing_fields: { $sum: "$missing_fields_count" },
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
        data_scopes: normalizeDistinctValues(scopesRaw),
        operation_types: normalizeDistinctValues(operationsRaw),
      },
      summary: {
        total_logs: Number(totals?.total_logs || 0),
        total_field_changes: Number(totals?.total_field_changes || 0),
        total_missing_fields: Number(totals?.total_missing_fields || 0),
      },
    });
  } catch (error) {
    console.error("Get PIS Update Logs Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch PIS update logs",
      error: error?.message || String(error),
    });
  }
};

exports.updateProductDatabaseItem = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }
    const beforeItemSnapshot = item.toObject();
    const beforeAuditSnapshot = buildItemUpdateAuditSnapshot(beforeItemSnapshot);

    const result = applyProductDatabaseSave({
      item,
      payload: req.body || {},
      user: req.user,
    });
    appendItemUpdateHistory(item, {
      before: beforeItemSnapshot,
      after: item.toObject(),
      reqUser: req.user,
      action: "product_database_update",
      source: "product_database_modal",
      route: "PATCH /items/:id/product-database",
      metadata: {
        product_database_status: result?.status || item?.pd_checked || "",
        changed: Boolean(result?.changed),
      },
    });
    await item.save();
    const afterAuditSnapshot = buildItemUpdateAuditSnapshot(item.toObject());
    await createPisUpdateLog({
      reqUser: req.user,
      beforeSnapshot: beforeAuditSnapshot,
      afterSnapshot: afterAuditSnapshot,
      operationType: "product_database_update",
      pageName: "Product Database Modal",
      source: "product_database_modal",
      dataScopes: [AUDIT_SCOPES.PD],
      metadata: {
        product_database_status: result?.status || item?.pd_checked || "",
        changed: Boolean(result?.changed),
      },
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: buildProductDatabaseRow(item.toObject(), req.user),
    });
  } catch (error) {
    return handleProductDatabaseError(
      res,
      error,
      "Failed to update Product Database item",
    );
  }
};

exports.checkProductDatabaseItem = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }
    const beforeItemSnapshot = item.toObject();
    const beforeAuditSnapshot = buildItemUpdateAuditSnapshot(beforeItemSnapshot);

    const result = applyProductDatabaseCheck({
      item,
      payload: req.body || {},
      user: req.user,
    });
    appendItemUpdateHistory(item, {
      before: beforeItemSnapshot,
      after: item.toObject(),
      reqUser: req.user,
      action: "product_database_check",
      source: "product_database_modal",
      route: "POST /items/:id/product-database/check",
      metadata: {
        product_database_status: result?.status || item?.pd_checked || "",
        changed: Boolean(result?.changed),
        checked: Boolean(result?.checked),
      },
    });
    await item.save();
    const afterAuditSnapshot = buildItemUpdateAuditSnapshot(item.toObject());
    await createPisUpdateLog({
      reqUser: req.user,
      beforeSnapshot: beforeAuditSnapshot,
      afterSnapshot: afterAuditSnapshot,
      operationType: "product_database_check",
      pageName: "Product Database Modal",
      source: "product_database_modal",
      dataScopes: [AUDIT_SCOPES.PD],
      metadata: {
        product_database_status: result?.status || item?.pd_checked || "",
        changed: Boolean(result?.changed),
        checked: Boolean(result?.checked),
      },
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: buildProductDatabaseRow(item.toObject(), req.user),
    });
  } catch (error) {
    return handleProductDatabaseError(
      res,
      error,
      "Failed to check Product Database item",
    );
  }
};

exports.approveProductDatabaseItem = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }
    const beforeItemSnapshot = item.toObject();
    const beforeAuditSnapshot = buildItemUpdateAuditSnapshot(beforeItemSnapshot);

    const result = applyProductDatabaseApprove({
      item,
      payload: req.body || {},
      user: req.user,
    });
    appendItemUpdateHistory(item, {
      before: beforeItemSnapshot,
      after: item.toObject(),
      reqUser: req.user,
      action: "product_database_approve",
      source: "product_database_modal",
      route: "POST /items/:id/product-database/approve",
      metadata: {
        product_database_status: result?.status || item?.pd_checked || "",
        changed: Boolean(result?.changed),
        approved: Boolean(result?.approved),
      },
    });
    await item.save();
    const afterAuditSnapshot = buildItemUpdateAuditSnapshot(item.toObject());
    await createPisUpdateLog({
      reqUser: req.user,
      beforeSnapshot: beforeAuditSnapshot,
      afterSnapshot: afterAuditSnapshot,
      operationType: "product_database_approve",
      pageName: "Product Database Modal",
      source: "product_database_modal",
      dataScopes: [AUDIT_SCOPES.PD],
      metadata: {
        product_database_status: result?.status || item?.pd_checked || "",
        changed: Boolean(result?.changed),
        approved: Boolean(result?.approved),
      },
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: buildProductDatabaseRow(item.toObject(), req.user),
    });
  } catch (error) {
    return handleProductDatabaseError(
      res,
      error,
      "Failed to approve Product Database item",
    );
  }
};

exports.getItems = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const fileType = req.query.file_type ?? req.query.fileType;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const fileViewMatch = buildItemFileViewMatch(fileType);
    const match = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ search, brand, vendor }), req.user),
      fileViewMatch,
    );
    const brandOptionsMatch = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ search, vendor }), req.user),
      fileViewMatch,
    );
    const vendorOptionsMatch = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ search, brand }), req.user),
      fileViewMatch,
    );
    const codeOptionsMatch = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ brand, vendor }), req.user),
      fileViewMatch,
    );

    const [items, totalRecords, brandsRaw, brandNamesRaw, brandsPrimaryRaw, vendorsRaw, codesRaw] =
      await Promise.all([
        Item.find(match)
          .sort({ updatedAt: -1, code: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Item.countDocuments(match),
        Item.distinct("brands", brandOptionsMatch),
        Item.distinct("brand_name", brandOptionsMatch),
        Item.distinct("brand", brandOptionsMatch),
        Item.distinct("vendors", vendorOptionsMatch),
        Item.distinct("code", codeOptionsMatch),
      ]);

    const latestInspectionReportLookup = await buildLatestInspectionReportLookup(
      (Array.isArray(items) ? items : []).map((item) => item?.code),
    );
    const itemsWithLatestInspectionReport = (Array.isArray(items) ? items : []).map((item) => {
      const latestInspectionReport = latestInspectionReportLookup.get(
        normalizeLookupKey(item?.code),
      );

      return {
        ...item,
        latest_inspection_report_qc_id: latestInspectionReport?.qc_id || "",
        latest_inspection_report_date:
          latestInspectionReport?.last_inspected_date || "",
      };
    });
    const shouldAttachThumbnails =
      normalizeTextField(fileType).toLowerCase() === "product_image" ||
      shouldIncludeProductImageThumbnails(req);
    const itemsWithThumbnails = await attachProductImageThumbnails(
      itemsWithLatestInspectionReport,
      new Map(),
      shouldAttachThumbnails,
    );

    return res.status(200).json({
      success: true,
      data: itemsWithThumbnails,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        brands: normalizeDistinctValues([
          ...(brandsPrimaryRaw || []),
          ...(brandsRaw || []),
          ...(brandNamesRaw || []),
        ]),
        vendors: normalizeDistinctValues(vendorsRaw),
        item_codes: normalizeDistinctValues(codesRaw),
      },
    });
  } catch (error) {
    console.error("Get Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch items",
      error: error.message,
    });
  }
};

exports.getItemMasters = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const match = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ search, brand, vendor }), req.user),
      ITEM_MASTER_ELIGIBLE_MATCH,
    );
    const brandOptionsMatch = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ search, vendor }), req.user),
      ITEM_MASTER_ELIGIBLE_MATCH,
    );
    const vendorOptionsMatch = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ search, brand }), req.user),
      ITEM_MASTER_ELIGIBLE_MATCH,
    );
    const codeOptionsMatch = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ brand, vendor }), req.user),
      ITEM_MASTER_ELIGIBLE_MATCH,
    );

    const [items, totalRecords, brandsRaw, brandNamesRaw, brandsPrimaryRaw, vendorsRaw, codesRaw] =
      await Promise.all([
        Item.find(match)
          .select(ITEM_MASTER_SELECT)
          .sort({ updatedAt: -1, code: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Item.countDocuments(match),
        Item.distinct("brands", brandOptionsMatch),
        Item.distinct("brand_name", brandOptionsMatch),
        Item.distinct("brand", brandOptionsMatch),
        Item.distinct("vendors", vendorOptionsMatch),
        Item.distinct("code", codeOptionsMatch),
      ]);

    return res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        brands: normalizeDistinctValues([
          ...(brandsPrimaryRaw || []),
          ...(brandsRaw || []),
          ...(brandNamesRaw || []),
        ]),
        vendors: normalizeDistinctValues(vendorsRaw),
        item_codes: normalizeDistinctValues(codesRaw),
      },
    });
  } catch (error) {
    console.error("Get Item Masters Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch item masters",
      error: error.message,
    });
  }
};

exports.getPisDiffItems = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const uncheckedPisMatch = { pis_checked_flag: { $ne: true } };
    const match = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ search, brand, vendor }), req.user),
      uncheckedPisMatch,
    );
    const brandOptionsMatch = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ search, vendor }), req.user),
      uncheckedPisMatch,
    );
    const vendorOptionsMatch = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ search, brand }), req.user),
      uncheckedPisMatch,
    );
    const codeOptionsMatch = combineMongoMatches(
      applyItemDataAccess(buildItemMatch({ brand, vendor }), req.user),
      uncheckedPisMatch,
    );

    const [diffRowsBase, brandOptionRows, vendorOptionRows, codeOptionRows] =
      await Promise.all([
        getPisDiffRowsForMatch(match),
        getPisDiffRowsForMatch(brandOptionsMatch, { code: 1 }),
        getPisDiffRowsForMatch(vendorOptionsMatch, { code: 1 }),
        getPisDiffRowsForMatch(codeOptionsMatch, { code: 1 }),
      ]);
    const mismatchLookup = await buildInspectionReportMismatchLookup(diffRowsBase);
    const diffRows = diffRowsBase.map((item) => {
      const mismatchEntry = mismatchLookup.get(normalizeLookupKey(item?.code)) || {};
      return {
        ...item,
        inspection_report_mismatch: Boolean(mismatchEntry?.inspection_report_mismatch),
        inspection_report_mismatch_count: Number(
          mismatchEntry?.inspection_report_mismatch_count || 0,
        ),
      };
    });

    const paginatedRows = diffRows.slice(skip, skip + limit);
    const itemLookup = new Map(
      paginatedRows.map((item) => [normalizeTextField(item?._id), item]),
    );
    const rowsWithThumbnails = await attachProductImageThumbnails(
      paginatedRows,
      itemLookup,
      shouldIncludeProductImageThumbnails(req),
    );

    return res.status(200).json({
      success: true,
      data: rowsWithThumbnails,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(diffRows.length / limit)),
        totalRecords: diffRows.length,
      },
      filters: {
        brands: normalizeDistinctValues(
          brandOptionRows.flatMap((item) => [
            item?.brand,
            item?.brand_name,
            ...(Array.isArray(item?.brands) ? item.brands : []),
          ]),
        ),
        vendors: normalizeDistinctValues(
          vendorOptionRows.flatMap((item) =>
            Array.isArray(item?.vendors) ? item.vendors : [],
          ),
        ),
        item_codes: normalizeDistinctValues(codeOptionRows.map((item) => item?.code)),
      },
    });
  } catch (error) {
    console.error("Get PIS Diff Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch PIS diff items",
      error: error.message,
    });
  }
};

exports.getPisDiffCheckedReportPreview = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;

    const checkedDiffRows = await getCheckedPisDiffRowsForReport({
      search,
      brand,
      vendor,
    });

    if (checkedDiffRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No checked PIS diff items found for preview",
      });
    }

    return res.status(200).json({
      success: true,
      data: buildPisDiffReportPayload({
        checkedDiffRows,
        search,
        brand,
        vendor,
      }),
    });
  } catch (error) {
    console.error("Preview Checked PIS Diff Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to preview checked PIS diff report",
      error: error.message,
    });
  }
};

exports.exportPisDiffCheckedReport = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;

    const checkedDiffRows = await getCheckedPisDiffRowsForReport({
      search,
      brand,
      vendor,
    });

    if (checkedDiffRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No checked PIS diff items found for export",
      });
    }

    const detailColumns = [
      { key: "code", header: "Item Code" },
      { key: "description", header: "Description" },
      { key: "brand", header: "Brand" },
      { key: "vendors", header: "Vendors" },
      { key: "diff_fields", header: "Diff Fields" },
      { key: "inspection_report", header: "Inspection Report" },
      { key: "inspected_item_size", header: "Inspected Item Size" },
      { key: "inspected_item_weight", header: "Inspected Item Net Weight" },
      { key: "pis_item_size", header: "PIS Item Size" },
      { key: "pis_item_weight", header: "PIS Item Net Weight" },
      { key: "inspected_box_size", header: "Inspected Box Size" },
      { key: "inspected_box_weight", header: "Inspected Box Gross Weight" },
      { key: "pis_box_size", header: "PIS Box Size" },
      { key: "pis_box_weight", header: "PIS Box Gross Weight" },
      { key: "inspected_barcode", header: "Inspected Barcode" },
      { key: "pis_barcode", header: "PIS Barcode" },
      { key: "pis_inner_barcode", header: "PIS Inner Barcode" },
      { key: "updated_at", header: "Last Updated" },
    ];

    const detailRows = checkedDiffRows.map((item) => {
      const inspectedItemBlock = formatMeasurementBlockForReport(
        buildPisDiffMeasurementEntries({ item, source: "inspected", group: "item" }),
        { weightKey: "net_weight" },
      );
      const pisItemBlock = formatMeasurementBlockForReport(
        buildPisDiffMeasurementEntries({ item, source: "pis", group: "item" }),
        { weightKey: "net_weight" },
      );
      const inspectedBoxBlock = formatMeasurementBlockForReport(
        buildPisDiffMeasurementEntries({ item, source: "inspected", group: "box" }),
        { weightKey: "gross_weight" },
      );
      const pisBoxBlock = formatMeasurementBlockForReport(
        buildPisDiffMeasurementEntries({ item, source: "pis", group: "box" }),
        { weightKey: "gross_weight" },
      );

      return {
        code: normalizeTextField(item?.code) || "N/A",
        description: normalizeTextField(item?.description || item?.name) || "N/A",
        brand: getPisDiffBrand(item) || "N/A",
        vendors: getPisDiffVendors(item) || "N/A",
        diff_fields: Array.isArray(item?.pis_diff?.fields)
          ? item.pis_diff.fields.join(", ")
          : "N/A",
        inspection_report: formatPisDiffMismatchStatus(item),
        inspected_item_size: inspectedItemBlock.sizeDisplay,
        inspected_item_weight: inspectedItemBlock.weightDisplay,
        pis_item_size: pisItemBlock.sizeDisplay,
        pis_item_weight: pisItemBlock.weightDisplay,
        inspected_box_size: inspectedBoxBlock.sizeDisplay,
        inspected_box_weight: inspectedBoxBlock.weightDisplay,
        pis_box_size: pisBoxBlock.sizeDisplay,
        pis_box_weight: pisBoxBlock.weightDisplay,
        inspected_barcode: formatEan13BarcodeDisplay(
          normalizeTextField(item?.qc?.master_barcode || item?.qc?.barcode),
        ),
        pis_barcode: formatEan13BarcodeDisplay(
          normalizeTextField(item?.pis_master_barcode || item?.pis_barcode),
        ),
        pis_inner_barcode: formatEan13BarcodeDisplay(
          normalizeTextField(item?.pis_inner_barcode),
        ),
        updated_at: item?.updatedAt
          ? new Date(item.updatedAt).toISOString().slice(0, 10)
          : "",
      };
    });
    const reportPreviewRows = checkedDiffRows.map((item) =>
      buildPisDiffReportPreviewRow(item),
    );
    const detailedDiffColumns = [
      { key: "code", header: "Item Code" },
      { key: "description", header: "Description" },
      { key: "brand", header: "Brand" },
      { key: "vendors", header: "Vendors" },
      { key: "section", header: "Area" },
      { key: "segment", header: "Measurement Segment" },
      { key: "attribute", header: "Attribute" },
      { key: "inspected", header: "Inspected" },
      { key: "pis", header: "PIS" },
      { key: "delta", header: "Difference" },
      { key: "note", header: "Remark" },
    ];
    const detailedDiffRows = reportPreviewRows.flatMap((row) =>
      (Array.isArray(row?.differences) ? row.differences : []).map((difference) => ({
        code: row?.code || "N/A",
        description: row?.description || "N/A",
        brand: row?.brand || "N/A",
        vendors: row?.vendors || "N/A",
        section: difference?.section || "",
        segment: difference?.segment || "",
        attribute: difference?.attribute || "",
        inspected: difference?.inspected || "Not Set",
        pis: difference?.pis || "Not Set",
        delta: difference?.delta || "",
        note: difference?.note || "",
      })),
    );

    const filterSummaryRows = [
      ["Checked PIS Diffs Report", ""],
      ["Generated On", new Date().toISOString().slice(0, 19).replace("T", " ")],
      ["Search Filter", normalizeTextField(search) || "All"],
      ["Brand Filter", normalizeTextField(brand) || "All"],
      ["Vendor Filter", normalizeTextField(vendor) || "All"],
      ["Checked Diff Items", checkedDiffRows.length],
      [
        "Unique Brands",
        normalizeDistinctValues(checkedDiffRows.map((item) => getPisDiffBrand(item))).join(", "),
      ],
      [
        "Unique Vendors",
        normalizeDistinctValues(
          checkedDiffRows.flatMap((item) => Array.isArray(item?.vendors) ? item.vendors : []),
        ).join(", "),
      ],
    ];

    const detailHeaderRow = detailColumns.map((column) => column.header);
    const detailDataRows = detailRows.map((row) =>
      detailColumns.map((column) => row[column.key] ?? ""),
    );
    const detailedDiffHeaderRow = detailedDiffColumns.map((column) => column.header);
    const detailedDiffDataRows = detailedDiffRows.map((row) =>
      detailedDiffColumns.map((column) => row[column.key] ?? ""),
    );

    const summarySheet = XLSX.utils.aoa_to_sheet(filterSummaryRows);
    summarySheet["!cols"] = [{ wch: 24 }, { wch: 90 }];

    const detailSheet = XLSX.utils.aoa_to_sheet([detailHeaderRow, ...detailDataRows]);
    detailSheet["!cols"] = detailColumns.map((column, columnIndex) => {
      const maxDataLength = Math.max(
        ...detailDataRows.map((row) => String(row[columnIndex] ?? "").length),
        column.header.length,
      );
      return { wch: Math.min(40, Math.max(14, maxDataLength + 2)) };
    });
    const detailedDiffSheet = XLSX.utils.aoa_to_sheet([
      detailedDiffHeaderRow,
      ...detailedDiffDataRows,
    ]);
    detailedDiffSheet["!cols"] = detailedDiffColumns.map((column, columnIndex) => {
      const maxDataLength = Math.max(
        ...detailedDiffDataRows.map((row) => String(row[columnIndex] ?? "").length),
        column.header.length,
      );
      return { wch: Math.min(55, Math.max(14, maxDataLength + 2)) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Checked PIS Diffs");
    XLSX.utils.book_append_sheet(workbook, detailedDiffSheet, "Detailed Differences");

    const fileBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    const fileDate = new Date().toISOString().slice(0, 10);
    const fileName = `pis-diffs-checked-${fileDate}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Export Checked PIS Diff Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export checked PIS diff report",
      error: error.message,
    });
  }
};

exports.getFinalPisCheckItems = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const diffField = req.query.diff_field;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const sortBy = req.query.sortBy;
    const sortOrder = req.query.sortOrder;

    const rows = await getFinalPisCheckRowsForQuery({
      search,
      brand,
      vendor,
      diffField,
      sortBy,
      sortOrder,
    });

    return res.status(200).json(
      buildFinalPisCheckPayload({
        rows,
        search,
        brand,
        vendor,
        diffField,
        page,
        limit,
      }),
    );
  } catch (error) {
    console.error("Get Final PIS Check Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Final PIS Check items",
      error: error.message,
    });
  }
};

exports.getFinalPisCheckOptions = async (req, res) => {
  try {
    const rows = await getFinalPisCheckRowsForQuery({
      search: req.query.search,
      brand: req.query.brand,
      vendor: req.query.vendor,
      sortBy: "code",
      sortOrder: "asc",
    });

    return res.status(200).json({
      success: true,
      data: buildFinalPisCheckOptions(rows),
    });
  } catch (error) {
    console.error("Get Final PIS Check Options Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Final PIS Check options",
      error: error.message,
    });
  }
};

exports.createFinalPisCheckComment = async (req, res) => {
  try {
    if (!canCreateFinalPisComment(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only manager roles can add Final PIS Check comments.",
      });
    }

    const itemCodeInput = normalizeTextField(req.params.code || req.params.itemCode);
    const commentText = normalizeTextField(req.body?.comment);

    if (!itemCodeInput) {
      return res.status(400).json({
        success: false,
        message: "Item code is required.",
      });
    }
    if (!commentText) {
      return res.status(400).json({
        success: false,
        message: "Comment is required.",
      });
    }
    if (commentText.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Comment cannot exceed 1000 characters.",
      });
    }

    const itemCodeMatch = new RegExp(`^\\s*${escapeRegex(itemCodeInput)}\\s*$`, "i");
    const item = await Item.findOne({ code: itemCodeMatch }).select(
      "_id code pis_update_comments",
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found.",
      });
    }

    const comment = {
      comment: commentText,
      item_code: item.code || itemCodeInput,
      created_by: req.user?._id || req.user?.id || null,
      created_by_name: getActorDisplayName(req.user),
      created_by_role: normalizeTextField(req.user?.role),
      created_at: new Date(),
    };

    item.pis_update_comments.push(comment);
    await item.save();
    const savedComment = item.pis_update_comments[item.pis_update_comments.length - 1];

    await notifyAdminsForFinalPisComment({
      item,
      comment: savedComment,
      actor: req.user,
      req,
    });

    return res.status(201).json({
      success: true,
      message: "Comment added.",
      data: {
        id: String(savedComment?._id || ""),
        comment: savedComment?.comment || commentText,
        created_by_name: savedComment?.created_by_name || getActorDisplayName(req.user),
        created_by_role: savedComment?.created_by_role || normalizeTextField(req.user?.role),
        created_at: savedComment?.created_at || comment.created_at,
      },
    });
  } catch (error) {
    console.error("Create Final PIS Check Comment Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add Final PIS Check comment",
      error: error.message,
    });
  }
};

exports.getFinalPisCheckReportPreview = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const diffField = req.query.diff_field;
    const sortBy = req.query.sortBy;
    const sortOrder = req.query.sortOrder;

    const rows = await getFinalPisCheckRowsForQuery({
      search,
      brand,
      vendor,
      diffField,
      sortBy,
      sortOrder,
    });

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No Final PIS Check items found for preview",
      });
    }

    return res.status(200).json({
      success: true,
      data: buildFinalPisCheckReportPayload({
        rows,
        search,
        brand,
        vendor,
        diffField,
      }),
    });
  } catch (error) {
    console.error("Preview Final PIS Check Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to preview Final PIS Check report",
      error: error.message,
    });
  }
};

exports.exportFinalPisCheckReport = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const diffField = req.query.diff_field;
    const sortBy = req.query.sortBy;
    const sortOrder = req.query.sortOrder;

    const rows = await getFinalPisCheckRowsForQuery({
      search,
      brand,
      vendor,
      diffField,
      sortBy,
      sortOrder,
    });

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No Final PIS Check items found for export",
      });
    }

    const reportPayload = buildFinalPisCheckReportPayload({
      rows,
      search,
      brand,
      vendor,
      diffField,
    });
    const detailColumns = [
      { key: "code", header: "Item Code" },
      { key: "description", header: "Description" },
      { key: "brand", header: "Brand" },
      { key: "vendors", header: "Vendors" },
      { key: "diff_fields", header: "Diff Fields" },
      { key: "inspection_report", header: "Inspection Report" },
      { key: "inspected_item_size", header: "Inspected Item Size" },
      { key: "inspected_item_weight", header: "Inspected Item Net Weight" },
      { key: "pis_item_size", header: "PIS Item Size" },
      { key: "pis_item_weight", header: "PIS Item Net Weight" },
      { key: "inspected_box_size", header: "Inspected Box Size" },
      { key: "inspected_box_weight", header: "Inspected Box Gross Weight" },
      { key: "pis_box_size", header: "PIS Box Size" },
      { key: "pis_box_weight", header: "PIS Box Gross Weight" },
      { key: "updated_at", header: "Last Updated" },
    ];
    const detailRows = rows.map((row) => ({
      code: row?.code || "N/A",
      description: row?.description || "N/A",
      brand: row?.brand || "N/A",
      vendors: row?.vendors || "N/A",
      diff_fields: Array.isArray(row?.diff_fields) ? row.diff_fields.join(", ") : "",
      inspection_report: formatPisDiffMismatchStatus(row),
      inspected_item_size: row?.measurements?.inspected_item?.sizeDisplay || "Not Set",
      inspected_item_weight: row?.measurements?.inspected_item?.weightDisplay || "Not Set",
      pis_item_size: row?.measurements?.pis_item?.sizeDisplay || "Not Set",
      pis_item_weight: row?.measurements?.pis_item?.weightDisplay || "Not Set",
      inspected_box_size: row?.measurements?.inspected_box?.sizeDisplay || "Not Set",
      inspected_box_weight: row?.measurements?.inspected_box?.weightDisplay || "Not Set",
      pis_box_size: row?.measurements?.pis_box?.sizeDisplay || "Not Set",
      pis_box_weight: row?.measurements?.pis_box?.weightDisplay || "Not Set",
      updated_at: row?.updated_at || "",
    }));
    const detailedDiffColumns = [
      { key: "code", header: "Item Code" },
      { key: "description", header: "Description" },
      { key: "brand", header: "Brand" },
      { key: "vendors", header: "Vendors" },
      { key: "section", header: "Area" },
      { key: "segment", header: "Measurement Segment" },
      { key: "attribute", header: "Attribute" },
      { key: "inspected", header: "Inspected" },
      { key: "pis", header: "PIS" },
      { key: "delta", header: "Difference" },
      { key: "note", header: "Remark" },
    ];
    const detailedDiffRows = rows.flatMap((row) =>
      (Array.isArray(row?.differences) ? row.differences : []).map((difference) => ({
        code: row?.code || "N/A",
        description: row?.description || "N/A",
        brand: row?.brand || "N/A",
        vendors: row?.vendors || "N/A",
        section: difference?.section || "",
        segment: difference?.segment || "",
        attribute: difference?.attribute || "",
        inspected: difference?.inspected || "Not Set",
        pis: difference?.pis || "Not Set",
        delta: difference?.delta || "",
        note: difference?.note || "",
      })),
    );
    const filterSummaryRows = [
      ["Final PIS Check Report", ""],
      ["Generated On", new Date().toISOString().slice(0, 19).replace("T", " ")],
      ["Search Filter", reportPayload?.filters?.search || "All"],
      ["Brand Filter", reportPayload?.filters?.brand || "All"],
      ["Vendor Filter", reportPayload?.filters?.vendor || "All"],
      ["Difference Field Filter", reportPayload?.filters?.diff_field || "All"],
      ["Items With Difference", Number(reportPayload?.summary?.checked_diff_items || 0)],
      [
        "Detailed Difference Rows",
        Number(reportPayload?.summary?.detailed_difference_rows || 0),
      ],
      [
        "Unique Brands",
        Array.isArray(reportPayload?.summary?.unique_brands)
          ? reportPayload.summary.unique_brands.join(", ")
          : "",
      ],
      [
        "Unique Vendors",
        Array.isArray(reportPayload?.summary?.unique_vendors)
          ? reportPayload.summary.unique_vendors.join(", ")
          : "",
      ],
      ...Object.entries(reportPayload?.summary?.diff_field_counts || {}).map(
        ([field, count]) => [`${field} Count`, Number(count || 0)],
      ),
    ];

    const detailHeaderRow = detailColumns.map((column) => column.header);
    const detailDataRows = detailRows.map((row) =>
      detailColumns.map((column) => row[column.key] ?? ""),
    );
    const detailedDiffHeaderRow = detailedDiffColumns.map((column) => column.header);
    const detailedDiffDataRows = detailedDiffRows.map((row) =>
      detailedDiffColumns.map((column) => row[column.key] ?? ""),
    );

    const summarySheet = XLSX.utils.aoa_to_sheet(filterSummaryRows);
    summarySheet["!cols"] = [{ wch: 28 }, { wch: 90 }];

    const detailSheet = XLSX.utils.aoa_to_sheet([detailHeaderRow, ...detailDataRows]);
    detailSheet["!cols"] = detailColumns.map((column, columnIndex) => {
      const maxDataLength = Math.max(
        ...detailDataRows.map((row) => String(row[columnIndex] ?? "").length),
        column.header.length,
      );
      return { wch: Math.min(44, Math.max(14, maxDataLength + 2)) };
    });

    const detailedDiffSheet = XLSX.utils.aoa_to_sheet([
      detailedDiffHeaderRow,
      ...detailedDiffDataRows,
    ]);
    detailedDiffSheet["!cols"] = detailedDiffColumns.map((column, columnIndex) => {
      const maxDataLength = Math.max(
        ...detailedDiffDataRows.map((row) => String(row[columnIndex] ?? "").length),
        column.header.length,
      );
      return { wch: Math.min(56, Math.max(14, maxDataLength + 2)) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Final PIS Check");
    XLSX.utils.book_append_sheet(workbook, detailedDiffSheet, "Detailed Differences");

    const fileBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    const fileDate = new Date().toISOString().slice(0, 10);
    const fileName = `final-pis-check-${fileDate}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Export Final PIS Check Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export Final PIS Check report",
      error: error.message,
    });
  }
};

exports.getItemOrdersHistory = async (req, res) => {
  try {
    const itemCodeInput = String(req.params.itemCode || "").trim();
    if (!itemCodeInput) {
      return res.status(400).json({
        success: false,
        message: "Item code is required",
      });
    }

    const escapedItemCode = escapeRegex(itemCodeInput);
    const itemCodeMatch = new RegExp(`^\\s*${escapedItemCode}\\s*$`, "i");

    const [itemDoc, orders] = await Promise.all([
      Item.findOne({ code: itemCodeMatch })
        .select("code name description brand brand_name brands vendors")
        .lean(),
      Order.find({ "item.item_code": itemCodeMatch })
        .select(
          "order_id item brand vendor order_date ETD revised_ETD status quantity archived qc_record updatedAt",
        )
        .populate({
          path: "qc_record",
          select: "inspector last_inspected_date quantities request_history inspection_record",
          populate: [
            {
              path: "inspector",
              select: "name email",
            },
            {
              path: "inspection_record",
              select:
                "inspection_date requested_date vendor_requested vendor_offered checked passed pending_after remarks createdAt inspector",
              populate: {
                path: "inspector",
                select: "name email",
              },
            },
          ],
        })
        .sort({ order_date: -1, ETD: -1, updatedAt: -1, order_id: 1 })
        .lean(),
    ]);

    const orderRows = (Array.isArray(orders) ? orders : []).map((order) => {
      const qcRecord =
        order?.qc_record && typeof order.qc_record === "object"
          ? order.qc_record
          : null;
      const inspectionRecords = Array.isArray(qcRecord?.inspection_record)
        ? qcRecord.inspection_record
        : [];

      const mappedInspections = inspectionRecords
        .map((record) => ({
          qc_id: String(qcRecord?._id || ""),
          id: String(record?._id || ""),
          inspector_name: resolveInspectorName(record?.inspector) || "N/A",
          inspection_date: String(record?.inspection_date || "").trim(),
          requested_date: String(record?.requested_date || "").trim(),
          vendor_requested: Math.max(0, toSafeNumber(record?.vendor_requested, 0)),
          vendor_offered: Math.max(0, toSafeNumber(record?.vendor_offered, 0)),
          checked: Math.max(0, toSafeNumber(record?.checked, 0)),
          passed: Math.max(0, toSafeNumber(record?.passed, 0)),
          pending_after: Math.max(0, toSafeNumber(record?.pending_after, 0)),
          remarks: String(record?.remarks || "").trim(),
          source: "inspection_record",
          __sortTime: Math.max(
            toTimestamp(record?.inspection_date),
            toTimestamp(record?.createdAt),
          ),
        }))
        .sort((a, b) => (b.__sortTime || 0) - (a.__sortTime || 0))
        .map(({ __sortTime, ...rest }) => rest);

      if (mappedInspections.length === 0 && qcRecord) {
        mappedInspections.push({
          id: `qc-snapshot-${order?._id || ""}`,
          inspector_name: resolveInspectorName(qcRecord?.inspector) || "N/A",
          inspection_date: String(qcRecord?.last_inspected_date || "").trim(),
          requested_date: "",
          vendor_requested: Math.max(
            0,
            toSafeNumber(qcRecord?.quantities?.quantity_requested, 0),
          ),
          vendor_offered: Math.max(
            0,
            toSafeNumber(qcRecord?.quantities?.vendor_provision, 0),
          ),
          checked: Math.max(0, toSafeNumber(qcRecord?.quantities?.qc_checked, 0)),
          passed: Math.max(0, toSafeNumber(qcRecord?.quantities?.qc_passed, 0)),
          pending_after: Math.max(
            0,
            toSafeNumber(qcRecord?.quantities?.pending, 0),
          ),
          remarks: "",
          source: "qc_snapshot",
        });
      }

      return {
        id: String(order?._id || ""),
        order_id: String(order?.order_id || "").trim(),
        brand: String(order?.brand || "").trim(),
        vendor: String(order?.vendor || "").trim(),
        status: deriveOrderStatus({ orderEntry: order }),
        order_date: order?.order_date || null,
        ETD: order?.ETD || null,
        revised_ETD: order?.revised_ETD || null,
        quantity: Math.max(0, toSafeNumber(order?.quantity, 0)),
        archived: Boolean(order?.archived),
        item_code: String(order?.item?.item_code || "").trim(),
        item_description: String(order?.item?.description || "").trim(),
        inspections: mappedInspections,
      };
    });

    return res.status(200).json({
      success: true,
      item_code: itemDoc?.code || itemCodeInput,
      item: itemDoc || null,
      data: orderRows,
      summary: {
        total_orders: orderRows.length,
        total_inspection_rows: orderRows.reduce(
          (sum, entry) => sum + (Array.isArray(entry?.inspections) ? entry.inspections.length : 0),
          0,
        ),
      },
    });
  } catch (error) {
    console.error("Get Item Orders History Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch item order history",
      error: error.message,
    });
  }
};

const buildItemDetailFilePayloads = async (item = {}) => {
  const fileEntries = [
    { type: "product_image", field: "image", fallbackBaseName: "product-image", extension: ".jpg" },
    { type: "cad_file", field: "cad_file", fallbackBaseName: "item-cad", extension: ".pdf" },
    { type: "pis_file", field: "pis_file", fallbackBaseName: "item-pis", extension: ".pdf" },
    { type: "assembly_file", field: "assembly_file", fallbackBaseName: "item-assembly", extension: ".pdf" },
    { type: "mounting_file", field: "mounting_file", fallbackBaseName: "item-mounting", extension: ".pdf" },
    { type: "packeging_ppt", field: "packeging_ppt", fallbackBaseName: "item-packaging-ppt", extension: ".pptx" },
  ];

  const pairs = await Promise.all(
    fileEntries.map(async (entry) => {
      try {
        const file = await buildItemFileResponse(item?.[entry.field], {
          itemCode: normalizeTextField(item?.code || item?._id),
          fallbackBaseName: entry.fallbackBaseName,
          extension: entry.extension,
        });
        return [entry.field, file || normalizeStoredItemFile(item?.[entry.field] || {})];
      } catch (error) {
        console.error("Build item detail file URL failed:", {
          itemId: item?._id,
          itemCode: item?.code,
          field: entry.field,
          error: error?.message || String(error),
        });
        return [entry.field, normalizeStoredItemFile(item?.[entry.field] || {})];
      }
    }),
  );

  return pairs.reduce((accumulator, [field, file]) => {
    accumulator[field] = file;
    return accumulator;
  }, {});
};

exports.getItemDetails = async (req, res) => {
  try {
    const itemCodeInput = String(req.params.itemCode || "").trim();
    if (!itemCodeInput) {
      return res.status(400).json({
        success: false,
        message: "Item code is required",
      });
    }

    const itemCodeMatch = new RegExp(`^\\s*${escapeRegex(itemCodeInput)}\\s*$`, "i");
    const item = await Item.findOne({ code: itemCodeMatch })
      .select(ITEM_DETAILS_SELECT)
      .lean();

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const orders = await Order.find({ "item.item_code": itemCodeMatch })
      .select("order_id item brand vendor status quantity archived qc_record updatedAt order_date ETD revised_ETD")
      .populate({
        path: "qc_record",
        select: "last_inspected_date request_date quantities inspection_record updatedAt",
        populate: {
          path: "inspection_record",
          select: "inspection_date requested_date checked passed createdAt updatedAt",
        },
      })
      .sort({ order_date: -1, ETD: -1, updatedAt: -1, order_id: 1 })
      .lean();

    const orderRows = (Array.isArray(orders) ? orders : []).map((order) => {
      const qcRecord =
        order?.qc_record && typeof order.qc_record === "object"
          ? order.qc_record
          : null;
      const inspectionRecords = Array.isArray(qcRecord?.inspection_record)
        ? qcRecord.inspection_record
        : [];
      const latestInspection = inspectionRecords
        .map((record) => ({
          record,
          sortTime: Math.max(
            toTimestamp(record?.inspection_date),
            toTimestamp(record?.updatedAt),
            toTimestamp(record?.createdAt),
          ),
        }))
        .sort((left, right) => right.sortTime - left.sortTime)[0]?.record || null;

      return {
        id: String(order?._id || ""),
        po: String(order?.order_id || "").trim(),
        qc_id: String(qcRecord?._id || ""),
        order_date: order?.order_date || "",
        etd: order?.ETD || "",
        last_inspected_date: String(
          latestInspection?.inspection_date ||
            qcRecord?.last_inspected_date ||
            "",
        ).trim(),
        order_quantity: Math.max(0, toSafeNumber(order?.quantity, 0)),
        current_status: deriveOrderStatus({ orderEntry: order }),
        inspection_count: inspectionRecords.length,
      };
    });

    const files = await buildItemDetailFilePayloads(item);
    const productDatabaseRow = buildProductDatabaseRow(item, req.user);

    return res.status(200).json({
      success: true,
      data: {
        item: {
          ...item,
          ...files,
        },
        product_database: productDatabaseRow,
        orders: orderRows,
        summary: {
          total_orders: orderRows.length,
          total_inspection_records: orderRows.reduce(
            (sum, row) => sum + Number(row?.inspection_count || 0),
            0,
          ),
        },
      },
    });
  } catch (error) {
    console.error("Get Item Details Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch item details",
      error: error.message,
    });
  }
};

const isCompletedInspectionForComparison = (inspection = {}) => {
  const status = normalizeTextField(inspection?.status).toLowerCase();
  if (status === "pending" || status === "goods not ready" || status === "rejected") {
    return false;
  }
  if (status === "transfered" || status === "transferred") return false;

  return (
    status === "inspection done" ||
    Math.max(0, toSafeNumber(inspection?.checked, 0)) > 0 ||
    Math.max(0, toSafeNumber(inspection?.passed, 0)) > 0
  );
};

const hasInspectionSizeDataForComparison = (inspection = {}) => {
  const hasSizeEntries = (entries = [], fields = []) =>
    (Array.isArray(entries) ? entries : []).some((entry = {}) =>
      entry &&
      typeof entry === "object" &&
      fields.some((field) => {
        const value = entry?.[field];
        if (value === null || value === undefined) return false;
        if (typeof value === "string") return value.trim() !== "";
        return true;
      }),
    );

  return (
    hasSizeEntries(inspection?.inspected_item_sizes, [
      "L",
      "B",
      "H",
      "net_weight",
      "gross_weight",
    ]) ||
    hasSizeEntries(inspection?.inspected_box_sizes, [
      "L",
      "B",
      "H",
      "net_weight",
      "gross_weight",
      "box_type",
      "item_count_in_inner",
      "box_count_in_master",
    ])
  );
};

const buildComparisonInspectionRow = (inspection = {}, order = {}) => ({
  inspection_id: String(inspection?._id || ""),
  qc_id: String(inspection?.qc || order?.qc_record || ""),
  order_id: String(order?.order_id || "").trim(),
  order_date: order?.order_date || null,
  createdAt: inspection?.createdAt || null,
  inspection_date: String(inspection?.inspection_date || "").trim(),
  brand: String(order?.brand || "").trim(),
  vendor: String(order?.vendor || "").trim(),
  status: String(inspection?.status || "").trim(),
  checked: Math.max(0, toSafeNumber(inspection?.checked, 0)),
  passed: Math.max(0, toSafeNumber(inspection?.passed, 0)),
  pending_after: Math.max(0, toSafeNumber(inspection?.pending_after, 0)),
  cbm: inspection?.cbm || {},
  barcode: inspection?.barcode ?? "",
  master_barcode: inspection?.master_barcode ?? "",
  inner_barcode: inspection?.inner_barcode ?? "",
  inspected_item_sizes: Array.isArray(inspection?.inspected_item_sizes)
    ? inspection.inspected_item_sizes
    : [],
  inspected_box_sizes: Array.isArray(inspection?.inspected_box_sizes)
    ? inspection.inspected_box_sizes
    : [],
  inspected_box_mode: String(inspection?.inspected_box_mode || "").trim(),
});

exports.getPisInspectionMasterComparison = async (req, res) => {
  try {
    const itemCodeInput = String(req.params.code || req.params.itemCode || "").trim();
    if (!itemCodeInput) {
      return res.status(400).json({
        success: false,
        message: "Item code is required",
      });
    }

    const escapedItemCode = escapeRegex(itemCodeInput);
    const itemCodeMatch = new RegExp(`^\\s*${escapedItemCode}\\s*$`, "i");
    const item = await Item.findOne({ code: itemCodeMatch })
      .select(PIS_INSPECTION_MASTER_ITEM_SELECT)
      .lean();

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const orders = await Order.find({
      "item.item_code": itemCodeMatch,
      qc_record: { $ne: null },
    })
      .select("order_id item.item_code brand vendor quantity qc_record order_date updatedAt status")
      .sort({ order_date: -1, updatedAt: -1, order_id: 1 })
      .lean();

    const orderByQcId = new Map(
      (Array.isArray(orders) ? orders : [])
        .map((order) => [String(order?.qc_record || ""), order])
        .filter(([qcId]) => mongoose.Types.ObjectId.isValid(qcId)),
    );
    const qcObjectIds = [...orderByQcId.keys()].map(
      (qcId) => new mongoose.Types.ObjectId(qcId),
    );

    const inspections = qcObjectIds.length > 0
      ? await Inspection.find({
          qc: { $in: qcObjectIds },
          $or: [
            { "inspected_item_sizes.0": { $exists: true } },
            { "inspected_box_sizes.0": { $exists: true } },
          ],
        })
          .select(
            "qc createdAt inspection_date status inspected_item_sizes inspected_box_sizes inspected_box_mode checked passed pending_after cbm barcode master_barcode inner_barcode",
          )
          .lean()
      : [];

    const validInspectionRows = (Array.isArray(inspections) ? inspections : [])
      .filter((inspection) =>
        isCompletedInspectionForComparison(inspection) &&
        hasInspectionSizeDataForComparison(inspection))
      .map((inspection) => {
        const order = orderByQcId.get(String(inspection?.qc || "")) || {};
        return {
          ...buildComparisonInspectionRow(inspection, order),
          __sortTime: Math.max(
            toTimestamp(inspection?.createdAt),
            toTimestamp(inspection?.inspection_date),
          ),
        };
      })
      .sort((left, right) => (right.__sortTime || 0) - (left.__sortTime || 0));

    const comparisonInspectionsByPo = [];
    const seenOrderIds = new Set();
    validInspectionRows.forEach((inspection) => {
      const orderKey = normalizeTextField(inspection?.order_id).toLowerCase();
      if (!orderKey || seenOrderIds.has(orderKey)) return;
      seenOrderIds.add(orderKey);
      comparisonInspectionsByPo.push(inspection);
    });

    const hasRequiredPoInspectionCount = comparisonInspectionsByPo.length >= 3;
    const comparisonInspections = hasRequiredPoInspectionCount
      ? comparisonInspectionsByPo
          .slice(0, 3)
          .map(({ __sortTime, ...inspection }) => inspection)
      : [];

    const inspectionSizeSources = [0, 1, 2].map((index) =>
      comparisonInspections[index] || {},
    );

    const sections = hasRequiredPoInspectionCount
      ? [
          {
            key: "item_sizes",
            title: "Item Sizes",
            rows: buildComparisonRows({
              pisEntries: item?.pis_item_sizes,
              inspectionEntries: inspectionSizeSources.map(
                (inspection) => inspection?.inspected_item_sizes || [],
              ),
              masterEntries: item?.master_item_sizes,
              fields: ITEM_SIZE_COMPARISON_FIELDS,
            }),
          },
          {
            key: "box_sizes",
            title: "Box Sizes",
            rows: buildComparisonRows({
              pisEntries: item?.pis_box_sizes,
              inspectionEntries: inspectionSizeSources.map(
                (inspection) => inspection?.inspected_box_sizes || [],
              ),
              masterEntries: item?.master_box_sizes,
              fields: BOX_SIZE_COMPARISON_FIELDS,
            }),
          },
        ]
      : [];

    return res.status(200).json({
      success: true,
      item: {
        code: item?.code || itemCodeInput,
        description: item?.description || item?.name || "",
        brand:
          item?.brand_name ||
          item?.brand ||
          (Array.isArray(item?.brands) ? item.brands[0] : "") ||
          "",
        brands: Array.isArray(item?.brands) ? item.brands : [],
        vendors: Array.isArray(item?.vendors) ? item.vendors : [],
        pis_box_mode: item?.pis_box_mode || "",
        master_box_mode: item?.master_box_mode || "",
        barcodes: {
          pis_barcode: item?.pis_barcode || "",
          pis_master_barcode: item?.pis_master_barcode || "",
          pis_inner_barcode: item?.pis_inner_barcode || "",
          master_barcode: item?.master_barcode || "",
          master_master_barcode: item?.master_master_barcode || "",
          master_inner_barcode: item?.master_inner_barcode || "",
        },
        pis_weight: item?.pis_weight || {},
        cbm: item?.cbm || {},
      },
      inspections: comparisonInspections.map(
        ({
          inspected_item_sizes,
          inspected_box_sizes,
          inspected_box_mode,
          cbm,
          barcode,
          master_barcode,
          inner_barcode,
          ...inspection
        }) => ({
          ...inspection,
          inspected_box_mode,
          cbm,
          barcode,
          master_barcode,
          inner_barcode,
        }),
      ),
      sections,
      summary: {
        total_orders: orders.length,
        total_valid_inspections: comparisonInspections.length,
        total_distinct_po_inspections: comparisonInspectionsByPo.length,
        required_distinct_po_inspections: 3,
        has_required_po_inspection_count: hasRequiredPoInspectionCount,
      },
    });
  } catch (error) {
    console.error("PIS Inspection Master Comparison Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch PIS inspection master comparison",
      error: error.message,
    });
  }
};

exports.getPisInspectionMasterComparisonRecords = async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parsePositiveInt(req.query.limit, 10), 1),
      50,
    );

    const rows = await Order.aggregate([
      {
        $match: {
          qc_record: { $ne: null },
          "item.item_code": { $nin: [null, ""] },
        },
      },
      {
        $lookup: {
          from: "inspections",
          localField: "qc_record",
          foreignField: "qc",
          as: "inspection_rows",
        },
      },
      { $unwind: "$inspection_rows" },
      {
        $addFields: {
          normalized_inspection_status: {
            $toLower: { $ifNull: ["$inspection_rows.status", ""] },
          },
        },
      },
      {
        $match: {
          normalized_inspection_status: {
            $nin: ["pending", "goods not ready", "rejected", "transfered", "transferred"],
          },
          $or: [
            { "inspection_rows.inspected_item_sizes.0": { $exists: true } },
            { "inspection_rows.inspected_box_sizes.0": { $exists: true } },
          ],
        },
      },
      {
        $match: {
          $or: [
            { normalized_inspection_status: "inspection done" },
            { "inspection_rows.checked": { $gt: 0 } },
            { "inspection_rows.passed": { $gt: 0 } },
          ],
        },
      },
      {
        $group: {
          _id: {
            item_code_lower: { $toLower: { $trim: { input: "$item.item_code" } } },
            order_id: "$order_id",
          },
          item_code: { $first: { $trim: { input: "$item.item_code" } } },
          order_id: { $first: "$order_id" },
          brand: { $first: "$brand" },
          vendor: { $first: "$vendor" },
          latest_inspection_created_at: { $max: "$inspection_rows.createdAt" },
          latest_inspection_date: { $max: "$inspection_rows.inspection_date" },
        },
      },
      {
        $group: {
          _id: "$_id.item_code_lower",
          code: { $first: "$item_code" },
          brands: { $addToSet: "$brand" },
          vendors: { $addToSet: "$vendor" },
          distinct_po_count: { $sum: 1 },
          latest_inspection_created_at: { $max: "$latest_inspection_created_at" },
          latest_inspection_date: { $max: "$latest_inspection_date" },
        },
      },
      { $match: { distinct_po_count: { $gte: 3 } } },
      { $sort: { latest_inspection_created_at: -1, latest_inspection_date: -1, code: 1 } },
      { $limit: limit },
      {
        $lookup: {
          from: "items",
          localField: "code",
          foreignField: "code",
          as: "item_doc",
        },
      },
      { $unwind: { path: "$item_doc", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          code: 1,
          description: {
            $ifNull: ["$item_doc.description", "$item_doc.name"],
          },
          brand: {
            $ifNull: [
              "$item_doc.brand_name",
              {
                $ifNull: [
                  "$item_doc.brand",
                  { $arrayElemAt: ["$brands", 0] },
                ],
              },
            ],
          },
          vendors: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$item_doc.vendors", []] } }, 0] },
              "$item_doc.vendors",
              "$vendors",
            ],
          },
          distinct_po_count: 1,
          latest_inspection_date: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      rows,
      pagination: {
        limit,
        count: rows.length,
      },
    });
  } catch (error) {
    console.error("PIS Inspection Master Comparison Records Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch PIS inspection master comparison records",
      error: error.message,
    });
  }
};

exports.getItemOrderPresence = async (req, res) => {
  try {
    const itemCodeInput = String(req.params.itemCode || "").trim();
    if (!itemCodeInput) {
      return res.status(400).json({
        success: false,
        message: "Item code is required",
      });
    }

    const escapedItemCode = escapeRegex(itemCodeInput);
    const itemCodeMatch = new RegExp(`^\\s*${escapedItemCode}\\s*$`, "i");

    const orders = await Order.find({
      ...ACTIVE_ORDER_MATCH,
      "item.item_code": itemCodeMatch,
    })
      .select(
        "order_id status quantity shipment order_date ETD revised_ETD updatedAt qc_record item",
      )
      .populate({
        path: "qc_record",
        select: "quantities request_history",
      })
      .sort({ order_date: -1, ETD: -1, updatedAt: -1, order_id: 1 })
      .lean();

    const rows = (Array.isArray(orders) ? orders : []).map((order) => {
      const qcRecord =
        order?.qc_record && typeof order.qc_record === "object"
          ? order.qc_record
          : null;
      const totalQuantity = Math.max(0, toSafeNumber(order?.quantity, 0));
      const shippedQuantity = getShippedQuantity(order?.shipment);

      return {
        id: String(order?._id || ""),
        order_id: String(order?.order_id || "").trim(),
        description: String(order?.item?.description || "").trim(),
        status: deriveOrderStatus({ orderEntry: order }),
        total_quantity: totalQuantity,
        open_quantity: getOpenQuantity(order),
        shipped_quantity: shippedQuantity,
        order_date: order?.order_date || null,
        effective_etd: order?.revised_ETD || order?.ETD || null,
      };
    });

    return res.status(200).json({
      success: true,
      item_code: itemCodeInput,
      data: rows,
      summary: {
        total_orders: rows.length,
      },
    });
  } catch (error) {
    console.error("Get Item Order Presence Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch item order presence",
      error: error.message,
    });
  }
};

exports.createItem = async (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const productTypeContext = await resolveItemProductTypeContext(payload);
    const importedCommonFields = productTypeContext.commonFields || {};
    const code = normalizeTextField(
      payload.code || importedCommonFields.code,
    ).toUpperCase();
    const description = normalizeTextField(
      payload.description || importedCommonFields.description,
    );
    const name = normalizeTextField(
      payload.name || importedCommonFields.name || description,
    );
    const brand = normalizeTextField(payload.brand);
    const vendor = normalizeTextField(payload.vendor);
    const importedPisMasterBarcode = normalizeTextField(
      importedCommonFields.pis_master_barcode || importedCommonFields.pis_barcode,
    );

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "code is required",
      });
    }
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "name is required",
      });
    }
    if (!description) {
      return res.status(400).json({
        success: false,
        message: "description is required",
      });
    }
    if (!brand) {
      return res.status(400).json({
        success: false,
        message: "brand is required",
      });
    }
    if (!vendor) {
      return res.status(400).json({
        success: false,
        message: "vendor is required",
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "PIS sheet is required",
      });
    }

    const existingItem = await Item.findOne({
      code: { $regex: `^${escapeRegex(code)}$`, $options: "i" },
    }).select("_id code");
    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: `Item code ${existingItem.code || code} already exists`,
      });
    }

    const pisItemSizesInput = parseJsonBodyField(
      payload.pis_item_sizes,
      "pis_item_sizes",
    );
    const pisBoxSizesInput = parseJsonBodyField(
      payload.pis_box_sizes,
      "pis_box_sizes",
    );
    const parsedPisBoxMode = detectBoxPackagingMode(
      payload?.pis_box_mode,
      Array.isArray(pisBoxSizesInput) ? pisBoxSizesInput : [],
    );

    const parsedPisItemSizes = parseSizeEntriesPayload(
      Array.isArray(pisItemSizesInput) ? pisItemSizesInput : [],
      {
        fieldLabel: "pis_item_sizes",
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        weightKey: "net_weight",
        weightLabel: "net_weight",
      },
    );
    const parsedPisBoxSizes = parseSizeEntriesPayload(
      Array.isArray(pisBoxSizesInput) ? pisBoxSizesInput : [],
      {
        fieldLabel: "pis_box_sizes",
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        weightKey: "gross_weight",
        weightLabel: "gross_weight",
        mode: parsedPisBoxMode,
      },
    );

    const item = new Item({
      code,
      name,
      description,
      brand,
      brand_name: brand,
      brands: [brand],
      vendors: [vendor],
      ...(productTypeContext.productTypeSnapshot
        ? { product_type: productTypeContext.productTypeSnapshot }
        : {}),
      ...(productTypeContext.productSpecs
        ? { product_specs: productTypeContext.productSpecs }
        : {}),
      pis_item_sizes: parsedPisItemSizes,
      pis_box_sizes: parsedPisBoxSizes,
      pis_box_mode: parsedPisBoxMode,
      kd: toBooleanValue(payload.kd, "kd"),
      mounting_file_needed: toBooleanValue(
        payload.mounting_file_needed,
        "mounting_file_needed",
      ),
      source: {
        from_orders: false,
        from_qc: false,
      },
      ...(importedPisMasterBarcode
        ? {
            pis_master_barcode: importedPisMasterBarcode,
            pis_barcode: importedPisMasterBarcode,
          }
        : {}),
    });

    applyCalculatedCbmTotals(item, (pathKey, pathValue) => {
      item.set(pathKey, pathValue);
    });

    const storedPisFile = await uploadPisSpreadsheetForItem({
      itemCode: code,
      itemId: String(item._id || ""),
      file: req.file,
    });
    item.pis_file = storedPisFile;
    appendItemUpdateHistory(item, {
      before: {},
      after: item.toObject(),
      reqUser: req.user,
      action: "create",
      source: "item_create",
      route: "POST /items",
      metadata: {
        pis_file_uploaded: Boolean(storedPisFile?.key || storedPisFile?.link),
      },
    });

    try {
      await item.save();
    } catch (saveError) {
      if (storedPisFile?.key) {
        try {
          await deleteObject(storedPisFile.key);
        } catch (rollbackError) {
          console.error("Rollback created item PIS file failed:", {
            code,
            storageKey: storedPisFile.key,
            error: rollbackError?.message || String(rollbackError),
          });
        }
      }
      throw saveError;
    }

    return res.status(201).json({
      success: true,
      message: "Item created successfully",
      data: item.toObject(),
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
    console.error("Create Item Error:", error);
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to create item",
    });
  }
};

exports.syncItemsFromOrders = async (req, res) => {
  try {
    const summary = await syncAllItemsFromOrdersAndQc({ user: req.user });

    return res.status(200).json({
      success: true,
      message: "Items synced successfully from orders and QC records",
      summary,
    });
  } catch (error) {
    console.error("Sync Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to sync items from existing records",
      error: error.message,
    });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const lockedFields = [
      "code",
      "brand",
      "brand_name",
      "brands",
      "vendors",
      "pis_barcode",
      "pis_weight",
      "pis_item_LBH",
      "pis_item_top_LBH",
      "pis_item_bottom_LBH",
      "pis_item_sizes",
      "pis_box_LBH",
      "pis_box_top_LBH",
      "pis_box_bottom_LBH",
      "pis_box_sizes",
      "inspected_item_LBH",
      "inspected_item_top_LBH",
      "inspected_item_bottom_LBH",
      "inspected_box_LBH",
      "inspected_box_top_LBH",
      "inspected_box_bottom_LBH",
      "inspected_top_LBH",
      "inspected_bottom_LBH",
    ];
    const touchedLockedFields = lockedFields.filter((field) => hasOwn(payload, field));
    if (touchedLockedFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `These fields are read-only: ${touchedLockedFields.join(", ")}`,
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }
    const beforeItemSnapshot = item.toObject();

    const productTypeContext = await resolveItemProductTypeContext(payload);

    let touched = false;
    const setPath = (path, value) => {
      touched = true;
      item.set(path, value);
    };
    const nextInspectedWeight = buildWeightRecord(item?.inspected_weight);
    let inspectedWeightTouched = false;
    let inspectedBoxTouched = false;

    if (hasOwn(payload, "name")) {
      setPath("name", normalizeTextField(payload.name));
    }

    if (hasOwn(payload, "description")) {
      setPath("description", normalizeTextField(payload.description));
    }

    if (hasOwn(payload, "kd")) {
      setPath(
        "kd",
        toBooleanValue(payload.kd, "kd"),
      );
    }
    if (hasOwn(payload, "mounting_file_needed")) {
      setPath(
        "mounting_file_needed",
        toBooleanValue(payload.mounting_file_needed, "mounting_file_needed"),
      );
    }

    if (productTypeContext.productTypeSnapshot) {
      setPath("product_type", productTypeContext.productTypeSnapshot);
    }

    if (productTypeContext.productSpecs) {
      setPath("product_specs", productTypeContext.productSpecs);
    }

    if (payload?.inspected_weight && typeof payload.inspected_weight === "object") {
      for (const fieldKey of WEIGHT_FIELD_KEYS) {
        const parsedField = getPayloadWeightField(
          payload.inspected_weight,
          fieldKey,
          "inspected_weight",
        );
        if (!parsedField.provided) continue;
        nextInspectedWeight[fieldKey] = parsedField.value;
        inspectedWeightTouched = true;
      }
    }

    if (hasOwn(payload, "inspected_box_mode") && !hasOwn(payload, "inspected_box_sizes")) {
      setPath(
        "inspected_box_mode",
        detectBoxPackagingMode(payload?.inspected_box_mode, item?.inspected_box_sizes),
      );
      inspectedBoxTouched = true;
    }

    if (hasOwn(payload, "inspected_item_sizes")) {
      const parsedInspectedItemSizes = parseSizeEntriesPayload(payload.inspected_item_sizes, {
        fieldLabel: "inspected_item_sizes",
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        weightKey: "net_weight",
        weightLabel: "net_weight",
      });

      setPath("inspected_item_sizes", parsedInspectedItemSizes);
    }

    if (hasOwn(payload, "inspected_box_sizes")) {
      const parsedInspectedBoxMode = detectBoxPackagingMode(
        payload?.inspected_box_mode,
        payload.inspected_box_sizes,
      );
      const parsedInspectedBoxSizes = parseSizeEntriesPayload(payload.inspected_box_sizes, {
        fieldLabel: "inspected_box_sizes",
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        weightKey: "gross_weight",
        weightLabel: "gross_weight",
        mode: parsedInspectedBoxMode,
      });

      setPath("inspected_box_sizes", parsedInspectedBoxSizes);
      setPath("inspected_box_mode", parsedInspectedBoxMode);
      inspectedBoxTouched = true;
    }

    if (payload?.cbm && typeof payload.cbm === "object") {
      if (hasOwn(payload.cbm, "top")) {
        setPath("cbm.top", toNormalizedDecimalText(payload.cbm.top, "cbm.top"));
      }
      if (hasOwn(payload.cbm, "bottom")) {
        setPath("cbm.bottom", toNormalizedDecimalText(payload.cbm.bottom, "cbm.bottom"));
      }
      if (hasOwn(payload.cbm, "total")) {
        setPath("cbm.total", toNormalizedDecimalText(payload.cbm.total, "cbm.total"));
      }
      if (hasOwn(payload.cbm, "inspected_top")) {
        setPath(
          "cbm.inspected_top",
          toNormalizedDecimalText(payload.cbm.inspected_top, "cbm.inspected_top"),
        );
      }
      if (hasOwn(payload.cbm, "inspected_bottom")) {
        setPath(
          "cbm.inspected_bottom",
          toNormalizedDecimalText(payload.cbm.inspected_bottom, "cbm.inspected_bottom"),
        );
      }
      if (hasOwn(payload.cbm, "inspected_total")) {
        setPath(
          "cbm.inspected_total",
          toNormalizedDecimalText(payload.cbm.inspected_total, "cbm.inspected_total"),
        );
      }
    }

    if (inspectedWeightTouched) {
      setPath("inspected_weight", nextInspectedWeight);
    }

    if (payload?.qc && typeof payload.qc === "object") {
      if (hasOwn(payload.qc, "packed_size")) {
        setPath(
          "qc.packed_size",
          toBooleanValue(payload.qc.packed_size, "qc.packed_size"),
        );
      }
      if (hasOwn(payload.qc, "finishing")) {
        setPath("qc.finishing", toBooleanValue(payload.qc.finishing, "qc.finishing"));
      }
      if (hasOwn(payload.qc, "branding")) {
        setPath("qc.branding", toBooleanValue(payload.qc.branding, "qc.branding"));
      }
      if (hasOwn(payload.qc, "barcode")) {
        const nextMasterBarcode = toNonNegativeNumber(payload.qc.barcode, "qc.barcode");
        setPath("qc.barcode", nextMasterBarcode);
        setPath("qc.master_barcode", nextMasterBarcode);
      }
      if (hasOwn(payload.qc, "master_barcode")) {
        const nextMasterBarcode = toNonNegativeNumber(
          payload.qc.master_barcode,
          "qc.master_barcode",
        );
        setPath("qc.master_barcode", nextMasterBarcode);
        setPath("qc.barcode", nextMasterBarcode);
      }
      if (hasOwn(payload.qc, "inner_barcode")) {
        setPath(
          "qc.inner_barcode",
          toNonNegativeNumber(payload.qc.inner_barcode, "qc.inner_barcode"),
        );
      }
      if (hasOwn(payload.qc, "last_inspected_date")) {
        setPath("qc.last_inspected_date", normalizeTextField(payload.qc.last_inspected_date));
      }

      if (payload.qc?.quantities && typeof payload.qc.quantities === "object") {
        if (hasOwn(payload.qc.quantities, "checked")) {
          setPath(
            "qc.quantities.checked",
            toNonNegativeNumber(payload.qc.quantities.checked, "qc.quantities.checked"),
          );
        }
        if (hasOwn(payload.qc.quantities, "passed")) {
          setPath(
            "qc.quantities.passed",
            toNonNegativeNumber(payload.qc.quantities.passed, "qc.quantities.passed"),
          );
        }
        if (hasOwn(payload.qc.quantities, "pending")) {
          setPath(
            "qc.quantities.pending",
            toNonNegativeNumber(payload.qc.quantities.pending, "qc.quantities.pending"),
          );
        }
      }
    }

    if (payload?.source && typeof payload.source === "object") {
      if (hasOwn(payload.source, "from_orders")) {
        setPath(
          "source.from_orders",
          toBooleanValue(payload.source.from_orders, "source.from_orders"),
        );
      }
      if (hasOwn(payload.source, "from_qc")) {
        setPath("source.from_qc", toBooleanValue(payload.source.from_qc, "source.from_qc"));
      }
    }

    if (touched) {
      applyCalculatedCbmTotals(item, setPath);
    }

    const inspectedCleanupGroups = [];
    if (hasOwn(payload, "inspected_item_sizes")) inspectedCleanupGroups.push("inspected_item");
    if (hasOwn(payload, "inspected_box_sizes")) inspectedCleanupGroups.push("inspected_box");
    if (inspectedCleanupGroups.length > 0) {
      const cleanupResult = cleanupLegacyItemSizeFields(item, {
        groups: inspectedCleanupGroups,
      });
      if (cleanupResult.changed) {
        touched = true;
      }
    }

    if (!touched) {
      return res.status(400).json({
        success: false,
        message: "No editable fields provided",
      });
    }

    appendItemUpdateHistory(item, {
      before: beforeItemSnapshot,
      after: item.toObject(),
      reqUser: req.user,
      action: "update",
      source: "item_update",
      route: "PATCH /items/:id",
      metadata: {
        inspected_box_touched: Boolean(inspectedBoxTouched),
      },
    });
    await item.save();

    let poCbmSync = null;
    if (inspectedBoxTouched) {
      try {
        poCbmSync = await syncTotalPoCbmForItem(item.toObject());
      } catch (syncError) {
        console.error("Item inspected box PO CBM sync failed:", {
          itemId: item._id,
          code: item.code,
          error: syncError?.message || String(syncError),
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Item updated successfully",
      data: item.toObject(),
      po_cbm_sync: poCbmSync,
    });
  } catch (error) {
    console.error("Update Item Error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update item",
    });
  }
};

exports.getItemFormDraft = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const now = new Date();
    const hadExpiredDrafts = cleanupExpiredFormDrafts(item, now);
    const draft = findFormDraft(item, {
      userId: getDraftUserId(req.user),
      mode: req.query?.mode,
      recordId: req.query?.record_id,
    }, now);

    if (hadExpiredDrafts) {
      item.markModified("form_drafts");
      await item.save();
    }

    return res.json({
      success: true,
      data: serializeFormDraft(draft),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to load item draft",
    });
  }
};

exports.saveItemFormDraft = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const draft = upsertFormDraft(item, {
      userId: getDraftUserId(req.user),
      mode: req.body?.mode,
      recordId: req.body?.record_id,
      payload: req.body?.payload,
    });

    item.markModified("form_drafts");
    await item.save();

    return res.json({
      success: true,
      data: serializeFormDraft(draft),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to save item draft",
    });
  }
};

exports.deleteItemFormDraft = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const changed = deleteFormDraft(item, {
      userId: getDraftUserId(req.user),
      mode: req.query?.mode || req.body?.mode,
      recordId: req.query?.record_id || req.body?.record_id,
    });

    if (changed) {
      item.markModified("form_drafts");
      await item.save();
    }

    return res.json({
      success: true,
      data: null,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to delete item draft",
    });
  }
};

exports.updateItemPis = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const roleKey = normalizeUserRoleKey(req.user?.role);
    const isStrictAdmin = ["admin", "super_admin"].includes(roleKey);
    const canCreatePisDiffMasterData = isStrictAdmin;
    const requestedPisDiffCheck =
      normalizeTextField(payload?.pis_update_source).toLowerCase() === "pis_diffs" ||
      payload?.sync_master_data === true ||
      payload?.pis_checked_flag === true;
    if (requestedPisDiffCheck && !canCreatePisDiffMasterData) {
      return res.status(403).json({
        success: false,
        message: "Only Admin or Super Admin can check PIS diffs and create master data.",
      });
    }

    const legacyPisSizeFields = [
      "pis_item_LBH",
      "pis_item_top_LBH",
      "pis_item_bottom_LBH",
      "pis_box_LBH",
      "pis_box_top_LBH",
      "pis_box_bottom_LBH",
    ];
    const touchedLegacyPisSizeFields = legacyPisSizeFields.filter((field) =>
      hasOwn(payload, field),
    );
    if (touchedLegacyPisSizeFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Use pis_item_sizes and pis_box_sizes for size updates. Legacy fields are read-only: ${touchedLegacyPisSizeFields.join(", ")}`,
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }
    const beforeItemSnapshot = item.toObject();
    const beforeAuditSnapshot = buildItemUpdateAuditSnapshot(beforeItemSnapshot);

    const setPath = (path, value) => {
      item.set(path, value);
    };
    let pisFieldsTouched = false;
    let masterFieldsTouched = false;
    const setPisPath = (path, value) => {
      setPath(path, value);
      pisFieldsTouched = true;
    };
    const setMasterPath = (path, value) => {
      setPath(path, value);
      masterFieldsTouched = true;
    };
    const nextPisWeight = buildWeightRecord(item?.pis_weight);
    let pisWeightTouched = false;

    if (!requestedPisDiffCheck && payload?.pis_weight && typeof payload.pis_weight === "object") {
      for (const fieldKey of WEIGHT_FIELD_KEYS) {
        const parsedField = getPayloadWeightField(
          payload.pis_weight,
          fieldKey,
          "pis_weight",
        );
        if (!parsedField.provided) continue;
        nextPisWeight[fieldKey] = parsedField.value;
        pisWeightTouched = true;
        pisFieldsTouched = true;
      }
    }

    if (hasOwn(payload, "pis_barcode")) {
      const nextMasterBarcode = normalizeTextField(payload.pis_barcode);
      if (requestedPisDiffCheck) {
        setMasterPath("master_barcode", nextMasterBarcode);
        setMasterPath("master_master_barcode", nextMasterBarcode);
        setPisPath("pis_barcode", nextMasterBarcode);
        setPisPath("pis_master_barcode", nextMasterBarcode);
      } else {
        setPisPath("pis_barcode", nextMasterBarcode);
        setPisPath("pis_master_barcode", nextMasterBarcode);
      }
    }
    if (hasOwn(payload, "pis_master_barcode")) {
      const nextMasterBarcode = normalizeTextField(payload.pis_master_barcode);
      if (requestedPisDiffCheck) {
        setMasterPath("master_master_barcode", nextMasterBarcode);
        setMasterPath("master_barcode", nextMasterBarcode);
        setPisPath("pis_master_barcode", nextMasterBarcode);
        setPisPath("pis_barcode", nextMasterBarcode);
      } else {
        setPisPath("pis_master_barcode", nextMasterBarcode);
        setPisPath("pis_barcode", nextMasterBarcode);
      }
    }
    if (hasOwn(payload, "pis_inner_barcode")) {
      const nextInnerBarcode = normalizeTextField(payload.pis_inner_barcode);
      if (requestedPisDiffCheck) {
        setMasterPath("master_inner_barcode", nextInnerBarcode);
        setPisPath("pis_inner_barcode", nextInnerBarcode);
      } else {
        setPisPath("pis_inner_barcode", nextInnerBarcode);
      }
    }
    if (hasOwn(payload, "country_of_origin")) {
      const nextCountryOfOrigin = normalizeTextField(payload.country_of_origin);
      if (requestedPisDiffCheck) {
        setMasterPath("master_country_of_origin", nextCountryOfOrigin);
        setPisPath("country_of_origin", nextCountryOfOrigin);
      } else {
        setPisPath("country_of_origin", nextCountryOfOrigin);
      }
    }
    if (hasOwn(payload, "kd")) {
      setPisPath("kd", toBooleanValue(payload.kd, "kd"));
    }
    if (hasOwn(payload, "mounting_file_needed")) {
      setPisPath(
        "mounting_file_needed",
        toBooleanValue(payload.mounting_file_needed, "mounting_file_needed"),
      );
    }

    if (hasOwn(payload, "barcode_exempted")) {
      if (!isStrictAdmin) {
        return res.status(403).json({
          success: false,
          message: "Only Admin or Super Admin can enable or disable barcode exempt items.",
        });
      }
      setPisPath(
        "barcode_exempted",
        toBooleanValue(payload.barcode_exempted, "barcode_exempted"),
      );
    }

    if (hasOwn(payload, "pis_item_sizes")) {
      const parsedPisItemSizes = parseSizeEntriesPayload(payload.pis_item_sizes, {
        fieldLabel: "pis_item_sizes",
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        weightKey: "net_weight",
        weightLabel: "net_weight",
        allowIncomplete: true,
      });

      if (requestedPisDiffCheck) {
        setMasterPath("master_item_sizes", parsedPisItemSizes);
      } else {
        setPisPath("pis_item_sizes", parsedPisItemSizes);
      }
    }

    if (hasOwn(payload, "pis_box_sizes")) {
      const parsedPisBoxMode = detectBoxPackagingMode(
        payload?.pis_box_mode,
        payload.pis_box_sizes,
      );
      const parsedPisBoxSizes = parseSizeEntriesPayload(payload.pis_box_sizes, {
        fieldLabel: "pis_box_sizes",
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        weightKey: "gross_weight",
        weightLabel: "gross_weight",
        mode: parsedPisBoxMode,
        allowIncomplete: true,
      });

      if (requestedPisDiffCheck) {
        setMasterPath("master_box_sizes", parsedPisBoxSizes);
        setMasterPath("master_box_mode", parsedPisBoxMode);
      } else {
        setPisPath("pis_box_sizes", parsedPisBoxSizes);
        setPisPath("pis_box_mode", parsedPisBoxMode);
      }
    }

    if (hasOwn(payload, "pis_box_mode") && !hasOwn(payload, "pis_box_sizes")) {
      if (requestedPisDiffCheck) {
        setMasterPath(
          "master_box_mode",
          detectBoxPackagingMode(payload?.pis_box_mode, item?.master_box_sizes),
        );
      } else {
        setPisPath(
          "pis_box_mode",
          detectBoxPackagingMode(payload?.pis_box_mode, item?.pis_box_sizes),
        );
      }
    }

    if (pisWeightTouched) {
      setPisPath("pis_weight", nextPisWeight);
    }

    if (requestedPisDiffCheck && !masterFieldsTouched) {
      return res.status(400).json({
        success: false,
        message: "No master fields provided",
      });
    }

    if (!requestedPisDiffCheck && !pisFieldsTouched) {
      return res.status(400).json({
        success: false,
        message: "No PIS fields provided",
      });
    }

    if (requestedPisDiffCheck) {
      setPath("pis_checked_flag", true);
    }

    if (!requestedPisDiffCheck) {
      const pisCleanupGroups = [];
      if (hasOwn(payload, "pis_item_sizes")) pisCleanupGroups.push("pis_item");
      if (hasOwn(payload, "pis_box_sizes")) pisCleanupGroups.push("pis_box");
      if (pisCleanupGroups.length > 0) {
        const cleanupResult = cleanupLegacyItemSizeFields(item, {
          groups: pisCleanupGroups,
        });
        if (cleanupResult.changed) {
          pisFieldsTouched = true;
        }
      }
    }

    applyCalculatedCbmTotals(item, setPath);
    appendItemUpdateHistory(item, {
      before: beforeItemSnapshot,
      after: item.toObject(),
      reqUser: req.user,
      action: requestedPisDiffCheck ? "pis_diff_update" : "pis_update",
      source: requestedPisDiffCheck ? "pis_diffs_modal" : "pis_update_modal",
      route: "PATCH /items/:id/pis",
      metadata: {
        pis_update_source: normalizeTextField(payload?.pis_update_source),
        sync_master_data: Boolean(payload?.sync_master_data),
        pis_checked_flag_requested: Boolean(payload?.pis_checked_flag),
      },
    });
    await item.save();
    const afterAuditSnapshot = buildItemUpdateAuditSnapshot(item.toObject());
    await createPisUpdateLog({
      reqUser: req.user,
      beforeSnapshot: beforeAuditSnapshot,
      afterSnapshot: afterAuditSnapshot,
      operationType: requestedPisDiffCheck ? "pis_diff_update" : "pis_update",
      pageName: requestedPisDiffCheck ? "PIS Diff Modal" : "PIS Update Modal",
      source: requestedPisDiffCheck ? "pis_diffs_modal" : "pis_update_modal",
      dataScopes: requestedPisDiffCheck
        ? [AUDIT_SCOPES.MASTER, AUDIT_SCOPES.PIS]
        : [AUDIT_SCOPES.PIS],
      extraRemarks: requestedPisDiffCheck
        ? ["PIS diff was checked and submitted values were saved to master and PIS data."]
        : [],
      metadata: {
        pis_update_source: normalizeTextField(payload?.pis_update_source),
        sync_master_data: Boolean(payload?.sync_master_data),
        pis_checked_flag_requested: Boolean(payload?.pis_checked_flag),
      },
    });

    return res.status(200).json({
      success: true,
      message: requestedPisDiffCheck
        ? "Master values updated successfully"
        : "PIS values updated successfully",
      data: item.toObject(),
    });
  } catch (error) {
    console.error("Update Item PIS Error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update PIS values",
    });
  }
};

const syncProductDatabaseValuesIntoPisItem = async ({
  item,
  user,
  route = "POST /items/:id/pis/sync-product-database",
} = {}) => {
  if (!item) {
    return { status: "missing", changedFields: [], syncMessages: [] };
  }

  if (item?.pis_product_database_synced_at) {
    return { status: "already_synced", changedFields: [], syncMessages: [] };
  }

  if (!hasSyncableProductDatabaseData(item)) {
    return { status: "no_data", changedFields: [], syncMessages: [] };
  }

  const beforeItemSnapshot = item.toObject();
  const beforeAuditSnapshot = buildItemUpdateAuditSnapshot(beforeItemSnapshot);
  const changedFields = [];
  const syncMessages = [];
  let touched = false;
  let copiedItemSizes = null;
  let copiedBoxSizes = null;
  let copiedBoxMode = "";

  const setPathIfChanged = (path, value) => {
    if (areNormalizedValuesEqual(item.get(path), value)) return false;
    item.set(path, value);
    touched = true;
    changedFields.push(path);
    return true;
  };

  const meaningfulPdItemSizes = getMeaningfulPdItemSizeEntries(item?.pd_item_sizes);
  if (meaningfulPdItemSizes.length > 0) {
    copiedItemSizes = parseSizeEntriesPayload(meaningfulPdItemSizes, {
      fieldLabel: "pis_item_sizes",
      remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
      weightKey: "net_weight",
      weightLabel: "net_weight",
      allowIncomplete: true,
    });
    if (setPathIfChanged("pis_item_sizes", copiedItemSizes)) {
      syncMessages.push("PIS item sizes synced from Product Database.");
    }
  }

  const meaningfulPdBoxSizes = getMeaningfulPdBoxSizeEntries(item?.pd_box_sizes);
  if (meaningfulPdBoxSizes.length > 0) {
    copiedBoxMode = detectBoxPackagingMode(item?.pd_box_mode, meaningfulPdBoxSizes);
    copiedBoxSizes = parseSizeEntriesPayload(meaningfulPdBoxSizes, {
      fieldLabel: "pis_box_sizes",
      remarkOptions: BOX_SIZE_REMARK_OPTIONS,
      weightKey: "gross_weight",
      weightLabel: "gross_weight",
      mode: copiedBoxMode,
      allowIncomplete: true,
    });
    if (setPathIfChanged("pis_box_sizes", copiedBoxSizes)) {
      syncMessages.push("PIS box sizes synced from Product Database.");
    }
    if (setPathIfChanged("pis_box_mode", copiedBoxMode)) {
      syncMessages.push("PIS box mode synced from Product Database.");
    }
  }

  const pdMasterBarcode = normalizeTextField(item?.pd_master_barcode);
  const pdBarcode = normalizeTextField(item?.pd_barcode);
  const nextMasterBarcode = pdMasterBarcode || pdBarcode;
  if (nextMasterBarcode) {
    if (setPathIfChanged("pis_barcode", nextMasterBarcode)) {
      syncMessages.push("PIS barcode synced from Product Database.");
    }
    if (setPathIfChanged("pis_master_barcode", nextMasterBarcode)) {
      syncMessages.push("PIS master barcode synced from Product Database.");
    }
  }

  const pdInnerBarcode = normalizeTextField(item?.pd_inner_barcode);
  if (pdInnerBarcode && setPathIfChanged("pis_inner_barcode", pdInnerBarcode)) {
    syncMessages.push("PIS inner barcode synced from Product Database.");
  }

  if (setPathIfChanged("kd", item?.kd === true)) {
    syncMessages.push("K/D synced from Product Database.");
  }

  if (Array.isArray(copiedItemSizes) || Array.isArray(copiedBoxSizes)) {
    const cleanupGroups = [];
    if (Array.isArray(copiedItemSizes)) cleanupGroups.push("pis_item");
    if (Array.isArray(copiedBoxSizes)) cleanupGroups.push("pis_box");
    const cleanupResult = cleanupLegacyItemSizeFields(item, {
      groups: cleanupGroups,
    });
    cleanupResult.changedPaths.forEach((path) => {
      if (!changedFields.includes(path)) {
        changedFields.push(path);
      }
    });
    if (cleanupResult.changed) {
      touched = true;
      syncMessages.push("Legacy PIS size fallback fields cleaned after Product Database sync.");
    }
  }

  const syncedAt = new Date();
  item.set("pis_product_database_synced_at", syncedAt);
  item.set("pis_product_database_synced_by", {
    ...buildPisProductDatabaseSyncActor(user),
    created_at: syncedAt,
    updated_at: syncedAt,
  });
  changedFields.push("pis_product_database_synced_at");

  if (touched) {
    item.set("pis_checked_flag", false);
    if (!changedFields.includes("pis_checked_flag")) {
      changedFields.push("pis_checked_flag");
    }
    applyCalculatedCbmTotals(item, (path, value) => {
      item.set(path, value);
    });
  }

  appendItemUpdateHistory(item, {
    before: beforeItemSnapshot,
    after: item.toObject(),
    reqUser: user,
    action: "pis_database_sync",
    source: "pis_sync_database_button",
    route,
    metadata: {
      source: "product_database",
      changed_fields: changedFields,
      synced_sections: syncMessages,
      touched: Boolean(touched),
    },
  });
  await item.save();

  if (touched) {
    const afterAuditSnapshot = buildItemUpdateAuditSnapshot(item.toObject());
    await createPisUpdateLog({
      reqUser: user,
      beforeSnapshot: beforeAuditSnapshot,
      afterSnapshot: afterAuditSnapshot,
      operationType: "pis_database_sync",
      pageName: "PIS Page",
      source: "pis_sync_database_button",
      dataScopes: [AUDIT_SCOPES.PIS],
      extraRemarks: [
        "Available Product Database measurements and barcodes were synced into PIS; empty Product Database values were skipped.",
      ],
      metadata: {
        source: "product_database",
        changed_fields: changedFields,
        synced_sections: syncMessages,
      },
    });
  }

  return {
    status: touched ? "updated" : "marked_synced",
    changedFields,
    syncMessages,
    data: item.toObject(),
  };
};

exports.syncProductDatabaseToPis = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const result = await syncProductDatabaseValuesIntoPisItem({
      item,
      user: req.user,
      route: "POST /items/:id/pis/sync-product-database",
    });

    if (result.status === "already_synced") {
      return res.status(409).json({
        success: false,
        message:
          "This item was already synced from Product Database once. Please update PIS manually for later changes.",
      });
    }

    if (result.status === "no_data") {
      return res.status(200).json({
        success: true,
        message: "No Product Database values available to sync.",
        data: item.toObject(),
      });
    }

    return res.status(200).json({
      success: true,
      message:
        result.status === "marked_synced"
          ? "Product Database values already match PIS. This item has been marked as synced once."
          : "Product Database values synced into PIS for admin review.",
      data: result.data || item.toObject(),
    });
  } catch (error) {
    console.error("Sync Product Database To PIS Error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to sync Product Database values into PIS.",
    });
  }
};

exports.syncAllProductDatabaseToPis = async (req, res) => {
  try {
    const candidateMatch = {
      $and: [
        {
          $or: [
            { pis_product_database_synced_at: { $exists: false } },
            { pis_product_database_synced_at: null },
          ],
        },
        {
          $or: [
            { pd_barcode: { $exists: true, $ne: "" } },
            { pd_master_barcode: { $exists: true, $ne: "" } },
            { pd_inner_barcode: { $exists: true, $ne: "" } },
            { pd_item_sizes: { $exists: true, $ne: [] } },
            { pd_box_sizes: { $exists: true, $ne: [] } },
          ],
        },
      ],
    };

    const items = await Item.find(candidateMatch);
    const summary = {
      scanned: items.length,
      updated: 0,
      marked_synced: 0,
      skipped_no_data: 0,
      skipped_already_synced: 0,
      failed: 0,
    };
    const failedItems = [];

    for (const item of items) {
      try {
        const result = await syncProductDatabaseValuesIntoPisItem({
          item,
          user: req.user,
          route: "POST /items/pis/sync-product-database",
        });

        if (result.status === "updated") summary.updated += 1;
        else if (result.status === "marked_synced") summary.marked_synced += 1;
        else if (result.status === "no_data") summary.skipped_no_data += 1;
        else if (result.status === "already_synced") summary.skipped_already_synced += 1;
      } catch (error) {
        summary.failed += 1;
        failedItems.push({
          id: String(item?._id || ""),
          code: normalizeTextField(item?.code),
          message: error?.message || "Failed to sync item",
        });
      }
    }

    const changedTotal = summary.updated + summary.marked_synced;

    return res.status(summary.failed > 0 ? 207 : 200).json({
      success: summary.failed === 0,
      message:
        changedTotal > 0
          ? `Product Database sync finished. ${summary.updated} item(s) updated and ${summary.marked_synced} item(s) marked as already matching.`
          : "No unsynced Product Database values available to sync.",
      summary,
      failed_items: failedItems,
    });
  } catch (error) {
    console.error("Sync All Product Database To PIS Error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to sync Product Database values into PIS.",
    });
  }
};

exports.getItemFileUrl = async (req, res) => {
  try {
    const itemId = getRequestedItemId(req);
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const fileType = normalizeTextField(
      req.params.fileType || req.query.file_type || req.query.fileType || "",
    ).toLowerCase();
    const fileConfig = getItemFileConfig(fileType);
    if (!fileConfig) {
      return res.status(400).json({
        success: false,
        message: "Invalid file type",
      });
    }

    const item = await Item.findById(itemId).select(
      `code mounting_file_needed ${fileConfig.field}`,
    );
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }
    if (!isItemFileAllowedForItem(item, fileConfig)) {
      return res.status(400).json({
        success: false,
        message: `${fileConfig.label} can only be used when mounting file is needed for this item`,
      });
    }

    const filePayload = await buildItemFileResponse(item?.[fileConfig.field], {
      itemCode: normalizeTextField(item?.code || itemId),
      fallbackBaseName: fileType,
      extension: fileConfig.defaultExtension,
    });

    if (!filePayload) {
      return res.status(404).json({
        success: false,
        message: `${fileConfig.label} not found`,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        item_id: item._id,
        file_type: fileType,
        file: {
          key: filePayload.key,
          originalName: filePayload.originalName,
          contentType: filePayload.contentType,
          size: filePayload.size,
          public_id: filePayload.public_id,
        },
        url: filePayload.link,
      },
    });
  } catch (error) {
    console.error("Get Item File URL Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate item file URL",
    });
  }
};

exports.uploadItemFile = async (req, res) => {
  try {
    const itemId = getRequestedItemId(req);
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const fileType = normalizeTextField(
      req.body?.file_type || req.body?.fileType || "",
    ).toLowerCase();
    const fileConfig = getItemFileConfig(fileType);
    if (!fileConfig || !ALLOWED_ITEM_FILE_TYPES.has(fileType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file type",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    if (fileType === "pis_file") {
      return exports.uploadItemPisFile(req, res);
    }

    if (!isWasabiConfigured()) {
      return res.status(500).json({
        success: false,
        message: "Wasabi storage is not configured",
      });
    }

    const mimeType = normalizeTextField(req.file.mimetype).toLowerCase();
    const extension = path.extname(String(req.file.originalname || "")).toLowerCase();
    if (
      !fileConfig.mimeTypes.has(mimeType)
      || !fileConfig.extensions.has(extension)
    ) {
      return res.status(400).json({
        success: false,
        message: fileConfig.invalidTypeMessage,
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }
    if (!isItemFileAllowedForItem(item, fileConfig)) {
      return res.status(400).json({
        success: false,
        message: `${fileConfig.label} can only be uploaded when mounting file is needed for this item`,
      });
    }
    const beforeItemSnapshot = item.toObject();

    const previousFile = normalizeStoredItemFile(item?.[fileConfig.field]);
    const previousStorageKey = previousFile.key;
    const fallbackOriginalName =
      req.file.originalname ||
      `${normalizeTextField(item?.code || itemId)}${extension || fileConfig.defaultExtension}`;
    let uploadResult = null;

    try {
      uploadResult = await uploadBuffer({
        buffer: req.file.buffer,
        key: createStorageKey({
          folder: fileConfig.folder,
          originalName: fallbackOriginalName,
          extension: extension || fileConfig.defaultExtension,
        }),
        originalName: fallbackOriginalName,
        contentType: mimeType || "application/octet-stream",
      });

      item[fileConfig.field] = buildStoredWasabiItemFile(uploadResult);
      appendItemUpdateHistory(item, {
        before: beforeItemSnapshot,
        after: item.toObject(),
        reqUser: req.user,
        action: "file_upload",
        source: "item_file_upload",
        route: "POST /items/:id/files",
        metadata: {
          file_type: fileType,
          label: fileConfig.label,
          original_name: fallbackOriginalName,
          previous_storage_key: previousStorageKey,
        },
      });
      await item.save();
    } catch (saveError) {
      if (uploadResult?.key) {
        try {
          await deleteObject(uploadResult.key);
        } catch (rollbackError) {
          console.error("Rollback item file upload failed:", {
            itemId,
            fileType,
            storageKey: uploadResult.key,
            error: rollbackError?.message || String(rollbackError),
          });
        }
      }

      throw saveError;
    }

    if (previousStorageKey && previousStorageKey !== uploadResult.key) {
      deleteObject(previousStorageKey).catch((error) => {
        console.error("Delete previous item file failed:", {
          itemId,
          previousStorageKey,
          fileType,
          error: error?.message || String(error),
        });
      });
    }

    return res.status(200).json({
      success: true,
      message: `${fileConfig.label} uploaded successfully`,
      data: {
        item_id: item._id,
        file_type: fileType,
        file: buildStoredWasabiItemFile(item?.[fileConfig.field]),
      },
    });
  } catch (error) {
    console.error("Upload Item File Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to upload item file",
    });
  }
};

exports.getItemPisFileUrl = async (req, res) => {
  let itemId = "";

  try {
    itemId = getRequestedItemId(req);
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await Item.findById(itemId).select("code pis_file");
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const storedPisFile = normalizeStoredItemFile(item?.pis_file);
    if (!storedPisFile.key) {
      return res.status(404).json({
        success: false,
        message: "PIS file not found",
      });
    }

    const pisFile = await buildItemFileResponse(item?.pis_file, {
      itemCode: normalizeTextField(item?.code || itemId),
      fallbackBaseName: "item-pis",
      extension: ".pdf",
      requireStorageKey: true,
    });

    if (!pisFile) {
      return res.status(404).json({
        success: false,
        message: "PIS file not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: pisFile,
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    console.error("Get Item PIS File URL Error:", {
      itemId,
      error: error?.message || String(error),
      details: error?.details || "",
    });
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to get PIS file URL",
    });
  }
};

exports.uploadItemPisFile = async (req, res) => {
  let itemId = "";
  let stagedPisFilePath = "";
  const fileConfig = getItemFileConfig("pis_file");
  try {
    itemId = getRequestedItemId(req);
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }
    if (!isItemFileAllowedForItem(item, fileConfig)) {
      return res.status(400).json({
        success: false,
        message: `${fileConfig.label} can only be deleted when mounting file is needed for this item`,
      });
    }
    const beforeItemSnapshot = item.toObject();

    const previousPisFile = normalizeStoredItemFile(item?.pis_file);
    const previousStorageKey = previousPisFile.key;

    if (parseAsyncRequest(req)) {
      const stagedFile = await stagePisSpreadsheetForJob(req.file);
      stagedPisFilePath = stagedFile.tempFilePath;

      const job = await enqueuePisFileProcessing({
        itemId,
        itemCode: normalizeTextField(item?.code),
        tempFilePath: stagedFile.tempFilePath,
        originalName: stagedFile.originalName,
        previousStorageKey,
        checksum: stagedFile.checksum,
        user: req.user
          ? {
              _id: req.user._id || req.user.id || null,
              id: req.user.id || req.user._id || null,
              name: req.user.name || req.user.email || req.user.username || "",
              email: req.user.email || "",
              username: req.user.username || "",
              role: req.user.role || "",
            }
          : null,
      });

      if (job) {
        return res.status(202).json({
          success: true,
          message: "PIS spreadsheet processing queued",
          queue: QUEUE_NAMES.fileProcessingQueue,
          job_id: job.id,
          status_url: `/jobs/${QUEUE_NAMES.fileProcessingQueue}/${job.id}`,
        });
      }

      await safeDeleteLocalFile(stagedFile.tempFilePath);
      stagedPisFilePath = "";
    }

    item.pis_file = await uploadPisSpreadsheetForItem({
      itemCode: normalizeTextField(item?.code),
      itemId,
      file: req.file,
    });
    appendItemUpdateHistory(item, {
      before: beforeItemSnapshot,
      after: item.toObject(),
      reqUser: req.user,
      action: "pis_file_upload",
      source: "item_pis_upload",
      route: "POST /items/:itemId/pis-upload",
      metadata: {
        file_type: "pis_file",
        label: fileConfig.label,
        original_name: req.file?.originalname || "",
        previous_storage_key: previousStorageKey,
      },
    });

    try {
      await item.save();
    } catch (saveError) {
      try {
        await deleteObject(item?.pis_file?.key);
        console.info("Rolled back uploaded PIS PDF after DB save failure", {
          itemId,
          storageKey: item?.pis_file?.key,
        });
      } catch (rollbackError) {
        console.error("Rollback uploaded PIS PDF failed:", {
          itemId,
          storageKey: item?.pis_file?.key,
          error: rollbackError?.message || String(rollbackError),
        });
      }

      throw saveError;
    }

    console.info("PIS file metadata saved on item", {
      itemId,
      storageKey: item?.pis_file?.key,
      replaced: Boolean(
        previousStorageKey &&
        previousStorageKey !== normalizeTextField(item?.pis_file?.key),
      ),
    });

    if (
      previousStorageKey &&
      previousStorageKey !== normalizeTextField(item?.pis_file?.key)
    ) {
      try {
        await deleteObject(previousStorageKey);
        console.info("Previous PIS PDF deleted from Wasabi", {
          itemId,
          storageKey: previousStorageKey,
        });
      } catch (deleteError) {
        console.error("Delete previous PIS PDF failed:", {
          itemId,
          storageKey: previousStorageKey,
          error: deleteError?.message || String(deleteError),
        });
      }
    }

    let responsePisFile = buildStoredWasabiItemFile(item?.pis_file);
    try {
      const freshPisFile = await buildItemFileResponse(item?.pis_file, {
        itemCode: normalizeTextField(item?.code || itemId),
        fallbackBaseName: "item-pis",
        extension: ".pdf",
        requireStorageKey: true,
      });

      if (freshPisFile) {
        responsePisFile = freshPisFile;
      }
    } catch (responseError) {
      console.error("Build PIS upload response link failed:", {
        itemId,
        storageKey: normalizeTextField(item?.pis_file?.key),
        error: responseError?.message || String(responseError),
      });
    }

    return res.status(200).json({
      success: true,
      message: "PIS spreadsheet uploaded successfully",
      data: {
        item_id: item._id,
        pis_file: responsePisFile,
      },
    });
  } catch (error) {
    await safeDeleteLocalFile(stagedPisFilePath);
    if (error?.cleanupError) {
      console.error("PIS upload cleanup after failure failed:", {
        itemId,
        error: error.cleanupError?.details
          || error.cleanupError?.message
          || String(error.cleanupError),
      });
    }

    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    console.error("Upload Item PIS Spreadsheet Error:", {
      itemId,
      error: error?.message || String(error),
      details: error?.details || "",
    });
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to upload PIS spreadsheet",
    });
  }
};

exports.deleteItemFile = async (req, res) => {
  try {
    const itemId = getRequestedItemId(req);
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const fileType = normalizeTextField(
      req.params.fileType || req.query.file_type || req.query.fileType || "",
    ).toLowerCase();
    const fileConfig = getItemFileConfig(fileType);
    if (!fileConfig || !ALLOWED_ITEM_FILE_TYPES.has(fileType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file type",
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const existingFile = normalizeStoredItemFile(item?.[fileConfig.field]);
    if (!existingFile.key && !existingFile.url) {
      return res.status(404).json({
        success: false,
        message: `${fileConfig.label} not found`,
      });
    }

    const beforeItemSnapshot = item.toObject();
    item[fileConfig.field] = {};
    appendItemUpdateHistory(item, {
      before: beforeItemSnapshot,
      after: item.toObject(),
      reqUser: req.user,
      action: "file_delete",
      source: "item_file_delete",
      route: "DELETE /items/:id/files/:fileType",
      metadata: {
        file_type: fileType,
        label: fileConfig.label,
        previous_storage_key: existingFile.key,
        previous_original_name: existingFile.originalName,
      },
    });
    await item.save();

    let storageDeleteWarning = "";
    if (existingFile.key) {
      try {
        await deleteObject(existingFile.key);
      } catch (storageError) {
        storageDeleteWarning = storageError?.message || String(storageError);
        console.error("Delete item file storage object failed:", {
          itemId,
          fileType,
          storageKey: existingFile.key,
          error: storageDeleteWarning,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: storageDeleteWarning
        ? `${fileConfig.label} removed from item. Storage cleanup failed.`
        : `${fileConfig.label} deleted successfully`,
      data: {
        item_id: item._id,
        file_type: fileType,
        storage_delete_warning: storageDeleteWarning,
      },
    });
  } catch (error) {
    console.error("Delete Item File Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete item file",
    });
  }
};

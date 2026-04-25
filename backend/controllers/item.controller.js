const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const mongoose = require("mongoose");
const path = require("path");
const { syncAllItemsFromOrdersAndQc } = require("../services/itemSync");
const { syncTotalPoCbmForItem } = require("../services/orderCbm.service");
const {
  isConfigured: isWasabiConfigured,
  createStorageKey,
  getObjectUrl,
  getSignedObjectUrl,
  uploadBuffer,
  deleteObject,
} = require("../services/wasabiStorage.service");
const { convertExcelToPdf } = require("../services/convertXlsxToPDF.service");
const {
  deriveOrderProgress,
  deriveOrderStatus,
} = require("../helpers/orderStatus");
const {
  BOX_PACKAGING_MODES,
  BOX_SIZE_REMARK_OPTIONS,
  buildBoxLegacyFieldsFromEntries,
  buildBoxMeasurementCbmSummary,
  calculateEffectiveBoxEntriesCbmTotal,
  detectBoxPackagingMode,
} = require("../helpers/boxMeasurement");

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
  "top",
  "base",
  "item1",
  "item2",
  "item3",
  "item4",
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

const calculateSizeEntriesCbmTotal = (entries = []) =>
  normalizeStoredSizeEntries(entries).reduce(
    (sum, entry) => sum + toPositiveCbmNumber(calculateCbmFromLbh(entry)),
    0,
  );

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

const buildLegacyLbhAndWeightFromSizeEntries = (
  entries = [],
  { weightKey = "", remarkOptions = [], mode = "" } = {},
) => {
  if (Array.isArray(remarkOptions) && remarkOptions === BOX_SIZE_REMARK_OPTIONS) {
    return buildBoxLegacyFieldsFromEntries(entries, { weightKey, mode });
  }

  const normalizedEntries = sortSizeEntriesByRemark(
    normalizeStoredSizeEntries(entries, { weightKey }),
    remarkOptions,
  );

  const toLbh = (entry = null) =>
    hasCompletePositiveLbh(entry)
      ? {
          L: toSafeNumber(entry?.L, 0),
          B: toSafeNumber(entry?.B, 0),
          H: toSafeNumber(entry?.H, 0),
        }
      : { L: 0, B: 0, H: 0 };

  const firstEntry = normalizedEntries[0] || null;
  const secondEntry = normalizedEntries[1] || null;
  const totalWeight = weightKey
    ? normalizedEntries.reduce(
        (sum, entry) => sum + toSafeNumber(entry?.[weightKey], 0),
        0,
      )
    : 0;

  if (normalizedEntries.length === 1) {
    return {
      single: toLbh(firstEntry),
      top: { L: 0, B: 0, H: 0 },
      bottom: { L: 0, B: 0, H: 0 },
      totalWeight,
      topWeight: 0,
      bottomWeight: 0,
    };
  }

  return {
    single: { L: 0, B: 0, H: 0 },
    top: toLbh(firstEntry),
    bottom: toLbh(secondEntry),
    totalWeight,
    topWeight: weightKey ? toSafeNumber(firstEntry?.[weightKey], 0) : 0,
    bottomWeight: weightKey ? toSafeNumber(secondEntry?.[weightKey], 0) : 0,
  };
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

const buildLbhRecord = (dimensions = {}) => ({
  L: toSafeNumber(dimensions?.L, 0),
  B: toSafeNumber(dimensions?.B, 0),
  H: toSafeNumber(dimensions?.H, 0),
});

const getPatchedLbhRecord = (currentValue = {}, payloadValue = {}, fieldLabelPrefix = "lbh") => {
  const next = buildLbhRecord(currentValue);
  let provided = false;

  if (!payloadValue || typeof payloadValue !== "object") {
    return { provided, value: next };
  }

  if (hasOwn(payloadValue, "L")) {
    next.L = toNonNegativeNumber(payloadValue.L, `${fieldLabelPrefix}.L`);
    provided = true;
  }
  if (hasOwn(payloadValue, "B")) {
    next.B = toNonNegativeNumber(payloadValue.B, `${fieldLabelPrefix}.B`);
    provided = true;
  }
  if (hasOwn(payloadValue, "H")) {
    next.H = toNonNegativeNumber(payloadValue.H, `${fieldLabelPrefix}.H`);
    provided = true;
  }

  return { provided, value: next };
};

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
  } = {},
) => {
  if (!Array.isArray(entries)) {
    throw new Error(`${fieldLabel} must be an array`);
  }

  if (entries.length > SIZE_ENTRY_LIMIT) {
    throw new Error(`${fieldLabel} cannot exceed ${SIZE_ENTRY_LIMIT} entries`);
  }

  const allowedRemarks = Array.isArray(remarkOptions) ? remarkOptions : [];
  const seenRemarks = new Set();
  const isBoxSizeField =
    fieldLabel === "inspected_box_sizes" || fieldLabel === "pis_box_sizes";
  const resolvedBoxMode =
    isBoxSizeField
      ? detectBoxPackagingMode(mode, entries)
      : BOX_PACKAGING_MODES.INDIVIDUAL;

  return entries.map((entry, index) => {
    const entryLabel = `${fieldLabel} ${index + 1}`;
    const L = toNonNegativeNumber(entry?.L, `${entryLabel}.L`);
    const B = toNonNegativeNumber(entry?.B, `${entryLabel}.B`);
    const H = toNonNegativeNumber(entry?.H, `${entryLabel}.H`);

    if (L <= 0 || B <= 0 || H <= 0) {
      throw new Error(`${entryLabel} must have positive L, B, and H values`);
    }

    const normalizedRemark = normalizeTextField(entry?.remark || "").toLowerCase();
    if (entries.length > 1) {
      if (!normalizedRemark) {
        throw new Error(`${entryLabel}.remark is required`);
      }
      if (!allowedRemarks.includes(normalizedRemark)) {
        throw new Error(`${entryLabel}.remark is invalid`);
      }
      if (seenRemarks.has(normalizedRemark)) {
        throw new Error(`${fieldLabel} remarks must be unique`);
      }
      seenRemarks.add(normalizedRemark);
    }

    const parsedEntry = {
      L,
      B,
      H,
      remark: entries.length > 1 ? normalizedRemark : "",
    };

    if (weightKey) {
      const parsedWeight = toNonNegativeNumber(
        entry?.[weightKey],
        `${entryLabel}.${weightLabel}`,
      );
      if (parsedWeight <= 0) {
        throw new Error(`${entryLabel}.${weightLabel} must be greater than 0`);
      }
      parsedEntry[weightKey] = parsedWeight;
    }

    if (isBoxSizeField) {
      if (resolvedBoxMode === BOX_PACKAGING_MODES.CARTON) {
        const entryType = index === 0 ? "inner" : "master";
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

        if (entryType === "inner" && parsedEntry.item_count_in_inner <= 0) {
          throw new Error(`${entryLabel}.item_count_in_inner must be greater than 0`);
        }
        if (entryType === "master" && parsedEntry.box_count_in_master <= 0) {
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

  const pisSummary =
    calculateSizeEntriesCbmTotal(item?.pis_box_sizes) > 0
      ? buildMeasurementCbmSummary({
          sizes: item?.pis_box_sizes,
          singleLbh: item?.pis_box_LBH || item?.box_LBH,
          topLbh: item?.pis_box_top_LBH,
          bottomLbh: item?.pis_box_bottom_LBH,
          remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        })
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
});
const ALLOWED_ITEM_FILE_TYPES = new Set(Object.keys(ITEM_FILE_CONFIG));
const ITEM_FILE_URL_EXPIRES_IN = 24 * 60 * 60;
const PIS_SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".xls"]);
const PIS_SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/excel",
  "application/x-excel",
  "application/x-msexcel",
  "application/xls",
  "application/x-xls",
]);

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const getItemFileConfig = (fileType = "") =>
  ITEM_FILE_CONFIG[normalizeTextField(fileType).toLowerCase()] || null;

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
    throw createHttpError(400, "Only .xlsx and .xls files are allowed for PIS uploads");
  }

  const mimeType = normalizeTextField(file?.mimetype).toLowerCase();
  if (
    mimeType
    && mimeType !== "application/octet-stream"
    && !PIS_SPREADSHEET_MIME_TYPES.has(mimeType)
  ) {
    throw createHttpError(400, "Only .xlsx and .xls files are allowed for PIS uploads");
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

const normalizeLookupKey = (value) => normalizeTextField(value).toLowerCase();

const MEASUREMENT_COMPARE_TOLERANCE = 0.0001;

const buildMeasurementEntryKey = (entry = {}, index = 0) => {
  const normalizedRemark = normalizeTextField(entry?.remark || entry?.type).toLowerCase();
  return normalizedRemark || `entry${index + 1}`;
};

const hasAnyPositiveMeasurementLbh = (dimensions = {}) =>
  Number(dimensions?.L || 0) > 0
  || Number(dimensions?.B || 0) > 0
  || Number(dimensions?.H || 0) > 0;

const hasPositiveMeasurementWeight = (value) => Number(value || 0) > 0;

const areMeasurementNumbersEqual = (left, right) =>
  Math.abs(toSafeNumber(left, 0) - toSafeNumber(right, 0)) < MEASUREMENT_COMPARE_TOLERANCE;

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
  { weightKey = "" } = {},
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

    if (hasInspectedSize !== hasPisSize) {
      sizeMismatch = true;
    } else if (hasInspectedSize && hasPisSize) {
      if (
        !areMeasurementNumbersEqual(inspectedEntry?.L, pisEntry?.L)
        || !areMeasurementNumbersEqual(inspectedEntry?.B, pisEntry?.B)
        || !areMeasurementNumbersEqual(inspectedEntry?.H, pisEntry?.H)
      ) {
        sizeMismatch = true;
      }
    }

    if (!weightKey) return;

    const hasInspectedWeight = hasPositiveMeasurementWeight(inspectedEntry?.[weightKey]);
    const hasPisWeight = hasPositiveMeasurementWeight(pisEntry?.[weightKey]);
    if (hasInspectedWeight !== hasPisWeight) {
      weightMismatch = true;
    } else if (
      hasInspectedWeight
      && hasPisWeight
      && !areMeasurementNumbersEqual(
        inspectedEntry?.[weightKey],
        pisEntry?.[weightKey],
      )
    ) {
      weightMismatch = true;
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
    { weightKey: "gross_weight" },
  );

  const pisBarcode = normalizeTextField(
    item?.pis_master_barcode || item?.pis_barcode,
  );
  const inspectedBarcode =
    Number(item?.qc?.master_barcode || item?.qc?.barcode || 0) > 0
      ? String(item?.qc?.master_barcode || item?.qc?.barcode).trim()
      : "";
  const barcodeMismatch =
    Boolean(pisBarcode || inspectedBarcode) && pisBarcode !== inspectedBarcode;

  const hasInspectedData =
    itemComparison.hasInspectedData
    || boxComparison.hasInspectedData
    || Boolean(pisBarcode || inspectedBarcode);
  if (!hasInspectedData) {
    return null;
  }

  const diffFields = [];
  if (barcodeMismatch) diffFields.push("Barcode");
  if (itemComparison.sizeMismatch) diffFields.push("Item Size");
  if (itemComparison.weightMismatch) diffFields.push("Item Weight");
  if (boxComparison.sizeMismatch) diffFields.push("Box Size");
  if (boxComparison.weightMismatch) diffFields.push("Box Weight");

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
    },
  };
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

exports.getItems = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const match = buildItemMatch({ search, brand, vendor });

    const [items, totalRecords, brandsRaw, brandNamesRaw, brandsPrimaryRaw, vendorsRaw, codesRaw] =
      await Promise.all([
        Item.find(match)
          .sort({ updatedAt: -1, code: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Item.countDocuments(match),
        Item.distinct("brands", buildItemMatch({ search, vendor })),
        Item.distinct("brand_name", buildItemMatch({ search, vendor })),
        Item.distinct("brand", buildItemMatch({ search, vendor })),
        Item.distinct("vendors", buildItemMatch({ search, brand })),
        Item.distinct("code", buildItemMatch({ brand, vendor })),
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

    return res.status(200).json({
      success: true,
      data: itemsWithLatestInspectionReport,
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

exports.getPisDiffItems = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const match = buildItemMatch({ search, brand, vendor });
    const itemSelect = [
      "code",
      "name",
      "description",
      "brand",
      "brand_name",
      "brands",
      "vendors",
      "pis_barcode",
      "pis_master_barcode",
      "pis_inner_barcode",
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
      "updatedAt",
    ].join(" ");

    const [items, brandsRaw, brandNamesRaw, brandsPrimaryRaw, vendorsRaw, codesRaw] =
      await Promise.all([
        Item.find(match)
          .select(itemSelect)
          .sort({ updatedAt: -1, code: 1 })
          .lean(),
        Item.distinct("brands", buildItemMatch({ search, vendor })),
        Item.distinct("brand_name", buildItemMatch({ search, vendor })),
        Item.distinct("brand", buildItemMatch({ search, vendor })),
        Item.distinct("vendors", buildItemMatch({ search, brand })),
        Item.distinct("code", buildItemMatch({ brand, vendor })),
      ]);

    const diffRows = (Array.isArray(items) ? items : [])
      .map((item) => {
        const pisDiff = buildPisDiffSummary(item);
        if (!pisDiff) return null;
        return {
          ...item,
          pis_diff: pisDiff,
        };
      })
      .filter(Boolean);

    const paginatedRows = diffRows.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      data: paginatedRows,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(diffRows.length / limit)),
        totalRecords: diffRows.length,
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
    console.error("Get PIS Diff Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch PIS diff items",
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
    const code = normalizeTextField(payload.code).toUpperCase();
    const name = normalizeTextField(payload.name);
    const description = normalizeTextField(payload.description);
    const brand = normalizeTextField(payload.brand);
    const vendor = normalizeTextField(payload.vendor);

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

    const derivedPisItemLegacy = buildLegacyLbhAndWeightFromSizeEntries(
      parsedPisItemSizes,
      {
        weightKey: "net_weight",
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
      },
    );
    const derivedPisBoxLegacy = buildLegacyLbhAndWeightFromSizeEntries(
      parsedPisBoxSizes,
      {
        weightKey: "gross_weight",
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
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
      pis_item_sizes: parsedPisItemSizes,
      pis_box_sizes: parsedPisBoxSizes,
      pis_box_mode: parsedPisBoxMode,
      pis_item_LBH: derivedPisItemLegacy.single,
      pis_item_top_LBH: derivedPisItemLegacy.top,
      pis_item_bottom_LBH: derivedPisItemLegacy.bottom,
      pis_box_LBH: derivedPisBoxLegacy.single,
      pis_box_top_LBH: derivedPisBoxLegacy.top,
      pis_box_bottom_LBH: derivedPisBoxLegacy.bottom,
      pis_weight: {
        top_net: derivedPisItemLegacy.topWeight,
        bottom_net: derivedPisItemLegacy.bottomWeight,
        total_net: derivedPisItemLegacy.totalWeight,
        top_gross: derivedPisBoxLegacy.topWeight,
        bottom_gross: derivedPisBoxLegacy.bottomWeight,
        total_gross: derivedPisBoxLegacy.totalWeight,
      },
      source: {
        from_orders: false,
        from_qc: false,
      },
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
    const summary = await syncAllItemsFromOrdersAndQc();

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

    const setPath = (path, value) => {
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

    const patchedInspectedItemLbh = getPatchedLbhRecord(
      item?.inspected_item_LBH,
      payload?.inspected_item_LBH,
      "inspected_item_LBH",
    );
    if (patchedInspectedItemLbh.provided) {
      setPath("inspected_item_LBH", patchedInspectedItemLbh.value);
    }

    const patchedInspectedItemTopLbh = getPatchedLbhRecord(
      item?.inspected_item_top_LBH,
      payload?.inspected_item_top_LBH,
      "inspected_item_top_LBH",
    );
    if (patchedInspectedItemTopLbh.provided) {
      setPath("inspected_item_top_LBH", patchedInspectedItemTopLbh.value);
    }

    const patchedInspectedItemBottomLbh = getPatchedLbhRecord(
      item?.inspected_item_bottom_LBH,
      payload?.inspected_item_bottom_LBH,
      "inspected_item_bottom_LBH",
    );
    if (patchedInspectedItemBottomLbh.provided) {
      setPath("inspected_item_bottom_LBH", patchedInspectedItemBottomLbh.value);
    }

    const patchedInspectedBoxLbh = getPatchedLbhRecord(
      item?.inspected_box_LBH,
      payload?.inspected_box_LBH,
      "inspected_box_LBH",
    );
    if (patchedInspectedBoxLbh.provided) {
      setPath("inspected_box_LBH", patchedInspectedBoxLbh.value);
      inspectedBoxTouched = true;
    }

    const patchedInspectedBoxTopLbh = getPatchedLbhRecord(
      item?.inspected_box_top_LBH || item?.inspected_top_LBH,
      payload?.inspected_box_top_LBH || payload?.inspected_top_LBH,
      hasOwn(payload || {}, "inspected_box_top_LBH")
        ? "inspected_box_top_LBH"
        : "inspected_top_LBH",
    );
    if (patchedInspectedBoxTopLbh.provided) {
      setPath("inspected_box_top_LBH", patchedInspectedBoxTopLbh.value);
      setPath("inspected_top_LBH", patchedInspectedBoxTopLbh.value);
      inspectedBoxTouched = true;
    }

    const patchedInspectedBoxBottomLbh = getPatchedLbhRecord(
      item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH,
      payload?.inspected_box_bottom_LBH || payload?.inspected_bottom_LBH,
      hasOwn(payload || {}, "inspected_box_bottom_LBH")
        ? "inspected_box_bottom_LBH"
        : "inspected_bottom_LBH",
    );
    if (patchedInspectedBoxBottomLbh.provided) {
      setPath("inspected_box_bottom_LBH", patchedInspectedBoxBottomLbh.value);
      setPath("inspected_bottom_LBH", patchedInspectedBoxBottomLbh.value);
      inspectedBoxTouched = true;
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
      const derivedItemLegacy = buildLegacyLbhAndWeightFromSizeEntries(
        parsedInspectedItemSizes,
        {
          weightKey: "net_weight",
          remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        },
      );

      setPath("inspected_item_sizes", parsedInspectedItemSizes);
      setPath("inspected_item_LBH", derivedItemLegacy.single);
      setPath("inspected_item_top_LBH", derivedItemLegacy.top);
      setPath("inspected_item_bottom_LBH", derivedItemLegacy.bottom);
      nextInspectedWeight.top_net = derivedItemLegacy.topWeight;
      nextInspectedWeight.bottom_net = derivedItemLegacy.bottomWeight;
      nextInspectedWeight.total_net = derivedItemLegacy.totalWeight;
      inspectedWeightTouched = true;
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
      const derivedBoxLegacy = buildLegacyLbhAndWeightFromSizeEntries(
        parsedInspectedBoxSizes,
        {
          weightKey: "gross_weight",
          remarkOptions: BOX_SIZE_REMARK_OPTIONS,
          mode: parsedInspectedBoxMode,
        },
      );

      setPath("inspected_box_sizes", parsedInspectedBoxSizes);
      setPath("inspected_box_mode", parsedInspectedBoxMode);
      setPath("inspected_box_LBH", derivedBoxLegacy.single);
      setPath("inspected_box_top_LBH", derivedBoxLegacy.top);
      setPath("inspected_top_LBH", derivedBoxLegacy.top);
      setPath("inspected_box_bottom_LBH", derivedBoxLegacy.bottom);
      setPath("inspected_bottom_LBH", derivedBoxLegacy.bottom);
      nextInspectedWeight.top_gross = derivedBoxLegacy.topWeight;
      nextInspectedWeight.bottom_gross = derivedBoxLegacy.bottomWeight;
      nextInspectedWeight.total_gross = derivedBoxLegacy.totalWeight;
      inspectedWeightTouched = true;
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

    if (!touched) {
      return res.status(400).json({
        success: false,
        message: "No editable fields provided",
      });
    }

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
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const setPath = (path, value) => {
      item.set(path, value);
    };
    let pisFieldsTouched = false;
    const setPisPath = (path, value) => {
      setPath(path, value);
      pisFieldsTouched = true;
    };
    const nextPisWeight = buildWeightRecord(item?.pis_weight);
    let pisWeightTouched = false;

    if (payload?.pis_weight && typeof payload.pis_weight === "object") {
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
      setPisPath("pis_barcode", nextMasterBarcode);
      setPisPath("pis_master_barcode", nextMasterBarcode);
    }
    if (hasOwn(payload, "pis_master_barcode")) {
      const nextMasterBarcode = normalizeTextField(payload.pis_master_barcode);
      setPisPath("pis_master_barcode", nextMasterBarcode);
      setPisPath("pis_barcode", nextMasterBarcode);
    }
    if (hasOwn(payload, "pis_inner_barcode")) {
      setPisPath("pis_inner_barcode", normalizeTextField(payload.pis_inner_barcode));
    }

    const patchedPisItemLbh = getPatchedLbhRecord(
      item?.pis_item_LBH,
      payload?.pis_item_LBH,
      "pis_item_LBH",
    );
    if (patchedPisItemLbh.provided) {
      setPisPath("pis_item_LBH", patchedPisItemLbh.value);
    }

    const patchedPisItemTopLbh = getPatchedLbhRecord(
      item?.pis_item_top_LBH,
      payload?.pis_item_top_LBH,
      "pis_item_top_LBH",
    );
    if (patchedPisItemTopLbh.provided) {
      setPisPath("pis_item_top_LBH", patchedPisItemTopLbh.value);
    }

    const patchedPisItemBottomLbh = getPatchedLbhRecord(
      item?.pis_item_bottom_LBH,
      payload?.pis_item_bottom_LBH,
      "pis_item_bottom_LBH",
    );
    if (patchedPisItemBottomLbh.provided) {
      setPisPath("pis_item_bottom_LBH", patchedPisItemBottomLbh.value);
    }

    const patchedPisBoxLbh = getPatchedLbhRecord(
      item?.pis_box_LBH,
      payload?.pis_box_LBH,
      "pis_box_LBH",
    );
    if (patchedPisBoxLbh.provided) {
      setPisPath("pis_box_LBH", patchedPisBoxLbh.value);
    }

    const patchedPisBoxTopLbh = getPatchedLbhRecord(
      item?.pis_box_top_LBH,
      payload?.pis_box_top_LBH,
      "pis_box_top_LBH",
    );
    if (patchedPisBoxTopLbh.provided) {
      setPisPath("pis_box_top_LBH", patchedPisBoxTopLbh.value);
    }

    const patchedPisBoxBottomLbh = getPatchedLbhRecord(
      item?.pis_box_bottom_LBH,
      payload?.pis_box_bottom_LBH,
      "pis_box_bottom_LBH",
    );
    if (patchedPisBoxBottomLbh.provided) {
      setPisPath("pis_box_bottom_LBH", patchedPisBoxBottomLbh.value);
    }

    if (hasOwn(payload, "pis_item_sizes")) {
      const parsedPisItemSizes = parseSizeEntriesPayload(payload.pis_item_sizes, {
        fieldLabel: "pis_item_sizes",
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        weightKey: "net_weight",
        weightLabel: "net_weight",
      });
      const derivedPisItemLegacy = buildLegacyLbhAndWeightFromSizeEntries(
        parsedPisItemSizes,
        {
          weightKey: "net_weight",
          remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        },
      );

      setPisPath("pis_item_sizes", parsedPisItemSizes);
      setPisPath("pis_item_LBH", derivedPisItemLegacy.single);
      setPisPath("pis_item_top_LBH", derivedPisItemLegacy.top);
      setPisPath("pis_item_bottom_LBH", derivedPisItemLegacy.bottom);
      nextPisWeight.top_net = derivedPisItemLegacy.topWeight;
      nextPisWeight.bottom_net = derivedPisItemLegacy.bottomWeight;
      nextPisWeight.total_net = derivedPisItemLegacy.totalWeight;
      pisWeightTouched = true;
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
      });
      const derivedPisBoxLegacy = buildLegacyLbhAndWeightFromSizeEntries(
        parsedPisBoxSizes,
        {
          weightKey: "gross_weight",
          remarkOptions: BOX_SIZE_REMARK_OPTIONS,
          mode: parsedPisBoxMode,
        },
      );

      setPisPath("pis_box_sizes", parsedPisBoxSizes);
      setPisPath("pis_box_mode", parsedPisBoxMode);
      setPisPath("pis_box_LBH", derivedPisBoxLegacy.single);
      setPisPath("pis_box_top_LBH", derivedPisBoxLegacy.top);
      setPisPath("pis_box_bottom_LBH", derivedPisBoxLegacy.bottom);
      nextPisWeight.top_gross = derivedPisBoxLegacy.topWeight;
      nextPisWeight.bottom_gross = derivedPisBoxLegacy.bottomWeight;
      nextPisWeight.total_gross = derivedPisBoxLegacy.totalWeight;
      pisWeightTouched = true;
    }

    if (hasOwn(payload, "pis_box_mode") && !hasOwn(payload, "pis_box_sizes")) {
      setPisPath(
        "pis_box_mode",
        detectBoxPackagingMode(payload?.pis_box_mode, item?.pis_box_sizes),
      );
    }

    if (pisWeightTouched) {
      setPisPath("pis_weight", nextPisWeight);
    }

    if (!pisFieldsTouched) {
      return res.status(400).json({
        success: false,
        message: "No PIS fields provided",
      });
    }

    setPath("pis_checked_flag", true);

    applyCalculatedCbmTotals(item, setPath);
    await item.save();

    return res.status(200).json({
      success: true,
      message: "PIS values updated successfully",
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
      `code ${fileConfig.field}`,
    );
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
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

    const previousPisFile = normalizeStoredItemFile(item?.pis_file);
    const previousStorageKey = previousPisFile.key;
    item.pis_file = await uploadPisSpreadsheetForItem({
      itemCode: normalizeTextField(item?.code),
      itemId,
      file: req.file,
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

    item[fileConfig.field] = {};
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

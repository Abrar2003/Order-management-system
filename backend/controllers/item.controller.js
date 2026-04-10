const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const mongoose = require("mongoose");
const path = require("path");
const { syncAllItemsFromOrdersAndQc } = require("../services/itemSync");
const {
  isConfigured: isWasabiConfigured,
  createStorageKey,
  getSignedObjectUrl,
  uploadBuffer,
  deleteObject,
} = require("../services/wasabiStorage.service");

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

const SIZE_ENTRY_LIMIT = 3;
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  "top",
  "base",
  "item1",
  "item2",
  "item3",
]);
const BOX_SIZE_REMARK_OPTIONS = Object.freeze([
  "top",
  "base",
  "box1",
  "box2",
  "box3",
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
  { weightKey = "", remarkOptions = [] } = {},
) => {
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
  { fieldLabel = "size entries", remarkOptions = [], weightKey = "", weightLabel = "weight" } = {},
) => {
  if (!Array.isArray(entries)) {
    throw new Error(`${fieldLabel} must be an array`);
  }

  if (entries.length > SIZE_ENTRY_LIMIT) {
    throw new Error(`${fieldLabel} cannot exceed ${SIZE_ENTRY_LIMIT} entries`);
  }

  const allowedRemarks = Array.isArray(remarkOptions) ? remarkOptions : [];
  const seenRemarks = new Set();

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

    return parsedEntry;
  });
};

const applyCalculatedCbmTotals = (item, setPath) => {
  const inspectedSummary =
    calculateSizeEntriesCbmTotal(item?.inspected_box_sizes) > 0
      ? buildMeasurementCbmSummary({
          sizes: item?.inspected_box_sizes,
          singleLbh: item?.inspected_box_LBH || item?.box_LBH,
          topLbh: item?.inspected_box_top_LBH || item?.inspected_top_LBH,
          bottomLbh: item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH,
          remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        })
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

const getPassedQuantity = (qcRecord = null) =>
  Math.max(0, toSafeNumber(qcRecord?.quantities?.qc_passed, 0));

const getOpenQuantity = (order = {}) => {
  const totalQuantity = Math.max(0, toSafeNumber(order?.quantity, 0));
  const qcRecord =
    order?.qc_record && typeof order.qc_record === "object" ? order.qc_record : null;

  if (qcRecord) {
    return Math.max(0, toSafeNumber(qcRecord?.quantities?.pending, 0));
  }

  return Math.max(0, totalQuantity - getPassedQuantity(qcRecord));
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

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const getItemFileConfig = (fileType = "") =>
  ITEM_FILE_CONFIG[normalizeTextField(fileType).toLowerCase()] || null;

const normalizeStoredItemFile = (file = {}) => {
  const parsedSize = Number(file?.size || 0);
  return {
    key: normalizeTextField(file?.key || file?.public_id),
    originalName: normalizeTextField(file?.originalName),
    contentType: normalizeTextField(file?.contentType),
    size: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0,
    url: normalizeTextField(file?.url || file?.link),
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
          select: "inspector last_inspected_date quantities inspection_record",
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
        status: String(order?.status || "").trim(),
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
        select: "quantities",
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
        status: String(order?.status || "").trim(),
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

    let touched = false;
    const setPath = (path, value) => {
      item.set(path, value);
      touched = true;
    };
    const nextInspectedWeight = buildWeightRecord(item?.inspected_weight);
    let inspectedWeightTouched = false;

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
      const parsedInspectedBoxSizes = parseSizeEntriesPayload(payload.inspected_box_sizes, {
        fieldLabel: "inspected_box_sizes",
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        weightKey: "gross_weight",
        weightLabel: "gross_weight",
      });
      const derivedBoxLegacy = buildLegacyLbhAndWeightFromSizeEntries(
        parsedInspectedBoxSizes,
        {
          weightKey: "gross_weight",
          remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        },
      );

      setPath("inspected_box_sizes", parsedInspectedBoxSizes);
      setPath("inspected_box_LBH", derivedBoxLegacy.single);
      setPath("inspected_box_top_LBH", derivedBoxLegacy.top);
      setPath("inspected_top_LBH", derivedBoxLegacy.top);
      setPath("inspected_box_bottom_LBH", derivedBoxLegacy.bottom);
      setPath("inspected_bottom_LBH", derivedBoxLegacy.bottom);
      nextInspectedWeight.top_gross = derivedBoxLegacy.topWeight;
      nextInspectedWeight.bottom_gross = derivedBoxLegacy.bottomWeight;
      nextInspectedWeight.total_gross = derivedBoxLegacy.totalWeight;
      inspectedWeightTouched = true;
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
        setPath("qc.barcode", toNonNegativeNumber(payload.qc.barcode, "qc.barcode"));
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

    return res.status(200).json({
      success: true,
      message: "Item updated successfully",
      data: item.toObject(),
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

    let touched = false;
    const setPath = (path, value) => {
      item.set(path, value);
      touched = true;
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
      }
    }

    if (hasOwn(payload, "pis_barcode")) {
      setPath("pis_barcode", normalizeTextField(payload.pis_barcode));
    }

    const patchedPisItemLbh = getPatchedLbhRecord(
      item?.pis_item_LBH,
      payload?.pis_item_LBH,
      "pis_item_LBH",
    );
    if (patchedPisItemLbh.provided) {
      setPath("pis_item_LBH", patchedPisItemLbh.value);
    }

    const patchedPisItemTopLbh = getPatchedLbhRecord(
      item?.pis_item_top_LBH,
      payload?.pis_item_top_LBH,
      "pis_item_top_LBH",
    );
    if (patchedPisItemTopLbh.provided) {
      setPath("pis_item_top_LBH", patchedPisItemTopLbh.value);
    }

    const patchedPisItemBottomLbh = getPatchedLbhRecord(
      item?.pis_item_bottom_LBH,
      payload?.pis_item_bottom_LBH,
      "pis_item_bottom_LBH",
    );
    if (patchedPisItemBottomLbh.provided) {
      setPath("pis_item_bottom_LBH", patchedPisItemBottomLbh.value);
    }

    const patchedPisBoxLbh = getPatchedLbhRecord(
      item?.pis_box_LBH,
      payload?.pis_box_LBH,
      "pis_box_LBH",
    );
    if (patchedPisBoxLbh.provided) {
      setPath("pis_box_LBH", patchedPisBoxLbh.value);
    }

    const patchedPisBoxTopLbh = getPatchedLbhRecord(
      item?.pis_box_top_LBH,
      payload?.pis_box_top_LBH,
      "pis_box_top_LBH",
    );
    if (patchedPisBoxTopLbh.provided) {
      setPath("pis_box_top_LBH", patchedPisBoxTopLbh.value);
    }

    const patchedPisBoxBottomLbh = getPatchedLbhRecord(
      item?.pis_box_bottom_LBH,
      payload?.pis_box_bottom_LBH,
      "pis_box_bottom_LBH",
    );
    if (patchedPisBoxBottomLbh.provided) {
      setPath("pis_box_bottom_LBH", patchedPisBoxBottomLbh.value);
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

      setPath("pis_item_sizes", parsedPisItemSizes);
      setPath("pis_item_LBH", derivedPisItemLegacy.single);
      setPath("pis_item_top_LBH", derivedPisItemLegacy.top);
      setPath("pis_item_bottom_LBH", derivedPisItemLegacy.bottom);
      nextPisWeight.top_net = derivedPisItemLegacy.topWeight;
      nextPisWeight.bottom_net = derivedPisItemLegacy.bottomWeight;
      nextPisWeight.total_net = derivedPisItemLegacy.totalWeight;
      pisWeightTouched = true;
    }

    if (hasOwn(payload, "pis_box_sizes")) {
      const parsedPisBoxSizes = parseSizeEntriesPayload(payload.pis_box_sizes, {
        fieldLabel: "pis_box_sizes",
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        weightKey: "gross_weight",
        weightLabel: "gross_weight",
      });
      const derivedPisBoxLegacy = buildLegacyLbhAndWeightFromSizeEntries(
        parsedPisBoxSizes,
        {
          weightKey: "gross_weight",
          remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        },
      );

      setPath("pis_box_sizes", parsedPisBoxSizes);
      setPath("pis_box_LBH", derivedPisBoxLegacy.single);
      setPath("pis_box_top_LBH", derivedPisBoxLegacy.top);
      setPath("pis_box_bottom_LBH", derivedPisBoxLegacy.bottom);
      nextPisWeight.top_gross = derivedPisBoxLegacy.topWeight;
      nextPisWeight.bottom_gross = derivedPisBoxLegacy.bottomWeight;
      nextPisWeight.total_gross = derivedPisBoxLegacy.totalWeight;
      pisWeightTouched = true;
    }

    if (pisWeightTouched) {
      setPath("pis_weight", nextPisWeight);
    }

    if (!touched) {
      return res.status(400).json({
        success: false,
        message: "No PIS fields provided",
      });
    }

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
    const itemId = String(req.params.id || "").trim();
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

    const storedFile = normalizeStoredItemFile(item?.[fileConfig.field]);
    if (!storedFile.key && !storedFile.url) {
      return res.status(404).json({
        success: false,
        message: `${fileConfig.label} not found`,
      });
    }

    let url = storedFile.url;
    if (storedFile.key) {
      if (!isWasabiConfigured()) {
        return res.status(500).json({
          success: false,
          message: "Wasabi storage is not configured",
        });
      }

      url = await getSignedObjectUrl(storedFile.key, {
        expiresIn: 24 * 60 * 60,
        filename:
          storedFile.originalName ||
          `${normalizeTextField(item?.code || itemId)}${fileConfig.defaultExtension}`,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        item_id: item._id,
        file_type: fileType,
        file: {
          key: storedFile.key,
          originalName: storedFile.originalName,
          contentType: storedFile.contentType,
          size: storedFile.size,
        },
        url,
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
    const itemId = String(req.params.id || "").trim();
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
    const uploadResult = await uploadBuffer({
      buffer: req.file.buffer,
      key: createStorageKey({
        folder: fileConfig.folder,
        originalName: fallbackOriginalName,
        extension: extension || fileConfig.defaultExtension,
      }),
      originalName: fallbackOriginalName,
      contentType: mimeType || "application/octet-stream",
    });

    item[fileConfig.field] = {
      key: uploadResult.key,
      originalName: uploadResult.originalName,
      contentType: uploadResult.contentType,
      size: uploadResult.size,
    };
    await item.save();

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
        file: normalizeStoredItemFile(item?.[fileConfig.field]),
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

exports.deleteItemFile = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
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

const {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
  BOX_SIZE_REMARK_OPTIONS,
  detectBoxPackagingMode,
} = require("./boxMeasurement");

const SIZE_ENTRY_LIMIT = 4;
const NUMBER_TOLERANCE = 0.001;
const LEGACY_WEIGHT_FALLBACK_BY_KEY = Object.freeze({
  total_net: "net",
  total_gross: "gross",
});
const ITEM_SIZE_REMARK_ORDER = Object.freeze([
  "",
  "item",
  "top",
  "base",
  "item1",
  "item2",
  "item3",
  "item4",
]);
const BOX_SIZE_REMARK_ORDER = Object.freeze([
  "",
  "inner",
  "master",
  "top",
  "base",
  "box1",
  "box2",
  "box3",
  "box4",
]);
const SNAPSHOT_SOURCE_FIELDS = Object.freeze([
  "inspected_item_sizes",
  "inspected_box_sizes",
  "inspected_box_mode",
  "inspected_item_LBH",
  "inspected_item_top_LBH",
  "inspected_item_bottom_LBH",
  "inspected_box_LBH",
  "inspected_box_top_LBH",
  "inspected_box_bottom_LBH",
  "inspected_top_LBH",
  "inspected_bottom_LBH",
  "inspected_weight",
]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getWeightValue = (weight = {}, key = "") => {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) return 0;

  const fallbackKey = LEGACY_WEIGHT_FALLBACK_BY_KEY[normalizedKey];
  return normalizeNumber(
    weight?.[normalizedKey] ??
      (fallbackKey ? weight?.[fallbackKey] : undefined) ??
      0,
  );
};

const hasMeaningfulNumber = (value) =>
  Math.abs(normalizeNumber(value)) > NUMBER_TOLERANCE;

const hasMeaningfulItemEntry = (entry = {}) =>
  ["L", "B", "H", "net_weight", "gross_weight"].some((field) =>
    hasMeaningfulNumber(entry?.[field]),
  ) || Boolean(normalizeKey(entry?.remark));

const hasMeaningfulBoxEntry = (entry = {}) =>
  [
    "L",
    "B",
    "H",
    "net_weight",
    "gross_weight",
    "item_count_in_inner",
    "box_count_in_master",
  ].some((field) => hasMeaningfulNumber(entry?.[field])) ||
  Boolean(normalizeKey(entry?.remark)) ||
  Boolean(normalizeKey(entry?.box_type));

const buildItemEntryKey = (entry = {}, index = 0) =>
  normalizeKey(entry?.remark) || `entry-${index + 1}`;

const buildBoxEntryKey = (entry = {}, index = 0) => {
  const remark = normalizeKey(entry?.remark);
  const boxType = normalizeKey(entry?.box_type);
  if (remark || boxType) {
    return `${remark || "entry"}::${boxType || "na"}`;
  }
  return `entry-${index + 1}`;
};

const sortEntries = (entries = [], { order = [], keyBuilder } = {}) =>
  [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftRemark = normalizeKey(left?.remark);
    const rightRemark = normalizeKey(right?.remark);
    const leftIndex = order.indexOf(leftRemark);
    const rightIndex = order.indexOf(rightRemark);
    const safeLeftIndex = leftIndex >= 0 ? leftIndex : order.length + 1;
    const safeRightIndex = rightIndex >= 0 ? rightIndex : order.length + 1;

    if (safeLeftIndex !== safeRightIndex) {
      return safeLeftIndex - safeRightIndex;
    }

    return keyBuilder(left, 0).localeCompare(keyBuilder(right, 0), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

const normalizeItemSizeEntry = (entry = {}) => ({
  L: normalizeNumber(entry?.L),
  B: normalizeNumber(entry?.B),
  H: normalizeNumber(entry?.H),
  remark: normalizeKey(entry?.remark || entry?.type || ""),
  net_weight: normalizeNumber(entry?.net_weight ?? entry?.weight),
  gross_weight: normalizeNumber(entry?.gross_weight),
});

const normalizeBoxEntryMetadata = (
  entry = {},
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
) => {
  const resolvedMode = detectBoxPackagingMode(mode, [entry]);
  const normalizedRemark = normalizeKey(entry?.remark || entry?.type || "");
  const normalizedBoxType = normalizeKey(entry?.box_type || "");

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const resolvedType =
      normalizedBoxType === BOX_ENTRY_TYPES.MASTER ||
      normalizedRemark === BOX_ENTRY_TYPES.MASTER
        ? BOX_ENTRY_TYPES.MASTER
        : BOX_ENTRY_TYPES.INNER;

    return {
      remark: resolvedType,
      box_type: resolvedType,
      item_count_in_inner:
        resolvedType === BOX_ENTRY_TYPES.INNER
          ? normalizeNumber(entry?.item_count_in_inner)
          : 0,
      box_count_in_master:
        resolvedType === BOX_ENTRY_TYPES.MASTER
          ? normalizeNumber(entry?.box_count_in_master)
          : 0,
    };
  }

  return {
    remark: BOX_SIZE_REMARK_OPTIONS.includes(normalizedRemark) ? normalizedRemark : "",
    box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
    item_count_in_inner: 0,
    box_count_in_master: 0,
  };
};

const normalizeBoxSizeEntry = (
  entry = {},
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
) => ({
  L: normalizeNumber(entry?.L),
  B: normalizeNumber(entry?.B),
  H: normalizeNumber(entry?.H),
  net_weight: normalizeNumber(entry?.net_weight),
  gross_weight: normalizeNumber(entry?.gross_weight ?? entry?.weight),
  ...normalizeBoxEntryMetadata(entry, mode),
});

const normalizeItemSizes = (entries = []) =>
  sortEntries(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeItemSizeEntry(entry))
      .filter((entry) => hasMeaningfulItemEntry(entry))
      .slice(0, SIZE_ENTRY_LIMIT),
    {
      order: ITEM_SIZE_REMARK_ORDER,
      keyBuilder: buildItemEntryKey,
    },
  );

const normalizeBoxSizes = (
  entries = [],
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
) => {
  const resolvedMode = detectBoxPackagingMode(mode, entries);
  const limit = resolvedMode === BOX_PACKAGING_MODES.CARTON ? 2 : SIZE_ENTRY_LIMIT;

  return sortEntries(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeBoxSizeEntry(entry, resolvedMode))
      .filter((entry) => hasMeaningfulBoxEntry(entry))
      .slice(0, limit),
    {
      order: BOX_SIZE_REMARK_ORDER,
      keyBuilder: buildBoxEntryKey,
    },
  );
};

const buildItemSizesFromSource = (source = {}) => {
  const normalizedEntries = normalizeItemSizes(source?.inspected_item_sizes);
  if (normalizedEntries.length > 0) return normalizedEntries;

  const legacyEntries = [];
  const topEntry = normalizeItemSizeEntry({
    ...(source?.inspected_item_top_LBH || {}),
    remark: "top",
    net_weight: getWeightValue(source?.inspected_weight, "top_net"),
  });
  if (hasMeaningfulItemEntry(topEntry)) {
    legacyEntries.push(topEntry);
  }

  const bottomEntry = normalizeItemSizeEntry({
    ...(source?.inspected_item_bottom_LBH || {}),
    remark: "base",
    net_weight: getWeightValue(source?.inspected_weight, "bottom_net"),
  });
  if (hasMeaningfulItemEntry(bottomEntry)) {
    legacyEntries.push(bottomEntry);
  }

  if (legacyEntries.length > 0) {
    return sortEntries(legacyEntries, {
      order: ITEM_SIZE_REMARK_ORDER,
      keyBuilder: buildItemEntryKey,
    });
  }

  const singleEntry = normalizeItemSizeEntry({
    ...(source?.inspected_item_LBH || {}),
    remark: "",
    net_weight: getWeightValue(source?.inspected_weight, "total_net"),
  });

  return hasMeaningfulItemEntry(singleEntry) ? [singleEntry] : [];
};

const buildBoxSizesFromSource = (source = {}) => {
  const resolvedMode = detectBoxPackagingMode(
    source?.inspected_box_mode,
    source?.inspected_box_sizes,
  );
  const normalizedEntries = normalizeBoxSizes(
    source?.inspected_box_sizes,
    resolvedMode,
  );
  if (normalizedEntries.length > 0) {
    return normalizedEntries;
  }

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const masterEntry = normalizeBoxSizeEntry(
      {
        ...(source?.inspected_box_LBH || {}),
        remark: BOX_ENTRY_TYPES.MASTER,
        box_type: BOX_ENTRY_TYPES.MASTER,
        gross_weight: getWeightValue(source?.inspected_weight, "total_gross"),
      },
      resolvedMode,
    );
    return hasMeaningfulBoxEntry(masterEntry) ? [masterEntry] : [];
  }

  const legacyEntries = [];
  const topEntry = normalizeBoxSizeEntry(
    {
      ...(source?.inspected_box_top_LBH || source?.inspected_top_LBH || {}),
      remark: "top",
      gross_weight: getWeightValue(source?.inspected_weight, "top_gross"),
    },
    resolvedMode,
  );
  if (hasMeaningfulBoxEntry(topEntry)) {
    legacyEntries.push(topEntry);
  }

  const bottomEntry = normalizeBoxSizeEntry(
    {
      ...(source?.inspected_box_bottom_LBH || source?.inspected_bottom_LBH || {}),
      remark: "base",
      gross_weight: getWeightValue(source?.inspected_weight, "bottom_gross"),
    },
    resolvedMode,
  );
  if (hasMeaningfulBoxEntry(bottomEntry)) {
    legacyEntries.push(bottomEntry);
  }

  if (legacyEntries.length > 0) {
    return sortEntries(legacyEntries, {
      order: BOX_SIZE_REMARK_ORDER,
      keyBuilder: buildBoxEntryKey,
    });
  }

  const singleEntry = normalizeBoxSizeEntry(
    {
      ...(source?.inspected_box_LBH || {}),
      remark: "",
      box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
      gross_weight: getWeightValue(source?.inspected_weight, "total_gross"),
    },
    resolvedMode,
  );

  return hasMeaningfulBoxEntry(singleEntry) ? [singleEntry] : [];
};

const buildNormalizedInspectionSizeState = (source = {}) => {
  const itemSizes = buildItemSizesFromSource(source);
  const boxSizes = buildBoxSizesFromSource(source);
  const inspectedBoxMode = detectBoxPackagingMode(
    source?.inspected_box_mode,
    boxSizes,
  );

  return {
    inspected_item_sizes: itemSizes,
    inspected_box_sizes: boxSizes,
    inspected_box_mode: inspectedBoxMode,
  };
};

const buildInspectionSizeSnapshot = ({
  qcDoc = null,
  updatePayload = {},
  currentSource = null,
} = {}) => {
  const baseSource = currentSource || qcDoc || {};
  const mergedSource = {
    ...(baseSource && typeof baseSource === "object" ? baseSource : {}),
  };

  SNAPSHOT_SOURCE_FIELDS.forEach((field) => {
    if (hasOwn(updatePayload, field)) {
      mergedSource[field] = updatePayload[field];
    }
  });

  return buildNormalizedInspectionSizeState(mergedSource);
};

const numericValuesEqual = (left, right) =>
  Math.abs(normalizeNumber(left) - normalizeNumber(right)) <= NUMBER_TOLERANCE;

const textValuesEqual = (left, right) => normalizeKey(left) === normalizeKey(right);

const createMismatchEntry = ({
  index = 0,
  field = "",
  label = "",
  inspectionValue = null,
  qcValue = null,
} = {}) => ({
  index,
  field,
  inspection_value: inspectionValue,
  qc_value: qcValue,
  label,
});

const compareEntryArrays = ({
  inspectionEntries = [],
  currentEntries = [],
  labelPrefix = "",
  fields = [],
} = {}) => {
  const mismatches = [];
  const maxLength = Math.max(
    Array.isArray(inspectionEntries) ? inspectionEntries.length : 0,
    Array.isArray(currentEntries) ? currentEntries.length : 0,
  );

  for (let index = 0; index < maxLength; index += 1) {
    const inspectionEntry = inspectionEntries[index] || {};
    const currentEntry = currentEntries[index] || {};

    fields.forEach((fieldConfig) => {
      const inspectionValue = inspectionEntry?.[fieldConfig.key];
      const qcValue = currentEntry?.[fieldConfig.key];
      const isEqual =
        fieldConfig.type === "text"
          ? textValuesEqual(inspectionValue, qcValue)
          : numericValuesEqual(inspectionValue, qcValue);

      if (isEqual) return;

      mismatches.push(
        createMismatchEntry({
          index,
          field: fieldConfig.key,
          inspectionValue:
            fieldConfig.type === "text"
              ? normalizeText(inspectionValue)
              : normalizeNumber(inspectionValue),
          qcValue:
            fieldConfig.type === "text"
              ? normalizeText(qcValue)
              : normalizeNumber(qcValue),
          label: `${labelPrefix} ${index + 1} - ${fieldConfig.label}`,
        }),
      );
    });
  }

  return mismatches;
};

const compareInspectionSizeSnapshot = (inspection = {}, currentSource = {}) => {
  const inspectionState = buildNormalizedInspectionSizeState(inspection);
  const currentState = buildNormalizedInspectionSizeState(currentSource);

  const itemSizeMismatches = compareEntryArrays({
    inspectionEntries: inspectionState.inspected_item_sizes,
    currentEntries: currentState.inspected_item_sizes,
    labelPrefix: "Item Size",
    fields: [
      { key: "L", label: "L", type: "number" },
      { key: "B", label: "B", type: "number" },
      { key: "H", label: "H", type: "number" },
      { key: "remark", label: "Remark", type: "text" },
      { key: "net_weight", label: "Net Weight", type: "number" },
      { key: "gross_weight", label: "Gross Weight", type: "number" },
    ],
  });

  const boxSizeMismatches = compareEntryArrays({
    inspectionEntries: inspectionState.inspected_box_sizes,
    currentEntries: currentState.inspected_box_sizes,
    labelPrefix: "Box Size",
    fields: [
      { key: "L", label: "L", type: "number" },
      { key: "B", label: "B", type: "number" },
      { key: "H", label: "H", type: "number" },
      { key: "remark", label: "Remark", type: "text" },
      { key: "net_weight", label: "Net Weight", type: "number" },
      { key: "gross_weight", label: "Gross Weight", type: "number" },
      { key: "box_type", label: "Box Type", type: "text" },
      {
        key: "item_count_in_inner",
        label: "Item Count In Inner",
        type: "number",
      },
      {
        key: "box_count_in_master",
        label: "Box Count In Master",
        type: "number",
      },
    ],
  });

  const boxModeMismatch = textValuesEqual(
    inspectionState.inspected_box_mode,
    currentState.inspected_box_mode,
  )
    ? null
    : {
        inspection_value: normalizeText(inspectionState.inspected_box_mode),
        qc_value: normalizeText(currentState.inspected_box_mode),
        label: "Box Mode",
      };

  const mismatchCount =
    itemSizeMismatches.length +
    boxSizeMismatches.length +
    (boxModeMismatch ? 1 : 0);

  return {
    has_mismatch: mismatchCount > 0,
    mismatch_count: mismatchCount,
    item_size_mismatches: itemSizeMismatches,
    box_size_mismatches: boxSizeMismatches,
    box_mode_mismatch: boxModeMismatch,
    inspection_snapshot: inspectionState,
    current_snapshot: currentState,
  };
};

module.exports = {
  SIZE_ENTRY_LIMIT,
  NUMBER_TOLERANCE,
  normalizeNumber,
  normalizeSizeEntry: (entry = {}, type = "item", options = {}) =>
    type === "box"
      ? normalizeBoxSizeEntry(entry, options.mode)
      : normalizeItemSizeEntry(entry),
  normalizeItemSizes,
  normalizeBoxSizes,
  buildNormalizedInspectionSizeState,
  buildInspectionSizeSnapshot,
  compareInspectionSizeSnapshot,
};

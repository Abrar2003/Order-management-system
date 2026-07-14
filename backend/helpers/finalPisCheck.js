const {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
  calculateEffectiveBoxEntriesCbmTotal,
  detectBoxPackagingMode,
} = require("./boxMeasurement");
const {
  compareBoxSizeDimensionVariance,
  compareItemSizeDimensionVariance,
  compareWeightVariance,
} = require("./measurementMismatchRules");
const {
  formatSizeArrayToReference,
  hasReferenceSizeArray,
} = require("./sizeDimensionFormatter");
const {
  normalizeSingleItemSizeRemarks,
  normalizeSingleBoxSizeRemarks,
} = require("./masterSizeRemarks");
const {
  normalizeVendorDisplayList,
  normalizeVendorText,
} = require("./vendorRef");

const FINAL_PIS_CHECK_ITEM_SELECT = [
  "code",
  "name",
  "description",
  "brand",
  "brand_name",
  "brands",
  "vendors",
  "barcode_exempted",
  "master_barcode",
  "master_master_barcode",
  "master_inner_barcode",
  "master_country_of_origin",
  "kd",
  "master_item_sizes",
  "master_box_sizes",
  "master_box_mode",
  "inspected_item_sizes",
  "inspected_box_sizes",
  "inspected_box_mode",
  "cbm",
  "qc.barcode",
  "qc.master_barcode",
  "qc.inner_barcode",
  "pis_checked_flag",
  "pis_update_comments",
  "updatedAt",
].join(" ");

const FINAL_PIS_CHECK_DIFF_FIELDS = Object.freeze([
  "Item Size",
  "Box Size",
  "Weight",
  "CBM",
]);

const FINAL_PIS_CHECK_SORT_FIELDS = Object.freeze([
  "updated_at",
  "code",
  "name",
  "description",
  "brand",
  "vendors",
  "diff_count",
  "detail_count",
]);

const COMPARE_TOLERANCE = 0.001;
const CBM_COMPARE_TOLERANCE = 0.03;
const CBM_COMPARE_EPSILON = 0.000000001;
const CBM_COMPARE_DECIMALS = 2;
const ITEM_SIZE_ENTRY_LIMIT = 5;
const BOX_SIZE_ENTRY_LIMIT = 4;
const SIZE_ENTRY_LIMIT = BOX_SIZE_ENTRY_LIMIT;
const EMPTY_LABEL = "Not Set";
const ITEM_REMARK_ORDER = Object.freeze([
  "",
  "item",
  "top",
  "base",
  "base2",
  "pedestal",
  "stretcher",
  "item1",
  "item2",
  "item3",
  "item4",
]);
const BOX_REMARK_ORDER = Object.freeze([
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
const normalizeText = (value) => normalizeVendorText(value);
const normalizeKey = (value) => normalizeText(value).toLowerCase();

const normalizeDistinctValues = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeText(value))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasMeaningfulNumber = (value) => {
  const parsed = toFiniteNumber(value);
  return parsed !== null && Math.abs(parsed) > COMPARE_TOLERANCE;
};

const toComparableNumber = (value, decimals = null) => {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  return Number.isInteger(decimals) ? Number(parsed.toFixed(decimals)) : parsed;
};

const hasMeaningfulComparableNumber = (value, tolerance = COMPARE_TOLERANCE) =>
  value !== null && Math.abs(value) > tolerance;

const compareNumericValues = (
  inspectedValue,
  pisValue,
  { tolerance = COMPARE_TOLERANCE, decimals = null } = {},
) => {
  const inspected = toComparableNumber(inspectedValue, decimals);
  const pis = toComparableNumber(pisValue, decimals);
  const hasInspected = hasMeaningfulComparableNumber(inspected, tolerance);
  const hasPis = hasMeaningfulComparableNumber(pis, tolerance);

  if (!hasInspected && !hasPis) {
    return {
      mismatch: false,
      hasInspected,
      hasPis,
      inspected: inspected ?? 0,
      pis: pis ?? 0,
      delta: 0,
    };
  }

  if (hasInspected !== hasPis) {
    return {
      mismatch: true,
      hasInspected,
      hasPis,
      inspected: inspected ?? 0,
      pis: pis ?? 0,
      delta: (inspected ?? 0) - (pis ?? 0),
    };
  }

  const delta = (inspected ?? 0) - (pis ?? 0);
  return {
    mismatch: Math.abs(delta) > tolerance,
    hasInspected,
    hasPis,
    inspected: inspected ?? 0,
    pis: pis ?? 0,
    delta,
  };
};

const normalizeNumericComparisonResult = (comparison = {}) => ({
  mismatch: Boolean(comparison?.mismatch),
  hasInspected: Boolean(comparison?.hasInspected),
  hasPis: Boolean(
    Object.prototype.hasOwnProperty.call(comparison, "hasReference")
      ? comparison.hasReference
      : comparison?.hasPis,
  ),
  inspected: Object.prototype.hasOwnProperty.call(comparison, "inspected")
    ? comparison.inspected
    : 0,
  pis: Object.prototype.hasOwnProperty.call(comparison, "reference")
    ? comparison.reference
    : (Object.prototype.hasOwnProperty.call(comparison, "pis") ? comparison.pis : 0),
  delta: Object.prototype.hasOwnProperty.call(comparison, "delta")
    ? comparison.delta
    : 0,
});


const normalizeBarcodeValue = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";

  const parsed = Number(normalized);
  if (Number.isFinite(parsed) && Math.abs(parsed) <= COMPARE_TOLERANCE) {
    return "";
  }

  return normalized;
};

const compareTextValues = (inspectedValue, pisValue) => {
  const inspected = normalizeBarcodeValue(inspectedValue);
  const pis = normalizeBarcodeValue(pisValue);
  const hasInspected = Boolean(inspected);
  const hasPis = Boolean(pis);

  if (!hasInspected && !hasPis) {
    return {
      mismatch: false,
      hasInspected,
      hasPis,
      inspected,
      pis,
    };
  }

  return {
    mismatch: inspected !== pis,
    hasInspected,
    hasPis,
    inspected,
    pis,
  };
};

const trimFormattedNumber = (value, decimals = 2) =>
  Number(value).toFixed(decimals).replace(/\.?0+$/, "");

const formatNumberDisplay = (
  value,
  { decimals = 2, unit = "", emptyLabel = EMPTY_LABEL, fixedDecimals = false } = {},
) => {
  const parsed = toFiniteNumber(value);
  if (parsed === null || Math.abs(parsed) <= COMPARE_TOLERANCE) return emptyLabel;
  const formatted = fixedDecimals
    ? Number(parsed).toFixed(decimals)
    : trimFormattedNumber(parsed, decimals);
  return unit ? `${formatted} ${unit}` : formatted;
};

const formatSizeDisplay = (entry = {}) => {
  const values = ["L", "B", "H"].map((axis) =>
    formatNumberDisplay(entry?.[axis], { decimals: 3, emptyLabel: EMPTY_LABEL }),
  );
  return values.every((value) => value === EMPTY_LABEL)
    ? EMPTY_LABEL
    : values.join(" x ");
};

const formatSignedDeltaDisplay = (
  value,
  unit = "",
  decimals = 2,
  { tolerance = COMPARE_TOLERANCE, fixedDecimals = false } = {},
) => {
  const parsed = toFiniteNumber(value);
  if (parsed === null || Math.abs(parsed) <= tolerance) {
    return "0";
  }

  const formatted = fixedDecimals
    ? Math.abs(parsed).toFixed(decimals)
    : trimFormattedNumber(Math.abs(parsed), decimals);
  return `${parsed > 0 ? "+" : "-"}${formatted}${unit ? ` ${unit}` : ""}`;
};

const formatRemarkLabel = (remark = "", fallback = "Value") => {
  const normalized = normalizeKey(remark);
  if (!normalized) return fallback;
  if (normalized === "item") return "Item";
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
  if (normalized === "base2") return "Base 2";
  if (normalized === "pedestal") return "Pedestal";
  if (normalized === "stretcher") return "Stretcher";
  if (normalized === "inner") return "Inner Carton";
  if (normalized === "master") return "Master Carton";
  if (normalized === "individual") return "Individual";
  if (/^item\d+$/.test(normalized)) {
    return `Item ${normalized.replace("item", "")}`;
  }
  if (/^box\d+$/.test(normalized)) {
    return `Box ${normalized.replace("box", "")}`;
  }

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || fallback;
};

const getFinalPisCheckBrand = (item = {}) =>
  normalizeText(item?.brand_name)
  || normalizeText(item?.brand)
  || normalizeDistinctValues(item?.brands)[0]
  || "";

const getFinalPisCheckBrandList = (item = {}) =>
  normalizeDistinctValues([
    normalizeText(item?.brand_name),
    normalizeText(item?.brand),
    ...(Array.isArray(item?.brands) ? item.brands : []),
  ]);

const getFinalPisCheckVendorList = (item = {}) =>
  normalizeVendorDisplayList(item?.vendors);

const getFinalPisCheckVendorsText = (item = {}) =>
  getFinalPisCheckVendorList(item).join(", ");

const formatUpdatedDate = (value) => {
  const parsed = value ? new Date(value) : null;
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const buildItemEntryKey = (entry = {}, index = 0) => {
  const remark = normalizeKey(entry?.remark || entry?.type);
  return remark || `entry-${index + 1}`;
};

const buildBoxEntryKey = (entry = {}, index = 0) => {
  const remark = normalizeKey(entry?.remark);
  const boxType = normalizeKey(entry?.box_type);
  if (remark || boxType) {
    return `${remark || "entry"}::${boxType || "na"}`;
  }
  return `entry-${index + 1}`;
};

const sortEntries = (entries = [], { order = [], keyBuilder = buildItemEntryKey } = {}) =>
  [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftKey = keyBuilder(left, 0);
    const rightKey = keyBuilder(right, 0);
    const leftRemark = normalizeKey(left?.remark);
    const rightRemark = normalizeKey(right?.remark);
    const leftIndex = order.indexOf(leftRemark);
    const rightIndex = order.indexOf(rightRemark);
    const safeLeftIndex = leftIndex >= 0 ? leftIndex : order.length + 1;
    const safeRightIndex = rightIndex >= 0 ? rightIndex : order.length + 1;

    if (safeLeftIndex !== safeRightIndex) {
      return safeLeftIndex - safeRightIndex;
    }

    return leftKey.localeCompare(rightKey, undefined, { numeric: true });
  });

const hasSizeData = (entry = {}) =>
  hasMeaningfulNumber(entry?.L)
  || hasMeaningfulNumber(entry?.B)
  || hasMeaningfulNumber(entry?.H);

const hasWeightData = (entry = {}, weightKey = "") =>
  weightKey ? hasMeaningfulNumber(entry?.[weightKey]) : false;

const hasCountData = (entry = {}, countKey = "") =>
  countKey ? hasMeaningfulNumber(entry?.[countKey]) : false;

const hasMeaningfulEntry = (
  entry = {},
  { weightKey = "", countKeys = [] } = {},
) =>
  hasSizeData(entry)
  || hasWeightData(entry, weightKey)
  || countKeys.some((countKey) => hasCountData(entry, countKey));

const normalizeItemMeasurementEntry = (entry = {}) => ({
  remark: normalizeKey(entry?.remark || entry?.type || ""),
  L: toFiniteNumber(entry?.L) ?? 0,
  B: toFiniteNumber(entry?.B) ?? 0,
  H: toFiniteNumber(entry?.H) ?? 0,
  net_weight: toFiniteNumber(entry?.net_weight ?? entry?.weight) ?? 0,
});

const normalizeBoxMeasurementEntry = (entry = {}) => ({
  remark: normalizeKey(entry?.remark || entry?.box_type || ""),
  box_type: normalizeKey(entry?.box_type || entry?.remark || BOX_ENTRY_TYPES.INDIVIDUAL),
  L: toFiniteNumber(entry?.L) ?? 0,
  B: toFiniteNumber(entry?.B) ?? 0,
  H: toFiniteNumber(entry?.H) ?? 0,
  gross_weight: toFiniteNumber(entry?.gross_weight ?? entry?.weight) ?? 0,
  item_count_in_inner: toFiniteNumber(entry?.item_count_in_inner) ?? 0,
  box_count_in_master: toFiniteNumber(entry?.box_count_in_master) ?? 0,
});

const buildItemMeasurementEntries = ({
  sizes = [],
} = {}) => {
  return sortEntries(
    (Array.isArray(sizes) ? sizes : [])
    .map((entry) => normalizeItemMeasurementEntry(entry))
    .filter((entry) => hasMeaningfulEntry(entry, { weightKey: "net_weight" }))
    .slice(0, ITEM_SIZE_ENTRY_LIMIT),
    {
      order: ITEM_REMARK_ORDER,
      keyBuilder: buildItemEntryKey,
    },
  );
};

const buildBoxMeasurementEntries = ({
  sizes = [],
  mode = "",
} = {}) => {
  const resolvedMode = detectBoxPackagingMode(mode, sizes);
  const entryLimit =
    resolvedMode === BOX_PACKAGING_MODES.CARTON
      ? 2
      : resolvedMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER
        ? 1
        : BOX_SIZE_ENTRY_LIMIT;
  const normalizedSizes = (Array.isArray(sizes) ? sizes : [])
    .map((entry) => normalizeBoxMeasurementEntry(entry))
    .filter((entry) =>
      hasMeaningfulEntry(entry, {
        weightKey: "gross_weight",
        countKeys: ["item_count_in_inner", "box_count_in_master"],
      }),
    )
    .slice(0, entryLimit);

  return sortEntries(normalizedSizes, {
    order: BOX_REMARK_ORDER,
    keyBuilder: buildBoxEntryKey,
  });
};

const buildMeasurementDisplay = (entries = [], weightKey = "") => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      sizeDisplay: EMPTY_LABEL,
      weightDisplay: EMPTY_LABEL,
    };
  }

  const sizeDisplay = entries
    .map((entry, index) => {
      const label = formatRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      const value = formatSizeDisplay(entry);
      if (entries.length === 1 && !normalizeText(entry?.remark)) {
        return value;
      }
      return `${label}: ${value}`;
    })
    .join(" | ");

  const weightDisplay = entries
    .map((entry, index) => {
      const label = formatRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      const value = formatNumberDisplay(entry?.[weightKey], {
        decimals: 3,
        emptyLabel: EMPTY_LABEL,
      });
      if (entries.length === 1 && !normalizeText(entry?.remark)) {
        return value;
      }
      return `${label}: ${value}`;
    })
    .join(" | ");

  return {
    sizeDisplay,
    weightDisplay,
  };
};

const buildNumericDifferenceNote = ({
  segment = "",
  attribute = "",
  inspectedDisplay = EMPTY_LABEL,
  pisDisplay = EMPTY_LABEL,
  hasInspected = false,
  hasPis = false,
  sourceLabel = "Inspected",
  referenceLabel = "PIS",
} = {}) => {
  const subject = `${segment} ${attribute}`.trim();
  if (hasInspected && !hasPis) {
    return `${sourceLabel} ${subject} is ${inspectedDisplay}, while ${referenceLabel} is not set.`;
  }
  if (!hasInspected && hasPis) {
    return `${referenceLabel} ${subject} is ${pisDisplay}, while ${sourceLabel} is not set.`;
  }
  return `${subject} differs (${inspectedDisplay} vs ${pisDisplay}).`;
};

const buildTextDifferenceNote = ({
  segment = "",
  attribute = "",
  inspectedDisplay = EMPTY_LABEL,
  pisDisplay = EMPTY_LABEL,
  hasInspected = false,
  hasPis = false,
  sourceLabel = "Inspected",
  referenceLabel = "PIS",
} = {}) => {
  const subject = `${segment} ${attribute}`.trim();
  if (hasInspected && !hasPis) {
    return `${sourceLabel} ${subject} is ${inspectedDisplay}, while ${referenceLabel} is not set.`;
  }
  if (!hasInspected && hasPis) {
    return `${referenceLabel} ${subject} is ${pisDisplay}, while ${sourceLabel} is not set.`;
  }
  return `${subject} differs (${inspectedDisplay} vs ${pisDisplay}).`;
};

const createNumericDifference = ({
  key,
  section,
  segment,
  attribute,
  inspectedValue,
  pisValue,
  unit = "",
  decimals = 2,
  compareTolerance = COMPARE_TOLERANCE,
  compareDecimals = null,
  fixedDecimals = false,
  sourceLabel = "Inspected",
  referenceLabel = "PIS",
  comparator = null,
  update = null,
} = {}) => {
  const comparisonResult = normalizeNumericComparisonResult(
    typeof comparator === "function"
      ? comparator(inspectedValue, pisValue)
      : compareNumericValues(inspectedValue, pisValue, {
          tolerance: compareTolerance,
          decimals: compareDecimals,
        }),
  );
  const comparison =
    !comparisonResult.mismatch && comparisonResult.hasInspected !== comparisonResult.hasPis
      ? { ...comparisonResult, mismatch: true }
      : comparisonResult;
  if (!comparison.mismatch) return null;
  const displayInspectedValue = Number.isInteger(compareDecimals)
    ? comparison.inspected
    : inspectedValue;
  const displayPisValue = Number.isInteger(compareDecimals)
    ? comparison.pis
    : pisValue;

  const inspectedDisplay = comparison.hasInspected
    ? formatNumberDisplay(displayInspectedValue, {
        decimals,
        unit,
        emptyLabel: EMPTY_LABEL,
        fixedDecimals,
      })
    : EMPTY_LABEL;
  const pisDisplay = comparison.hasPis
    ? formatNumberDisplay(displayPisValue, {
        decimals,
        unit,
        emptyLabel: EMPTY_LABEL,
        fixedDecimals,
      })
    : EMPTY_LABEL;

  const difference = {
    key,
    section,
    segment,
    attribute,
    inspected: inspectedDisplay,
    pis: pisDisplay,
    reference_label: referenceLabel,
    delta:
      comparison.hasInspected && comparison.hasPis
        ? formatSignedDeltaDisplay(comparison.delta, unit, decimals, {
            tolerance: compareTolerance,
            fixedDecimals,
          })
        : (comparison.hasInspected ? `${referenceLabel} not set` : `${sourceLabel} not set`),
    note: buildNumericDifferenceNote({
      segment,
      attribute,
      inspectedDisplay,
      pisDisplay,
      hasInspected: comparison.hasInspected,
      hasPis: comparison.hasPis,
      sourceLabel,
      referenceLabel,
    }),
  };
  if (update && typeof update === "object") {
    difference.master_update = {
      ...update,
      value_type: update.value_type || "number",
      suggested_value:
        update.suggested_value !== undefined
          ? update.suggested_value
          : inspectedValue,
      unit,
    };
  }
  return difference;
};

const createTextDifference = ({
  key,
  section,
  segment,
  attribute,
  inspectedValue,
  pisValue,
  sourceLabel = "Inspected",
  referenceLabel = "PIS",
  update = null,
} = {}) => {
  const comparison = compareTextValues(inspectedValue, pisValue);
  if (!comparison.mismatch) return null;

  const inspectedDisplay = comparison.inspected || EMPTY_LABEL;
  const pisDisplay = comparison.pis || EMPTY_LABEL;

  const difference = {
    key,
    section,
    segment,
    attribute,
    inspected: inspectedDisplay,
    pis: pisDisplay,
    reference_label: referenceLabel,
    delta:
      comparison.hasInspected && !comparison.hasPis
        ? `${referenceLabel} not set`
        : (!comparison.hasInspected && comparison.hasPis ? `${sourceLabel} not set` : "Mismatch"),
    note: buildTextDifferenceNote({
      segment,
      attribute,
      inspectedDisplay,
      pisDisplay,
      hasInspected: comparison.hasInspected,
      hasPis: comparison.hasPis,
      sourceLabel,
      referenceLabel,
    }),
  };
  if (update && typeof update === "object") {
    difference.master_update = {
      ...update,
      value_type: update.value_type || "text",
      suggested_value:
        update.suggested_value !== undefined
          ? update.suggested_value
          : inspectedValue,
    };
  }
  return difference;
};

const buildReferenceFirstEntryPairs = (
  inspectedEntries = [],
  pisEntries = [],
  keyBuilder,
  { allowIndexFallback = true, includeUnmatchedInspected = true } = {},
) => {
  const inspectedList = (Array.isArray(inspectedEntries) ? inspectedEntries : []).map(
    (entry, index) => ({
      entry,
      index,
      key: keyBuilder(entry, index),
    }),
  );
  const referenceList = (Array.isArray(pisEntries) ? pisEntries : []).map(
    (entry, index) => ({
      entry,
      index,
      key: keyBuilder(entry, index),
    }),
  );
  const usedInspectedIndexes = new Set();
  const pairs = referenceList.map((reference) => ({
    key: reference.key,
    index: reference.index,
    inspectedEntry: {},
    pisEntry: reference.entry,
    labelEntry: reference.entry,
  }));

  referenceList.forEach((reference, pairIndex) => {
    const exactMatch = inspectedList.find(
      (source) =>
        source.key === reference.key && !usedInspectedIndexes.has(source.index),
    );
    if (!exactMatch) return;

    usedInspectedIndexes.add(exactMatch.index);
    pairs[pairIndex].inspectedEntry = exactMatch.entry;
  });

  if (allowIndexFallback) {
    referenceList.forEach((reference, pairIndex) => {
      if (Object.keys(pairs[pairIndex].inspectedEntry || {}).length > 0) {
        return;
      }

      const indexMatch = inspectedList.find(
        (source) =>
          source.index === reference.index && !usedInspectedIndexes.has(source.index),
      );
      if (!indexMatch) return;

      usedInspectedIndexes.add(indexMatch.index);
      pairs[pairIndex].inspectedEntry = indexMatch.entry;
    });
  }

  if (includeUnmatchedInspected) {
    inspectedList.forEach((source) => {
      if (usedInspectedIndexes.has(source.index)) return;
      pairs.push({
        key: source.key,
        index: pairs.length,
        inspectedEntry: source.entry,
        pisEntry: {},
        labelEntry: source.entry,
      });
    });
  }

  return pairs;
};

const getEntryLabel = (entry = {}, key = "", fallback = "Value") => {
  const explicitRemark = formatRemarkLabel(entry?.remark, "");
  if (explicitRemark) return explicitRemark;
  return formatRemarkLabel(key, fallback);
};

const buildItemSizeDifferences = (
  inspectedEntries = [],
  pisEntries = [],
  { sourceLabel = "Inspected", referenceLabel = "PIS" } = {},
) => {
  const differences = [];
  const entryPairs = buildReferenceFirstEntryPairs(
    inspectedEntries,
    pisEntries,
    buildItemEntryKey,
    {
      allowIndexFallback: false,
      includeUnmatchedInspected: true,
    },
  );

  entryPairs.forEach(({ key, index, inspectedEntry = {}, pisEntry = {}, labelEntry }) => {
    const segment = getEntryLabel(labelEntry, key, "Item");

    ["L", "B", "H"].forEach((axis) => {
      const difference = createNumericDifference({
        key: `item-size-${key}-${axis}-${index}`,
        section: "Item Size",
        segment,
        attribute: axis,
        inspectedValue: inspectedEntry?.[axis],
        pisValue: pisEntry?.[axis],
        unit: "cm",
        comparator: compareItemSizeDimensionVariance,
        sourceLabel,
        referenceLabel,
        update: {
          target: "master_item_sizes",
          index,
          field: axis,
          remark: normalizeKey(labelEntry?.remark || inspectedEntry?.remark || pisEntry?.remark || key),
        },
      });
      if (difference) differences.push(difference);
    });

    const weightDifference = createNumericDifference({
      key: `item-size-${key}-net-weight-${index}`,
      section: "Item Size",
      segment,
      attribute: "Net Weight",
      inspectedValue: inspectedEntry?.net_weight,
      pisValue: pisEntry?.net_weight,
      unit: "kg",
      comparator: compareWeightVariance,
      sourceLabel,
      referenceLabel,
      update: {
        target: "master_item_sizes",
        index,
        field: "net_weight",
        remark: normalizeKey(labelEntry?.remark || inspectedEntry?.remark || pisEntry?.remark || key),
      },
    });
    if (weightDifference) differences.push(weightDifference);
  });

  return differences;
};

const buildBoxSizeDifferences = ({
  inspectedEntries = [],
  pisEntries = [],
  inspectedMode = "",
  pisMode = "",
  sourceLabel = "Inspected",
  referenceLabel = "PIS",
} = {}) => {
  const differences = [];
  const modeDifference = createTextDifference({
    key: "box-mode",
    section: "Box Size",
    segment: "Packaging",
    attribute: "Box Mode",
    inspectedValue: inspectedMode,
    pisValue: pisMode,
    sourceLabel,
    referenceLabel,
    update: {
      target: "master_box_mode",
      field: "master_box_mode",
      value_type: "box_mode",
      suggested_value: inspectedMode,
    },
  });
  if (modeDifference) differences.push(modeDifference);

  const entryPairs = buildReferenceFirstEntryPairs(
    inspectedEntries,
    pisEntries,
    buildBoxEntryKey,
    {
      allowIndexFallback: false,
      includeUnmatchedInspected: true,
    },
  );

  entryPairs.forEach(({ key, index, inspectedEntry = {}, pisEntry = {}, labelEntry }) => {
    const segment = getEntryLabel(labelEntry, key, "Box");

    ["L", "B", "H"].forEach((axis) => {
      const difference = createNumericDifference({
        key: `box-size-${key}-${axis}-${index}`,
        section: "Box Size",
        segment,
        attribute: axis,
        inspectedValue: inspectedEntry?.[axis],
        pisValue: pisEntry?.[axis],
        unit: "cm",
        comparator: compareBoxSizeDimensionVariance,
        sourceLabel,
        referenceLabel,
        update: {
          target: "master_box_sizes",
          index,
          field: axis,
          remark: normalizeKey(labelEntry?.remark || inspectedEntry?.remark || pisEntry?.remark || key),
          box_type: normalizeKey(labelEntry?.box_type || inspectedEntry?.box_type || pisEntry?.box_type || ""),
        },
      });
      if (difference) differences.push(difference);
    });

    [
      {
        keySuffix: "gross-weight",
        attribute: "Gross Weight",
        unit: "kg",
        inspectedValue: inspectedEntry?.gross_weight,
        pisValue: pisEntry?.gross_weight,
      },
      {
        keySuffix: "item-count-in-inner",
        attribute: "Item Count in Inner",
        unit: "",
        inspectedValue: inspectedEntry?.item_count_in_inner,
        pisValue: pisEntry?.item_count_in_inner,
      },
      {
        keySuffix: "box-count-in-master",
        attribute: "Box Count in Master",
        unit: "",
        inspectedValue: inspectedEntry?.box_count_in_master,
        pisValue: pisEntry?.box_count_in_master,
      },
    ].forEach((entryConfig) => {
      const difference = createNumericDifference({
        key: `box-size-${key}-${entryConfig.keySuffix}-${index}`,
        section: "Box Size",
        segment,
        attribute: entryConfig.attribute,
        inspectedValue: entryConfig.inspectedValue,
        pisValue: entryConfig.pisValue,
        unit: entryConfig.unit,
        comparator:
          entryConfig.keySuffix === "gross-weight"
            ? compareWeightVariance
            : null,
        sourceLabel,
        referenceLabel,
        update: {
          target: "master_box_sizes",
          index,
          field: entryConfig.keySuffix === "gross-weight"
            ? "gross_weight"
            : entryConfig.keySuffix === "item-count-in-inner"
              ? "item_count_in_inner"
              : "box_count_in_master",
          remark: normalizeKey(labelEntry?.remark || inspectedEntry?.remark || pisEntry?.remark || key),
          box_type: normalizeKey(labelEntry?.box_type || inspectedEntry?.box_type || pisEntry?.box_type || ""),
        },
      });
      if (difference) differences.push(difference);
    });
  });

  return differences;
};

const sumEntryWeight = (entries = [], weightKey = "") =>
  (Array.isArray(entries) ? entries : []).reduce(
    (sum, entry) => sum + (toFiniteNumber(entry?.[weightKey]) || 0),
    0,
  );

const buildOverallWeightDifferences = ({
  inspectedWeight = {},
  masterItemEntries = [],
  masterBoxEntries = [],
  itemReferenceLabel = "Master",
  boxReferenceLabel = "Master",
} = {}) => {
  const differences = [];
  [
    {
      key: "total-net",
      attribute: "Total Net",
      unit: "kg",
      fieldKey: "total_net",
      referenceLabel: itemReferenceLabel,
    },
    {
      key: "total-gross",
      attribute: "Total Gross",
      unit: "kg",
      fieldKey: "total_gross",
      referenceLabel: boxReferenceLabel,
    },
  ].forEach((weightField) => {
    const isNetWeight = weightField.fieldKey === "total_net";
    const masterEntries = isNetWeight ? masterItemEntries : masterBoxEntries;
    const masterWeight = sumEntryWeight(
      masterEntries,
      isNetWeight ? "net_weight" : "gross_weight",
    );
    if (masterWeight <= COMPARE_TOLERANCE) {
      return;
    }

    const difference = createNumericDifference({
      key: `weight-${weightField.key}`,
      section: "Weight",
      segment: "Overall",
      attribute: weightField.attribute,
      inspectedValue: getWeightRecordValue(inspectedWeight, weightField.fieldKey),
      pisValue: masterWeight,
      unit: weightField.unit,
      comparator: compareWeightVariance,
      referenceLabel: weightField.referenceLabel,
    });
    if (difference) differences.push(difference);
  });
  return differences;
};

const buildCbmDifferences = ({
  inspectedCbm,
  masterCbm: storedMasterCbm,
  masterBoxEntries = [],
  masterBoxMode = "",
  sourceLabel = "Inspected",
  referenceLabel = "Master",
} = {}) => {
  const storedMasterCbmNumber = toFiniteNumber(storedMasterCbm);
  const masterCbm = hasMeaningfulComparableNumber(storedMasterCbmNumber)
    ? storedMasterCbmNumber
    : calculateEffectiveBoxEntriesCbmTotal(masterBoxEntries, masterBoxMode);
  if (masterCbm <= COMPARE_TOLERANCE) {
    return [];
  }

  const difference = createNumericDifference({
    key: "cbm-calculated-total",
    section: "CBM",
    segment: "Calculated",
    attribute: "Total CBM",
    inspectedValue: inspectedCbm,
    pisValue: masterCbm,
    unit: "cbm",
    decimals: CBM_COMPARE_DECIMALS,
    compareTolerance: CBM_COMPARE_TOLERANCE + CBM_COMPARE_EPSILON,
    compareDecimals: CBM_COMPARE_DECIMALS,
    fixedDecimals: true,
    sourceLabel,
    referenceLabel,
    update: {
      target: "cbm.calculated_master_total",
      field: "calculated_master_total",
      value_type: "number",
      suggested_value: inspectedCbm,
    },
  });

  return difference ? [difference] : [];
};

const createMissingMasterDifference = ({
  key,
  section,
  segment,
  attribute,
  sourceDisplay = EMPTY_LABEL,
  note = "",
} = {}) => ({
  key,
  section,
  segment,
  attribute,
  inspected: sourceDisplay || EMPTY_LABEL,
  pis: EMPTY_LABEL,
  reference_label: "Master",
  delta: "Master data missing",
  note:
    note ||
    `Master ${`${segment || ""} ${attribute || ""}`.trim()} is missing; source data cannot be approved against Master.`,
});

const buildMasterPresenceDifferences = ({
  hasSourceItemEntries = false,
  hasMasterItemEntries = false,
  hasSourceBoxEntries = false,
  hasMasterBoxEntries = false,
  sourceItemEntries = [],
  sourceBoxEntries = [],
  sourceLabel = "Inspected",
} = {}) => {
  const differences = [];
  if (hasSourceItemEntries && !hasMasterItemEntries) {
    differences.push(createMissingMasterDifference({
      key: "master-missing-item-size",
      section: "Item Size",
      segment: "Master Data",
      attribute: "Item Size",
      sourceDisplay: buildMeasurementDisplay(sourceItemEntries, "net_weight").sizeDisplay,
      note: `Master item sizes are missing; ${sourceLabel} item sizes cannot be approved against Master.`,
    }));
  }
  if (hasSourceBoxEntries && !hasMasterBoxEntries) {
    differences.push(createMissingMasterDifference({
      key: "master-missing-box-size",
      section: "Box Size",
      segment: "Master Data",
      attribute: "Box Size",
      sourceDisplay: buildMeasurementDisplay(sourceBoxEntries, "gross_weight").sizeDisplay,
      note: `Master box sizes are missing; ${sourceLabel} box sizes cannot be approved against Master.`,
    }));
  }
  return differences;
};

const formatBoxModeLabel = (mode = "") => {
  const normalized = normalizeKey(mode);
  if (!normalized) return "";
  if (normalized === BOX_PACKAGING_MODES.CARTON) return "Carton";
  if (normalized === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER) {
    return "Individual packing + master";
  }
  if (normalized === BOX_PACKAGING_MODES.INDIVIDUAL) return "Individual";
  return formatRemarkLabel(normalized, normalized);
};

const buildFinalPisCheckRow = (item = {}) => {
  const masterItemSizes = normalizeSingleItemSizeRemarks(
    item?.master_item_sizes,
  );
  const inspectedItemSizes = normalizeSingleItemSizeRemarks(
    item?.inspected_item_sizes,
  );
  const masterBoxSizes = normalizeSingleBoxSizeRemarks(
    item?.master_box_sizes,
  );
  const inspectedBoxSizes = normalizeSingleBoxSizeRemarks(
    item?.inspected_box_sizes,
  );
  const masterItemEntries = buildItemMeasurementEntries({
    sizes: masterItemSizes,
  });
  const inspectedItemEntries = buildItemMeasurementEntries({
    sizes: inspectedItemSizes,
  });
  const masterBoxEntries = buildBoxMeasurementEntries({
    sizes: masterBoxSizes,
    mode: item?.master_box_mode,
  });
  const inspectedBoxEntries = buildBoxMeasurementEntries({
    sizes: inspectedBoxSizes,
    mode: item?.inspected_box_mode,
  });
  const hasMasterItemEntries = masterItemEntries.length > 0;
  const hasMasterBoxEntries = masterBoxEntries.length > 0;
  const hasInspectedItemEntries = inspectedItemEntries.length > 0;
  const hasInspectedBoxEntries = inspectedBoxEntries.length > 0;
  const sourceLabel = "Inspected";
  const itemReferenceLabel = "Master";
  const boxReferenceLabel = "Master";
  const normalizedInspectedItemEntries = hasReferenceSizeArray(masterItemEntries)
    ? formatSizeArrayToReference(inspectedItemEntries, masterItemEntries, {
        type: "item",
      })
    : inspectedItemEntries;
  const normalizedInspectedBoxEntries = hasReferenceSizeArray(masterBoxEntries)
    ? formatSizeArrayToReference(inspectedBoxEntries, masterBoxEntries, {
        type: "box",
      })
    : inspectedBoxEntries;

  const resolvedInspectedBoxMode =
    hasInspectedBoxEntries || normalizeText(item?.inspected_box_mode)
      ? formatBoxModeLabel(
          detectBoxPackagingMode(item?.inspected_box_mode, inspectedBoxSizes),
        )
      : "";
  const resolvedMasterBoxMode =
    hasMasterBoxEntries || normalizeText(item?.master_box_mode)
      ? formatBoxModeLabel(
          detectBoxPackagingMode(item?.master_box_mode, masterBoxSizes),
        )
      : "";

  const differences = [
    ...(hasMasterItemEntries || hasInspectedItemEntries
      ? buildItemSizeDifferences(normalizedInspectedItemEntries, masterItemEntries, {
          sourceLabel,
          referenceLabel: itemReferenceLabel,
        })
      : []),
    ...(hasMasterBoxEntries || hasInspectedBoxEntries
      ? buildBoxSizeDifferences({
          inspectedEntries: normalizedInspectedBoxEntries,
          pisEntries: masterBoxEntries,
          inspectedMode: resolvedInspectedBoxMode,
          pisMode: resolvedMasterBoxMode,
          sourceLabel,
          referenceLabel: boxReferenceLabel,
        })
      : []),
    ...buildCbmDifferences({
      inspectedCbm: item?.cbm?.calculated_inspected_total || item?.cbm?.inspected_total,
      masterCbm: item?.cbm?.calculated_master_total,
      masterBoxEntries,
      masterBoxMode: detectBoxPackagingMode(item?.master_box_mode, masterBoxSizes),
      sourceLabel,
      referenceLabel: boxReferenceLabel,
    }),
  ];

  if (differences.length === 0) {
    return null;
  }

  const diffFieldSet = new Set(differences.map((difference) => difference.section));
  const diffFields = FINAL_PIS_CHECK_DIFF_FIELDS.filter((field) => diffFieldSet.has(field));
  const brand = getFinalPisCheckBrand(item);
  const vendorsText = getFinalPisCheckVendorsText(item);

  return {
    id: String(item?._id || item?.code || ""),
    code: normalizeText(item?.code) || "N/A",
    name: normalizeText(item?.name) || "",
    description: normalizeText(item?.description || item?.name) || "N/A",
    brand: brand || "N/A",
    brand_name: normalizeText(item?.brand_name),
    brands: getFinalPisCheckBrandList(item),
    vendors: vendorsText || "N/A",
    vendor_list: getFinalPisCheckVendorList(item),
    updated_at: formatUpdatedDate(item?.updatedAt),
    diff_fields: diffFields,
    measurements: {
      inspected_item: buildMeasurementDisplay(normalizedInspectedItemEntries, "net_weight"),
      pis_item: buildMeasurementDisplay(masterItemEntries, "net_weight"),
      inspected_box: buildMeasurementDisplay(normalizedInspectedBoxEntries, "gross_weight"),
      pis_box: buildMeasurementDisplay(masterBoxEntries, "gross_weight"),
    },
    references: {
      source_label: sourceLabel,
      item_label: itemReferenceLabel,
      box_label: boxReferenceLabel,
      has_master_item_sizes: hasMasterItemEntries,
      has_master_box_sizes: hasMasterBoxEntries,
      has_pis_item_sizes: hasInspectedItemEntries,
      has_pis_box_sizes: hasInspectedBoxEntries,
      has_inspected_item_sizes: hasInspectedItemEntries,
      has_inspected_box_sizes: hasInspectedBoxEntries,
    },
    comments: Array.isArray(item?.pis_update_comments)
      ? item.pis_update_comments
          .slice(-5)
          .reverse()
          .map((comment) => ({
            id: String(comment?._id || ""),
            comment: normalizeText(comment?.comment),
            created_by: String(comment?.created_by || ""),
            created_by_name: normalizeText(comment?.created_by_name),
            created_by_role: normalizeText(comment?.created_by_role),
            created_at: comment?.created_at || null,
          }))
      : [],
    comment_count: Array.isArray(item?.pis_update_comments)
      ? item.pis_update_comments.length
      : 0,
    differences,
  };
};

const buildFinalPisCheckRows = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => buildFinalPisCheckRow(item))
    .filter(Boolean);

const normalizeFinalPisCheckDiffField = (value = "") => {
  const normalized = normalizeKey(value);
  if (!normalized || normalized === "all") return "";

  return FINAL_PIS_CHECK_DIFF_FIELDS.find(
    (diffField) => normalizeKey(diffField) === normalized,
  ) || "";
};

const filterFinalPisCheckRowsByDiffField = (rows = [], diffField = "") => {
  const resolvedDiffField = normalizeFinalPisCheckDiffField(diffField);
  if (!resolvedDiffField) {
    return Array.isArray(rows) ? [...rows] : [];
  }

  return (Array.isArray(rows) ? rows : []).filter((row) =>
    Array.isArray(row?.diff_fields) && row.diff_fields.includes(resolvedDiffField),
  );
};

const normalizeFinalPisCheckSortBy = (value = "") => {
  const normalized = normalizeKey(value);
  if (!normalized) return "updated_at";
  if (normalized === "updatedat") return "updated_at";
  if (normalized === "detailed_difference_rows") return "detail_count";
  return FINAL_PIS_CHECK_SORT_FIELDS.includes(normalized)
    ? normalized
    : "updated_at";
};

const normalizeSortOrder = (value = "") =>
  normalizeKey(value) === "asc" ? "asc" : "desc";

const getSortValueForRow = (row = {}, sortBy = "updated_at") => {
  switch (sortBy) {
    case "code":
      return normalizeText(row?.code);
    case "name":
      return normalizeText(row?.name);
    case "description":
      return normalizeText(row?.description);
    case "brand":
      return normalizeText(row?.brand);
    case "vendors":
      return normalizeText(row?.vendors);
    case "diff_count":
      return Array.isArray(row?.diff_fields) ? row.diff_fields.length : 0;
    case "detail_count":
      return Array.isArray(row?.differences) ? row.differences.length : 0;
    case "updated_at":
    default:
      return normalizeText(row?.updated_at);
  }
};

const sortFinalPisCheckRows = (rows = [], { sortBy = "updated_at", sortOrder = "desc" } = {}) => {
  const resolvedSortBy = normalizeFinalPisCheckSortBy(sortBy);
  const resolvedSortOrder = normalizeSortOrder(sortOrder);
  const direction = resolvedSortOrder === "asc" ? 1 : -1;

  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const leftValue = getSortValueForRow(left, resolvedSortBy);
    const rightValue = getSortValueForRow(right, resolvedSortBy);

    if (typeof leftValue === "number" || typeof rightValue === "number") {
      const numericResult = (Number(leftValue) || 0) - (Number(rightValue) || 0);
      if (numericResult !== 0) return numericResult * direction;
    } else {
      const stringResult = String(leftValue || "").localeCompare(
        String(rightValue || ""),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      if (stringResult !== 0) return stringResult * direction;
    }

    return String(left?.code || "").localeCompare(String(right?.code || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
};

const buildFinalPisCheckSummary = (rows = []) => {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const diffFieldCounts = FINAL_PIS_CHECK_DIFF_FIELDS.reduce((accumulator, field) => {
    accumulator[field] = normalizedRows.reduce(
      (count, row) =>
        count + (
          Array.isArray(row?.diff_fields) && row.diff_fields.includes(field)
            ? 1
            : 0
        ),
      0,
    );
    return accumulator;
  }, {});

  return {
    checked_diff_items: normalizedRows.length,
    detailed_difference_rows: normalizedRows.reduce(
      (sum, row) => sum + (Array.isArray(row?.differences) ? row.differences.length : 0),
      0,
    ),
    unique_brands: normalizeDistinctValues(
      normalizedRows
        .map((row) => normalizeText(row?.brand))
        .filter((brand) => brand && brand !== "N/A"),
    ),
    unique_vendors: normalizeDistinctValues(
      normalizedRows.flatMap((row) =>
        Array.isArray(row?.vendor_list)
          ? row.vendor_list
          : normalizeText(row?.vendors) && row?.vendors !== "N/A"
            ? row.vendors.split(",")
            : [],
      ),
    ),
    diff_field_counts: diffFieldCounts,
  };
};

const buildFinalPisCheckPayload = ({
  rows = [],
  search = "",
  brand = "",
  vendor = "",
  country = "",
  diffField = "",
  page = 1,
  limit = 20,
} = {}) => {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const total = normalizedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const skip = (safePage - 1) * Math.max(1, limit);

  return {
    success: true,
    rows: normalizedRows.slice(skip, skip + Math.max(1, limit)),
    summary: buildFinalPisCheckSummary(normalizedRows),
    filters: {
      search: normalizeText(search),
      brand: normalizeText(brand),
      vendor: normalizeText(vendor),
      country: normalizeText(country),
      diff_field: normalizeFinalPisCheckDiffField(diffField),
    },
    pagination: {
      page: safePage,
      limit: Math.max(1, limit),
      total,
      totalPages,
    },
    generated_at: new Date().toISOString(),
  };
};

const buildFinalPisCheckReportPayload = ({
  rows = [],
  search = "",
  brand = "",
  vendor = "",
  diffField = "",
  country = "",
} = {}) => ({
  generated_at: new Date().toISOString(),
  filters: {
    search: normalizeText(search) || "All",
    brand: normalizeText(brand) || "All",
    vendor: normalizeText(vendor) || "All",
    diff_field: normalizeFinalPisCheckDiffField(diffField) || "All",
    country: normalizeText(country) || "All",
  },
  summary: buildFinalPisCheckSummary(rows),
  rows: Array.isArray(rows) ? rows : [],
});

const buildFinalPisCheckOptions = (rows = []) => {
  const summary = buildFinalPisCheckSummary(rows);

  return {
    brands: summary.unique_brands,
    vendors: summary.unique_vendors,
    diff_fields: FINAL_PIS_CHECK_DIFF_FIELDS.filter(
      (field) => Number(summary?.diff_field_counts?.[field] || 0) > 0,
    ),
  };
};

module.exports = {
  FINAL_PIS_CHECK_ITEM_SELECT,
  FINAL_PIS_CHECK_DIFF_FIELDS,
  buildFinalPisCheckRows,
  buildFinalPisCheckPayload,
  buildFinalPisCheckReportPayload,
  buildFinalPisCheckOptions,
  buildFinalPisCheckSummary,
  filterFinalPisCheckRowsByDiffField,
  getFinalPisCheckBrand,
  getFinalPisCheckVendorsText,
  normalizeFinalPisCheckDiffField,
  normalizeFinalPisCheckSortBy,
  normalizeSortOrder,
  sortFinalPisCheckRows,
};

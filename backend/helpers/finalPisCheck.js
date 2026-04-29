const {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
  detectBoxPackagingMode,
} = require("./boxMeasurement");

const FINAL_PIS_CHECK_ITEM_SELECT = [
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

const FINAL_PIS_CHECK_DIFF_FIELDS = Object.freeze([
  "Item Size",
  "Box Size",
  "Weight",
  "CBM",
  "Barcode",
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
const SIZE_ENTRY_LIMIT = 4;
const EMPTY_LABEL = "Not Set";
const ITEM_REMARK_ORDER = Object.freeze([
  "",
  "item",
  "top",
  "base",
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
const LEGACY_WEIGHT_FALLBACK_BY_KEY = Object.freeze({
  total_net: "net",
  total_gross: "gross",
});

const normalizeText = (value) => String(value ?? "").trim();
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

const compareNumericValues = (inspectedValue, pisValue) => {
  const inspected = toFiniteNumber(inspectedValue);
  const pis = toFiniteNumber(pisValue);
  const hasInspected = hasMeaningfulNumber(inspected);
  const hasPis = hasMeaningfulNumber(pis);

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
    mismatch: Math.abs(delta) > COMPARE_TOLERANCE,
    hasInspected,
    hasPis,
    inspected: inspected ?? 0,
    pis: pis ?? 0,
    delta,
  };
};

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

const trimFormattedNumber = (value, decimals = 3) =>
  Number(value).toFixed(decimals).replace(/\.?0+$/, "");

const formatNumberDisplay = (
  value,
  { decimals = 3, unit = "", emptyLabel = EMPTY_LABEL } = {},
) => {
  const parsed = toFiniteNumber(value);
  if (parsed === null || Math.abs(parsed) <= COMPARE_TOLERANCE) return emptyLabel;
  const formatted = trimFormattedNumber(parsed, decimals);
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

const formatSignedDeltaDisplay = (value, unit = "", decimals = 3) => {
  const parsed = toFiniteNumber(value);
  if (parsed === null || Math.abs(parsed) <= COMPARE_TOLERANCE) {
    return "0";
  }

  const formatted = trimFormattedNumber(Math.abs(parsed), decimals);
  return `${parsed > 0 ? "+" : "-"}${formatted}${unit ? ` ${unit}` : ""}`;
};

const formatRemarkLabel = (remark = "", fallback = "Value") => {
  const normalized = normalizeKey(remark);
  if (!normalized) return fallback;
  if (normalized === "item") return "Item";
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
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
  normalizeDistinctValues(Array.isArray(item?.vendors) ? item.vendors : []);

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

const getWeightRecordValue = (weight = {}, key = "") => {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) return 0;
  const fallbackKey = LEGACY_WEIGHT_FALLBACK_BY_KEY[normalizedKey];
  const rawValue =
    weight?.[normalizedKey]
    ?? (fallbackKey ? weight?.[fallbackKey] : undefined)
    ?? 0;
  return toFiniteNumber(rawValue) ?? 0;
};

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
  singleLbh = {},
  topLbh = {},
  bottomLbh = {},
  weight = {},
} = {}) => {
  const normalizedSizes = (Array.isArray(sizes) ? sizes : [])
    .map((entry) => normalizeItemMeasurementEntry(entry))
    .filter((entry) => hasMeaningfulEntry(entry, { weightKey: "net_weight" }))
    .slice(0, SIZE_ENTRY_LIMIT);

  if (normalizedSizes.length > 0) {
    return sortEntries(normalizedSizes, {
      order: ITEM_REMARK_ORDER,
      keyBuilder: buildItemEntryKey,
    });
  }

  const legacyEntries = [];
  const topEntry = normalizeItemMeasurementEntry({
    ...topLbh,
    remark: "top",
    net_weight: getWeightRecordValue(weight, "top_net"),
  });
  if (hasMeaningfulEntry(topEntry, { weightKey: "net_weight" })) {
    legacyEntries.push(topEntry);
  }

  const baseEntry = normalizeItemMeasurementEntry({
    ...bottomLbh,
    remark: "base",
    net_weight: getWeightRecordValue(weight, "bottom_net"),
  });
  if (hasMeaningfulEntry(baseEntry, { weightKey: "net_weight" })) {
    legacyEntries.push(baseEntry);
  }

  if (legacyEntries.length > 0) {
    return sortEntries(legacyEntries, {
      order: ITEM_REMARK_ORDER,
      keyBuilder: buildItemEntryKey,
    });
  }

  const singleEntry = normalizeItemMeasurementEntry({
    ...singleLbh,
    remark: "",
    net_weight: getWeightRecordValue(weight, "total_net"),
  });

  return hasMeaningfulEntry(singleEntry, { weightKey: "net_weight" })
    ? [singleEntry]
    : [];
};

const buildBoxMeasurementEntries = ({
  sizes = [],
  mode = "",
  singleLbh = {},
  topLbh = {},
  bottomLbh = {},
  weight = {},
} = {}) => {
  const resolvedMode = detectBoxPackagingMode(mode, sizes);
  const normalizedSizes = (Array.isArray(sizes) ? sizes : [])
    .map((entry) => normalizeBoxMeasurementEntry(entry))
    .filter((entry) =>
      hasMeaningfulEntry(entry, {
        weightKey: "gross_weight",
        countKeys: ["item_count_in_inner", "box_count_in_master"],
      }),
    )
    .slice(0, resolvedMode === BOX_PACKAGING_MODES.CARTON ? 2 : SIZE_ENTRY_LIMIT);

  if (normalizedSizes.length > 0) {
    return sortEntries(normalizedSizes, {
      order: BOX_REMARK_ORDER,
      keyBuilder: buildBoxEntryKey,
    });
  }

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const masterEntry = normalizeBoxMeasurementEntry({
      ...singleLbh,
      remark: "master",
      box_type: BOX_ENTRY_TYPES.MASTER,
      gross_weight: getWeightRecordValue(weight, "total_gross"),
    });

    return hasMeaningfulEntry(masterEntry, {
      weightKey: "gross_weight",
      countKeys: ["item_count_in_inner", "box_count_in_master"],
    })
      ? [masterEntry]
      : [];
  }

  const legacyEntries = [];
  const topEntry = normalizeBoxMeasurementEntry({
    ...topLbh,
    remark: "top",
    box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
    gross_weight: getWeightRecordValue(weight, "top_gross"),
  });
  if (hasMeaningfulEntry(topEntry, { weightKey: "gross_weight" })) {
    legacyEntries.push(topEntry);
  }

  const baseEntry = normalizeBoxMeasurementEntry({
    ...bottomLbh,
    remark: "base",
    box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
    gross_weight: getWeightRecordValue(weight, "bottom_gross"),
  });
  if (hasMeaningfulEntry(baseEntry, { weightKey: "gross_weight" })) {
    legacyEntries.push(baseEntry);
  }

  if (legacyEntries.length > 0) {
    return sortEntries(legacyEntries, {
      order: BOX_REMARK_ORDER,
      keyBuilder: buildBoxEntryKey,
    });
  }

  const singleEntry = normalizeBoxMeasurementEntry({
    ...singleLbh,
    remark: "",
    box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
    gross_weight: getWeightRecordValue(weight, "total_gross"),
  });

  return hasMeaningfulEntry(singleEntry, { weightKey: "gross_weight" })
    ? [singleEntry]
    : [];
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
} = {}) => {
  const subject = `${segment} ${attribute}`.trim();
  if (hasInspected && !hasPis) {
    return `Inspected ${subject} is ${inspectedDisplay}, while PIS is not set.`;
  }
  if (!hasInspected && hasPis) {
    return `PIS ${subject} is ${pisDisplay}, while inspected value is not set.`;
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
} = {}) => {
  const subject = `${segment} ${attribute}`.trim();
  if (hasInspected && !hasPis) {
    return `Inspected ${subject} is ${inspectedDisplay}, while PIS is not set.`;
  }
  if (!hasInspected && hasPis) {
    return `PIS ${subject} is ${pisDisplay}, while inspected value is not set.`;
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
  decimals = 3,
} = {}) => {
  const comparison = compareNumericValues(inspectedValue, pisValue);
  if (!comparison.mismatch) return null;

  const inspectedDisplay = formatNumberDisplay(inspectedValue, {
    decimals,
    unit,
    emptyLabel: EMPTY_LABEL,
  });
  const pisDisplay = formatNumberDisplay(pisValue, {
    decimals,
    unit,
    emptyLabel: EMPTY_LABEL,
  });

  return {
    key,
    section,
    segment,
    attribute,
    inspected: inspectedDisplay,
    pis: pisDisplay,
    delta:
      comparison.hasInspected && comparison.hasPis
        ? formatSignedDeltaDisplay(comparison.delta, unit, decimals)
        : (comparison.hasInspected ? "PIS not set" : "Inspected not set"),
    note: buildNumericDifferenceNote({
      segment,
      attribute,
      inspectedDisplay,
      pisDisplay,
      hasInspected: comparison.hasInspected,
      hasPis: comparison.hasPis,
    }),
  };
};

const createTextDifference = ({
  key,
  section,
  segment,
  attribute,
  inspectedValue,
  pisValue,
} = {}) => {
  const comparison = compareTextValues(inspectedValue, pisValue);
  if (!comparison.mismatch) return null;

  const inspectedDisplay = comparison.inspected || EMPTY_LABEL;
  const pisDisplay = comparison.pis || EMPTY_LABEL;

  return {
    key,
    section,
    segment,
    attribute,
    inspected: inspectedDisplay,
    pis: pisDisplay,
    delta: "Mismatch",
    note: buildTextDifferenceNote({
      segment,
      attribute,
      inspectedDisplay,
      pisDisplay,
      hasInspected: comparison.hasInspected,
      hasPis: comparison.hasPis,
    }),
  };
};

const buildUnionKeys = (inspectedEntries = [], pisEntries = [], keyBuilder) => [
  ...new Set([
    ...(Array.isArray(inspectedEntries) ? inspectedEntries : []).map((entry, index) =>
      keyBuilder(entry, index),
    ),
    ...(Array.isArray(pisEntries) ? pisEntries : []).map((entry, index) =>
      keyBuilder(entry, index),
    ),
  ]),
];

const getEntryLabel = (entry = {}, key = "", fallback = "Value") => {
  const explicitRemark = formatRemarkLabel(entry?.remark, "");
  if (explicitRemark) return explicitRemark;
  return formatRemarkLabel(key, fallback);
};

const buildItemSizeDifferences = (inspectedEntries = [], pisEntries = []) => {
  const differences = [];
  const orderedKeys = buildUnionKeys(inspectedEntries, pisEntries, buildItemEntryKey);
  const inspectedMap = new Map(
    inspectedEntries.map((entry, index) => [buildItemEntryKey(entry, index), entry]),
  );
  const pisMap = new Map(
    pisEntries.map((entry, index) => [buildItemEntryKey(entry, index), entry]),
  );

  orderedKeys.forEach((key, index) => {
    const inspectedEntry = inspectedMap.get(key) || {};
    const pisEntry = pisMap.get(key) || {};
    const segment = getEntryLabel(inspectedEntry?.remark ? inspectedEntry : pisEntry, key, "Item");

    ["L", "B", "H"].forEach((axis) => {
      const difference = createNumericDifference({
        key: `item-size-${key}-${axis}-${index}`,
        section: "Item Size",
        segment,
        attribute: axis,
        inspectedValue: inspectedEntry?.[axis],
        pisValue: pisEntry?.[axis],
        unit: "cm",
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
} = {}) => {
  const differences = [];
  const modeDifference = createTextDifference({
    key: "box-mode",
    section: "Box Size",
    segment: "Packaging",
    attribute: "Box Mode",
    inspectedValue: inspectedMode,
    pisValue: pisMode,
  });
  if (modeDifference) differences.push(modeDifference);

  const orderedKeys = buildUnionKeys(inspectedEntries, pisEntries, buildBoxEntryKey);
  const inspectedMap = new Map(
    inspectedEntries.map((entry, index) => [buildBoxEntryKey(entry, index), entry]),
  );
  const pisMap = new Map(
    pisEntries.map((entry, index) => [buildBoxEntryKey(entry, index), entry]),
  );

  orderedKeys.forEach((key, index) => {
    const inspectedEntry = inspectedMap.get(key) || {};
    const pisEntry = pisMap.get(key) || {};
    const labelSource = inspectedEntry?.remark ? inspectedEntry : pisEntry;
    const segment = getEntryLabel(labelSource, key, "Box");

    ["L", "B", "H"].forEach((axis) => {
      const difference = createNumericDifference({
        key: `box-size-${key}-${axis}-${index}`,
        section: "Box Size",
        segment,
        attribute: axis,
        inspectedValue: inspectedEntry?.[axis],
        pisValue: pisEntry?.[axis],
        unit: "cm",
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
      });
      if (difference) differences.push(difference);
    });
  });

  return differences;
};

const buildOverallWeightDifferences = (item = {}) => {
  const differences = [];
  [
    { key: "total-net", attribute: "Total Net", unit: "kg", fieldKey: "total_net" },
    { key: "total-gross", attribute: "Total Gross", unit: "kg", fieldKey: "total_gross" },
  ].forEach((weightField) => {
    const difference = createNumericDifference({
      key: `weight-${weightField.key}`,
      section: "Weight",
      segment: "Overall",
      attribute: weightField.attribute,
      inspectedValue: getWeightRecordValue(item?.inspected_weight, weightField.fieldKey),
      pisValue: getWeightRecordValue(item?.pis_weight, weightField.fieldKey),
      unit: weightField.unit,
    });
    if (difference) differences.push(difference);
  });
  return differences;
};

const buildCbmDifferences = (item = {}) => {
  const difference = createNumericDifference({
    key: "cbm-calculated-total",
    section: "CBM",
    segment: "Calculated",
    attribute: "Total CBM",
    inspectedValue: item?.cbm?.calculated_inspected_total,
    pisValue: item?.cbm?.calculated_pis_total,
    unit: "cbm",
    decimals: 6,
  });

  return difference ? [difference] : [];
};

const buildBarcodeDifferences = (item = {}) => {
  const differences = [];
  const masterDifference = createTextDifference({
    key: "barcode-master",
    section: "Barcode",
    segment: "Master",
    attribute: "Barcode",
    inspectedValue: item?.qc?.master_barcode || item?.qc?.barcode,
    pisValue: item?.pis_master_barcode || item?.pis_barcode,
  });
  if (masterDifference) differences.push(masterDifference);

  const innerDifference = createTextDifference({
    key: "barcode-inner",
    section: "Barcode",
    segment: "Inner",
    attribute: "Barcode",
    inspectedValue: item?.qc?.inner_barcode,
    pisValue: item?.pis_inner_barcode,
  });
  if (innerDifference) differences.push(innerDifference);

  return differences;
};

const formatBoxModeLabel = (mode = "") => {
  const normalized = normalizeKey(mode);
  if (!normalized) return "";
  if (normalized === BOX_PACKAGING_MODES.CARTON) return "Carton";
  if (normalized === BOX_PACKAGING_MODES.INDIVIDUAL) return "Individual";
  return formatRemarkLabel(normalized, normalized);
};

const buildFinalPisCheckRow = (item = {}) => {
  const inspectedItemEntries = buildItemMeasurementEntries({
    sizes: item?.inspected_item_sizes,
    singleLbh: item?.inspected_item_LBH,
    topLbh: item?.inspected_item_top_LBH,
    bottomLbh: item?.inspected_item_bottom_LBH,
    weight: item?.inspected_weight,
  });
  const pisItemEntries = buildItemMeasurementEntries({
    sizes: item?.pis_item_sizes,
    singleLbh: item?.pis_item_LBH,
    topLbh: item?.pis_item_top_LBH,
    bottomLbh: item?.pis_item_bottom_LBH,
    weight: item?.pis_weight,
  });
  const inspectedBoxEntries = buildBoxMeasurementEntries({
    sizes: item?.inspected_box_sizes,
    mode: item?.inspected_box_mode,
    singleLbh: item?.inspected_box_LBH,
    topLbh: item?.inspected_box_top_LBH || item?.inspected_top_LBH,
    bottomLbh: item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH,
    weight: item?.inspected_weight,
  });
  const pisBoxEntries = buildBoxMeasurementEntries({
    sizes: item?.pis_box_sizes,
    mode: item?.pis_box_mode,
    singleLbh: item?.pis_box_LBH,
    topLbh: item?.pis_box_top_LBH,
    bottomLbh: item?.pis_box_bottom_LBH,
    weight: item?.pis_weight,
  });

  const resolvedInspectedBoxMode = formatBoxModeLabel(
    detectBoxPackagingMode(item?.inspected_box_mode, item?.inspected_box_sizes),
  );
  const resolvedPisBoxMode = formatBoxModeLabel(
    detectBoxPackagingMode(item?.pis_box_mode, item?.pis_box_sizes),
  );

  const differences = [
    ...buildItemSizeDifferences(inspectedItemEntries, pisItemEntries),
    ...buildBoxSizeDifferences({
      inspectedEntries: inspectedBoxEntries,
      pisEntries: pisBoxEntries,
      inspectedMode: resolvedInspectedBoxMode,
      pisMode: resolvedPisBoxMode,
    }),
    ...buildOverallWeightDifferences(item),
    ...buildCbmDifferences(item),
    ...buildBarcodeDifferences(item),
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
      inspected_item: buildMeasurementDisplay(inspectedItemEntries, "net_weight"),
      pis_item: buildMeasurementDisplay(pisItemEntries, "net_weight"),
      inspected_box: buildMeasurementDisplay(inspectedBoxEntries, "gross_weight"),
      pis_box: buildMeasurementDisplay(pisBoxEntries, "gross_weight"),
    },
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
} = {}) => ({
  generated_at: new Date().toISOString(),
  filters: {
    search: normalizeText(search) || "All",
    brand: normalizeText(brand) || "All",
    vendor: normalizeText(vendor) || "All",
    diff_field: normalizeFinalPisCheckDiffField(diffField) || "All",
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

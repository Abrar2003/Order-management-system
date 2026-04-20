const BOX_PACKAGING_MODES = Object.freeze({
  INDIVIDUAL: "individual",
  CARTON: "carton",
});

const BOX_ENTRY_TYPES = Object.freeze({
  INDIVIDUAL: "individual",
  INNER: "inner",
  MASTER: "master",
});

const BOX_INDIVIDUAL_REMARK_OPTIONS = Object.freeze([
  "top",
  "base",
  "box1",
  "box2",
  "box3",
]);

const BOX_CARTON_REMARK_OPTIONS = Object.freeze([
  "inner",
  "master",
]);

const BOX_SIZE_REMARK_OPTIONS = Object.freeze([
  ...BOX_INDIVIDUAL_REMARK_OPTIONS,
  ...BOX_CARTON_REMARK_OPTIONS,
]);

const SIZE_ENTRY_LIMIT = 3;

const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = toSafeNumber(value, fallback);
  if (parsed <= 0) return fallback;
  return parsed;
};

const toDecimalString = (value, precision = 6) => {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const fixed = value.toFixed(precision);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const hasCompletePositiveLbh = (dimensions = {}) =>
  toPositiveNumber(dimensions?.L, 0) > 0 &&
  toPositiveNumber(dimensions?.B, 0) > 0 &&
  toPositiveNumber(dimensions?.H, 0) > 0;

const calculateCbmFromLbh = (dimensions = {}) => {
  if (!hasCompletePositiveLbh(dimensions)) return "0";
  const cubicMeters =
    (toPositiveNumber(dimensions?.L, 0) *
      toPositiveNumber(dimensions?.B, 0) *
      toPositiveNumber(dimensions?.H, 0)) /
    1000000;
  return toDecimalString(cubicMeters, 6);
};

const detectBoxPackagingMode = (value = "", entries = []) => {
  const normalizedValue = normalizeText(value);
  if (
    normalizedValue === BOX_PACKAGING_MODES.INDIVIDUAL ||
    normalizedValue === BOX_PACKAGING_MODES.CARTON
  ) {
    return normalizedValue;
  }

  const hasCartonEntry = (Array.isArray(entries) ? entries : []).some((entry) => {
    const remark = normalizeText(entry?.remark || entry?.type || "");
    const boxType = normalizeText(entry?.box_type || "");
    return (
      remark === BOX_ENTRY_TYPES.INNER ||
      remark === BOX_ENTRY_TYPES.MASTER ||
      boxType === BOX_ENTRY_TYPES.INNER ||
      boxType === BOX_ENTRY_TYPES.MASTER
    );
  });

  return hasCartonEntry
    ? BOX_PACKAGING_MODES.CARTON
    : BOX_PACKAGING_MODES.INDIVIDUAL;
};

const normalizeIndividualRemark = (value = "") => {
  const normalized = normalizeText(value);
  return BOX_INDIVIDUAL_REMARK_OPTIONS.includes(normalized) ? normalized : "";
};

const normalizeBoxEntryMetadata = (entry = {}, mode = BOX_PACKAGING_MODES.INDIVIDUAL) => {
  const normalizedMode = detectBoxPackagingMode(mode, [entry]);
  const normalizedRemark = normalizeText(entry?.remark || entry?.type || "");
  const normalizedBoxType = normalizeText(entry?.box_type || "");

  if (normalizedMode === BOX_PACKAGING_MODES.CARTON) {
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
          ? Math.max(0, toSafeNumber(entry?.item_count_in_inner, 0))
          : 0,
      box_count_in_master:
        resolvedType === BOX_ENTRY_TYPES.MASTER
          ? Math.max(0, toSafeNumber(entry?.box_count_in_master, 0))
          : 0,
    };
  }

  return {
    remark: normalizeIndividualRemark(normalizedRemark),
    box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
    item_count_in_inner: 0,
    box_count_in_master: 0,
  };
};

const normalizeStoredBoxEntries = (
  entries = [],
  { weightKey = "", mode = BOX_PACKAGING_MODES.INDIVIDUAL } = {},
) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const resolvedMode = detectBoxPackagingMode(mode, safeEntries);

  const normalizedEntries = safeEntries
    .map((entry) => {
      const L = Math.max(0, toSafeNumber(entry?.L, 0));
      const B = Math.max(0, toSafeNumber(entry?.B, 0));
      const H = Math.max(0, toSafeNumber(entry?.H, 0));
      const metadata = normalizeBoxEntryMetadata(entry, resolvedMode);
      const normalizedEntry = {
        L,
        B,
        H,
        ...metadata,
      };

      if (weightKey) {
        normalizedEntry[weightKey] = Math.max(0, toSafeNumber(entry?.[weightKey], 0));
      }

      return normalizedEntry;
    })
    .filter((entry) => hasCompletePositiveLbh(entry));

  if (resolvedMode !== BOX_PACKAGING_MODES.CARTON) {
    return normalizedEntries.slice(0, SIZE_ENTRY_LIMIT);
  }

  const byType = new Map();
  normalizedEntries.forEach((entry) => {
    const entryType =
      entry?.box_type === BOX_ENTRY_TYPES.MASTER
        ? BOX_ENTRY_TYPES.MASTER
        : BOX_ENTRY_TYPES.INNER;
    if (!byType.has(entryType)) {
      byType.set(entryType, entry);
    }
  });

  const orderedCartonEntries = [];
  if (byType.has(BOX_ENTRY_TYPES.INNER)) {
    orderedCartonEntries.push(byType.get(BOX_ENTRY_TYPES.INNER));
  }
  if (byType.has(BOX_ENTRY_TYPES.MASTER)) {
    orderedCartonEntries.push(byType.get(BOX_ENTRY_TYPES.MASTER));
  }

  return orderedCartonEntries.slice(0, 2);
};

const sortBoxEntriesByRemark = (
  entries = [],
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
) => {
  const resolvedMode = detectBoxPackagingMode(mode, entries);
  const remarkOrder =
    resolvedMode === BOX_PACKAGING_MODES.CARTON
      ? BOX_CARTON_REMARK_OPTIONS
      : BOX_INDIVIDUAL_REMARK_OPTIONS;

  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftRemark = normalizeText(left?.remark || "");
    const rightRemark = normalizeText(right?.remark || "");
    const leftIndex = remarkOrder.indexOf(leftRemark);
    const rightIndex = remarkOrder.indexOf(rightRemark);
    const safeLeftIndex = leftIndex >= 0 ? leftIndex : remarkOrder.length + 1;
    const safeRightIndex = rightIndex >= 0 ? rightIndex : remarkOrder.length + 1;
    return safeLeftIndex - safeRightIndex;
  });
};

const buildBoxEntriesFromLegacy = ({
  sizes = [],
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
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
  const resolvedMode = detectBoxPackagingMode(mode, sizes);
  const normalizedSizes = normalizeStoredBoxEntries(sizes, {
    weightKey,
    mode: resolvedMode,
  });
  if (normalizedSizes.length > 0) {
    return normalizedSizes;
  }

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    if (!hasCompletePositiveLbh(singleLbh)) {
      return [];
    }

    return [
      {
        L: toPositiveNumber(singleLbh?.L, 0),
        B: toPositiveNumber(singleLbh?.B, 0),
        H: toPositiveNumber(singleLbh?.H, 0),
        remark: BOX_ENTRY_TYPES.MASTER,
        box_type: BOX_ENTRY_TYPES.MASTER,
        item_count_in_inner: 0,
        box_count_in_master: 0,
        ...(weightKey
          ? { [weightKey]: Math.max(0, toSafeNumber(totalWeight, 0)) }
          : {}),
      },
    ];
  }

  const legacyEntries = [];
  if (hasCompletePositiveLbh(topLbh)) {
    legacyEntries.push({
      ...topLbh,
      remark: topRemark,
      box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
      item_count_in_inner: 0,
      box_count_in_master: 0,
      ...(weightKey ? { [weightKey]: Math.max(0, toSafeNumber(topWeight, 0)) } : {}),
    });
  }
  if (hasCompletePositiveLbh(bottomLbh)) {
    legacyEntries.push({
      ...bottomLbh,
      remark: bottomRemark,
      box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
      item_count_in_inner: 0,
      box_count_in_master: 0,
      ...(weightKey
        ? { [weightKey]: Math.max(0, toSafeNumber(bottomWeight, 0)) }
        : {}),
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
      box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
      item_count_in_inner: 0,
      box_count_in_master: 0,
      ...(weightKey ? { [weightKey]: Math.max(0, toSafeNumber(totalWeight, 0)) } : {}),
    },
  ];
};

const buildBoxLegacyFieldsFromEntries = (
  entries = [],
  { weightKey = "" } = {},
) => {
  const resolvedMode = detectBoxPackagingMode("", entries);
  const normalizedEntries = sortBoxEntriesByRemark(
    normalizeStoredBoxEntries(entries, { weightKey, mode: resolvedMode }),
    resolvedMode,
  );

  const toLbh = (entry = null) =>
    hasCompletePositiveLbh(entry)
      ? {
          L: Math.max(0, toSafeNumber(entry?.L, 0)),
          B: Math.max(0, toSafeNumber(entry?.B, 0)),
          H: Math.max(0, toSafeNumber(entry?.H, 0)),
        }
      : { L: 0, B: 0, H: 0 };

  const totalWeight = weightKey
    ? normalizedEntries.reduce(
        (sum, entry) => sum + Math.max(0, toSafeNumber(entry?.[weightKey], 0)),
        0,
      )
    : 0;

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const innerEntry =
      normalizedEntries.find((entry) => entry?.box_type === BOX_ENTRY_TYPES.INNER) ||
      null;
    const masterEntry =
      normalizedEntries.find((entry) => entry?.box_type === BOX_ENTRY_TYPES.MASTER) ||
      null;

    return {
      mode: resolvedMode,
      single: toLbh(masterEntry),
      top: { L: 0, B: 0, H: 0 },
      bottom: { L: 0, B: 0, H: 0 },
      totalWeight,
      topWeight: weightKey ? Math.max(0, toSafeNumber(innerEntry?.[weightKey], 0)) : 0,
      bottomWeight: weightKey
        ? Math.max(0, toSafeNumber(masterEntry?.[weightKey], 0))
        : 0,
    };
  }

  const firstEntry = normalizedEntries[0] || null;
  const secondEntry = normalizedEntries[1] || null;

  if (normalizedEntries.length === 1) {
    return {
      mode: resolvedMode,
      single: toLbh(firstEntry),
      top: { L: 0, B: 0, H: 0 },
      bottom: { L: 0, B: 0, H: 0 },
      totalWeight,
      topWeight: 0,
      bottomWeight: 0,
    };
  }

  return {
    mode: resolvedMode,
    single: { L: 0, B: 0, H: 0 },
    top: toLbh(firstEntry),
    bottom: toLbh(secondEntry),
    totalWeight,
    topWeight: weightKey ? Math.max(0, toSafeNumber(firstEntry?.[weightKey], 0)) : 0,
    bottomWeight: weightKey
      ? Math.max(0, toSafeNumber(secondEntry?.[weightKey], 0))
      : 0,
  };
};

const buildBoxMeasurementCbmSummary = ({
  sizes = [],
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  singleLbh = null,
  topLbh = null,
  bottomLbh = null,
} = {}) => {
  const resolvedMode = detectBoxPackagingMode(mode, sizes);
  const normalizedEntries = sortBoxEntriesByRemark(
    buildBoxEntriesFromLegacy({
      sizes,
      mode: resolvedMode,
      singleLbh,
      topLbh,
      bottomLbh,
    }),
    resolvedMode,
  );

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const innerEntry =
      normalizedEntries.find((entry) => entry?.box_type === BOX_ENTRY_TYPES.INNER) ||
      null;
    const masterEntry =
      normalizedEntries.find((entry) => entry?.box_type === BOX_ENTRY_TYPES.MASTER) ||
      null;
    const innerCbm = calculateCbmFromLbh(innerEntry || {});
    const masterCbm = calculateCbmFromLbh(masterEntry || {});

    return {
      mode: resolvedMode,
      first: innerCbm,
      second: masterCbm,
      third: "0",
      total: masterCbm,
    };
  }

  if (normalizedEntries.length > 0) {
    const first = calculateCbmFromLbh(normalizedEntries[0] || {});
    const second = calculateCbmFromLbh(normalizedEntries[1] || {});
    const third = calculateCbmFromLbh(normalizedEntries[2] || {});
    const total = normalizedEntries.reduce(
      (sum, entry) => sum + toPositiveNumber(calculateCbmFromLbh(entry), 0),
      0,
    );

    return {
      mode: resolvedMode,
      first,
      second,
      third,
      total: toDecimalString(total, 6),
    };
  }

  const first = calculateCbmFromLbh(topLbh || {});
  const second = calculateCbmFromLbh(bottomLbh || {});
  const splitTotal =
    toPositiveNumber(first, 0) > 0 && toPositiveNumber(second, 0) > 0
      ? toPositiveNumber(first, 0) + toPositiveNumber(second, 0)
      : 0;

  return {
    mode: resolvedMode,
    first,
    second,
    third: "0",
    total:
      splitTotal > 0
        ? toDecimalString(splitTotal, 6)
        : calculateCbmFromLbh(singleLbh || {}),
  };
};

const calculateEffectiveBoxEntriesCbmTotal = (
  entries = [],
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
) =>
  toPositiveNumber(
    buildBoxMeasurementCbmSummary({
      sizes: entries,
      mode,
    }).total,
    0,
  );

module.exports = {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
  BOX_INDIVIDUAL_REMARK_OPTIONS,
  BOX_CARTON_REMARK_OPTIONS,
  BOX_SIZE_REMARK_OPTIONS,
  detectBoxPackagingMode,
  normalizeStoredBoxEntries,
  buildBoxEntriesFromLegacy,
  buildBoxLegacyFieldsFromEntries,
  buildBoxMeasurementCbmSummary,
  calculateEffectiveBoxEntriesCbmTotal,
  calculateCbmFromLbh,
  hasCompletePositiveLbh,
};

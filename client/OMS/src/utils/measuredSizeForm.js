import { formatCbm } from "./cbm";
import { formatNumberInputValue } from "./measurementDisplay";

export const SIZE_ENTRY_LIMIT = 4;
export const BOX_PACKAGING_MODES = Object.freeze({
  INDIVIDUAL: "individual",
  CARTON: "carton",
});
export const BOX_ENTRY_TYPES = Object.freeze({
  INDIVIDUAL: "individual",
  INNER: "inner",
  MASTER: "master",
});

export const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  { value: "item", label: "Item" },
  { value: "top", label: "Top" },
  { value: "base", label: "Base" },
  { value: "item2", label: "Item 2" },
  { value: "item3", label: "Item 3" },
  { value: "item4", label: "Item 4" },
]);

export const BOX_SIZE_REMARK_OPTIONS = Object.freeze([
  { value: "top", label: "Top" },
  { value: "base", label: "Base" },
  { value: "box1", label: "Box 1" },
  { value: "box2", label: "Box 2" },
  { value: "box3", label: "Box 3" },
  { value: "box4", label: "Box 4" },
  { value: "inner", label: "Inner Carton" },
  { value: "master", label: "Master Carton" },
]);

export const BOX_CARTON_REMARK_OPTIONS = Object.freeze([
  { value: "inner", label: "Inner Carton" },
  { value: "master", label: "Master Carton" },
]);

const LEGACY_WEIGHT_FALLBACK_BY_KEY = Object.freeze({
  total_net: "net",
  total_gross: "gross",
});

export const detectBoxPackagingMode = (mode = "", entries = []) => {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (
    normalizedMode === BOX_PACKAGING_MODES.INDIVIDUAL ||
    normalizedMode === BOX_PACKAGING_MODES.CARTON
  ) {
    return normalizedMode;
  }

  const hasCartonEntry = (Array.isArray(entries) ? entries : []).some((entry) => {
    const remark = String(entry?.remark || entry?.type || "").trim().toLowerCase();
    const boxType = String(entry?.box_type || "").trim().toLowerCase();
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

const createCartonEntry = (boxType = BOX_ENTRY_TYPES.INNER) => ({
  remark: boxType,
  box_type: boxType,
  L: "",
  B: "",
  H: "",
  weight: "",
  item_count_in_inner: boxType === BOX_ENTRY_TYPES.INNER ? "" : "0",
  box_count_in_master: boxType === BOX_ENTRY_TYPES.MASTER ? "" : "0",
});

export const createEmptyMeasuredSizeEntry = ({
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  boxType = BOX_ENTRY_TYPES.INDIVIDUAL,
} = {}) =>
  detectBoxPackagingMode(mode, [{ box_type: boxType }]) === BOX_PACKAGING_MODES.CARTON
    ? createCartonEntry(boxType === BOX_ENTRY_TYPES.MASTER ? BOX_ENTRY_TYPES.MASTER : BOX_ENTRY_TYPES.INNER)
    : {
        remark: "",
        box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
        L: "",
        B: "",
        H: "",
        weight: "",
        item_count_in_inner: "0",
        box_count_in_master: "0",
      };

export const toDimensionInputValue = (value) => {
  return formatNumberInputValue(value);
};

export const normalizeSizeCount = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > SIZE_ENTRY_LIMIT) {
    return fallback;
  }
  return parsed;
};

const coerceMeasuredSizeEntry = (
  entry = {},
  { mode = BOX_PACKAGING_MODES.INDIVIDUAL } = {},
) => {
  const resolvedMode = detectBoxPackagingMode(mode, [entry]);
  const normalizedRemark = String(entry?.remark || "").trim().toLowerCase();
  const normalizedBoxType = String(entry?.box_type || "").trim().toLowerCase();
  const isCartonMode = resolvedMode === BOX_PACKAGING_MODES.CARTON;
  const resolvedBoxType = isCartonMode
    ? normalizedBoxType === BOX_ENTRY_TYPES.MASTER || normalizedRemark === BOX_ENTRY_TYPES.MASTER
      ? BOX_ENTRY_TYPES.MASTER
      : BOX_ENTRY_TYPES.INNER
    : BOX_ENTRY_TYPES.INDIVIDUAL;

  return {
    remark: isCartonMode
      ? resolvedBoxType
      : normalizedRemark,
    box_type: resolvedBoxType,
    L: String(entry?.L || ""),
    B: String(entry?.B || ""),
    H: String(entry?.H || ""),
    weight: String(entry?.weight || ""),
    item_count_in_inner: String(entry?.item_count_in_inner ?? "0"),
    box_count_in_master: String(entry?.box_count_in_master ?? "0"),
  };
};

export const ensureMeasuredSizeEntryCount = (
  entries = [],
  count = 1,
  { mode = BOX_PACKAGING_MODES.INDIVIDUAL } = {},
) => {
  const resolvedMode = detectBoxPackagingMode(mode, entries);
  const safeCount =
    resolvedMode === BOX_PACKAGING_MODES.CARTON
      ? 2
      : normalizeSizeCount(count, 1);
  const nextEntries = Array.isArray(entries)
    ? entries.slice(0, safeCount).map((entry) => coerceMeasuredSizeEntry(entry, { mode: resolvedMode }))
    : [];

  while (nextEntries.length < safeCount) {
    if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
      nextEntries.push(
        createEmptyMeasuredSizeEntry({
          mode: resolvedMode,
          boxType: nextEntries.length === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
        }),
      );
    } else {
      nextEntries.push(createEmptyMeasuredSizeEntry());
    }
  }

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    nextEntries.forEach((entry, index) => {
      entry.box_type = index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER;
      entry.remark = entry.box_type;
      if (entry.box_type === BOX_ENTRY_TYPES.INNER) {
        entry.box_count_in_master = "0";
      } else {
        entry.item_count_in_inner = "0";
      }
    });
  } else if (safeCount === 1 && nextEntries[0]) {
    nextEntries[0].remark = "";
    nextEntries[0].box_type = BOX_ENTRY_TYPES.INDIVIDUAL;
  }

  return nextEntries;
};

const toMeasuredSizeEntryValue = (
  entry = {},
  weightKey = "",
  { mode = BOX_PACKAGING_MODES.INDIVIDUAL } = {},
) => {
  const resolvedMode = detectBoxPackagingMode(mode, [entry]);
  const coercedEntry = coerceMeasuredSizeEntry(entry, { mode: resolvedMode });
  return {
    ...coercedEntry,
    L: toDimensionInputValue(entry?.L),
    B: toDimensionInputValue(entry?.B),
    H: toDimensionInputValue(entry?.H),
    weight: toDimensionInputValue(weightKey ? entry?.[weightKey] : entry?.weight),
    item_count_in_inner: toDimensionInputValue(entry?.item_count_in_inner),
    box_count_in_master: toDimensionInputValue(entry?.box_count_in_master),
  };
};

export const hasMeaningfulMeasuredSize = (entry = {}) =>
  String(entry?.L || "").trim() !== "" ||
  String(entry?.B || "").trim() !== "" ||
  String(entry?.H || "").trim() !== "" ||
  String(entry?.weight || "").trim() !== "" ||
  String(entry?.remark || "").trim() !== "" ||
  String(entry?.item_count_in_inner || "").trim() !== "" ||
  String(entry?.box_count_in_master || "").trim() !== "";

export const getWeightValueFromModel = (weightData = {}, payloadKey = "") => {
  const normalizedPayloadKey = String(payloadKey || "").trim();
  if (!normalizedPayloadKey) return 0;

  const legacyKey = LEGACY_WEIGHT_FALLBACK_BY_KEY[normalizedPayloadKey];
  const rawValue =
    weightData?.[normalizedPayloadKey]
    ?? (legacyKey ? weightData?.[legacyKey] : undefined)
    ?? 0;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const buildMeasuredSizeEntriesFromLegacy = ({
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
} = {}) => {
  const resolvedMode = detectBoxPackagingMode(mode, primaryEntries);
  const normalizedPrimaryEntries = Array.isArray(primaryEntries)
    ? primaryEntries
        .map((entry) => toMeasuredSizeEntryValue(entry, weightKey, { mode: resolvedMode }))
        .filter((entry) => hasMeaningfulMeasuredSize(entry))
        .slice(0, resolvedMode === BOX_PACKAGING_MODES.CARTON ? 2 : SIZE_ENTRY_LIMIT)
    : [];
  if (normalizedPrimaryEntries.length > 0) {
    return normalizedPrimaryEntries;
  }

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const masterEntry = toMeasuredSizeEntryValue(
      {
        ...singleLbh,
        remark: BOX_ENTRY_TYPES.MASTER,
        box_type: BOX_ENTRY_TYPES.MASTER,
        [weightKey]: totalWeight,
      },
      weightKey,
      { mode: resolvedMode },
    );
    return hasMeaningfulMeasuredSize(masterEntry)
      ? [masterEntry]
      : [createEmptyMeasuredSizeEntry({ mode: resolvedMode, boxType: BOX_ENTRY_TYPES.INNER }), createEmptyMeasuredSizeEntry({ mode: resolvedMode, boxType: BOX_ENTRY_TYPES.MASTER })];
  }

  const topEntry = toMeasuredSizeEntryValue(
    { ...topLbh, remark: topRemark, [weightKey]: topWeight },
    weightKey,
    { mode: resolvedMode },
  );
  const bottomEntry = toMeasuredSizeEntryValue(
    { ...bottomLbh, remark: bottomRemark, [weightKey]: bottomWeight },
    weightKey,
    { mode: resolvedMode },
  );
  if (hasMeaningfulMeasuredSize(topEntry) || hasMeaningfulMeasuredSize(bottomEntry)) {
    return [topEntry, bottomEntry].filter((entry) => hasMeaningfulMeasuredSize(entry));
  }

  const singleEntry = toMeasuredSizeEntryValue(
    { ...singleLbh, [weightKey]: totalWeight },
    weightKey,
    { mode: resolvedMode },
  );
  return hasMeaningfulMeasuredSize(singleEntry) ? [singleEntry] : [createEmptyMeasuredSizeEntry()];
};

export const getRemarkLabel = (options = [], remark = "") =>
  options.find((option) => option.value === remark)?.label || remark;

export const convertMeasuredBoxEntriesMode = (
  entries = [],
  nextMode = BOX_PACKAGING_MODES.INDIVIDUAL,
) => {
  const resolvedMode = detectBoxPackagingMode(nextMode, entries);
  const normalizedEntries = ensureMeasuredSizeEntryCount(
    entries,
    resolvedMode === BOX_PACKAGING_MODES.CARTON ? 2 : Math.max(1, entries?.length || 1),
    { mode: resolvedMode },
  );

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const firstEntry = normalizedEntries[0] || createEmptyMeasuredSizeEntry({
      mode: resolvedMode,
      boxType: BOX_ENTRY_TYPES.INNER,
    });
    const secondEntry = normalizedEntries[1] || createEmptyMeasuredSizeEntry({
      mode: resolvedMode,
      boxType: BOX_ENTRY_TYPES.MASTER,
    });

    return [
      {
        ...createEmptyMeasuredSizeEntry({
          mode: resolvedMode,
          boxType: BOX_ENTRY_TYPES.INNER,
        }),
        ...firstEntry,
        remark: BOX_ENTRY_TYPES.INNER,
        box_type: BOX_ENTRY_TYPES.INNER,
        box_count_in_master: "0",
      },
      {
        ...createEmptyMeasuredSizeEntry({
          mode: resolvedMode,
          boxType: BOX_ENTRY_TYPES.MASTER,
        }),
        ...secondEntry,
        remark: BOX_ENTRY_TYPES.MASTER,
        box_type: BOX_ENTRY_TYPES.MASTER,
        item_count_in_inner: "0",
      },
    ];
  }

  return normalizedEntries.map((entry, index) => ({
    ...createEmptyMeasuredSizeEntry(),
    ...entry,
    remark:
      normalizedEntries.length === 1
        ? ""
        : String(entry?.remark || BOX_SIZE_REMARK_OPTIONS[index]?.value || "").trim().toLowerCase(),
    box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
    item_count_in_inner: "0",
    box_count_in_master: "0",
  }));
};

export const deriveLegacyFromMeasuredSizeEntries = (
  entries = [],
  {
    count = 1,
    weightKey = "weight",
    remarkOrder = [],
    mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  } = {},
) => {
  const resolvedMode = detectBoxPackagingMode(mode, entries);
  const safeCount =
    resolvedMode === BOX_PACKAGING_MODES.CARTON ? 2 : normalizeSizeCount(count, 1);
  const safeEntries = ensureMeasuredSizeEntryCount(entries, safeCount, {
    mode: resolvedMode,
  });
  const normalizedEntries = safeEntries
    .map((entry) => ({
      remark: String(entry?.remark || "").trim().toLowerCase(),
      box_type: String(entry?.box_type || "").trim().toLowerCase(),
      L: toDimensionInputValue(entry?.L),
      B: toDimensionInputValue(entry?.B),
      H: toDimensionInputValue(entry?.H),
      weight: toDimensionInputValue(entry?.[weightKey] ?? entry?.weight),
    }))
    .sort((left, right) => {
      if (!Array.isArray(remarkOrder) || remarkOrder.length === 0) return 0;
      const leftIndex = remarkOrder.indexOf(left.remark);
      const rightIndex = remarkOrder.indexOf(right.remark);
      const safeLeftIndex = leftIndex >= 0 ? leftIndex : remarkOrder.length + 1;
      const safeRightIndex = rightIndex >= 0 ? rightIndex : remarkOrder.length + 1;
      return safeLeftIndex - safeRightIndex;
    });
  const toLegacyLbh = (entry = null) =>
    entry &&
    entry.L &&
    entry.B &&
    entry.H
      ? {
          L: Number(entry.L),
          B: Number(entry.B),
          H: Number(entry.H),
        }
      : null;
  const totalWeight = normalizedEntries.reduce(
    (sum, entry) => sum + (Number(entry?.weight || 0) || 0),
    0,
  );

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const innerEntry =
      normalizedEntries.find((entry) => entry.box_type === BOX_ENTRY_TYPES.INNER || entry.remark === BOX_ENTRY_TYPES.INNER) ||
      null;
    const masterEntry =
      normalizedEntries.find((entry) => entry.box_type === BOX_ENTRY_TYPES.MASTER || entry.remark === BOX_ENTRY_TYPES.MASTER) ||
      null;

    return {
      mode: resolvedMode,
      single: toLegacyLbh(masterEntry),
      top: null,
      bottom: null,
      totalWeight: totalWeight > 0 ? totalWeight : null,
      topWeight: Number(innerEntry?.weight || 0) > 0 ? Number(innerEntry.weight) : null,
      bottomWeight: Number(masterEntry?.weight || 0) > 0 ? Number(masterEntry.weight) : null,
    };
  }

  return {
    mode: resolvedMode,
    single: safeCount === 1 ? toLegacyLbh(normalizedEntries[0]) : null,
    top: safeCount >= 2 ? toLegacyLbh(normalizedEntries[0]) : null,
    bottom: safeCount >= 2 ? toLegacyLbh(normalizedEntries[1]) : null,
    totalWeight: totalWeight > 0 ? totalWeight : null,
    topWeight:
      safeCount >= 2 && Number(normalizedEntries[0]?.weight || 0) > 0
        ? Number(normalizedEntries[0].weight)
        : null,
    bottomWeight:
      safeCount >= 2 && Number(normalizedEntries[1]?.weight || 0) > 0
        ? Number(normalizedEntries[1].weight)
        : null,
  };
};

export const parseMeasuredSizeEntries = ({
  entries = [],
  count = 1,
  groupLabel = "Sizes",
  remarkOptions = [],
  payloadWeightKey = "",
  weightFieldLabel = "Weight",
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
} = {}) => {
  const resolvedMode = detectBoxPackagingMode(mode, entries);
  const safeCount =
    resolvedMode === BOX_PACKAGING_MODES.CARTON
      ? 2
      : normalizeSizeCount(count, 1);
  const scopedEntries = ensureMeasuredSizeEntryCount(
    entries,
    safeCount,
    { mode: resolvedMode },
  ).slice(0, safeCount);
  const hasMeaningfulInput = scopedEntries.some((entry) => hasMeaningfulMeasuredSize(entry));

  if (!hasMeaningfulInput) {
    return {
      mode: resolvedMode,
      count: safeCount,
      hasAnyInput: false,
      value: [],
    };
  }

  const allowedRemarks = remarkOptions.map((option) => String(option?.value || "").trim().toLowerCase());
  const seenRemarks = new Set();
  const parsedEntries = [];

  for (let index = 0; index < scopedEntries.length; index += 1) {
    const entry = scopedEntries[index] || {};
    const entryLabel = `${groupLabel} ${index + 1}`;
    const L = Number(String(entry?.L ?? "").trim());
    const B = Number(String(entry?.B ?? "").trim());
    const H = Number(String(entry?.H ?? "").trim());

    if (!Number.isFinite(L) || L <= 0) {
      return { error: `${entryLabel} length must be greater than 0.` };
    }
    if (!Number.isFinite(B) || B <= 0) {
      return { error: `${entryLabel} breadth must be greater than 0.` };
    }
    if (!Number.isFinite(H) || H <= 0) {
      return { error: `${entryLabel} height must be greater than 0.` };
    }

    let normalizedRemark = "";
    if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
      normalizedRemark = index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER;
    } else if (safeCount > 1) {
      normalizedRemark = String(entry?.remark || "").trim().toLowerCase();
      if (!normalizedRemark) {
        return { error: `${entryLabel} remark is required.` };
      }
      if (!allowedRemarks.includes(normalizedRemark)) {
        return { error: `${entryLabel} remark is invalid.` };
      }
      if (seenRemarks.has(normalizedRemark)) {
        return { error: `${groupLabel} remarks must be unique.` };
      }
      seenRemarks.add(normalizedRemark);
    }

    const parsedEntry = {
      remark: normalizedRemark,
      L,
      B,
      H,
    };

    if (payloadWeightKey) {
      const parsedWeight = Number(String(entry?.weight ?? "").trim());
      if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
        return {
          error: `${entryLabel} ${weightFieldLabel.toLowerCase()} must be greater than 0.`,
        };
      }
      parsedEntry[payloadWeightKey] = parsedWeight;
    }

    if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
      const boxType = index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER;
      parsedEntry.remark = boxType;
      parsedEntry.box_type = boxType;
      if (boxType === BOX_ENTRY_TYPES.INNER) {
        const itemCountInInner = Number(String(entry?.item_count_in_inner ?? "").trim());
        if (!Number.isFinite(itemCountInInner) || itemCountInInner <= 0) {
          return { error: `${entryLabel} item count in inner must be greater than 0.` };
        }
        parsedEntry.item_count_in_inner = itemCountInInner;
        parsedEntry.box_count_in_master = 0;
      } else {
        const boxCountInMaster = Number(String(entry?.box_count_in_master ?? "").trim());
        if (!Number.isFinite(boxCountInMaster) || boxCountInMaster <= 0) {
          return { error: `${entryLabel} box count in master must be greater than 0.` };
        }
        parsedEntry.box_count_in_master = boxCountInMaster;
        parsedEntry.item_count_in_inner = 0;
      }
    }

    parsedEntries.push(parsedEntry);
  }

  return {
    mode: resolvedMode,
    count: safeCount,
    hasAnyInput: true,
    value: parsedEntries,
  };
};

export const calculateMeasuredSizeEntriesCbm = (
  entries = [],
  count = 1,
  { mode = BOX_PACKAGING_MODES.INDIVIDUAL } = {},
) => {
  const resolvedMode = detectBoxPackagingMode(mode, entries);
  const safeCount =
    resolvedMode === BOX_PACKAGING_MODES.CARTON
      ? 2
      : normalizeSizeCount(count, 1);
  const scopedEntries = ensureMeasuredSizeEntryCount(entries, safeCount, {
    mode: resolvedMode,
  }).slice(0, safeCount);
  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const masterEntry =
      scopedEntries.find((entry) => entry?.box_type === BOX_ENTRY_TYPES.MASTER) ||
      scopedEntries[1] ||
      null;
    const L = Number(masterEntry?.L || 0);
    const B = Number(masterEntry?.B || 0);
    const H = Number(masterEntry?.H || 0);
    if (!Number.isFinite(L) || !Number.isFinite(B) || !Number.isFinite(H)) {
      return formatCbm(0);
    }
    if (L <= 0 || B <= 0 || H <= 0) {
      return formatCbm(0);
    }
    return formatCbm((L * B * H) / 1000000);
  }
  const total = scopedEntries.reduce((sum, entry) => {
    const L = Number(entry?.L || 0);
    const B = Number(entry?.B || 0);
    const H = Number(entry?.H || 0);
    if (!Number.isFinite(L) || !Number.isFinite(B) || !Number.isFinite(H)) {
      return sum;
    }
    if (L <= 0 || B <= 0 || H <= 0) {
      return sum;
    }
    return sum + ((L * B * H) / 1000000);
  }, 0);

  return formatCbm(total);
};

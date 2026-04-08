import { formatCbm } from "./cbm";
import { formatNumberInputValue } from "./measurementDisplay";

export const SIZE_ENTRY_LIMIT = 3;

export const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  { value: "top", label: "Top" },
  { value: "base", label: "Base" },
  { value: "item1", label: "Item 1" },
  { value: "item2", label: "Item 2" },
  { value: "item3", label: "Item 3" },
]);

export const BOX_SIZE_REMARK_OPTIONS = Object.freeze([
  { value: "top", label: "Top" },
  { value: "base", label: "Base" },
  { value: "box1", label: "Box 1" },
  { value: "box2", label: "Box 2" },
  { value: "box3", label: "Box 3" },
]);

const LEGACY_WEIGHT_FALLBACK_BY_KEY = Object.freeze({
  total_net: "net",
  total_gross: "gross",
});

export const createEmptyMeasuredSizeEntry = () => ({
  remark: "",
  L: "",
  B: "",
  H: "",
  weight: "",
});

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

export const ensureMeasuredSizeEntryCount = (entries = [], count = 1) => {
  const safeCount = normalizeSizeCount(count, 1);
  const nextEntries = Array.isArray(entries)
    ? entries.slice(0, safeCount).map((entry) => ({
        remark: String(entry?.remark || "").trim().toLowerCase(),
        L: String(entry?.L || ""),
        B: String(entry?.B || ""),
        H: String(entry?.H || ""),
        weight: String(entry?.weight || ""),
      }))
    : [];

  while (nextEntries.length < safeCount) {
    nextEntries.push(createEmptyMeasuredSizeEntry());
  }

  if (safeCount === 1 && nextEntries[0]) {
    nextEntries[0].remark = "";
  }

  return nextEntries;
};

const toMeasuredSizeEntryValue = (entry = {}, weightKey = "") => ({
  remark: String(entry?.remark || entry?.type || "").trim().toLowerCase(),
  L: toDimensionInputValue(entry?.L),
  B: toDimensionInputValue(entry?.B),
  H: toDimensionInputValue(entry?.H),
  weight: toDimensionInputValue(weightKey ? entry?.[weightKey] : ""),
});

export const hasMeaningfulMeasuredSize = (entry = {}) =>
  String(entry?.L || "").trim() !== "" ||
  String(entry?.B || "").trim() !== "" ||
  String(entry?.H || "").trim() !== "" ||
  String(entry?.weight || "").trim() !== "" ||
  String(entry?.remark || "").trim() !== "";

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
  const normalizedPrimaryEntries = Array.isArray(primaryEntries)
    ? primaryEntries
        .map((entry) => toMeasuredSizeEntryValue(entry, weightKey))
        .filter((entry) => hasMeaningfulMeasuredSize(entry))
        .slice(0, SIZE_ENTRY_LIMIT)
    : [];
  if (normalizedPrimaryEntries.length > 0) {
    return normalizedPrimaryEntries;
  }

  const topEntry = toMeasuredSizeEntryValue(
    { ...topLbh, remark: topRemark, [weightKey]: topWeight },
    weightKey,
  );
  const bottomEntry = toMeasuredSizeEntryValue(
    { ...bottomLbh, remark: bottomRemark, [weightKey]: bottomWeight },
    weightKey,
  );
  if (hasMeaningfulMeasuredSize(topEntry) || hasMeaningfulMeasuredSize(bottomEntry)) {
    return [topEntry, bottomEntry].filter((entry) => hasMeaningfulMeasuredSize(entry));
  }

  const singleEntry = toMeasuredSizeEntryValue(
    { ...singleLbh, [weightKey]: totalWeight },
    weightKey,
  );
  return hasMeaningfulMeasuredSize(singleEntry) ? [singleEntry] : [createEmptyMeasuredSizeEntry()];
};

export const getRemarkLabel = (options = [], remark = "") =>
  options.find((option) => option.value === remark)?.label || remark;

export const parseMeasuredSizeEntries = ({
  entries = [],
  count = 1,
  groupLabel = "Sizes",
  remarkOptions = [],
  payloadWeightKey = "",
  weightFieldLabel = "Weight",
} = {}) => {
  const safeCount = normalizeSizeCount(count, 1);
  const scopedEntries = ensureMeasuredSizeEntryCount(entries, safeCount).slice(0, safeCount);
  const hasMeaningfulInput = scopedEntries.some((entry) => hasMeaningfulMeasuredSize(entry));

  if (!hasMeaningfulInput) {
    return {
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
    if (safeCount > 1) {
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

    parsedEntries.push(parsedEntry);
  }

  return {
    count: safeCount,
    hasAnyInput: true,
    value: parsedEntries,
  };
};

export const calculateMeasuredSizeEntriesCbm = (entries = [], count = 1) => {
  const safeCount = normalizeSizeCount(count, 1);
  const scopedEntries = ensureMeasuredSizeEntryCount(entries, safeCount).slice(0, safeCount);
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

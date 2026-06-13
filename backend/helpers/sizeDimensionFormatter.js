const DEFAULT_TOLERANCE = 1;
const SIZE_AXES = Object.freeze(["L", "B", "H"]);

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasNumericDimensions = (entry = {}) =>
  SIZE_AXES.every((axis) => toFiniteNumber(entry?.[axis]) !== null);

const hasPositiveReferenceDimensions = (entry = {}) =>
  SIZE_AXES.every((axis) => {
    const value = toFiniteNumber(entry?.[axis]);
    return value !== null && value > 0;
  });

const getEntryBoxType = (entry = {}) =>
  String(entry?.box_type || "").trim().toLowerCase();

const toPlainEntry = (entry = {}) =>
  entry && typeof entry.toObject === "function"
    ? entry.toObject({ depopulate: true })
    : { ...(entry || {}) };

const hasReferenceSizeArray = (entries = []) =>
  (Array.isArray(entries) ? entries : []).some((entry) =>
    hasPositiveReferenceDimensions(entry),
  );

const valuesMatchWithinTolerance = (left, right, tolerance = DEFAULT_TOLERANCE) => {
  const leftNumber = toFiniteNumber(left);
  const rightNumber = toFiniteNumber(right);
  if (leftNumber === null || rightNumber === null) return false;
  return Math.abs(leftNumber - rightNumber) <= tolerance;
};

const formatSizeEntryToReference = (
  incomingEntry = {},
  referenceEntry = {},
  { tolerance = DEFAULT_TOLERANCE } = {},
) => {
  if (
    !incomingEntry ||
    typeof incomingEntry !== "object" ||
    !referenceEntry ||
    typeof referenceEntry !== "object" ||
    !hasNumericDimensions(incomingEntry) ||
    !hasPositiveReferenceDimensions(referenceEntry)
  ) {
    return incomingEntry;
  }

  const usedIncomingAxes = new Set();
  const outputValues = {};

  SIZE_AXES.forEach((targetAxis) => {
    const referenceValue = referenceEntry[targetAxis];
    const matchedAxis = SIZE_AXES.find((incomingAxis) =>
      !usedIncomingAxes.has(incomingAxis) &&
      valuesMatchWithinTolerance(
        incomingEntry[incomingAxis],
        referenceValue,
        tolerance,
      ),
    );

    if (!matchedAxis) return;
    outputValues[targetAxis] = incomingEntry[matchedAxis];
    usedIncomingAxes.add(matchedAxis);
  });

  const remainingIncomingAxes = SIZE_AXES.filter((axis) => !usedIncomingAxes.has(axis));
  const remainingTargetAxes = SIZE_AXES.filter((axis) =>
    !Object.prototype.hasOwnProperty.call(outputValues, axis),
  );

  remainingTargetAxes.forEach((targetAxis, index) => {
    const sourceAxis = remainingIncomingAxes[index];
    if (!sourceAxis) return;
    outputValues[targetAxis] = incomingEntry[sourceAxis];
  });

  return {
    ...toPlainEntry(incomingEntry),
    ...outputValues,
  };
};

const findReferenceEntryForIncoming = ({
  incomingEntry = {},
  incomingIndex = 0,
  referenceEntries = [],
  type = "item",
} = {}) => {
  const references = Array.isArray(referenceEntries) ? referenceEntries : [];
  if (type === "box") {
    const incomingBoxType = getEntryBoxType(incomingEntry);
    if (incomingBoxType) {
      const matchedByType = references.find(
        (referenceEntry) =>
          getEntryBoxType(referenceEntry) === incomingBoxType &&
          hasPositiveReferenceDimensions(referenceEntry),
      );
      if (matchedByType) return matchedByType;
    }
  }

  const referenceByIndex = references[incomingIndex];
  return hasPositiveReferenceDimensions(referenceByIndex)
    ? referenceByIndex
    : null;
};

const formatSizeArrayToReference = (
  incomingArray = [],
  referenceArray = [],
  { type = "item", tolerance = DEFAULT_TOLERANCE } = {},
) => {
  if (!Array.isArray(incomingArray) || !Array.isArray(referenceArray)) {
    return incomingArray;
  }
  if (!hasReferenceSizeArray(referenceArray)) {
    return incomingArray;
  }

  return incomingArray.map((incomingEntry, incomingIndex) => {
    const referenceEntry = findReferenceEntryForIncoming({
      incomingEntry,
      incomingIndex,
      referenceEntries: referenceArray,
      type,
    });
    return referenceEntry
      ? formatSizeEntryToReference(incomingEntry, referenceEntry, { tolerance })
      : incomingEntry;
  });
};

const pickReferenceSizeArray = (itemDoc = {}, type = "item") => {
  const masterKey = type === "box" ? "master_box_sizes" : "master_item_sizes";
  const pisKey = type === "box" ? "pis_box_sizes" : "pis_item_sizes";

  if (hasReferenceSizeArray(itemDoc?.[masterKey])) {
    return itemDoc[masterKey];
  }
  if (hasReferenceSizeArray(itemDoc?.[pisKey])) {
    return itemDoc[pisKey];
  }
  return [];
};

module.exports = {
  DEFAULT_TOLERANCE,
  SIZE_AXES,
  formatSizeArrayToReference,
  formatSizeEntryToReference,
  hasReferenceSizeArray,
  pickReferenceSizeArray,
};

const NUMBER_TOLERANCE = 0.001;
const ITEM_SIZE_DIMENSION_VARIANCE_CM = 0.5;
const BOX_SIZE_DIMENSION_VARIANCE_CM = 1;
const WEIGHT_VARIANCE_PERCENT = 10;

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasComparableNumber = (value, tolerance = NUMBER_TOLERANCE) =>
  Math.abs(toFiniteNumber(value)) > tolerance;

const compareDimensionVariance = (
  inspectedValue,
  referenceValue,
  thresholdCm,
) => {
  const inspected = toFiniteNumber(inspectedValue);
  const reference = toFiniteNumber(referenceValue);
  const hasInspected = hasComparableNumber(inspected);
  const hasReference = hasComparableNumber(reference);
  const comparable = hasInspected && hasReference;
  const delta = inspected - reference;

  return {
    comparable,
    mismatch: comparable && Math.abs(delta) > thresholdCm,
    hasInspected,
    hasReference,
    inspected,
    reference,
    delta,
  };
};

const compareItemSizeDimensionVariance = (inspectedValue, referenceValue) =>
  compareDimensionVariance(
    inspectedValue,
    referenceValue,
    ITEM_SIZE_DIMENSION_VARIANCE_CM,
  );

const compareBoxSizeDimensionVariance = (inspectedValue, referenceValue) =>
  compareDimensionVariance(
    inspectedValue,
    referenceValue,
    BOX_SIZE_DIMENSION_VARIANCE_CM,
  );

const compareWeightVariance = (inspectedValue, referenceValue) => {
  const inspected = toFiniteNumber(inspectedValue);
  const reference = toFiniteNumber(referenceValue);
  const hasInspected = hasComparableNumber(inspected);
  const hasReference = hasComparableNumber(reference);
  const comparable = hasInspected && hasReference;
  const delta = inspected - reference;
  const variance_percent = comparable
    ? (Math.abs(delta) / Math.abs(reference)) * 100
    : 0;

  return {
    comparable,
    mismatch: comparable && variance_percent > WEIGHT_VARIANCE_PERCENT,
    hasInspected,
    hasReference,
    inspected,
    reference,
    delta,
    variance_percent,
  };
};

module.exports = {
  BOX_SIZE_DIMENSION_VARIANCE_CM,
  ITEM_SIZE_DIMENSION_VARIANCE_CM,
  NUMBER_TOLERANCE,
  WEIGHT_VARIANCE_PERCENT,
  compareBoxSizeDimensionVariance,
  compareItemSizeDimensionVariance,
  compareWeightVariance,
  hasComparableNumber,
  toFiniteNumber,
};

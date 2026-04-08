const DEFAULT_MEASUREMENT_PRECISION = 2;

export const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const roundToFixedNumber = (
  value,
  precision = DEFAULT_MEASUREMENT_PRECISION,
  fallback = 0,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number(parsed.toFixed(precision));
};

export const formatFixedNumber = (
  value,
  fallback = "0.00",
  precision = DEFAULT_MEASUREMENT_PRECISION,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return roundToFixedNumber(parsed, precision, 0).toFixed(precision);
};

export const formatPositiveFixedNumber = (
  value,
  fallback = "Not Set",
  precision = DEFAULT_MEASUREMENT_PRECISION,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return roundToFixedNumber(parsed, precision, 0).toFixed(precision);
};

export const formatNumberInputValue = (
  value,
  { precision = DEFAULT_MEASUREMENT_PRECISION, allowZero = false } = {},
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  if (allowZero ? parsed < 0 : parsed <= 0) return "";
  return roundToFixedNumber(parsed, precision, 0).toFixed(precision);
};

export const formatLbhValue = (
  value,
  { fallback = "Not Set", suffix = "" } = {},
) => {
  const length = toFiniteNumber(value?.L, 0);
  const breadth = toFiniteNumber(value?.B, 0);
  const height = toFiniteNumber(value?.H, 0);

  if (length <= 0 && breadth <= 0 && height <= 0) {
    return fallback;
  }

  const formatted = [
    formatFixedNumber(length),
    formatFixedNumber(breadth),
    formatFixedNumber(height),
  ].join(" x ");

  return suffix ? `${formatted} ${suffix}` : formatted;
};

export const formatWeightValue = (
  value,
  { fallback = "Not Set", suffix = "" } = {},
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const formatted = formatFixedNumber(parsed);
  return suffix ? `${formatted} ${suffix}` : formatted;
};

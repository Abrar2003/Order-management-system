import { formatFixedNumber, formatPositiveFixedNumber } from "./measurementDisplay";

export const formatCbm = (value, fallback = "0.00") =>
  formatFixedNumber(value, fallback);

export const formatPositiveCbm = (value, fallback = "Not Set") =>
  formatPositiveFixedNumber(value, fallback);

export const resolvePreferredCbm = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

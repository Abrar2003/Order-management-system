import { formatFixedNumber, formatPositiveFixedNumber } from "./measurementDisplay";

export const formatCbm = (value, fallback = "0.00") =>
  formatFixedNumber(value, fallback);

export const formatPositiveCbm = (value, fallback = "Not Set") =>
  formatPositiveFixedNumber(value, fallback);

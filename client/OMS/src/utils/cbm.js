export const formatCbm = (value, fallback = "0.000") => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed.toFixed(3);
};

export const formatPositiveCbm = (value, fallback = "Not Set") => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed.toFixed(3);
};

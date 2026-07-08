export const getOptionText = (value) => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  return String(
    value.name ||
      value.vendor_name ||
      value.vendorName ||
      value.brand ||
      value.vendor ||
      value.label ||
      value.value ||
      "",
  ).trim();
};

export const normalizeTextOptions = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(getOptionText)
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

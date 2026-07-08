const OPTION_TEXT_KEYS = [
  "name",
  "vendor_name",
  "vendorName",
  "brand",
  "vendor",
  "label",
  "value",
];

export const getOptionText = (value) => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  for (const key of OPTION_TEXT_KEYS) {
    const candidate = value[key];
    if (candidate === value) continue;
    const text = getOptionText(candidate);
    if (text) return text;
  }

  return "";
};

export const normalizeTextOptions = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(getOptionText)
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

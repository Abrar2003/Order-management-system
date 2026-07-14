const OPTION_TEXT_KEYS = [
  "name",
  "vendor_name",
  "vendorName",
  "brand",
  "vendor",
  "label",
  "value",
];

const INVALID_OPTION_TEXT_VALUES = new Set([
  "[object Object]",
  "undefined",
  "null",
]);

const normalizeOptionText = (value) => {
  const text = String(value ?? "").trim();
  return INVALID_OPTION_TEXT_VALUES.has(text) ? "" : text;
};

export const getOptionText = (value) => {
  if (typeof value === "string" || typeof value === "number") {
    return normalizeOptionText(value);
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

export const filterVendorOptionsByBrandIds = (
  vendorOptions = [],
  selectedBrandIds = [],
  allBrands = true,
) => {
  const options = Array.isArray(vendorOptions) ? vendorOptions : [];
  if (allBrands) return options;

  const selected = new Set(
    (Array.isArray(selectedBrandIds) ? selectedBrandIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  if (selected.size === 0) return [];

  return options.filter((vendor) =>
    (Array.isArray(vendor?.brand_ids) ? vendor.brand_ids : [])
      .some((brandId) => selected.has(String(brandId))),
  );
};

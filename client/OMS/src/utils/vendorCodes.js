export const emptyVendorCode = { brand: "", code: "" };

const normalizeText = (value) => String(value ?? "").trim();

export const normalizeVendorCodeRows = (value = []) => {
  if (typeof value === "string") {
    const code = normalizeText(value);
    return code ? [{ brand: "", code }] : [{ ...emptyVendorCode }];
  }

  const rows = (Array.isArray(value) ? value : [])
    .map((entry = {}) => {
      if (typeof entry === "string") {
        return { brand: "", code: normalizeText(entry) };
      }

      return {
        brand: normalizeText(entry?.brand || entry?.brand_name || entry?.brandName),
        code: normalizeText(entry?.code || entry?.vendor_code || entry?.vendorCode),
      };
    })
    .filter((entry) => entry.brand || entry.code);

  return rows.length > 0 ? rows : [{ ...emptyVendorCode }];
};

export const getCompleteVendorCodes = (value = []) =>
  normalizeVendorCodeRows(value)
    .map((entry) => ({
      brand: normalizeText(entry.brand),
      code: normalizeText(entry.code),
    }))
    .filter((entry) => entry.brand && entry.code);

export const hasIncompleteVendorCodeRows = (value = []) =>
  normalizeVendorCodeRows(value).some((entry) => {
    const brand = normalizeText(entry.brand);
    const code = normalizeText(entry.code);
    return Boolean((brand || code) && !(brand && code));
  });

export const hasDuplicateVendorCodeRows = (value = []) => {
  const seen = new Set();
  for (const entry of getCompleteVendorCodes(value)) {
    const key = `${entry.brand.toLowerCase()}\u0000${entry.code.toLowerCase()}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
};

export const formatVendorCodes = (value = []) => {
  const entries = getCompleteVendorCodes(value);
  if (entries.length === 0) {
    const partialRows = normalizeVendorCodeRows(value)
      .map((entry) => normalizeText(entry.code || entry.brand))
      .filter(Boolean);
    return partialRows.join("; ");
  }

  return entries.map((entry) => `${entry.brand}: ${entry.code}`).join("; ");
};

export const getVendorCodeSearchValues = (value = []) =>
  normalizeVendorCodeRows(value).flatMap((entry) => [
    entry.brand,
    entry.code,
    entry.brand && entry.code ? `${entry.brand}: ${entry.code}` : "",
  ]);

export const normalizeBrandOptions = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeText)
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

export const getAvailableBrandOptions = (brandOptions = [], selectedBrand = "") =>
  normalizeBrandOptions([...brandOptions, selectedBrand]);

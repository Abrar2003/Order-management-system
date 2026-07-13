const { buildEmbeddedVendor } = require("./vendorRef");

const normalizeRectifyText = (value) => {
  const text = String(value ?? "").trim();
  const invalid = new Set(["[object Object]", "undefined", "null", "N/A"]);
  return invalid.has(text) ? "" : text;
};

const processRectifyRows = ({ rows, existingCodesSet, vendor, brand }) => {
  const invalid = [];
  const conflicting = [];
  const duplicates = [];
  const existing = [];
  const toCreate = [];

  const codeMap = new Map(); // upperCode -> { code, description, hasConflict: false }

  for (const row of rows) {
    const rawCode = row.ourItemCode || row.yourItemCode || "";
    const code = normalizeRectifyText(rawCode);
    const description = normalizeRectifyText(row.description || "");

    if (!code || !description) {
      invalid.push({
        row,
        reason: !code ? "Missing item code" : "Missing description",
      });
      continue;
    }

    const upperCode = code.toUpperCase();
    if (codeMap.has(upperCode)) {
      const existingEntry = codeMap.get(upperCode);
      if (existingEntry.description.toLowerCase() !== description.toLowerCase()) {
        existingEntry.hasConflict = true;
        conflicting.push({
          code,
          description1: existingEntry.description,
          description2: description,
        });
      } else {
        duplicates.push({ code, description });
      }
    } else {
      codeMap.set(upperCode, { code, description, hasConflict: false });
    }
  }

  for (const [upperCode, entry] of codeMap.entries()) {
    if (entry.hasConflict) {
      continue;
    }

    if (existingCodesSet.has(upperCode)) {
      existing.push({ code: entry.code });
      continue;
    }

    const embeddedVendor = buildEmbeddedVendor(vendor);

    toCreate.push({
      code: entry.code,
      name: entry.description,
      description: entry.description,
      brand: brand.name,
      brand_name: brand.name,
      brands: [brand.name],
      vendors: embeddedVendor ? [embeddedVendor] : [],
      country_of_origin: vendor.country || "India",
      is_rectify_imported: true,
    });
  }

  return {
    invalid,
    conflicting,
    duplicates,
    existing,
    toCreate,
  };
};

module.exports = {
  normalizeRectifyText,
  processRectifyRows,
};

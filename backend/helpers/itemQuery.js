const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const { buildVendorsArrayFilter } = require("./vendorRef");
const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeFilterValue = (value) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return null;
  }
  return normalized;
};

const BARCODE_SEARCH_FIELDS = [
  "pis_barcode",
  "pis_master_barcode",
  "pis_inner_barcode",
  "pis_logistics_ean",
  "pis_logistics_eans",
  "inspected_logistics_ean",
  "inspected_logistics_eans",
  "master_barcode",
  "master_master_barcode",
  "master_inner_barcode",
  "pd_barcode",
  "pd_master_barcode",
  "pd_inner_barcode",
  "qc.barcode",
  "qc.master_barcode",
  "qc.inner_barcode",
];

const buildBarcodeSearchConditions = (escapedSearch) =>
  BARCODE_SEARCH_FIELDS.map((field) => ({
    [field]: { $regex: escapedSearch, $options: "i" },
  }));

const buildItemMatch = ({ search, brand, vendor, country } = {}) => {
  const conditions = [];
  const normalizedSearch = normalizeFilterValue(search);
  const normalizedBrand = normalizeFilterValue(brand);
  const normalizedVendor = normalizeFilterValue(vendor);
  const normalizedCountry = normalizeFilterValue(country);

  if (normalizedSearch) {
    const escaped = escapeRegex(normalizedSearch);
    conditions.push({
      $or: [
        { code: { $regex: escaped, $options: "i" } },
        { name: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { brand: { $regex: escaped, $options: "i" } },
        { brand_name: { $regex: escaped, $options: "i" } },
        ...buildBarcodeSearchConditions(escaped),
      ],
    });
  }

  if (normalizedBrand) {
    conditions.push({
      $or: [
        { brand: normalizedBrand },
        { brands: normalizedBrand },
        { brand_name: normalizedBrand },
      ],
    });
  }

  if (normalizedVendor) {
    conditions.push(buildVendorsArrayFilter({ field: "vendors", vendorId: normalizedVendor, vendorName: normalizedVendor }));
  }

  if (normalizedCountry) {
    conditions.push({
      country_of_origin: {
        $regex: `^${escapeRegex(normalizedCountry)}$`,
        $options: "i",
      },
    });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
};

const ITEM_DATA_ACCESS_FIELDS = {
  brandFields: ["brand", "brand_name", "brands"],
  vendorFields: ["vendors"],
};

const applyItemDataAccess = (match = {}, user = {}) =>
  applyDataAccessMatch(match, user, ITEM_DATA_ACCESS_FIELDS);


module.exports = { buildItemMatch, buildBarcodeSearchConditions, applyItemDataAccess, escapeRegex };

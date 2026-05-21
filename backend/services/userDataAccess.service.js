const mongoose = require("mongoose");
const Brand = require("../models/brand.model");

const ALL_VENDOR_TOKEN = "all";

const normalizeText = (value = "") => String(value || "").trim();

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
};

const normalizeObjectIdList = (value) => {
  const seen = new Set();
  const result = [];

  for (const entry of toArray(value)) {
    const raw = normalizeText(
      typeof entry === "object" && entry !== null
        ? entry?._id || entry?.id || ""
        : entry,
    );
    if (!raw || !mongoose.Types.ObjectId.isValid(raw)) continue;
    const id = String(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
};

const normalizeVendorList = (value, { defaultAll = true } = {}) => {
  const seen = new Set();
  const result = [];

  for (const entry of toArray(value)) {
    const vendor = normalizeText(entry);
    if (!vendor) continue;
    const key = vendor.toLowerCase();
    if (key === ALL_VENDOR_TOKEN) {
      return [ALL_VENDOR_TOKEN];
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(vendor);
  }

  return result.length > 0 ? result : defaultAll ? [ALL_VENDOR_TOKEN] : [];
};

const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "on"].includes(
    normalizeText(value).toLowerCase(),
  );
};

const getBrandIdsFromPayload = (payload = {}) =>
  normalizeObjectIdList(
    payload.allowed_brand_ids ??
      payload.allowedBrandIds ??
      payload.allowed_brands ??
      payload.allowedBrands,
  );

const getVendorNamesFromPayload = (payload = {}) =>
  normalizeVendorList(
    payload.allowed_vendors ??
      payload.allowedVendors ??
      payload.allowed_vendor_names ??
      payload.allowedVendorNames,
    { defaultAll: false },
  );

const buildUserAccessUpdate = (payload = {}) => {
  const brandIds = getBrandIdsFromPayload(payload);
  const vendorNames = getVendorNamesFromPayload(payload);
  const hasBrandAllFlag =
    payload.all_brands !== undefined || payload.allBrands !== undefined;
  const hasVendorAllFlag =
    payload.all_vendors !== undefined || payload.allVendors !== undefined;
  const allBrands = hasBrandAllFlag
    ? parseBoolean(payload.all_brands ?? payload.allBrands)
    : brandIds.length === 0;
  const allVendors = hasVendorAllFlag
    ? parseBoolean(payload.all_vendors ?? payload.allVendors)
    : vendorNames.length === 0 ||
      vendorNames.some((vendor) => vendor.toLowerCase() === ALL_VENDOR_TOKEN);

  if (!allBrands && brandIds.length === 0) {
    const error = new Error("Select at least one brand or keep All brands enabled");
    error.statusCode = 400;
    throw error;
  }

  if (!allVendors && vendorNames.length === 0) {
    const error = new Error("Select at least one vendor or keep All vendors enabled");
    error.statusCode = 400;
    throw error;
  }

  return {
    allowed_brands: allBrands ? [] : brandIds,
    allowed_vendors: allVendors ? [ALL_VENDOR_TOKEN] : vendorNames,
  };
};

const assertBrandIdsExist = async (brandIds = []) => {
  const ids = normalizeObjectIdList(brandIds);
  if (ids.length === 0) return ids;

  const existing = await Brand.find({ _id: { $in: ids } }).select("_id").lean();
  if (existing.length !== ids.length) {
    const found = new Set(existing.map((brand) => String(brand._id)));
    const missing = ids.filter((id) => !found.has(id));
    const error = new Error(`Invalid brand access selection: ${missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  return ids;
};

const isPopulatedBrand = (entry) =>
  entry && typeof entry === "object" && (entry.name || entry._id || entry.id);

const serializeBrandEntry = (entry, brandMap = new Map()) => {
  const id = normalizeText(
    typeof entry === "object" && entry !== null
      ? entry?._id || entry?.id || ""
      : entry,
  );
  if (!id) return null;
  const mapped = brandMap.get(id);
  const name = normalizeText(
    isPopulatedBrand(entry) ? entry.name : mapped?.name,
  );
  return {
    _id: id,
    name,
  };
};

const serializeUserDataAccess = (user = {}, brandMap = new Map()) => {
  const brandEntries = toArray(user.allowed_brands)
    .map((entry) => serializeBrandEntry(entry, brandMap))
    .filter(Boolean);
  const vendorEntries = normalizeVendorList(user.allowed_vendors);
  const allBrands = brandEntries.length === 0;
  const allVendors =
    vendorEntries.length === 0 ||
    vendorEntries.some((vendor) => vendor.toLowerCase() === ALL_VENDOR_TOKEN);

  return {
    all_brands: allBrands,
    allowed_brand_ids: brandEntries.map((brand) => brand._id),
    allowed_brands: brandEntries,
    all_vendors: allVendors,
    allowed_vendors: allVendors ? [ALL_VENDOR_TOKEN] : vendorEntries,
  };
};

module.exports = {
  ALL_VENDOR_TOKEN,
  assertBrandIdsExist,
  buildUserAccessUpdate,
  getBrandIdsFromPayload,
  getVendorNamesFromPayload,
  normalizeObjectIdList,
  normalizeVendorList,
  serializeUserDataAccess,
};

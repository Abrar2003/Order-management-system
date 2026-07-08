const mongoose = require("mongoose");
const Brand = require("../models/brand.model");
const {
  buildVendorAccessCondition,
  getVendorName,
} = require("../helpers/vendorRef");

const ALL_VENDOR_TOKEN = "all";
const BRAND_SCOPE_ALL = "all";
const BRAND_SCOPE_DUTCH = "dutch";
const BRAND_SCOPE_GIGA = "giga";
const GIGA_BRAND_NAME = "Giga";
const GIGA_BRAND_REGEX = new RegExp(`^${GIGA_BRAND_NAME}$`, "i");

const normalizeText = (value = "") => String(value || "").trim();

const normalizeRoleKey = (value = "") =>
  normalizeText(value).toLowerCase().replace(/[\s-]+/g, "_");

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
    const vendor = normalizeText(getVendorName(entry) || entry);
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

const normalizeBrandScope = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === BRAND_SCOPE_GIGA) return BRAND_SCOPE_GIGA;
  if (normalized === BRAND_SCOPE_DUTCH || normalized === "dutch_interior") {
    return BRAND_SCOPE_DUTCH;
  }
  return BRAND_SCOPE_ALL;
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

const getAllowedBrandNames = (user = {}) => {
  const brands = toArray(user.allowed_brands);
  if (brands.length === 0) return null;
  return brands
    .map((entry) => normalizeText(
      typeof entry === "object" && entry !== null ? entry.name : "",
    ))
    .filter(Boolean);
};

const getAllowedVendorNames = (user = {}) => {
  const vendors = normalizeVendorList(user.allowed_vendors);
  if (
    vendors.length === 0 ||
    vendors.some((vendor) => vendor.toLowerCase() === ALL_VENDOR_TOKEN)
  ) {
    return null;
  }
  return vendors;
};

const isQcUser = (user = {}) =>
  normalizeRoleKey(user?.role) === "qc" || user?.isQC === true;

const hasDataAccessFilter = (user = {}) =>
  toArray(user?.allowed_brands).length > 0 || Boolean(getAllowedVendorNames(user));

const getUserBrandScope = (user = {}) => {
  if (isQcUser(user) || hasDataAccessFilter(user)) {
    return BRAND_SCOPE_ALL;
  }
  return normalizeBrandScope(user?.brand_scope ?? user?.brandScope);
};

const combineMongoMatches = (...matches) => {
  const cleaned = matches.filter((match) => (
    match &&
    typeof match === "object" &&
    Object.keys(match).length > 0
  ));

  if (cleaned.length === 0) return {};
  if (cleaned.length === 1) return cleaned[0];
  return { $and: cleaned };
};

const buildFieldAccessCondition = (fields = [], values = []) => {
  const normalizedFields = toArray(fields).map(normalizeText).filter(Boolean);
  const normalizedValues = toArray(values).map(normalizeText).filter(Boolean);
  if (normalizedFields.length === 0 || normalizedValues.length === 0) {
    return { _id: null };
  }

  if (normalizedFields.length === 1) {
    return { [normalizedFields[0]]: { $in: normalizedValues } };
  }

  return {
    $or: normalizedFields.map((field) => ({
      [field]: { $in: normalizedValues },
    })),
  };
};

const buildBrandScopeCondition = (fields = [], brandScope = BRAND_SCOPE_ALL) => {
  const normalizedFields = toArray(fields).map(normalizeText).filter(Boolean);
  const normalizedScope = normalizeBrandScope(brandScope);
  if (normalizedFields.length === 0 || normalizedScope === BRAND_SCOPE_ALL) {
    return {};
  }

  if (normalizedScope === BRAND_SCOPE_GIGA) {
    if (normalizedFields.length === 1) {
      return { [normalizedFields[0]]: GIGA_BRAND_REGEX };
    }
    return {
      $or: normalizedFields.map((field) => ({
        [field]: GIGA_BRAND_REGEX,
      })),
    };
  }

  return {
    $and: normalizedFields.map((field) => ({
      [field]: { $not: GIGA_BRAND_REGEX },
    })),
  };
};

const buildDataAccessMatch = (
  user = {},
  {
    brandFields = ["brand"],
    vendorFields = ["vendor"],
  } = {},
) => {
  const allowedBrands = getAllowedBrandNames(user);
  const allowedVendors = getAllowedVendorNames(user);
  const brandScope = getUserBrandScope(user);
  const conditions = [];

  if (allowedBrands) {
    conditions.push(buildFieldAccessCondition(brandFields, allowedBrands));
  }
  if (brandScope !== BRAND_SCOPE_ALL) {
    conditions.push(buildBrandScopeCondition(brandFields, brandScope));
  }
  if (allowedVendors) {
    conditions.push(buildVendorAccessCondition(vendorFields, allowedVendors));
  }

  return combineMongoMatches(...conditions);
};

const applyDataAccessMatch = (match = {}, user = {}, options = {}) =>
  combineMongoMatches(match, buildDataAccessMatch(user, options));

const buildBrandDocumentAccessMatch = (user = {}) => {
  const allowedBrandIds = normalizeObjectIdList(user?.allowed_brands);
  const brandScope = getUserBrandScope(user);
  const conditions = [];

  if (allowedBrandIds.length > 0) {
    conditions.push({ _id: { $in: allowedBrandIds } });
  }
  if (brandScope !== BRAND_SCOPE_ALL) {
    conditions.push(buildBrandScopeCondition(["name"], brandScope));
  }

  return combineMongoMatches(...conditions);
};

const applyBrandDocumentAccessMatch = (match = {}, user = {}) =>
  combineMongoMatches(match, buildBrandDocumentAccessMatch(user));

module.exports = {
  ALL_VENDOR_TOKEN,
  BRAND_SCOPE_ALL,
  BRAND_SCOPE_DUTCH,
  BRAND_SCOPE_GIGA,
  applyDataAccessMatch,
  applyBrandDocumentAccessMatch,
  assertBrandIdsExist,
  buildBrandDocumentAccessMatch,
  buildDataAccessMatch,
  buildBrandScopeCondition,
  buildUserAccessUpdate,
  combineMongoMatches,
  getBrandIdsFromPayload,
  getAllowedBrandNames,
  getAllowedVendorNames,
  getUserBrandScope,
  hasDataAccessFilter,
  isQcUser,
  normalizeBrandScope,
  getVendorNamesFromPayload,
  normalizeObjectIdList,
  normalizeVendorList,
  serializeUserDataAccess,
};

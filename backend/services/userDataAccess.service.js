const mongoose = require("mongoose");
const Brand = require("../models/brand.model");
const Order = require("../models/order.model");
const Vendor = require("../models/vendor.model");
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

const getVendorAccessOptions = async ({ user = null } = {}) => {
  const [brands, vendors, orderPairs] = await Promise.all([
    Brand.find({}).select("_id name").lean(),
    Vendor.find({
      $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
    })
      .select("_id name vendor_code brands is_active")
      .lean(),
    Order.aggregate([
      {
        $project: {
          brand: { $trim: { input: { $ifNull: ["$brand", ""] } } },
          vendor_id: {
            $convert: {
              input: "$vendor.vendor_id",
              to: "string",
              onError: "",
              onNull: "",
            },
          },
          vendor_name: {
            $trim: {
              input: {
                $cond: [
                  { $eq: [{ $type: "$vendor" }, "string"] },
                  "$vendor",
                  { $ifNull: ["$vendor.name", ""] },
                ],
              },
            },
          },
        },
      },
      { $match: { brand: { $ne: "" }, vendor_name: { $ne: "" } } },
      { $group: { _id: { brand: "$brand", vendor_id: "$vendor_id", vendor_name: "$vendor_name" } } },
    ]),
  ]);

  const brandById = new Map();
  const brandByName = new Map();
  for (const brand of brands) {
    const id = normalizeText(brand?._id);
    const name = normalizeText(brand?.name);
    if (!id || !name) continue;
    const entry = { _id: id, name };
    brandById.set(id, entry);
    brandByName.set(name.toLowerCase(), entry);
  }

  const options = vendors.map((vendor) => ({
    _id: normalizeText(vendor?._id),
    name: normalizeText(vendor?.name),
    vendor_code: Array.isArray(vendor?.vendor_code) ? vendor.vendor_code : [],
    is_active: vendor?.is_active !== false,
    brandMap: new Map(),
  }));
  const optionById = new Map(options.map((option) => [option._id, option]));
  const optionByName = new Map(
    options
      .filter((option) => option.name)
      .map((option) => [option.name.toLowerCase(), option]),
  );

  const addBrand = (option, brandId = "", brandName = "") => {
    if (!option) return;
    const brand = brandById.get(normalizeText(brandId))
      || brandByName.get(normalizeText(brandName).toLowerCase());
    if (brand) option.brandMap.set(brand._id, brand);
  };

  vendors.forEach((vendor, index) => {
    const option = options[index];
    for (const entry of Array.isArray(vendor?.brands) ? vendor.brands : []) {
      addBrand(option, entry?.brand_id, entry?.brand_name);
    }
    for (const entry of Array.isArray(vendor?.vendor_code) ? vendor.vendor_code : []) {
      if (entry && typeof entry === "object") {
        addBrand(option, "", entry?.brand || entry?.brand_name);
      }
    }
  });

  for (const pair of orderPairs) {
    const vendorId = normalizeText(pair?._id?.vendor_id);
    const vendorName = normalizeText(pair?._id?.vendor_name);
    const option = optionById.get(vendorId) || optionByName.get(vendorName.toLowerCase());
    addBrand(option, "", pair?._id?.brand);
  }

  const allowedBrands = user ? getAllowedBrandNames(user) : null;
  const allowedVendors = user ? getAllowedVendorNames(user) : null;
  const brandScope = user ? getUserBrandScope(user) : BRAND_SCOPE_ALL;
  const allowedBrandKeys = new Set((allowedBrands || []).map((name) => name.toLowerCase()));
  const allowedVendorKeys = new Set((allowedVendors || []).map((name) => name.toLowerCase()));

  return options
    .map((option) => {
      const associatedBrands = [...option.brandMap.values()]
        .filter((brand) => {
          if (allowedBrandKeys.size > 0 && !allowedBrandKeys.has(brand.name.toLowerCase())) {
            return false;
          }
          if (brandScope === BRAND_SCOPE_GIGA) return GIGA_BRAND_REGEX.test(brand.name);
          if (brandScope === BRAND_SCOPE_DUTCH) return !GIGA_BRAND_REGEX.test(brand.name);
          return true;
        })
        .sort((left, right) => left.name.localeCompare(right.name));
      return {
        _id: option._id,
        name: option.name,
        vendor_code: option.vendor_code,
        is_active: option.is_active,
        brand_ids: associatedBrands.map((brand) => brand._id),
        brands: associatedBrands.map((brand) => brand.name),
      };
    })
    .filter((option) => {
      if (!option._id || !option.name) return false;
      if (allowedVendorKeys.size > 0 && !allowedVendorKeys.has(option.name.toLowerCase())) {
        return false;
      }
      if (
        (allowedBrandKeys.size > 0 || brandScope !== BRAND_SCOPE_ALL)
        && option.brands.length === 0
      ) {
        return false;
      }
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
};

const assertVendorAccessSelection = async ({ brandIds = [], vendorNames = [] } = {}) => {
  const selectedBrandIds = normalizeObjectIdList(brandIds);
  const selectedVendors = normalizeVendorList(vendorNames, { defaultAll: false });
  if (
    selectedVendors.length === 0
    || selectedVendors.some((vendor) => vendor.toLowerCase() === ALL_VENDOR_TOKEN)
  ) {
    return selectedVendors;
  }

  const options = await getVendorAccessOptions();
  const optionByName = new Map(
    options.map((option) => [option.name.toLowerCase(), option]),
  );

  for (const vendorName of selectedVendors) {
    const option = optionByName.get(vendorName.toLowerCase());
    if (!option) {
      const error = new Error(`Invalid vendor access selection: ${vendorName}`);
      error.statusCode = 400;
      throw error;
    }
    if (
      selectedBrandIds.length > 0
      && !option.brand_ids.some((brandId) => selectedBrandIds.includes(brandId))
    ) {
      const error = new Error(
        `Vendor ${option.name} is not associated with any selected brand`,
      );
      error.statusCode = 400;
      throw error;
    }
  }

  return selectedVendors;
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

const isUserAllowedData = (user = {}, { brands = [], vendors = [] } = {}) => {
  const dataBrands = toArray(brands)
    .map((entry) => normalizeText(
      typeof entry === "object" && entry !== null
        ? entry.name || entry.brand || entry.brand_name
        : entry,
    ).toLowerCase())
    .filter(Boolean);
  const dataVendors = normalizeVendorList(vendors, { defaultAll: false })
    .map((vendor) => vendor.toLowerCase());
  const allowedBrands = getAllowedBrandNames(user);
  const allowedVendors = getAllowedVendorNames(user);
  const brandScope = getUserBrandScope(user);

  if (
    allowedBrands
    && !dataBrands.some((brand) => allowedBrands.some((allowed) => allowed.toLowerCase() === brand))
  ) {
    return false;
  }
  if (brandScope === BRAND_SCOPE_GIGA && !dataBrands.includes(GIGA_BRAND_NAME.toLowerCase())) {
    return false;
  }
  if (
    brandScope === BRAND_SCOPE_DUTCH
    && !dataBrands.some((brand) => brand !== GIGA_BRAND_NAME.toLowerCase())
  ) {
    return false;
  }
  if (
    allowedVendors
    && !dataVendors.some((vendor) =>
      allowedVendors.some((allowed) => allowed.toLowerCase() === vendor))
  ) {
    return false;
  }

  return true;
};

const assertUserDataAccess = (user = {}, data = {}) => {
  if (isUserAllowedData(user, data)) return;
  const error = new Error("You do not have access to the selected brand and vendor");
  error.statusCode = 403;
  throw error;
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
  assertUserDataAccess,
  assertVendorAccessSelection,
  buildBrandDocumentAccessMatch,
  buildDataAccessMatch,
  buildBrandScopeCondition,
  buildUserAccessUpdate,
  combineMongoMatches,
  getBrandIdsFromPayload,
  getAllowedBrandNames,
  getAllowedVendorNames,
  getUserBrandScope,
  getVendorAccessOptions,
  hasDataAccessFilter,
  isUserAllowedData,
  isQcUser,
  normalizeBrandScope,
  getVendorNamesFromPayload,
  normalizeObjectIdList,
  normalizeVendorList,
  serializeUserDataAccess,
};

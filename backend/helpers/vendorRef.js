const mongoose = require("mongoose");

const normalizeVendorName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeText = (value = "") => String(value ?? "").trim();

const embeddedVendorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    country: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false },
);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const getVendorModel = () => require("../models/vendor.model");

const getVendorName = (vendor) => {
  if (typeof vendor === "string") return normalizeText(vendor);
  if (!isObject(vendor)) return "";
  return normalizeText(
    vendor.name ||
      vendor.vendor_name ||
      vendor.vendorName ||
      vendor.label ||
      vendor.value,
  );
};

const getVendorId = (vendor) => {
  if (typeof vendor === "string" && mongoose.Types.ObjectId.isValid(vendor)) {
    return vendor;
  }
  if (!isObject(vendor)) return "";
  const raw = normalizeText(
    vendor.vendor_id ||
      vendor.vendorId ||
      vendor._id ||
      vendor.id ||
      vendor.value,
  );
  return mongoose.Types.ObjectId.isValid(raw) ? raw : "";
};

const getVendorCountry = (vendor) => {
  if (!isObject(vendor)) return "";
  return normalizeText(vendor.country);
};

const isEmbeddedVendor = (value) => {
  if (!isObject(value)) return false;
  const vendorName = getVendorName(value);
  const vendorId = getVendorId(value);
  return Boolean(vendorName) &&
    Boolean(vendorId) &&
    normalizeVendorName(vendorName) !== normalizeVendorName(vendorId);
};

const buildEmbeddedVendor = (vendorDoc, existingCountry = "") => {
  if (!vendorDoc) return null;
  const vendorId = getVendorId(vendorDoc);
  const name = normalizeText(vendorDoc.name);
  if (!vendorId || !name) return null;

  return {
    name,
    vendor_id: new mongoose.Types.ObjectId(vendorId),
    country: normalizeText(existingCountry) || normalizeText(vendorDoc.country),
  };
};

const coerceVendorValueForSchema = (value) => {
  if (!value) return undefined;
  if (isObject(value)) {
    const vendorId = getVendorId(value);
    return {
      name: getVendorName(value),
      ...(vendorId ? { vendor_id: new mongoose.Types.ObjectId(vendorId) } : {}),
      country: getVendorCountry(value),
    };
  }

  const text = normalizeText(value);
  if (!text) return undefined;
  if (mongoose.Types.ObjectId.isValid(text)) {
    return {
      name: "",
      vendor_id: new mongoose.Types.ObjectId(text),
      country: "",
    };
  }
  return {
    name: text,
    country: "",
  };
};

const coerceVendorArrayForSchema = (value) => {
  const rawValues = Array.isArray(value)
    ? value
    : isObject(value)
      ? [value]
    : value === undefined || value === null || value === ""
      ? []
      : String(value)
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);

  return rawValues
    .map(coerceVendorValueForSchema)
    .filter(Boolean);
};

const buildVendorNameRegex = (vendorName = "") => {
  const normalized = normalizeText(vendorName);
  if (!normalized) return null;
  return new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
};

const buildVendorNameMap = (vendorDocs = []) => {
  const map = new Map();
  const duplicates = [];

  for (const vendor of Array.isArray(vendorDocs) ? vendorDocs : []) {
    const key = normalizeVendorName(vendor?.name);
    if (!key) continue;
    if (map.has(key)) {
      duplicates.push({
        normalizedName: key,
        vendors: [map.get(key), vendor].map((entry) => ({
          _id: String(entry?._id || ""),
          name: normalizeText(entry?.name),
          country: normalizeText(entry?.country),
        })),
      });
      continue;
    }
    map.set(key, vendor);
  }

  return { map, duplicates };
};

const findVendorByName = async (name = "") => {
  const normalizedName = normalizeVendorName(name);
  if (!normalizedName) return null;
  const Vendor = getVendorModel();
  const vendors = await Vendor.find({
    $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
  })
    .select("_id name country")
    .lean();
  const { map } = buildVendorNameMap(vendors);
  return map.get(normalizedName) || null;
};

const resolveVendorFromInput = async (input, options = {}) => {
  const existingCountry = normalizeText(options.existingCountry || getVendorCountry(input));
  const vendorId = normalizeText(
    options.vendorId ||
      getVendorId(input) ||
      (typeof input === "string" ? "" : input),
  );
  const Vendor = getVendorModel();

  if (vendorId && mongoose.Types.ObjectId.isValid(vendorId)) {
    const vendorDoc = await Vendor.findOne({
      _id: vendorId,
      $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
    })
      .select("_id name country")
      .lean();
    if (!vendorDoc) {
      throw new Error(`Vendor not found for id ${vendorId}`);
    }
    return buildEmbeddedVendor(vendorDoc, existingCountry);
  }

  const vendorName = getVendorName(input);
  if (!vendorName) return null;
  const vendorDoc = await findVendorByName(vendorName);
  if (!vendorDoc) {
    throw new Error(`Vendor "${vendorName}" was not found in vendor master`);
  }
  return buildEmbeddedVendor(vendorDoc, existingCountry);
};

const resolveVendorsFromInput = async (input, options = {}) => {
  const rawValues = Array.isArray(options.vendorIds)
    ? options.vendorIds
    : Array.isArray(input)
      ? input
      : isObject(input)
        ? [input]
      : input === undefined || input === null || input === ""
        ? []
        : String(input)
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);

  const seen = new Set();
  const result = [];
  for (const entry of rawValues) {
    const resolved = await resolveVendorFromInput(entry);
    if (!resolved) continue;
    const key = String(resolved.vendor_id);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }

  return result;
};

const legacyStringExpr = (field, value) => ({
  $expr: { $eq: [`$${field}`, value] },
});

const legacyArrayStringExpr = (field, value) => ({
  $expr: {
    $in: [
      value,
      {
        $cond: [{ $isArray: `$${field}` }, `$${field}`, []],
      },
    ],
  },
});

const buildVendorFilter = ({ field = "vendor", vendorId, vendorName } = {}) => {
  const normalizedId = normalizeText(vendorId);
  const normalizedName = normalizeText(vendorName);
  const conditions = [];

  if (normalizedId && mongoose.Types.ObjectId.isValid(normalizedId)) {
    conditions.push({ [`${field}.vendor_id`]: new mongoose.Types.ObjectId(normalizedId) });
  }
  if (normalizedName) {
    const nameRegex = buildVendorNameRegex(normalizedName);
    conditions.push({ [`${field}.name`]: nameRegex });
    // TODO: Remove legacy string vendor support after vendor object migration is fully verified in production.
    conditions.push(legacyStringExpr(field, normalizedName));
  }

  if (conditions.length === 0) return {};
  return conditions.length === 1 ? conditions[0] : { $or: conditions };
};

const buildVendorsArrayFilter = ({ field = "vendors", vendorId, vendorName } = {}) => {
  const normalizedId = normalizeText(vendorId);
  const normalizedName = normalizeText(vendorName);
  const conditions = [];

  if (normalizedId && mongoose.Types.ObjectId.isValid(normalizedId)) {
    conditions.push({ [`${field}.vendor_id`]: new mongoose.Types.ObjectId(normalizedId) });
  }
  if (normalizedName) {
    const nameRegex = buildVendorNameRegex(normalizedName);
    conditions.push({ [`${field}.name`]: nameRegex });
    // TODO: Remove legacy string vendor support after vendor object migration is fully verified in production.
    conditions.push(legacyArrayStringExpr(field, normalizedName));
  }

  if (conditions.length === 0) return {};
  return conditions.length === 1 ? conditions[0] : { $or: conditions };
};

const buildVendorAccessCondition = (fields = [], vendors = []) => {
  const normalizedFields = (Array.isArray(fields) ? fields : [fields])
    .map(normalizeText)
    .filter(Boolean);
  const rawVendors = Array.isArray(vendors) ? vendors : [vendors];
  const vendorIds = rawVendors.map(getVendorId).filter(Boolean);
  const vendorNames = rawVendors.map(getVendorName).filter(Boolean);
  const conditions = [];

  for (const field of normalizedFields) {
    for (const vendorId of vendorIds) {
      conditions.push(buildVendorFilter({ field, vendorId }));
      conditions.push(buildVendorsArrayFilter({ field, vendorId }));
    }
    for (const vendorName of vendorNames) {
      conditions.push(buildVendorFilter({ field, vendorName }));
      conditions.push(buildVendorsArrayFilter({ field, vendorName }));
    }
  }

  const cleaned = conditions.filter((condition) => Object.keys(condition).length > 0);
  if (cleaned.length === 0) return { _id: null };
  return cleaned.length === 1 ? cleaned[0] : { $or: cleaned };
};

const vendorToDisplayName = (vendor) => getVendorName(vendor);

const normalizeVendorDisplayList = (vendors = []) =>
  [
    ...new Set(
      (Array.isArray(vendors) ? vendors : [vendors])
        .flatMap((vendor) => (Array.isArray(vendor) ? vendor : [vendor]))
        .map(vendorToDisplayName)
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

const resolveDocumentVendorFields = async (doc, config = {}) => {
  for (const field of config.single || []) {
    const value = doc.get ? doc.get(field) : doc[field];
    if (!value || isEmbeddedVendor(value)) continue;
    const resolved = await resolveVendorFromInput(value);
    if (resolved && doc.set) doc.set(field, resolved);
    else if (resolved) doc[field] = resolved;
  }

  for (const field of config.array || []) {
    const value = doc.get ? doc.get(field) : doc[field];
    if (!Array.isArray(value)) continue;
    if (value.every(isEmbeddedVendor)) continue;
    const resolved = await resolveVendorsFromInput(value);
    if (doc.set) doc.set(field, resolved);
    else doc[field] = resolved;
  }
};

module.exports = {
  buildEmbeddedVendor,
  buildVendorAccessCondition,
  buildVendorFilter,
  coerceVendorArrayForSchema,
  coerceVendorValueForSchema,
  buildVendorNameMap,
  buildVendorsArrayFilter,
  embeddedVendorSchema,
  getVendorCountry,
  getVendorId,
  getVendorName,
  isEmbeddedVendor,
  normalizeVendorDisplayList,
  normalizeVendorName,
  resolveDocumentVendorFields,
  resolveVendorFromInput,
  resolveVendorsFromInput,
  vendorToDisplayName,
};

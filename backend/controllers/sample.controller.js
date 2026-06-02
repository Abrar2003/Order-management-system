const mongoose = require("mongoose");
const Sample = require("../models/sample.model");
const { BOX_PACKAGING_MODES, BOX_ENTRY_TYPES } = require("../helpers/boxMeasurement");
const { calculateTotalPoCbm } = require("../services/orderCbm.service");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const {
  createStorageKey,
  getObjectUrl,
  getSignedObjectUrl,
  isConfigured: isWasabiConfigured,
  uploadBuffer,
} = require("../services/wasabiStorage.service");
const { normalizeUserRoleKey } = require("../helpers/userRole");

const SHIPPED_BY_VENDOR_ID = "shipped_by_vendor";
const SHIPPED_BY_VENDOR_NAME = "Shipped By Vendor";
const SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze(["item", "top", "base", "item1", "item2", "item3"]);
const BOX_SIZE_REMARK_OPTIONS = Object.freeze(["top", "base", "box", "box1", "box2", "box3"]);
const BOX_CARTON_REMARK_OPTIONS = Object.freeze(["inner", "master"]);
const SAMPLE_FILE_TYPES = Object.freeze([
  "initial_sketch",
  "cad",
  "sample_image",
  "inspection",
  "vendor",
  "other",
]);
const SAMPLE_MUTATION_ROLES = new Set([
  "admin",
  "super_admin",
  "inspection_manager",
  "product_manager",
]);
const STATUS_DATE_FIELD = Object.freeze({
  cad_ready: "cad_completed_at",
  sent_to_client: "sent_to_client_at",
  client_approved: "client_approved_at",
  sent_to_vendor: "sent_to_vendor_at",
  manufacturing: "expected_manufacturing_date",
  inspection_requested: "inspection_requested_at",
  inspected: "inspected_at",
  shipping_planned: "estimated_shipping_date",
  shipped: "shipped_at",
});

const escapeRegex = (value = "") =>
  String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeText = (value) => String(value ?? "").trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const toNonNegativeNumber = (value, fieldLabel) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel} must be a non-negative number`);
  }
  return parsed;
};
const isPositiveNumericInput = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0;
};
const normalizeFilterValue = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (["all", "null", "undefined"].includes(lowered)) return null;
  return normalized;
};
const parseDate = (value, label = "date") => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed;
};
const parseDateBoundary = (value, endOfDay = false) => {
  const parsed = parseDate(value, "date");
  if (!parsed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value))) {
    parsed.setUTCHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  }
  return parsed;
};
const parseJsonBodyField = (value, label, fallback = []) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
};
const normalizeDistinctValues = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => normalizeText(value))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

const buildAuditActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name: normalizeText(user?.name || user?.email || user?.role || ""),
});

const canMutateSamples = (user = {}) =>
  SAMPLE_MUTATION_ROLES.has(normalizeUserRoleKey(user?.role));

const ensureSampleMutationAccess = (req, res) => {
  if (canMutateSamples(req.user)) return true;
  res.status(403).json({
    success: false,
    message: "Sample workflow updates are restricted to admin, super admin, inspection manager, and product manager users.",
  });
  return false;
};

const validateEnum = (value, allowed = [], label = "value", fallback = "") => {
  const normalized = normalizeLower(value || fallback);
  if (!normalized) return fallback;
  if (!allowed.includes(normalized)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
};

const validateRemarkOption = (remark = "", options = [], fieldLabel = "Remark") => {
  if (!remark) return;
  if (!options.includes(remark)) {
    throw new Error(`${fieldLabel} must be one of: ${options.join(", ")}`);
  }
};

const normalizeVendorList = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => normalizeText(entry)).filter(Boolean))];
  }
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return [...new Set(normalized.split(",").map((entry) => normalizeText(entry)).filter(Boolean))];
};

const normalizeShipmentInvoiceNumber = (value, fallback = "") => {
  const normalized = normalizeText(value);
  return normalized || normalizeText(fallback);
};

const normalizeShipmentStuffedBy = (input = {}) => {
  const id = normalizeText(input?.id || input?._id);
  const name = normalizeText(input?.name);
  if (id === SHIPPED_BY_VENDOR_ID || name.toLowerCase() === SHIPPED_BY_VENDOR_NAME.toLowerCase()) {
    return { id: null, name: SHIPPED_BY_VENDOR_NAME };
  }
  if (!id && !name) throw new Error("stuffed_by is required");
  return { id: id || null, name: name || id };
};

const isBlankItemSizeEntry = (entry = {}) =>
  !isPositiveNumericInput(entry?.L) &&
  !isPositiveNumericInput(entry?.B) &&
  !isPositiveNumericInput(entry?.H) &&
  !isPositiveNumericInput(entry?.net_weight) &&
  !isPositiveNumericInput(entry?.gross_weight) &&
  !normalizeText(entry?.remark);

const isBlankBoxSizeEntry = (entry = {}, boxMode = BOX_PACKAGING_MODES.INDIVIDUAL) =>
  !isPositiveNumericInput(entry?.L) &&
  !isPositiveNumericInput(entry?.B) &&
  !isPositiveNumericInput(entry?.H) &&
  !isPositiveNumericInput(entry?.net_weight) &&
  !isPositiveNumericInput(entry?.gross_weight) &&
  (boxMode === BOX_PACKAGING_MODES.CARTON ? true : !normalizeText(entry?.remark)) &&
  !isPositiveNumericInput(entry?.item_count_in_inner) &&
  !isPositiveNumericInput(entry?.box_count_in_master);

const normalizeItemSizeEntries = (entries = []) => {
  if (!Array.isArray(entries)) throw new Error("item_sizes must be an array");
  const normalizedEntries = entries.filter((entry) => !isBlankItemSizeEntry(entry));
  if (normalizedEntries.length > SIZE_ENTRY_LIMIT) {
    throw new Error(`item_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`);
  }
  const seenRemarks = new Set();
  return normalizedEntries.map((entry, index) => {
    const label = `item_sizes[${index + 1}]`;
    const L = toNonNegativeNumber(entry?.L ?? 0, `${label}.L`);
    const B = toNonNegativeNumber(entry?.B ?? 0, `${label}.B`);
    const H = toNonNegativeNumber(entry?.H ?? 0, `${label}.H`);
    const netWeight = toNonNegativeNumber(entry?.net_weight ?? entry?.weight ?? 0, `${label}.net_weight`);
    const grossWeight = toNonNegativeNumber(entry?.gross_weight ?? 0, `${label}.gross_weight`);
    const remark = normalizeLower(entry?.remark) || (normalizedEntries.length === 1 ? "item" : "");
    if ((L > 0 || B > 0 || H > 0) && (!L || !B || !H)) {
      throw new Error(`${label} must include positive L, B, and H values`);
    }
    if (normalizedEntries.length > 1) {
      if (!remark) throw new Error(`${label}.remark is required`);
      validateRemarkOption(remark, ITEM_SIZE_REMARK_OPTIONS, `${label}.remark`);
      if (seenRemarks.has(remark)) throw new Error("item_sizes remarks must be unique");
      seenRemarks.add(remark);
    } else {
      validateRemarkOption(remark, ITEM_SIZE_REMARK_OPTIONS, `${label}.remark`);
    }
    return { L, B, H, remark, net_weight: netWeight, gross_weight: grossWeight };
  });
};

const normalizeBoxSizeEntries = (entries = [], boxMode = BOX_PACKAGING_MODES.INDIVIDUAL) => {
  if (!Array.isArray(entries)) throw new Error("box_sizes must be an array");
  const normalizedEntries = entries.filter((entry) => !isBlankBoxSizeEntry(entry, boxMode));
  if (normalizedEntries.length > SIZE_ENTRY_LIMIT) {
    throw new Error(`box_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`);
  }
  const seenRemarks = new Set();
  return normalizedEntries.map((entry, index) => {
    const label = `box_sizes[${index + 1}]`;
    const L = toNonNegativeNumber(entry?.L ?? 0, `${label}.L`);
    const B = toNonNegativeNumber(entry?.B ?? 0, `${label}.B`);
    const H = toNonNegativeNumber(entry?.H ?? 0, `${label}.H`);
    const netWeight = toNonNegativeNumber(entry?.net_weight ?? 0, `${label}.net_weight`);
    const grossWeight = toNonNegativeNumber(entry?.gross_weight ?? entry?.weight ?? 0, `${label}.gross_weight`);
    if ((L > 0 || B > 0 || H > 0) && (!L || !B || !H)) {
      throw new Error(`${label} must include positive L, B, and H values`);
    }
    if (boxMode === BOX_PACKAGING_MODES.CARTON) {
      const isInner = index === 0;
      return {
        L,
        B,
        H,
        remark: isInner ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
        net_weight: netWeight,
        gross_weight: grossWeight,
        box_type: isInner ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
        item_count_in_inner: isInner
          ? toNonNegativeNumber(entry?.item_count_in_inner ?? 0, `${label}.item_count_in_inner`)
          : 0,
        box_count_in_master: isInner
          ? 0
          : toNonNegativeNumber(entry?.box_count_in_master ?? 0, `${label}.box_count_in_master`),
      };
    }
    const remark = normalizeLower(entry?.remark) || (normalizedEntries.length === 1 ? "box" : "");
    if (normalizedEntries.length > 1) {
      if (!remark) throw new Error(`${label}.remark is required`);
      validateRemarkOption(remark, BOX_SIZE_REMARK_OPTIONS, `${label}.remark`);
      if (seenRemarks.has(remark)) throw new Error("box_sizes remarks must be unique");
      seenRemarks.add(remark);
    } else {
      validateRemarkOption(remark, BOX_SIZE_REMARK_OPTIONS, `${label}.remark`);
    }
    return {
      L,
      B,
      H,
      remark,
      net_weight: netWeight,
      gross_weight: grossWeight,
      box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
      item_count_in_inner: 0,
      box_count_in_master: 0,
    };
  });
};

const roundCbm = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Number(parsed.toFixed(6));
};

const calculateShipmentCbm = (sample = {}, quantity = 0) => {
  const shipmentQuantity = Math.max(0, Number(quantity || 0));
  if (shipmentQuantity <= 0) return 0;
  const measuredShipmentCbm = calculateTotalPoCbm({
    orderQuantity: shipmentQuantity,
    inspectedBoxSizes: sample?.box_sizes,
    inspectedBoxMode: sample?.box_mode,
  });
  if (measuredShipmentCbm > 0) return roundCbm(measuredShipmentCbm);
  const perUnitCbm = Math.max(0, Number(sample?.cbm || 0));
  return roundCbm(perUnitCbm * shipmentQuantity);
};

const calculateSamplePerItemCbm = (sample = {}) => calculateShipmentCbm(sample, 1);

const buildStoredSampleFile = (file = {}, actor = {}) => ({
  key: normalizeText(file.key),
  originalName: normalizeText(file.originalName || file.originalname),
  contentType: normalizeText(file.contentType || file.mimetype),
  size: Math.max(0, Number(file.size || 0)),
  link: normalizeText(file.link) || (file.key && isWasabiConfigured() ? getObjectUrl(file.key) : ""),
  public_id: normalizeText(file.public_id || file.key),
  uploadedAt: file.uploadedAt || new Date(),
  uploaded_by: file.uploaded_by || actor,
});

const serializeSampleFile = async (file = {}) => {
  const key = normalizeText(file?.key);
  const originalName = normalizeText(file?.originalName || file?.originalname || "sample-file");
  let link = normalizeText(file?.link);
  if (key && isWasabiConfigured()) {
    try {
      link = await getSignedObjectUrl(key, {
        expiresIn: 24 * 60 * 60,
        filename: originalName,
      });
    } catch (error) {
      console.error("Sample file signed URL generation failed:", {
        key,
        error: error?.message || String(error),
      });
    }
  }
  return {
    _id: String(file?._id || ""),
    key,
    originalName,
    contentType: normalizeText(file?.contentType),
    size: Math.max(0, Number(file?.size || 0)),
    link,
    public_id: normalizeText(file?.public_id || key),
    uploadedAt: file?.uploadedAt || null,
    uploaded_by: file?.uploaded_by || null,
  };
};

const uploadSampleFiles = async (files = [], fileType = "other", actor = {}) => {
  const normalizedType = SAMPLE_FILE_TYPES.includes(fileType) ? fileType : "other";
  if (!Array.isArray(files) || files.length === 0) return [];
  if (!isWasabiConfigured()) throw new Error("Wasabi storage is not configured");
  const folder = `samples/${normalizedType}`;
  return Promise.all(files.map(async (file) => {
    const uploadResult = await uploadBuffer({
      buffer: file.buffer,
      key: createStorageKey({
        folder,
        originalName: file.originalname,
      }),
      originalName: file.originalname,
      contentType: file.mimetype,
    });
    return buildStoredSampleFile({
      ...uploadResult,
      originalName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
    }, actor);
  }));
};

const compactValue = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(compactValue);
  if (value && typeof value === "object") {
    if (value._id) return String(value._id);
    return Object.entries(value).reduce((acc, [key, entryValue]) => {
      if (["updatedAt", "createdAt", "__v"].includes(key)) return acc;
      acc[key] = compactValue(entryValue);
      return acc;
    }, {});
  }
  return value;
};

const buildChangedFields = (before = {}, after = {}, fields = []) =>
  fields.reduce((changes, field) => {
    const beforeValue = compactValue(before?.[field]);
    const afterValue = compactValue(after?.[field]);
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.push({ field, before: beforeValue, after: afterValue });
    }
    return changes;
  }, []);

const addTimeline = (sample, {
  stage = "",
  action = "",
  statusFrom = "",
  statusTo = "",
  comment = "",
  files = [],
  vendorName = "",
  changedFields = [],
  actor = {},
} = {}) => {
  sample.timeline = Array.isArray(sample.timeline) ? sample.timeline : [];
  sample.timeline.push({
    stage,
    action,
    status_from: statusFrom,
    status_to: statusTo,
    comment,
    files,
    vendor_name: vendorName,
    changed_fields: changedFields,
    created_by: actor,
    created_at: new Date(),
  });
};

const syncLegacyVendors = (sample) => {
  const vendorNames = normalizeDistinctValues([
    ...(Array.isArray(sample.vendor) ? sample.vendor : []),
    ...(Array.isArray(sample.vendor_entries) ? sample.vendor_entries.map((entry) => entry.vendor_name) : []),
  ]);
  sample.vendor = vendorNames;
  const existing = new Set(
    (Array.isArray(sample.vendor_entries) ? sample.vendor_entries : [])
      .map((entry) => normalizeLower(entry.vendor_name))
      .filter(Boolean),
  );
  vendorNames.forEach((vendorName) => {
    if (existing.has(vendorName.toLowerCase())) return;
    sample.vendor_entries.push({ vendor_name: vendorName });
    existing.add(vendorName.toLowerCase());
  });
};

const normalizeVendorEntries = (value, legacyVendor = []) => {
  const entries = parseJsonBodyField(value, "vendor_entries", []);
  const normalized = [];
  const seen = new Set();
  const pushVendor = (entry = {}) => {
    const vendorName = normalizeText(entry?.vendor_name || entry?.name || entry);
    if (!vendorName || seen.has(vendorName.toLowerCase())) return;
    seen.add(vendorName.toLowerCase());
    normalized.push({
      vendor_name: vendorName,
      vendor_id: isValidObjectId(entry?.vendor_id) ? entry.vendor_id : null,
      contact_name: normalizeText(entry?.contact_name),
      expected_manufacturing_date: parseDate(entry?.expected_manufacturing_date, "expected_manufacturing_date"),
      manufacturing_status: validateEnum(entry?.manufacturing_status, Sample.MANUFACTURING_STATUSES, "manufacturing_status", "not_started"),
      inspection_requested_at: parseDate(entry?.inspection_requested_at, "inspection_requested_at"),
      inspection_status: validateEnum(entry?.inspection_status, Sample.INSPECTION_STATUSES, "inspection_status", "not_requested"),
      inspected_at: parseDate(entry?.inspected_at, "inspected_at"),
      estimated_shipping_date: parseDate(entry?.estimated_shipping_date, "estimated_shipping_date"),
      shipped_at: parseDate(entry?.shipped_at, "shipped_at"),
      tracking: normalizeText(entry?.tracking),
      container: normalizeText(entry?.container),
      shipment_remarks: normalizeText(entry?.shipment_remarks),
      files: Array.isArray(entry?.files) ? entry.files.map((file) => buildStoredSampleFile(file)) : [],
      comments: Array.isArray(entry?.comments) ? entry.comments : [],
    });
  };
  entries.forEach(pushVendor);
  normalizeVendorList(legacyVendor).forEach((vendorName) => pushVendor(vendorName));
  return normalized;
};

const getVendorSummary = (sample = {}) => {
  const entries = Array.isArray(sample?.vendor_entries) ? sample.vendor_entries : [];
  const manufacturingDates = entries.map((entry) => entry?.expected_manufacturing_date).filter(Boolean);
  const inspectionStatuses = entries.map((entry) => normalizeText(entry?.inspection_status)).filter(Boolean);
  const shippingDates = entries.map((entry) => entry?.estimated_shipping_date).filter(Boolean);
  return {
    vendors: normalizeDistinctValues([
      ...(Array.isArray(sample?.vendor) ? sample.vendor : []),
      ...entries.map((entry) => entry?.vendor_name),
    ]),
    expected_manufacturing_date: manufacturingDates.sort((a, b) => new Date(a) - new Date(b))[0] || sample?.expected_manufacturing_date || null,
    inspection_status: inspectionStatuses.includes("requested")
      ? "requested"
      : inspectionStatuses.includes("inspected")
        ? "inspected"
        : inspectionStatuses[0] || "not_requested",
    estimated_shipping_date: shippingDates.sort((a, b) => new Date(a) - new Date(b))[0] || sample?.estimated_shipping_date || null,
  };
};

const serializeSample = async (sample = {}, { detail = false } = {}) => {
  const plain = typeof sample.toObject === "function" ? sample.toObject() : sample;
  const vendorSummary = getVendorSummary(plain);
  const fileFields = ["initial_sketch_files", "cad_files", "sample_images", "other_files", "qc_images"];
  const serialized = {
    ...plain,
    _id: String(plain?._id || ""),
    vendors: vendorSummary.vendors,
    vendor_summary: vendorSummary,
  };
  if (detail) {
    await Promise.all(fileFields.map(async (field) => {
      serialized[field] = await Promise.all((Array.isArray(plain?.[field]) ? plain[field] : []).map(serializeSampleFile));
    }));
    serialized.vendor_entries = await Promise.all((Array.isArray(plain?.vendor_entries) ? plain.vendor_entries : []).map(async (entry) => ({
      ...entry,
      _id: String(entry?._id || ""),
      files: await Promise.all((Array.isArray(entry?.files) ? entry.files : []).map(serializeSampleFile)),
    })));
    serialized.timeline = await Promise.all((Array.isArray(plain?.timeline) ? plain.timeline : []).map(async (entry) => ({
      ...entry,
      _id: String(entry?._id || ""),
      files: await Promise.all((Array.isArray(entry?.files) ? entry.files : []).map(serializeSampleFile)),
    })));
  }
  return serialized;
};

const buildSampleMatch = (query = {}) => {
  const match = {};
  const search = normalizeFilterValue(query.search);
  const brand = normalizeFilterValue(query.brand);
  const vendor = normalizeFilterValue(query.vendor);
  const status = normalizeFilterValue(query.status);
  const archived = normalizeText(query.archived).toLowerCase();
  const dateFrom = parseDateBoundary(query.date_from || query.dateFrom);
  const dateTo = parseDateBoundary(query.date_to || query.dateTo, true);

  match.archived = ["1", "true", "yes", "archived"].includes(archived);
  if (archived === "all") delete match.archived;
  if (brand) match.brand = { $regex: `^${escapeRegex(brand)}$`, $options: "i" };
  if (vendor) {
    match.$or = [
      { vendor: { $elemMatch: { $regex: escapeRegex(vendor), $options: "i" } } },
      { "vendor_entries.vendor_name": { $regex: escapeRegex(vendor), $options: "i" } },
    ];
  }
  if (status) match.current_status = status;
  if (dateFrom || dateTo) {
    match.updatedAt = {};
    if (dateFrom) match.updatedAt.$gte = dateFrom;
    if (dateTo) match.updatedAt.$lte = dateTo;
  }
  if (search) {
    const escaped = escapeRegex(search);
    const searchOr = [
      { code: { $regex: escaped, $options: "i" } },
      { name: { $regex: escaped, $options: "i" } },
      { description: { $regex: escaped, $options: "i" } },
      { brand: { $regex: escaped, $options: "i" } },
      { vendor: { $elemMatch: { $regex: escaped, $options: "i" } } },
      { "vendor_entries.vendor_name": { $regex: escaped, $options: "i" } },
    ];
    if (match.$or) {
      match.$and = [{ $or: match.$or }, { $or: searchOr }];
      delete match.$or;
    } else {
      match.$or = searchOr;
    }
  }
  return match;
};

const isBadRequestError = (error) => {
  const normalized = normalizeLower(error?.message);
  return ["required", "must be", "invalid", "already exists", "not found", "unsupported"].some((part) => normalized.includes(part));
};

const flattenSampleShipmentRows = (samples = []) =>
  (Array.isArray(samples) ? samples : []).flatMap((sample) => {
    const shipmentEntries = Array.isArray(sample?.shipment) ? sample.shipment : [];
    return shipmentEntries.map((entry, index) => {
      const quantity = Math.max(0, toSafeNumber(entry?.quantity, 0));
      return {
        _id: sample?._id || null,
        entity_id: sample?._id || null,
        line_type: "sample",
        order_id: "Sample",
        sample_code: sample?.code || "",
        item_code: sample?.code || sample?.name || `sample-${index + 1}`,
        sample_name: sample?.name || "",
        description: sample?.description || "",
        brand: sample?.brand || "",
        vendor: normalizeDistinctValues(sample?.vendor).join(", "),
        order_quantity: quantity,
        quantity,
        pending: Math.max(0, toSafeNumber(entry?.pending, 0)),
        status: "Shipped",
        shipment: shipmentEntries,
        shipment_id: entry?._id || `${sample?._id || "sample"}-${index}`,
        stuffing_date: entry?.stuffing_date || null,
        container: entry?.container || "",
        invoice_number: normalizeShipmentInvoiceNumber(entry?.invoice_number, "N/A"),
        remaining_remarks: normalizeText(entry?.remaining_remarks),
        shipment_checked: Boolean(entry?.checked?.checked),
        shipment_checked_by: entry?.checked?.checked_by || null,
        shipment_cbm: calculateShipmentCbm(sample, quantity),
        per_item_cbm: calculateSamplePerItemCbm(sample),
        createdAt: sample?.createdAt || null,
        updatedAt: sample?.updatedAt || null,
      };
    });
  });

exports.getSamples = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;
    const baseMatch = buildSampleMatch(req.query);
    const match = applyDataAccessMatch(baseMatch, req.user, {
      vendorFields: ["vendor", "vendor_entries.vendor_name"],
    });
    const [samples, totalRecords, brandsRaw, legacyVendorsRaw, entryVendorsRaw] = await Promise.all([
      Sample.find(match).sort({ updatedAt: -1, code: 1 }).skip(skip).limit(limit).lean(),
      Sample.countDocuments(match),
      Sample.distinct("brand", applyDataAccessMatch(buildSampleMatch({ ...req.query, brand: "" }), req.user, { vendorFields: ["vendor", "vendor_entries.vendor_name"] })),
      Sample.distinct("vendor", applyDataAccessMatch(buildSampleMatch({ ...req.query, vendor: "" }), req.user, { vendorFields: ["vendor", "vendor_entries.vendor_name"] })),
      Sample.distinct("vendor_entries.vendor_name", applyDataAccessMatch(buildSampleMatch({ ...req.query, vendor: "" }), req.user, { vendorFields: ["vendor", "vendor_entries.vendor_name"] })),
    ]);
    const data = await Promise.all(samples.map((sample) => serializeSample(sample)));
    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        brands: normalizeDistinctValues(brandsRaw),
        vendors: normalizeDistinctValues([
          ...legacyVendorsRaw,
          ...entryVendorsRaw,
          ...samples.flatMap((sample) => (Array.isArray(sample.vendor_entries) ? sample.vendor_entries.map((entry) => entry.vendor_name) : [])),
        ]),
        statuses: Sample.SAMPLE_STATUSES,
      },
    });
  } catch (error) {
    console.error("Get Samples Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch samples", error: error.message });
  }
};

exports.getSampleById = async (req, res) => {
  try {
    const match = applyDataAccessMatch(
      { _id: req.params.id },
      req.user,
      { vendorFields: ["vendor", "vendor_entries.vendor_name"] },
    );
    const sample = await Sample.findOne(match).lean();
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    return res.status(200).json({ success: true, data: await serializeSample(sample, { detail: true }) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch sample", error: error.message });
  }
};

exports.createSample = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const actor = buildAuditActor(req.user);
    const code = normalizeText(payload.code).toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: "code is required" });
    if (!normalizeText(payload.name) && !normalizeText(payload.description)) {
      return res.status(400).json({ success: false, message: "name or description is required" });
    }
    if (!normalizeText(payload.brand)) {
      return res.status(400).json({ success: false, message: "brand is required" });
    }
    const existingSample = await Sample.findOne({ code: { $regex: `^${escapeRegex(code)}$`, $options: "i" } }).select("_id code");
    if (existingSample) {
      return res.status(400).json({ success: false, message: `Sample code ${existingSample.code || code} already exists` });
    }
    const boxMode = Object.values(BOX_PACKAGING_MODES).includes(payload.box_mode)
      ? payload.box_mode
      : BOX_PACKAGING_MODES.INDIVIDUAL;
    const uploadedFiles = await uploadSampleFiles(req.files, "initial_sketch", actor);
    const vendorEntries = payload.vendor_entries !== undefined
      ? normalizeVendorEntries(payload.vendor_entries, payload.vendor)
      : normalizeVendorEntries([], payload.vendor);
    const sample = new Sample({
      code,
      name: normalizeText(payload.name),
      description: normalizeText(payload.description),
      brand: normalizeText(payload.brand),
      vendor: normalizeVendorList(payload.vendor),
      vendor_entries: vendorEntries,
      item_sizes: normalizeItemSizeEntries(parseJsonBodyField(payload.item_sizes, "item_sizes")),
      box_sizes: normalizeBoxSizeEntries(parseJsonBodyField(payload.box_sizes, "box_sizes"), boxMode),
      box_mode: boxMode,
      cbm: Math.max(0, toSafeNumber(payload.cbm, 0)),
      current_status: validateEnum(payload.current_status, Sample.SAMPLE_STATUSES, "current_status", "created"),
      assigned_cad_artist: normalizeText(payload.assigned_cad_artist),
      initial_sketch_files: uploadedFiles,
      requested_by: actor,
      created_by: actor,
      updated_by: actor,
    });
    syncLegacyVendors(sample);
    addTimeline(sample, {
      stage: "created",
      action: "create",
      statusTo: sample.current_status,
      comment: normalizeText(payload.first_comment || payload.comment),
      files: uploadedFiles,
      changedFields: buildChangedFields({}, sample.toObject(), [
        "code",
        "name",
        "description",
        "brand",
        "current_status",
        "assigned_cad_artist",
      ]),
      actor,
    });
    await sample.save();
    return res.status(201).json({ success: true, message: "Sample created successfully", data: await serializeSample(sample, { detail: true }) });
  } catch (error) {
    return res.status(isBadRequestError(error) ? 400 : 500).json({
      success: false,
      message: error?.message || "Failed to create sample",
      error: error.message,
    });
  }
};

exports.updateSample = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const sample = await Sample.findById(req.params.id);
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const actor = buildAuditActor(req.user);
    const before = sample.toObject();
    const nextCode = normalizeText(payload.code || sample.code).toUpperCase();
    if (!nextCode) return res.status(400).json({ success: false, message: "code is required" });
    if (nextCode.toLowerCase() !== normalizeLower(sample.code)) {
      const existingSample = await Sample.findOne({
        _id: { $ne: sample._id },
        code: { $regex: `^${escapeRegex(nextCode)}$`, $options: "i" },
      }).select("_id code");
      if (existingSample) {
        return res.status(400).json({ success: false, message: `Sample code ${existingSample.code || nextCode} already exists` });
      }
    }
    sample.code = nextCode;
    sample.name = normalizeText(payload.name ?? sample.name);
    sample.description = normalizeText(payload.description ?? sample.description);
    sample.brand = normalizeText(payload.brand ?? sample.brand);
    sample.assigned_cad_artist = normalizeText(payload.assigned_cad_artist ?? sample.assigned_cad_artist);
    if (payload.vendor !== undefined) sample.vendor = normalizeVendorList(payload.vendor);
    if (payload.vendor_entries !== undefined) {
      sample.vendor_entries = normalizeVendorEntries(payload.vendor_entries, sample.vendor);
    }
    if (payload.item_sizes !== undefined) sample.item_sizes = normalizeItemSizeEntries(parseJsonBodyField(payload.item_sizes, "item_sizes"));
    if (payload.box_mode !== undefined) {
      sample.box_mode = Object.values(BOX_PACKAGING_MODES).includes(payload.box_mode)
        ? payload.box_mode
        : BOX_PACKAGING_MODES.INDIVIDUAL;
    }
    if (payload.box_sizes !== undefined) sample.box_sizes = normalizeBoxSizeEntries(parseJsonBodyField(payload.box_sizes, "box_sizes"), sample.box_mode);
    if (payload.cbm !== undefined) sample.cbm = Math.max(0, toSafeNumber(payload.cbm, 0));
    if (payload.shipment !== undefined) sample.shipment = normalizeShipmentEntries(payload.shipment, actor);
    syncLegacyVendors(sample);
    sample.updated_by = actor;
    const changedFields = buildChangedFields(before, sample.toObject(), [
      "code",
      "name",
      "description",
      "brand",
      "vendor",
      "vendor_entries",
      "item_sizes",
      "box_sizes",
      "box_mode",
      "cbm",
      "assigned_cad_artist",
    ]);
    if (changedFields.length > 0 || normalizeText(payload.comment)) {
      addTimeline(sample, {
        stage: "details",
        action: "update",
        comment: normalizeText(payload.comment),
        changedFields,
        actor,
      });
    }
    await sample.save();
    return res.status(200).json({ success: true, message: "Sample updated successfully", data: await serializeSample(sample, { detail: true }) });
  } catch (error) {
    return res.status(isBadRequestError(error) ? 400 : 500).json({
      success: false,
      message: error?.message || "Failed to update sample",
      error: error.message,
    });
  }
};

const normalizeShipmentEntries = (entries = [], actor = {}) => {
  if (!Array.isArray(entries)) throw new Error("shipment must be an array");
  return entries.map((entry, index) => {
    const container = normalizeText(entry?.container);
    const stuffingDate = parseDate(entry?.stuffing_date, `shipment[${index + 1}].stuffing_date`);
    const quantity = Number(entry?.quantity);
    if (!container) throw new Error(`shipment[${index + 1}] container is required`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`shipment[${index + 1}] quantity must be a positive number`);
    return {
      container,
      invoice_number: normalizeShipmentInvoiceNumber(entry?.invoice_number, ""),
      stuffing_date: stuffingDate,
      quantity,
      pending: Math.max(0, toSafeNumber(entry?.pending, 0)),
      remaining_remarks: normalizeText(entry?.remaining_remarks),
      stuffed_by: normalizeShipmentStuffedBy(entry?.stuffed_by),
      cases: Array.isArray(entry?.cases) ? entry.cases : [],
      updated_at: new Date(),
      updated_by: actor,
    };
  });
};

exports.updateSampleStatus = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const sample = await Sample.findById(req.params.id);
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const actor = buildAuditActor(req.user);
    const statusFrom = sample.current_status;
    const statusTo = validateEnum(payload.current_status || payload.status, Sample.SAMPLE_STATUSES, "current_status", statusFrom);
    const before = sample.toObject();
    sample.current_status = statusTo;
    if (STATUS_DATE_FIELD[statusTo]) {
      sample[STATUS_DATE_FIELD[statusTo]] = parseDate(payload.date, "date") || new Date();
    }
    if (statusTo === "cad_ready") sample.cad_completed_at = parseDate(payload.cad_completed_at, "cad_completed_at") || sample.cad_completed_at || new Date();
    if (statusTo === "shipping_planned") sample.estimated_shipping_date = parseDate(payload.estimated_shipping_date || payload.date, "estimated_shipping_date") || sample.estimated_shipping_date;
    if (statusTo === "shipped") {
      sample.shipped_at = parseDate(payload.shipped_at || payload.date, "shipped_at") || sample.shipped_at || new Date();
      if (payload.container && payload.quantity && payload.stuffing_date) {
        sample.shipment.push(normalizeShipmentEntries([payload], actor)[0]);
      }
    }
    sample.updated_by = actor;
    addTimeline(sample, {
      stage: statusTo,
      action: "status_change",
      statusFrom,
      statusTo,
      comment: normalizeText(payload.comment),
      changedFields: buildChangedFields(before, sample.toObject(), [
        "current_status",
        "cad_completed_at",
        "sent_to_client_at",
        "client_approved_at",
        "sent_to_vendor_at",
        "expected_manufacturing_date",
        "inspection_requested_at",
        "inspected_at",
        "estimated_shipping_date",
        "shipped_at",
        "shipment",
      ]),
      actor,
    });
    await sample.save();
    return res.status(200).json({ success: true, message: "Sample status updated successfully", data: await serializeSample(sample, { detail: true }) });
  } catch (error) {
    return res.status(isBadRequestError(error) ? 400 : 500).json({ success: false, message: error.message || "Failed to update sample status", error: error.message });
  }
};

exports.addSampleTimeline = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const sample = await Sample.findById(req.params.id);
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const actor = buildAuditActor(req.user);
    addTimeline(sample, {
      stage: normalizeText(req.body?.stage || sample.current_status || "comment"),
      action: normalizeText(req.body?.action || "comment"),
      comment: normalizeText(req.body?.comment),
      vendorName: normalizeText(req.body?.vendor_name),
      actor,
    });
    sample.updated_by = actor;
    await sample.save();
    return res.status(200).json({ success: true, message: "Timeline entry added", data: await serializeSample(sample, { detail: true }) });
  } catch (error) {
    return res.status(isBadRequestError(error) ? 400 : 500).json({ success: false, message: error.message || "Failed to add timeline entry", error: error.message });
  }
};

const getFileBucket = (type = "") => {
  const normalized = SAMPLE_FILE_TYPES.includes(type) ? type : "other";
  if (normalized === "initial_sketch") return "initial_sketch_files";
  if (normalized === "cad") return "cad_files";
  if (normalized === "sample_image") return "sample_images";
  if (normalized === "inspection") return "qc_images";
  return "other_files";
};

exports.addSampleFiles = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const sample = await Sample.findById(req.params.id);
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const actor = buildAuditActor(req.user);
    const fileType = normalizeText(req.body?.file_type || req.body?.type || "other");
    const files = await uploadSampleFiles(req.files, fileType, actor);
    const bucket = getFileBucket(fileType);
    sample[bucket] = Array.isArray(sample[bucket]) ? sample[bucket] : [];
    files.forEach((file) => sample[bucket].push(file));
    if (fileType === "cad" && files[0]) {
      sample.cad_file = {
        key: files[0].key,
        originalName: files[0].originalName,
        contentType: files[0].contentType,
        size: files[0].size,
        link: files[0].link,
        public_id: files[0].public_id,
      };
      sample.current_status = sample.current_status === "cad_pending" ? "cad_ready" : sample.current_status;
      sample.cad_completed_at = sample.cad_completed_at || new Date();
    }
    if (fileType === "sample_image" && files[0]) {
      sample.image = {
        key: files[0].key,
        originalName: files[0].originalName,
        contentType: files[0].contentType,
        size: files[0].size,
        link: files[0].link,
        public_id: files[0].public_id,
      };
    }
    addTimeline(sample, {
      stage: fileType,
      action: "file_upload",
      comment: normalizeText(req.body?.comment),
      files,
      actor,
    });
    sample.updated_by = actor;
    await sample.save();
    return res.status(200).json({ success: true, message: "Files uploaded successfully", data: await serializeSample(sample, { detail: true }) });
  } catch (error) {
    return res.status(isBadRequestError(error) ? 400 : 500).json({ success: false, message: error.message || "Failed to upload sample files", error: error.message });
  }
};

exports.updateSampleVendor = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const sample = await Sample.findById(req.params.id);
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const actor = buildAuditActor(req.user);
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    let vendorEntry = String(req.params.vendorEntryId || "").trim() === "new"
      ? null
      : sample.vendor_entries.id(req.params.vendorEntryId);
    if (!vendorEntry) {
      const vendorName = normalizeText(payload.vendor_name);
      if (!vendorName) return res.status(400).json({ success: false, message: "vendor_name is required" });
      sample.vendor_entries.push({ vendor_name: vendorName });
      vendorEntry = sample.vendor_entries[sample.vendor_entries.length - 1];
    }
    const before = vendorEntry.toObject ? vendorEntry.toObject() : { ...vendorEntry };
    if (payload.vendor_name !== undefined) vendorEntry.vendor_name = normalizeText(payload.vendor_name);
    if (payload.vendor_id !== undefined) vendorEntry.vendor_id = isValidObjectId(payload.vendor_id) ? payload.vendor_id : null;
    if (payload.contact_name !== undefined) vendorEntry.contact_name = normalizeText(payload.contact_name);
    if (payload.expected_manufacturing_date !== undefined) vendorEntry.expected_manufacturing_date = parseDate(payload.expected_manufacturing_date, "expected_manufacturing_date");
    if (payload.manufacturing_status !== undefined) vendorEntry.manufacturing_status = validateEnum(payload.manufacturing_status, Sample.MANUFACTURING_STATUSES, "manufacturing_status", vendorEntry.manufacturing_status);
    if (payload.inspection_requested_at !== undefined) vendorEntry.inspection_requested_at = parseDate(payload.inspection_requested_at, "inspection_requested_at");
    if (payload.inspection_status !== undefined) vendorEntry.inspection_status = validateEnum(payload.inspection_status, Sample.INSPECTION_STATUSES, "inspection_status", vendorEntry.inspection_status);
    if (payload.inspected_at !== undefined) vendorEntry.inspected_at = parseDate(payload.inspected_at, "inspected_at");
    if (payload.estimated_shipping_date !== undefined) vendorEntry.estimated_shipping_date = parseDate(payload.estimated_shipping_date, "estimated_shipping_date");
    if (payload.shipped_at !== undefined) vendorEntry.shipped_at = parseDate(payload.shipped_at, "shipped_at");
    if (payload.tracking !== undefined) vendorEntry.tracking = normalizeText(payload.tracking);
    if (payload.container !== undefined) vendorEntry.container = normalizeText(payload.container);
    if (payload.shipment_remarks !== undefined) vendorEntry.shipment_remarks = normalizeText(payload.shipment_remarks);
    if (normalizeText(payload.comment)) {
      vendorEntry.comments.push({ comment: normalizeText(payload.comment), created_by: actor, created_at: new Date() });
    }
    const files = await uploadSampleFiles(req.files, "vendor", actor);
    files.forEach((file) => vendorEntry.files.push(file));
    syncLegacyVendors(sample);
    const statusBefore = sample.current_status;
    if (vendorEntry.shipped_at) {
      sample.current_status = "shipped";
      sample.shipped_at = vendorEntry.shipped_at;
    } else if (vendorEntry.estimated_shipping_date) {
      sample.current_status = "shipping_planned";
      sample.estimated_shipping_date = vendorEntry.estimated_shipping_date;
    } else if (vendorEntry.inspected_at || vendorEntry.inspection_status === "inspected") {
      sample.current_status = "inspected";
      sample.inspected_at = vendorEntry.inspected_at || sample.inspected_at || new Date();
    } else if (vendorEntry.inspection_requested_at || vendorEntry.inspection_status === "requested") {
      sample.current_status = "inspection_requested";
      sample.inspection_requested_at = vendorEntry.inspection_requested_at || sample.inspection_requested_at || new Date();
    } else if (vendorEntry.expected_manufacturing_date || vendorEntry.manufacturing_status === "manufacturing") {
      sample.current_status = "manufacturing";
      sample.expected_manufacturing_date = vendorEntry.expected_manufacturing_date || sample.expected_manufacturing_date;
    }
    sample.updated_by = actor;
    addTimeline(sample, {
      stage: "vendor",
      action: "vendor_update",
      statusFrom: statusBefore,
      statusTo: sample.current_status,
      comment: normalizeText(payload.comment),
      files,
      vendorName: vendorEntry.vendor_name,
      changedFields: buildChangedFields(before, vendorEntry.toObject ? vendorEntry.toObject() : vendorEntry, [
        "vendor_name",
        "contact_name",
        "expected_manufacturing_date",
        "manufacturing_status",
        "inspection_requested_at",
        "inspection_status",
        "inspected_at",
        "estimated_shipping_date",
        "shipped_at",
        "tracking",
        "container",
        "shipment_remarks",
      ]),
      actor,
    });
    await sample.save();
    return res.status(200).json({ success: true, message: "Vendor updated successfully", data: await serializeSample(sample, { detail: true }) });
  } catch (error) {
    return res.status(isBadRequestError(error) ? 400 : 500).json({ success: false, message: error.message || "Failed to update sample vendor", error: error.message });
  }
};

exports.archiveSample = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const sample = await Sample.findById(req.params.id);
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const actor = buildAuditActor(req.user);
    const before = sample.toObject();
    sample.archived = true;
    sample.archived_at = new Date();
    sample.archived_by = actor;
    sample.updated_by = actor;
    addTimeline(sample, {
      stage: "archive",
      action: "archive",
      comment: normalizeText(req.body?.comment),
      changedFields: buildChangedFields(before, sample.toObject(), ["archived", "archived_at"]),
      actor,
    });
    await sample.save();
    return res.status(200).json({ success: true, message: "Sample archived", data: await serializeSample(sample, { detail: true }) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to archive sample", error: error.message });
  }
};

exports.unarchiveSample = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const sample = await Sample.findById(req.params.id);
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const actor = buildAuditActor(req.user);
    const before = sample.toObject();
    sample.archived = false;
    sample.archived_at = null;
    sample.archived_by = {};
    sample.updated_by = actor;
    addTimeline(sample, {
      stage: "archive",
      action: "unarchive",
      comment: normalizeText(req.body?.comment),
      changedFields: buildChangedFields(before, sample.toObject(), ["archived", "archived_at"]),
      actor,
    });
    await sample.save();
    return res.status(200).json({ success: true, message: "Sample unarchived", data: await serializeSample(sample, { detail: true }) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to unarchive sample", error: error.message });
  }
};

exports.finalizeSampleShipment = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const sample = await Sample.findById(req.params.id);
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const actor = buildAuditActor(req.user);
    const shipmentEntry = normalizeShipmentEntries([req.body], actor)[0];
    const before = sample.toObject();
    sample.shipment = Array.isArray(sample.shipment) ? sample.shipment : [];
    sample.shipment.push(shipmentEntry);
    sample.current_status = "shipped";
    sample.shipped_at = shipmentEntry.stuffing_date || new Date();
    sample.updated_by = actor;
    addTimeline(sample, {
      stage: "shipped",
      action: "finalize_shipment",
      statusFrom: before.current_status,
      statusTo: sample.current_status,
      comment: normalizeText(req.body?.remarks || req.body?.remaining_remarks),
      changedFields: buildChangedFields(before, sample.toObject(), ["shipment", "current_status", "shipped_at"]),
      actor,
    });
    await sample.save();
    return res.status(200).json({ success: true, message: "Sample shipment updated successfully", data: sample });
  } catch (error) {
    return res.status(isBadRequestError(error) ? 400 : 500).json({
      success: false,
      message: "Failed to finalize sample shipment",
      error: error.message,
    });
  }
};

exports.getShippedSamples = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const container = normalizeFilterValue(req.query.container);
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const samples = await Sample.find(
      applyDataAccessMatch(
        { ...buildSampleMatch({ search, brand, vendor, archived: "all" }), "shipment.0": { $exists: true } },
        req.user,
        { vendorFields: ["vendor", "vendor_entries.vendor_name"] },
      ),
    ).sort({ updatedAt: -1, code: 1 }).lean();
    const rows = flattenSampleShipmentRows(samples).filter((row) => {
      if (!container) return true;
      return String(row?.container || "").toLowerCase().includes(container.toLowerCase());
    });
    const totalRecords = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;
    return res.status(200).json({
      success: true,
      data: rows.slice(skip, skip + limit),
      pagination: { page: safePage, limit, totalPages, totalRecords },
      summary: {
        total: totalRecords,
        total_quantity: rows.reduce((sum, row) => sum + Math.max(0, Number(row?.quantity || 0)), 0),
        checked: rows.filter((row) => row?.shipment_checked).length,
      },
      filters: {
        brands: normalizeDistinctValues(samples.map((sample) => sample?.brand)),
        vendors: normalizeDistinctValues(samples.map((sample) => sample?.vendor)),
        containers: normalizeDistinctValues(rows.map((row) => row?.container)),
        sample_codes: normalizeDistinctValues(samples.map((sample) => sample?.code)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch shipped samples", error: error.message });
  }
};

exports.flattenSampleShipmentRows = flattenSampleShipmentRows;

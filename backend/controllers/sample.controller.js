const mongoose = require("mongoose");
const path = require("path");

const Sample = require("../models/sample.model");
const Item = require("../models/item.model");
const {
  BOX_PACKAGING_MODES,
  BOX_ENTRY_TYPES,
  buildBoxMeasurementCbmSummary,
} = require("../helpers/boxMeasurement");
const { normalizeUserRoleKey } = require("../helpers/userRole");
const { appendItemUpdateHistory } = require("../helpers/itemUpdateHistory");
const { calculateTotalPoCbm } = require("../services/orderCbm.service");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const wasabiStorage = require("../services/wasabiStorage.service");
const {
  buildVendorsArrayFilter,
  getVendorId,
  getVendorName,
  normalizeVendorDisplayList,
} = require("../helpers/vendorRef");

const SHIPPED_BY_VENDOR_ID = "shipped_by_vendor";
const SHIPPED_BY_VENDOR_NAME = "Shipped By Vendor";
const ITEM_SIZE_ENTRY_LIMIT = 5;
const BOX_SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  "item",
  "top",
  "base",
  "base2",
  "pedestal",
  "stretcher",
  "item1",
  "item2",
  "item3",
  "item4",
]);
const BOX_SIZE_REMARK_OPTIONS = Object.freeze(["top", "base", "box", "box1", "box2", "box3"]);
const SAMPLE_MUTATION_ROLES = new Set([
  "admin",
  "super_admin",
  "inspection_manager",
  "product_manager",
]);

const escapeRegex = (value = "") =>
  String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();

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
    parsed.setUTCHours(
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );
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
    message: "Sample updates are restricted to admin, super admin, inspection manager, and product manager users.",
  });
  return false;
};

const isBadRequestError = (error) => {
  const normalized = normalizeLower(error?.message);
  return ["required", "must be", "invalid", "already exists", "not found", "unsupported"].some((part) =>
    normalized.includes(part),
  );
};

const validateRemarkOption = (remark = "", options = [], fieldLabel = "Remark") => {
  if (!remark) return;
  if (!options.includes(remark)) {
    throw new Error(`${fieldLabel} must be one of: ${options.join(", ")}`);
  }
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const splitVendorString = (value) =>
  normalizeText(value)
    .split(",")
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

const normalizeVendorList = (value, options = {}) => {
  const vendorIds = Array.isArray(options.vendorIds)
    ? options.vendorIds
    : options.vendorId
      ? [options.vendorId]
      : null;
  const rawValues = vendorIds ||
    (Array.isArray(value)
      ? value
      : isPlainObject(value)
        ? [value]
        : splitVendorString(value));
  const seen = new Set();

  return rawValues
    .flatMap((entry) => {
      if (Array.isArray(entry)) return entry;
      if (isPlainObject(entry)) return [entry];
      return splitVendorString(entry);
    })
    .map((entry) => {
      const vendorId = getVendorId(entry);
      const vendorName = getVendorName(entry);
      const key = normalizeLower(vendorId || vendorName || entry);
      if (!key || seen.has(key)) return null;
      seen.add(key);
      return entry;
    })
    .filter(Boolean);
};

const getVendorPayloadList = (payload = {}) =>
  normalizeVendorList(payload.vendor ?? payload.vendors, {
    vendorId: payload.vendor_id ?? payload.vendorId,
    vendorIds: payload.vendor_ids ?? payload.vendorIds,
  });

const normalizeShipmentInvoiceNumber = (value, fallback = "") => {
  const normalized = normalizeText(value);
  return normalized || normalizeText(fallback);
};

const normalizeObjectIdValue = (value = null) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return normalizeText(value?._id || value?.id || value?.$oid);
  }
  return normalizeText(value);
};

const normalizeShipmentStuffedBy = (input = {}) => {
  const id = normalizeText(input?.id || input?._id);
  const name = normalizeText(input?.name);
  if (id === SHIPPED_BY_VENDOR_ID || name.toLowerCase() === SHIPPED_BY_VENDOR_NAME.toLowerCase()) {
    return { id: null, name: SHIPPED_BY_VENDOR_NAME };
  }
  if (!id && !name) throw new Error("stuffed_by is required");
  return { id: id && mongoose.Types.ObjectId.isValid(id) ? id : null, name: name || id };
};

const normalizeShipmentChecked = (value = null) => {
  const isChecked = Boolean(value?.checked);
  const checkedBy = normalizeObjectIdValue(
    value?.checked_by ?? value?.checkedBy,
  );

  return {
    checked: isChecked,
    checked_by:
      isChecked && mongoose.Types.ObjectId.isValid(checkedBy)
        ? new mongoose.Types.ObjectId(checkedBy)
        : null,
  };
};

const normalizeShipmentEntryId = (entry = {}) => {
  const normalizedId = normalizeObjectIdValue(entry?._id ?? entry?.id);
  return mongoose.Types.ObjectId.isValid(normalizedId)
    ? new mongoose.Types.ObjectId(normalizedId)
    : null;
};

const isBlankItemSizeEntry = (entry = {}) =>
  !isPositiveNumericInput(entry?.L) &&
  !isPositiveNumericInput(entry?.B) &&
  !isPositiveNumericInput(entry?.H) &&
  !isPositiveNumericInput(entry?.net_weight) &&
  !isPositiveNumericInput(entry?.gross_weight) &&
  !isPositiveNumericInput(entry?.weight) &&
  !normalizeText(entry?.remark);

const isBlankBoxSizeEntry = (entry = {}, boxMode = BOX_PACKAGING_MODES.INDIVIDUAL) =>
  !isPositiveNumericInput(entry?.L) &&
  !isPositiveNumericInput(entry?.B) &&
  !isPositiveNumericInput(entry?.H) &&
  !isPositiveNumericInput(entry?.net_weight) &&
  !isPositiveNumericInput(entry?.gross_weight) &&
  !isPositiveNumericInput(entry?.weight) &&
  (
    boxMode === BOX_PACKAGING_MODES.CARTON ||
    boxMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER
      ? true
      : !normalizeText(entry?.remark)
  ) &&
  !isPositiveNumericInput(entry?.item_count_in_inner) &&
  !isPositiveNumericInput(entry?.box_count_in_master);

const normalizeItemSizeEntries = (entries = []) => {
  if (!Array.isArray(entries)) throw new Error("item_sizes must be an array");
  const normalizedEntries = entries.filter((entry) => !isBlankItemSizeEntry(entry));
  if (normalizedEntries.length > ITEM_SIZE_ENTRY_LIMIT) {
    throw new Error(`item_sizes cannot exceed ${ITEM_SIZE_ENTRY_LIMIT} entries`);
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
    if (normalizedEntries.length > 1 && !remark) {
      throw new Error(`${label}.remark is required`);
    }
    validateRemarkOption(remark, ITEM_SIZE_REMARK_OPTIONS, `${label}.remark`);
    if (remark && seenRemarks.has(remark)) throw new Error("item_sizes remarks must be unique");
    if (remark) seenRemarks.add(remark);
    return { L, B, H, remark, net_weight: netWeight, gross_weight: grossWeight };
  });
};

const normalizeBoxSizeEntries = (entries = [], boxMode = BOX_PACKAGING_MODES.INDIVIDUAL) => {
  if (!Array.isArray(entries)) throw new Error("box_sizes must be an array");
  const normalizedEntries = entries.filter((entry) => !isBlankBoxSizeEntry(entry, boxMode));
  const entryLimit =
    boxMode === BOX_PACKAGING_MODES.CARTON
      ? 2
      : boxMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER
        ? 1
        : BOX_SIZE_ENTRY_LIMIT;
  if (normalizedEntries.length > entryLimit) {
    throw new Error(`box_sizes cannot exceed ${entryLimit} entries`);
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

    if (boxMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER) {
      const piecesInMaster = toNonNegativeNumber(
        entry?.box_count_in_master ?? 0,
        `${label}.box_count_in_master`,
      );
      if (piecesInMaster <= 0) {
        throw new Error(`${label}.box_count_in_master must be greater than 0`);
      }
      return {
        L,
        B,
        H,
        remark: BOX_ENTRY_TYPES.MASTER,
        net_weight: netWeight,
        gross_weight: grossWeight,
        box_type: BOX_ENTRY_TYPES.MASTER,
        item_count_in_inner: 0,
        box_count_in_master: piecesInMaster,
      };
    }

    const remark = normalizeLower(entry?.remark) || (normalizedEntries.length === 1 ? "box" : "");
    if (normalizedEntries.length > 1 && !remark) {
      throw new Error(`${label}.remark is required`);
    }
    validateRemarkOption(remark, BOX_SIZE_REMARK_OPTIONS, `${label}.remark`);
    if (remark && seenRemarks.has(remark)) throw new Error("box_sizes remarks must be unique");
    if (remark) seenRemarks.add(remark);
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

const normalizeShipmentEntries = (entries = [], actor = {}) => {
  if (!Array.isArray(entries)) throw new Error("shipment must be an array");
  return entries.map((entry, index) => {
    const container = normalizeText(entry?.container);
    const stuffingDate = parseDate(entry?.stuffing_date, `shipment[${index + 1}].stuffing_date`);
    const quantity = Number(entry?.quantity);
    if (!container) throw new Error(`shipment[${index + 1}] container is required`);
    const CONTAINER_REGEX = /^[A-Za-z]{4}-\d{6}-\d{1}$/;
    if (!CONTAINER_REGEX.test(container)) {
      throw new Error(`shipment[${index + 1}] container number must be in the format 'AAAA-111111-2' (4 letters, hyphen, 6 digits, hyphen, 1 digit)`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`shipment[${index + 1}] quantity must be a positive number`);
    }
    const shipmentEntryId = normalizeShipmentEntryId(entry);
    const normalizedEntry = {
      container,
      invoice_number: normalizeShipmentInvoiceNumber(entry?.invoice_number, ""),
      stuffing_date: stuffingDate,
      quantity,
      pending: Math.max(0, toSafeNumber(entry?.pending, 0)),
      remaining_remarks: normalizeText(entry?.remaining_remarks),
      stuffed_by: normalizeShipmentStuffedBy(entry?.stuffed_by),
      checked: normalizeShipmentChecked(entry?.checked),
      cases: Array.isArray(entry?.cases) ? entry.cases : [],
      updated_at: new Date(),
      updated_by: actor,
    };
    if (shipmentEntryId) normalizedEntry._id = shipmentEntryId;
    return normalizedEntry;
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

const serializeSample = (sample = {}) => {
  const plain = typeof sample.toObject === "function" ? sample.toObject() : sample;
  return {
    ...plain,
    _id: String(plain?._id || ""),
    vendors: normalizeVendorDisplayList(plain?.vendor),
    vendor_summary: {
      vendors: normalizeVendorDisplayList(plain?.vendor),
    },
  };
};

const buildSampleMatch = (query = {}) => {
  const match = {};
  const search = normalizeFilterValue(query.search);
  const brand = normalizeFilterValue(query.brand);
  const vendor = normalizeFilterValue(query.vendor);
  const dateFrom = parseDateBoundary(query.date_from || query.dateFrom);
  const dateTo = parseDateBoundary(query.date_to || query.dateTo, true);

  if (brand) match.brand = { $regex: `^${escapeRegex(brand)}$`, $options: "i" };
  if (vendor) {
    Object.assign(match, buildVendorsArrayFilter({ field: "vendor", vendorId: vendor, vendorName: vendor }));
  }
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
      { "vendor.name": { $regex: escaped, $options: "i" } },
      buildVendorsArrayFilter({ field: "vendor", vendorName: search }),
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
        vendor: normalizeVendorDisplayList(sample?.vendor).join(", "),
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

const hasStoredImage = (image) => {
  return !!(image && (image.key || image.link));
};

const buildProductImageThumbnail = async (image, sampleCode) => {
  if (!hasStoredImage(image)) {
    return {
      product_image: image ? {
        key: image.key || "",
        originalName: image.originalName || "",
        contentType: image.contentType || "",
        size: image.size || 0,
        link: image.link || "",
        public_id: image.public_id || "",
      } : null,
      product_image_url: "",
    };
  }

  let link = image.link || "";
  if (image.key) {
    if (wasabiStorage.isConfigured()) {
      try {
        link = await wasabiStorage.getSignedObjectUrl(image.key, {
          expiresIn: 24 * 60 * 60,
          filename: image.originalName || `${sampleCode || "sample"}-product-image.jpg`,
        });
      } catch (err) {
        console.error("Failed to sign sample image key", err);
      }
    }
  }

  return {
    product_image: {
      key: image.key || "",
      originalName: image.originalName || `${sampleCode || "sample"}-product-image.jpg`,
      contentType: image.contentType || "image/jpeg",
      size: image.size || 0,
      link: image.link || "",
      public_id: image.public_id || image.key || "",
    },
    product_image_url: link,
  };
};

const buildEmptyStoredFile = () => ({
  key: "",
  originalName: "",
  contentType: "",
  size: 0,
  link: "",
  public_id: "",
});

const getImageExtension = (originalName = "", contentType = "") => {
  const extension = path.extname(String(originalName || "")).toLowerCase();
  if ([".jpg", ".jpeg", ".png"].includes(extension)) return extension;
  return String(contentType || "").toLowerCase() === "image/png" ? ".png" : ".jpg";
};

const copySampleImageToItemImage = async (sample = {}, itemCode = "") => {
  const sourceImage = sample?.image || {};
  const sourceKey = normalizeText(sourceImage.key || sourceImage.public_id);
  if (!sourceKey) return buildEmptyStoredFile();

  if (!wasabiStorage.isConfigured()) {
    throw new Error("Wasabi storage is not configured");
  }

  const objectPayload = await wasabiStorage.getObjectBuffer(sourceKey);
  const originalName =
    normalizeText(sourceImage.originalName) ||
    `${normalizeText(itemCode || sample?.code) || "item"}-product-image.jpg`;
  const contentType =
    normalizeText(objectPayload?.contentType) ||
    normalizeText(sourceImage.contentType) ||
    "image/jpeg";
  const extension = getImageExtension(originalName, contentType);
  const uploadResult = await wasabiStorage.uploadBuffer({
    buffer: objectPayload.buffer,
    key: wasabiStorage.createStorageKey({
      folder: "item-image",
      originalName,
      extension,
    }),
    originalName,
    contentType,
  });

  return {
    key: uploadResult.key,
    originalName,
    contentType,
    size: uploadResult.size || objectPayload.size || sourceImage.size || 0,
    link: "",
    public_id: uploadResult.key,
  };
};

exports.getSamples = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;
    const baseMatch = buildSampleMatch(req.query);
    const accessOptions = { vendorFields: ["vendor"] };
    const match = applyDataAccessMatch(baseMatch, req.user, accessOptions);
    const [samples, totalRecords, brandsRaw, vendorsRaw] = await Promise.all([
      Sample.find(match).sort({ updatedAt: -1, code: 1 }).skip(skip).limit(limit).lean(),
      Sample.countDocuments(match),
      Sample.distinct("brand", applyDataAccessMatch(buildSampleMatch({ ...req.query, brand: "" }), req.user, accessOptions)),
      Sample.distinct("vendor", applyDataAccessMatch(buildSampleMatch({ ...req.query, vendor: "" }), req.user, accessOptions)),
    ]);

    const includeThumbnail = req.query.include_product_image_thumbnail === "true";
    let data;
    if (includeThumbnail) {
      data = await Promise.all(
        samples.map(async (sample) => {
          const serialized = serializeSample(sample);
          const thumbnail = await buildProductImageThumbnail(sample.image, sample.code);
          return {
            ...serialized,
            ...thumbnail,
          };
        })
      );
    } else {
      data = samples.map(serializeSample);
    }

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
        vendors: normalizeVendorDisplayList(vendorsRaw),
      },
    });
  } catch (error) {
    console.error("Get Samples Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch samples",
      error: error.message,
    });
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

    const existingSample = await Sample.findOne({
      code: { $regex: `^${escapeRegex(code)}$`, $options: "i" },
    }).select("_id code");
    if (existingSample) {
      return res.status(400).json({
        success: false,
        message: `Sample code ${existingSample.code || code} already exists`,
      });
    }

    const boxMode = Object.values(BOX_PACKAGING_MODES).includes(payload.box_mode)
      ? payload.box_mode
      : BOX_PACKAGING_MODES.INDIVIDUAL;
    const sample = new Sample({
      code,
      name: normalizeText(payload.name),
      description: normalizeText(payload.description),
      brand: normalizeText(payload.brand),
      vendor: getVendorPayloadList(payload),
      item_sizes: normalizeItemSizeEntries(parseJsonBodyField(payload.item_sizes, "item_sizes")),
      box_sizes: normalizeBoxSizeEntries(parseJsonBodyField(payload.box_sizes, "box_sizes"), boxMode),
      box_mode: boxMode,
      cbm: Math.max(0, toSafeNumber(payload.cbm, 0)),
      shipment: payload.shipment !== undefined
        ? normalizeShipmentEntries(parseJsonBodyField(payload.shipment, "shipment"), actor)
        : [],
      updated_by: actor,
    });

    await sample.save();
    return res.status(201).json({
      success: true,
      message: "Sample created successfully",
      data: serializeSample(sample),
    });
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
    const sample = await Sample.findOne(
      applyDataAccessMatch({ _id: req.params.id }, req.user, {
        vendorFields: ["vendor"],
      }),
    );
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const actor = buildAuditActor(req.user);
    const nextCode = normalizeText(payload.code || sample.code).toUpperCase();
    if (!nextCode) return res.status(400).json({ success: false, message: "code is required" });
    if (nextCode.toLowerCase() !== normalizeLower(sample.code)) {
      const existingSample = await Sample.findOne({
        _id: { $ne: sample._id },
        code: { $regex: `^${escapeRegex(nextCode)}$`, $options: "i" },
      }).select("_id code");
      if (existingSample) {
        return res.status(400).json({
          success: false,
          message: `Sample code ${existingSample.code || nextCode} already exists`,
        });
      }
    }

    sample.code = nextCode;
    sample.name = normalizeText(payload.name ?? sample.name);
    sample.description = normalizeText(payload.description ?? sample.description);
    sample.brand = normalizeText(payload.brand ?? sample.brand);
    if (
      payload.vendor !== undefined ||
      payload.vendors !== undefined ||
      payload.vendor_id !== undefined ||
      payload.vendorId !== undefined ||
      payload.vendor_ids !== undefined ||
      payload.vendorIds !== undefined
    ) {
      sample.vendor = getVendorPayloadList(payload);
    }
    if (payload.item_sizes !== undefined) {
      sample.item_sizes = normalizeItemSizeEntries(parseJsonBodyField(payload.item_sizes, "item_sizes"));
    }
    if (payload.box_mode !== undefined) {
      sample.box_mode = Object.values(BOX_PACKAGING_MODES).includes(payload.box_mode)
        ? payload.box_mode
        : BOX_PACKAGING_MODES.INDIVIDUAL;
    }
    if (payload.box_sizes !== undefined) {
      sample.box_sizes = normalizeBoxSizeEntries(parseJsonBodyField(payload.box_sizes, "box_sizes"), sample.box_mode);
    }
    if (payload.cbm !== undefined) sample.cbm = Math.max(0, toSafeNumber(payload.cbm, 0));
    if (payload.shipment !== undefined) {
      sample.shipment = normalizeShipmentEntries(parseJsonBodyField(payload.shipment, "shipment"), actor);
    }
    sample.updated_by = actor;
    await sample.save();
    return res.status(200).json({
      success: true,
      message: "Sample updated successfully",
      data: serializeSample(sample),
    });
  } catch (error) {
    return res.status(isBadRequestError(error) ? 400 : 500).json({
      success: false,
      message: error?.message || "Failed to update sample",
      error: error.message,
    });
  }
};

exports.finalizeSampleShipment = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const sample = await Sample.findOne(
      applyDataAccessMatch({ _id: req.params.id }, req.user, {
        vendorFields: ["vendor"],
      }),
    );
    if (!sample) return res.status(404).json({ success: false, message: "Sample not found" });
    const actor = buildAuditActor(req.user);
    const shipmentEntry = normalizeShipmentEntries([req.body], actor)[0];
    sample.shipment = Array.isArray(sample.shipment) ? sample.shipment : [];
    sample.shipment.push(shipmentEntry);
    sample.updated_by = actor;
    await sample.save();
    return res.status(200).json({
      success: true,
      message: "Sample shipment updated successfully",
      data: serializeSample(sample),
    });
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
        { ...buildSampleMatch({ search, brand, vendor }), "shipment.0": { $exists: true } },
        req.user,
        { vendorFields: ["vendor"] },
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
        vendors: normalizeVendorDisplayList(samples.flatMap((sample) => sample?.vendor || [])),
        containers: normalizeDistinctValues(rows.map((row) => row?.container)),
        sample_codes: normalizeDistinctValues(samples.map((sample) => sample?.code)),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch shipped samples",
      error: error.message,
    });
  }
};

exports.uploadSampleFile = async (req, res) => {
  try {
    const sampleId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(sampleId)) {
      return res.status(400).json({ success: false, message: "Invalid sample ID" });
    }

    const fileType = (req.body?.file_type || req.body?.fileType || "").trim().toLowerCase();
    if (fileType !== "product_image") {
      return res.status(400).json({ success: false, message: "Invalid file type" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const mimeType = String(file.mimetype || "").toLowerCase();
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
    const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

    if (!ALLOWED_MIME_TYPES.has(mimeType) || !ALLOWED_EXTENSIONS.has(extension)) {
      return res.status(400).json({ success: false, message: "Only JPG, JPEG, and PNG images are allowed" });
    }

    if (!wasabiStorage.isConfigured()) {
      return res.status(500).json({ success: false, message: "Wasabi storage is not configured" });
    }

    const sample = await Sample.findOne(
      applyDataAccessMatch({ _id: sampleId }, req.user, {
        vendorFields: ["vendor"],
      }),
    );
    if (!sample) {
      return res.status(404).json({ success: false, message: "Sample not found" });
    }

    const previousStorageKey = sample.image?.key;

    let uploadResult = null;
    try {
      uploadResult = await wasabiStorage.uploadBuffer({
        buffer: file.buffer,
        key: wasabiStorage.createStorageKey({
          folder: "samples/images",
          originalName: file.originalname || `${sample.code}-product-image.jpg`,
          extension,
        }),
        originalName: file.originalname || `${sample.code}-product-image.jpg`,
        contentType: mimeType,
      });
    } catch (uploadError) {
      throw uploadError;
    }

    sample.image = {
      key: uploadResult.key,
      originalName: file.originalname || `${sample.code}-product-image.jpg`,
      contentType: mimeType,
      size: uploadResult.size || file.size || 0,
      link: "",
      public_id: uploadResult.key,
    };
    sample.updated_by = buildAuditActor(req.user);
    try {
      await sample.save();
    } catch (saveError) {
      if (uploadResult?.key) {
        await wasabiStorage.deleteObject(uploadResult.key).catch((cleanupError) => {
          console.error("Rollback uploaded sample image failed:", cleanupError);
        });
      }
      throw saveError;
    }

    if (previousStorageKey) {
      wasabiStorage.deleteObject(previousStorageKey).catch((error) => {
        console.error("Delete previous sample image failed:", error);
      });
    }

    return res.status(200).json({
      success: true,
      message: "Sample image uploaded successfully",
      data: {
        key: sample.image.key,
        originalName: sample.image.originalName,
        contentType: sample.image.contentType,
        size: sample.image.size,
        link: sample.image.link,
        public_id: sample.image.public_id,
      },
    });
  } catch (error) {
    console.error("Upload Sample File Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload sample file",
      error: error.message,
    });
  }
};

exports.convertToItem = async (req, res) => {
  try {
    const sampleId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(sampleId)) {
      return res.status(400).json({ success: false, message: "Invalid sample ID" });
    }

    const { code, name, description } = req.body || {};
    const normalizedCode = String(code || "").trim().toUpperCase();
    const normalizedName = String(name || "").trim();
    const normalizedDescription = String(description || "").trim();

    if (!normalizedCode) {
      return res.status(400).json({ success: false, message: "Item code is required" });
    }
    if (!normalizedName) {
      return res.status(400).json({ success: false, message: "Item name is required" });
    }
    if (!normalizedDescription) {
      return res.status(400).json({ success: false, message: "Item description is required" });
    }

    // Fetch sample with data access protection
    const sample = await Sample.findOne(
      applyDataAccessMatch({ _id: sampleId }, req.user, {
        vendorFields: ["vendor"],
      }),
    );
    if (!sample) {
      return res.status(404).json({ success: false, message: "Sample not found" });
    }
    if (sample.converted_item?.item) {
      return res.status(400).json({
        success: false,
        message: `Sample is already converted to item ${sample.converted_item.code || ""}`.trim(),
      });
    }

    // Validate brand and vendor on sample
    const sampleBrand = normalizeText(sample.brand);
    const sampleVendors = normalizeVendorList(sample.vendor);
    if (!sampleBrand) {
      return res.status(400).json({ success: false, message: "Sample brand is required for conversion" });
    }
    if (sampleVendors.length === 0) {
      return res.status(400).json({ success: false, message: "Sample must have at least one vendor for conversion" });
    }

    // Check duplicate item code
    const existingItem = await Item.findOne({
      code: { $regex: `^${escapeRegex(normalizedCode)}$`, $options: "i" },
    }).select("_id code");
    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: `Item code ${existingItem.code || normalizedCode} already exists`,
      });
    }

    // Calculate CBM
    const summary = buildBoxMeasurementCbmSummary({
      sizes: sample.box_sizes,
      mode: sample.box_mode,
    });

    const totalCbmVal = (summary.total && summary.total !== "0") ? summary.total : (sample.cbm > 0 ? String(sample.cbm) : "0");
    const topCbmVal = (summary.total && summary.total !== "0") ? (summary.first || "0") : "0";
    const bottomCbmVal = (summary.total && summary.total !== "0") ? (summary.second || "0") : "0";

    const itemCbm = {
      top: topCbmVal,
      bottom: bottomCbmVal,
      total: totalCbmVal,
      inspected_top: topCbmVal,
      inspected_bottom: bottomCbmVal,
      inspected_total: totalCbmVal,
      calculated_inspected_total: totalCbmVal,
      calculated_pis_total: "0",
      calculated_total: totalCbmVal,
    };

    const itemImage = await copySampleImageToItemImage(sample, normalizedCode);

    // Create the Item
    const item = new Item({
      code: normalizedCode,
      name: normalizedName,
      description: normalizedDescription,
      brand: sampleBrand,
      brand_name: sampleBrand,
      brands: [sampleBrand],
      vendors: sampleVendors,
      inspected_item_sizes: (Array.isArray(sample.item_sizes) ? sample.item_sizes : []).map(size => ({
        L: size.L,
        B: size.B,
        H: size.H,
        remark: size.remark,
        net_weight: size.net_weight,
        gross_weight: size.gross_weight,
      })),
      inspected_box_sizes: (Array.isArray(sample.box_sizes) ? sample.box_sizes : []).map(size => ({
        L: size.L,
        B: size.B,
        H: size.H,
        remark: size.remark,
        net_weight: size.net_weight,
        gross_weight: size.gross_weight,
        box_type: size.box_type,
        item_count_in_inner: size.item_count_in_inner,
        box_count_in_master: size.box_count_in_master,
      })),
      inspected_box_mode: sample.box_mode,
      cbm: itemCbm,
      image: itemImage,
      source: {
        from_orders: false,
        from_qc: false,
      },
    });

    // Append update history
    appendItemUpdateHistory(item, {
      before: {},
      after: item.toObject(),
      reqUser: req.user,
      action: "create",
      source: "sample_conversion",
      route: "POST /samples/:id/convert-to-item",
    });

    try {
      await item.save();
    } catch (saveError) {
      if (itemImage.key) {
        await wasabiStorage.deleteObject(itemImage.key).catch((cleanupError) => {
          console.error("Rollback converted item image failed:", cleanupError);
        });
      }
      throw saveError;
    }

    // Update sample with converted details
    sample.converted_item = {
      item: item._id,
      code: item.code,
      name: item.name,
      description: item.description,
      converted_at: new Date(),
      converted_by: buildAuditActor(req.user),
    };
    await sample.save();

    return res.status(201).json({
      success: true,
      message: "Sample converted to item successfully",
      data: {
        item,
        sample: serializeSample(sample),
      },
    });
  } catch (error) {
    console.error("Convert Sample to Item Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to convert sample to item",
      error: error.message,
    });
  }
};

exports.flattenSampleShipmentRows = flattenSampleShipmentRows;

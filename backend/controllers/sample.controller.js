const mongoose = require("mongoose");

const Sample = require("../models/sample.model");
const { BOX_PACKAGING_MODES, BOX_ENTRY_TYPES } = require("../helpers/boxMeasurement");
const { normalizeUserRoleKey } = require("../helpers/userRole");
const { calculateTotalPoCbm } = require("../services/orderCbm.service");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");

const SHIPPED_BY_VENDOR_ID = "shipped_by_vendor";
const SHIPPED_BY_VENDOR_NAME = "Shipped By Vendor";
const SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze(["item", "top", "base", "item1", "item2", "item3", "item4"]);
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
        : SIZE_ENTRY_LIMIT;
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
    vendors: normalizeDistinctValues(plain?.vendor),
    vendor_summary: {
      vendors: normalizeDistinctValues(plain?.vendor),
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
    match.vendor = { $elemMatch: { $regex: escapeRegex(vendor), $options: "i" } };
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
      { vendor: { $elemMatch: { $regex: escaped, $options: "i" } } },
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
    const accessOptions = { vendorFields: ["vendor"] };
    const match = applyDataAccessMatch(baseMatch, req.user, accessOptions);
    const [samples, totalRecords, brandsRaw, vendorsRaw] = await Promise.all([
      Sample.find(match).sort({ updatedAt: -1, code: 1 }).skip(skip).limit(limit).lean(),
      Sample.countDocuments(match),
      Sample.distinct("brand", applyDataAccessMatch(buildSampleMatch({ ...req.query, brand: "" }), req.user, accessOptions)),
      Sample.distinct("vendor", applyDataAccessMatch(buildSampleMatch({ ...req.query, vendor: "" }), req.user, accessOptions)),
    ]);

    return res.status(200).json({
      success: true,
      data: samples.map(serializeSample),
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        brands: normalizeDistinctValues(brandsRaw),
        vendors: normalizeDistinctValues(vendorsRaw),
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
      vendor: normalizeVendorList(payload.vendor),
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
    if (payload.vendor !== undefined) sample.vendor = normalizeVendorList(payload.vendor);
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
        vendors: normalizeDistinctValues(samples.map((sample) => sample?.vendor)),
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

exports.flattenSampleShipmentRows = flattenSampleShipmentRows;

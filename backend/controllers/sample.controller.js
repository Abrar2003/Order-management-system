const Sample = require("../models/sample.model");
const { BOX_PACKAGING_MODES, BOX_ENTRY_TYPES } = require("../helpers/boxMeasurement");

const SHIPPED_BY_VENDOR_ID = "shipped_by_vendor";
const SHIPPED_BY_VENDOR_NAME = "Shipped By Vendor";
const SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARK_OPTIONS = ["item", "top", "base", "item1", "item2", "item3", "item4"];

const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeText = (value) => String(value ?? "").trim();

const normalizeFilterValue = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "null" || lowered === "undefined") {
    return null;
  }
  return normalized;
};

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
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

const normalizeVendorList = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => normalizeText(entry)).filter(Boolean))];
  }

  const normalized = normalizeText(value);
  if (!normalized) return [];

  return [...new Set(
    normalized
      .split(",")
      .map((entry) => normalizeText(entry))
      .filter(Boolean),
  )];
};

const normalizeShipmentInvoiceNumber = (value, fallback = "") => {
  const normalized = normalizeText(value);
  return normalized || normalizeText(fallback);
};

const buildAuditActor = (user = {}) => ({
  user: user?._id || null,
  name: normalizeText(user?.name || user?.email || user?.role || ""),
});

const normalizeShipmentStuffedBy = (input = {}) => {
  const id = normalizeText(input?.id || input?._id);
  const name = normalizeText(input?.name);

  if (id === SHIPPED_BY_VENDOR_ID || name.toLowerCase() === SHIPPED_BY_VENDOR_NAME.toLowerCase()) {
    return {
      id: null,
      name: SHIPPED_BY_VENDOR_NAME,
    };
  }

  if (!id && !name) {
    throw new Error("stuffed_by is required");
  }

  return {
    id: id || null,
    name: name || id,
  };
};

const parseJsonBodyField = (value, label) => {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (Array.isArray(value)) return value;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`${label} must be valid JSON`);
  }
};

const normalizeItemSizeEntries = (entries = []) => {
  if (!Array.isArray(entries)) {
    throw new Error("item_sizes must be an array");
  }
  if (entries.length > SIZE_ENTRY_LIMIT) {
    throw new Error(`item_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`);
  }

  const seenRemarks = new Set();
  return entries.map((entry, index) => {
    const label = `item_sizes[${index + 1}]`;
    const L = toNonNegativeNumber(entry?.L ?? 0, `${label}.L`);
    const B = toNonNegativeNumber(entry?.B ?? 0, `${label}.B`);
    const H = toNonNegativeNumber(entry?.H ?? 0, `${label}.H`);
    const netWeight = toNonNegativeNumber(
      entry?.net_weight ?? 0,
      `${label}.net_weight`,
    );
    const grossWeight = toNonNegativeNumber(
      entry?.gross_weight ?? 0,
      `${label}.gross_weight`,
    );
    const remark = normalizeText(entry?.remark).toLowerCase();

    if ((L > 0 || B > 0 || H > 0) && (!L || !B || !H)) {
      throw new Error(`${label} must include positive L, B, and H values`);
    }

    if (entries.length > 1) {
      if (!remark) {
        throw new Error(`${label}.remark is required`);
      }
      if (!ITEM_SIZE_REMARK_OPTIONS.includes(remark)) {
        throw new Error(`${label}.remark is invalid`);
      }
      if (seenRemarks.has(remark)) {
        throw new Error("item_sizes remarks must be unique");
      }
      seenRemarks.add(remark);
    }

    return {
      L,
      B,
      H,
      remark: entries.length > 1 ? remark : "",
      net_weight: netWeight,
      gross_weight: grossWeight,
    };
  });
};

const normalizeBoxSizeEntries = (entries = [], boxMode = BOX_PACKAGING_MODES.INDIVIDUAL) => {
  if (!Array.isArray(entries)) {
    throw new Error("box_sizes must be an array");
  }
  if (entries.length > SIZE_ENTRY_LIMIT) {
    throw new Error(`box_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`);
  }

  return entries.map((entry, index) => {
    const label = `box_sizes[${index + 1}]`;
    const L = toNonNegativeNumber(entry?.L ?? 0, `${label}.L`);
    const B = toNonNegativeNumber(entry?.B ?? 0, `${label}.B`);
    const H = toNonNegativeNumber(entry?.H ?? 0, `${label}.H`);
    const netWeight = toNonNegativeNumber(
      entry?.net_weight ?? 0,
      `${label}.net_weight`,
    );
    const grossWeight = toNonNegativeNumber(
      entry?.gross_weight ?? 0,
      `${label}.gross_weight`,
    );

    if ((L > 0 || B > 0 || H > 0) && (!L || !B || !H)) {
      throw new Error(`${label} must include positive L, B, and H values`);
    }

    if (boxMode === BOX_PACKAGING_MODES.CARTON) {
      const isInner = index === 0;
      return {
        L,
        B,
        H,
        remark: isInner ? "inner" : "master",
        net_weight: netWeight,
        gross_weight: grossWeight,
        box_type: isInner ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
        item_count_in_inner: isInner
          ? toNonNegativeNumber(entry?.item_count_in_inner ?? 0, `${label}.item_count_in_inner`)
          : 0,
        box_count_in_master: isInner
          ? 0
          : toNonNegativeNumber(
              entry?.box_count_in_master ?? 0,
              `${label}.box_count_in_master`,
            ),
      };
    }

    return {
      L,
      B,
      H,
      remark: normalizeText(entry?.remark).toLowerCase(),
      net_weight: netWeight,
      gross_weight: grossWeight,
      box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
      item_count_in_inner: 0,
      box_count_in_master: 0,
    };
  });
};

const buildSampleMatch = ({ search, brand, vendor, shippedOnly = false } = {}) => {
  const match = {};
  const normalizedBrand = normalizeFilterValue(brand);
  const normalizedVendor = normalizeFilterValue(vendor);
  const normalizedSearch = normalizeFilterValue(search);

  if (normalizedBrand) {
    match.brand = { $regex: escapeRegex(normalizedBrand), $options: "i" };
  }
  if (normalizedVendor) {
    match.vendor = { $elemMatch: { $regex: escapeRegex(normalizedVendor), $options: "i" } };
  }
  if (normalizedSearch) {
    const escaped = escapeRegex(normalizedSearch);
    match.$or = [
      { code: { $regex: escaped, $options: "i" } },
      { name: { $regex: escaped, $options: "i" } },
      { description: { $regex: escaped, $options: "i" } },
      { brand: { $regex: escaped, $options: "i" } },
      { vendor: { $elemMatch: { $regex: escaped, $options: "i" } } },
      ...(normalizedSearch.toLowerCase() === "sample"
        ? [{ code: { $exists: true } }]
        : []),
    ];
  }
  if (shippedOnly) {
    match["shipment.0"] = { $exists: true };
  }

  return match;
};

const normalizeDistinctValues = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => normalizeText(value))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

const calculateShipmentCbm = (sample = {}, quantity = 0) => {
  const perUnitCbm = Math.max(0, Number(sample?.cbm || 0));
  return Number((perUnitCbm * Math.max(0, Number(quantity || 0))).toFixed(3));
};

const isBadRequestError = (error) => {
  const normalized = String(error?.message || "").trim().toLowerCase();
  return (
    normalized.includes("required")
    || normalized.includes("must be")
    || normalized.includes("invalid")
    || normalized.includes("already exists")
    || normalized.includes("not found")
  );
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
        per_item_cbm: Math.max(0, Number(sample?.cbm || 0)),
        createdAt: sample?.createdAt || null,
        updatedAt: sample?.updatedAt || null,
      };
    });
  });

exports.getSamples = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;
    const match = buildSampleMatch({ search, brand, vendor });

    const [samples, totalRecords, brandsRaw, vendorsRaw, codesRaw] = await Promise.all([
      Sample.find(match)
        .sort({ updatedAt: -1, code: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Sample.countDocuments(match),
      Sample.distinct("brand", buildSampleMatch({ search, vendor })),
      Sample.distinct("vendor", buildSampleMatch({ search, brand })),
      Sample.distinct("code", buildSampleMatch({ brand, vendor })),
    ]);

    return res.status(200).json({
      success: true,
      data: samples,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        brands: normalizeDistinctValues(brandsRaw),
        vendors: normalizeDistinctValues(vendorsRaw),
        sample_codes: normalizeDistinctValues(codesRaw),
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
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const code = normalizeText(payload.code).toUpperCase();

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "code is required",
      });
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

    const itemSizes = normalizeItemSizeEntries(
      parseJsonBodyField(payload.item_sizes, "item_sizes"),
    );
    const boxMode = Object.values(BOX_PACKAGING_MODES).includes(payload.box_mode)
      ? payload.box_mode
      : BOX_PACKAGING_MODES.INDIVIDUAL;
    const boxSizes = normalizeBoxSizeEntries(
      parseJsonBodyField(payload.box_sizes, "box_sizes"),
      boxMode,
    );
    const cbm = Math.max(0, toSafeNumber(payload.cbm, 0));

    const sample = await Sample.create({
      code,
      name: normalizeText(payload.name),
      description: normalizeText(payload.description),
      brand: normalizeText(payload.brand),
      vendor: normalizeVendorList(payload.vendor),
      item_sizes: itemSizes,
      box_sizes: boxSizes,
      box_mode: boxMode,
      cbm,
      updated_by: buildAuditActor(req.user),
    });

    return res.status(201).json({
      success: true,
      message: "Sample created successfully",
      data: sample,
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
    const sample = await Sample.findById(req.params.id);
    if (!sample) {
      return res.status(404).json({
        success: false,
        message: "Sample not found",
      });
    }

    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const nextCode = normalizeText(payload.code || sample.code).toUpperCase();
    if (!nextCode) {
      return res.status(400).json({
        success: false,
        message: "code is required",
      });
    }

    if (nextCode.toLowerCase() !== String(sample.code || "").trim().toLowerCase()) {
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
    if (payload.vendor !== undefined) {
      sample.vendor = normalizeVendorList(payload.vendor);
    }
    if (payload.item_sizes !== undefined) {
      sample.item_sizes = normalizeItemSizeEntries(
        parseJsonBodyField(payload.item_sizes, "item_sizes"),
      );
    }
    if (payload.box_mode !== undefined) {
      sample.box_mode = Object.values(BOX_PACKAGING_MODES).includes(payload.box_mode)
        ? payload.box_mode
        : BOX_PACKAGING_MODES.INDIVIDUAL;
    }
    if (payload.box_sizes !== undefined) {
      sample.box_sizes = normalizeBoxSizeEntries(
        parseJsonBodyField(payload.box_sizes, "box_sizes"),
        sample.box_mode,
      );
    }
    if (payload.cbm !== undefined) {
      sample.cbm = Math.max(0, toSafeNumber(payload.cbm, 0));
    }
    if (payload.shipment !== undefined) {
      if (!Array.isArray(payload.shipment)) {
        return res.status(400).json({
          success: false,
          message: "shipment must be an array",
        });
      }

      sample.shipment = payload.shipment.map((entry, index) => {
        const container = normalizeText(entry?.container);
        const stuffingDate = entry?.stuffing_date ? new Date(entry.stuffing_date) : null;
        const quantity = Number(entry?.quantity);
        if (!container) {
          throw new Error(`shipment[${index + 1}] container is required`);
        }
        if (!(stuffingDate instanceof Date) || Number.isNaN(stuffingDate.getTime())) {
          throw new Error(`shipment[${index + 1}] stuffing_date is invalid`);
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(`shipment[${index + 1}] quantity must be a positive number`);
        }

        return {
          container,
          invoice_number: normalizeShipmentInvoiceNumber(entry?.invoice_number, ""),
          stuffing_date: stuffingDate,
          quantity,
          pending: Math.max(0, toSafeNumber(entry?.pending, 0)),
          remaining_remarks: normalizeText(entry?.remaining_remarks),
          stuffed_by: normalizeShipmentStuffedBy(entry?.stuffed_by),
          updated_at: new Date(),
          updated_by: buildAuditActor(req.user),
        };
      });
    }

    sample.updated_by = buildAuditActor(req.user);
    await sample.save();

    return res.status(200).json({
      success: true,
      message: "Sample updated successfully",
      data: sample,
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
    const sample = await Sample.findById(req.params.id);
    if (!sample) {
      return res.status(404).json({
        success: false,
        message: "Sample not found",
      });
    }

    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const parsedContainer = normalizeText(payload.container);
    const parsedInvoiceNumber = normalizeShipmentInvoiceNumber(
      payload.invoice_number ?? payload.invoiceNumber ?? payload.invoice,
      "",
    );
    const parsedStuffingDate = new Date(payload.stuffing_date);
    let parsedStuffedBy;

    if (!parsedContainer) {
      return res.status(400).json({
        message: "container is required",
      });
    }
    if (!(parsedStuffingDate instanceof Date) || Number.isNaN(parsedStuffingDate.getTime())) {
      return res.status(400).json({
        message: "stuffing_date is invalid",
      });
    }
    try {
      parsedStuffedBy = normalizeShipmentStuffedBy(payload.stuffed_by);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    const parsedQuantity = Number(payload.quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({
        message: "quantity must be a valid positive number",
      });
    }

    sample.shipment = Array.isArray(sample.shipment) ? sample.shipment : [];
    sample.shipment.push({
      container: parsedContainer,
      invoice_number: parsedInvoiceNumber,
      stuffing_date: parsedStuffingDate,
      quantity: parsedQuantity,
      pending: 0,
      remaining_remarks: normalizeText(payload.remarks ?? payload.remaining_remarks),
      stuffed_by: parsedStuffedBy,
      updated_at: new Date(),
      updated_by: buildAuditActor(req.user),
    });
    sample.updated_by = buildAuditActor(req.user);
    await sample.save();

    return res.status(200).json({
      success: true,
      message: "Sample shipment updated successfully",
      data: sample,
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
      buildSampleMatch({ search, brand, vendor, shippedOnly: true }),
    )
      .sort({ updatedAt: -1, code: 1 })
      .lean();

    const rows = flattenSampleShipmentRows(samples).filter((row) => {
      if (!container) return true;
      return String(row?.container || "")
        .toLowerCase()
        .includes(container.toLowerCase());
    });

    const totalRecords = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;

    return res.status(200).json({
      success: true,
      data: rows.slice(skip, skip + limit),
      pagination: {
        page: safePage,
        limit,
        totalPages,
        totalRecords,
      },
      summary: {
        total: totalRecords,
        total_quantity: rows.reduce(
          (sum, row) => sum + Math.max(0, Number(row?.quantity || 0)),
          0,
        ),
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

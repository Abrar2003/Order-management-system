const Item = require("../models/item.model");
const Order = require("../models/order.model");
const mongoose = require("mongoose");
const { syncAllItemsFromOrdersAndQc } = require("../services/itemSync");

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

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const normalizeTextField = (value) => String(value ?? "").trim();

const toNonNegativeNumber = (value, fieldLabel) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel} must be a non-negative number`);
  }
  return parsed;
};

const toBooleanValue = (value, fieldLabel) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n", ""].includes(normalized)) return false;

  throw new Error(`${fieldLabel} must be a boolean`);
};

const toNormalizedDecimalText = (value, fieldLabel) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return "0";

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel} must be a non-negative number`);
  }

  const fixed = parsed.toFixed(6);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const calculateCbmFromLbh = (box = {}) => {
  const length = Math.max(0, Number(box?.L || 0));
  const breadth = Math.max(0, Number(box?.B || 0));
  const height = Math.max(0, Number(box?.H || 0));
  if (!Number.isFinite(length) || !Number.isFinite(breadth) || !Number.isFinite(height)) {
    return "0";
  }
  if (length <= 0 || breadth <= 0 || height <= 0) return "0";

  const cubicMeters = (length * breadth * height) / 1000000;
  const fixed = cubicMeters.toFixed(6);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const applyCalculatedCbmTotals = (item, setPath) => {
  const calculatedFromInspected = calculateCbmFromLbh(
    item?.inspected_box_LBH || item?.box_LBH || {},
  );
  const calculatedFromPis = calculateCbmFromLbh(
    item?.pis_box_LBH || item?.box_LBH || {},
  );

  setPath("cbm.inspected_total", calculatedFromInspected);
  setPath("cbm.calculated_inspected_total", calculatedFromInspected);
  setPath("cbm.calculated_pis_total", calculatedFromPis);
  setPath("cbm.calculated_total", calculatedFromInspected);
};

const normalizeDistinctValues = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const toTimestamp = (value) => {
  if (!value) return 0;
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  const asString = String(value).trim();
  if (!asString) return 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    const parsed = new Date(`${asString}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(asString)) {
    const [day, month, year] = asString.split(/[/-]/).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const resolveInspectorName = (inspectorValue) => {
  if (!inspectorValue) return "";
  if (typeof inspectorValue === "string") return inspectorValue.trim();
  return String(
    inspectorValue?.name || inspectorValue?.email || inspectorValue?._id || "",
  ).trim();
};

const buildItemMatch = ({ search, brand, vendor } = {}) => {
  const conditions = [];
  const normalizedSearch = normalizeFilterValue(search);
  const normalizedBrand = normalizeFilterValue(brand);
  const normalizedVendor = normalizeFilterValue(vendor);

  if (normalizedSearch) {
    const escaped = escapeRegex(normalizedSearch);
    conditions.push({
      $or: [
        { code: { $regex: escaped, $options: "i" } },
        { name: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { brand: { $regex: escaped, $options: "i" } },
        { brand_name: { $regex: escaped, $options: "i" } },
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
    conditions.push({ vendors: normalizedVendor });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
};

exports.getItems = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const match = buildItemMatch({ search, brand, vendor });

    const [items, totalRecords, brandsRaw, brandNamesRaw, brandsPrimaryRaw, vendorsRaw, codesRaw] =
      await Promise.all([
        Item.find(match)
          .sort({ updatedAt: -1, code: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Item.countDocuments(match),
        Item.distinct("brands", buildItemMatch({ search, vendor })),
        Item.distinct("brand_name", buildItemMatch({ search, vendor })),
        Item.distinct("brand", buildItemMatch({ search, vendor })),
        Item.distinct("vendors", buildItemMatch({ search, brand })),
        Item.distinct("code", buildItemMatch({ brand, vendor })),
      ]);

    return res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        brands: normalizeDistinctValues([
          ...(brandsPrimaryRaw || []),
          ...(brandsRaw || []),
          ...(brandNamesRaw || []),
        ]),
        vendors: normalizeDistinctValues(vendorsRaw),
        item_codes: normalizeDistinctValues(codesRaw),
      },
    });
  } catch (error) {
    console.error("Get Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch items",
      error: error.message,
    });
  }
};

exports.getItemOrdersHistory = async (req, res) => {
  try {
    const itemCodeInput = String(req.params.itemCode || "").trim();
    if (!itemCodeInput) {
      return res.status(400).json({
        success: false,
        message: "Item code is required",
      });
    }

    const escapedItemCode = escapeRegex(itemCodeInput);
    const itemCodeMatch = new RegExp(`^\\s*${escapedItemCode}\\s*$`, "i");

    const [itemDoc, orders] = await Promise.all([
      Item.findOne({ code: itemCodeMatch })
        .select("code name description brand brand_name brands vendors")
        .lean(),
      Order.find({ "item.item_code": itemCodeMatch })
        .select(
          "order_id item brand vendor order_date ETD revised_ETD status quantity archived qc_record updatedAt",
        )
        .populate({
          path: "qc_record",
          select: "inspector last_inspected_date quantities inspection_record",
          populate: [
            {
              path: "inspector",
              select: "name email",
            },
            {
              path: "inspection_record",
              select:
                "inspection_date requested_date vendor_requested vendor_offered checked passed pending_after remarks createdAt inspector",
              populate: {
                path: "inspector",
                select: "name email",
              },
            },
          ],
        })
        .sort({ order_date: -1, ETD: -1, updatedAt: -1, order_id: 1 })
        .lean(),
    ]);

    const orderRows = (Array.isArray(orders) ? orders : []).map((order) => {
      const qcRecord =
        order?.qc_record && typeof order.qc_record === "object"
          ? order.qc_record
          : null;
      const inspectionRecords = Array.isArray(qcRecord?.inspection_record)
        ? qcRecord.inspection_record
        : [];

      const mappedInspections = inspectionRecords
        .map((record) => ({
          id: String(record?._id || ""),
          inspector_name: resolveInspectorName(record?.inspector) || "N/A",
          inspection_date: String(record?.inspection_date || "").trim(),
          requested_date: String(record?.requested_date || "").trim(),
          vendor_requested: Math.max(0, toSafeNumber(record?.vendor_requested, 0)),
          vendor_offered: Math.max(0, toSafeNumber(record?.vendor_offered, 0)),
          checked: Math.max(0, toSafeNumber(record?.checked, 0)),
          passed: Math.max(0, toSafeNumber(record?.passed, 0)),
          pending_after: Math.max(0, toSafeNumber(record?.pending_after, 0)),
          remarks: String(record?.remarks || "").trim(),
          source: "inspection_record",
          __sortTime: Math.max(
            toTimestamp(record?.inspection_date),
            toTimestamp(record?.createdAt),
          ),
        }))
        .sort((a, b) => (b.__sortTime || 0) - (a.__sortTime || 0))
        .map(({ __sortTime, ...rest }) => rest);

      if (mappedInspections.length === 0 && qcRecord) {
        mappedInspections.push({
          id: `qc-snapshot-${order?._id || ""}`,
          inspector_name: resolveInspectorName(qcRecord?.inspector) || "N/A",
          inspection_date: String(qcRecord?.last_inspected_date || "").trim(),
          requested_date: "",
          vendor_requested: Math.max(
            0,
            toSafeNumber(qcRecord?.quantities?.quantity_requested, 0),
          ),
          vendor_offered: Math.max(
            0,
            toSafeNumber(qcRecord?.quantities?.vendor_provision, 0),
          ),
          checked: Math.max(0, toSafeNumber(qcRecord?.quantities?.qc_checked, 0)),
          passed: Math.max(0, toSafeNumber(qcRecord?.quantities?.qc_passed, 0)),
          pending_after: Math.max(
            0,
            toSafeNumber(qcRecord?.quantities?.pending, 0),
          ),
          remarks: "",
          source: "qc_snapshot",
        });
      }

      return {
        id: String(order?._id || ""),
        order_id: String(order?.order_id || "").trim(),
        brand: String(order?.brand || "").trim(),
        vendor: String(order?.vendor || "").trim(),
        status: String(order?.status || "").trim(),
        order_date: order?.order_date || null,
        ETD: order?.ETD || null,
        revised_ETD: order?.revised_ETD || null,
        quantity: Math.max(0, toSafeNumber(order?.quantity, 0)),
        archived: Boolean(order?.archived),
        item_code: String(order?.item?.item_code || "").trim(),
        item_description: String(order?.item?.description || "").trim(),
        inspections: mappedInspections,
      };
    });

    return res.status(200).json({
      success: true,
      item_code: itemDoc?.code || itemCodeInput,
      item: itemDoc || null,
      data: orderRows,
      summary: {
        total_orders: orderRows.length,
        total_inspection_rows: orderRows.reduce(
          (sum, entry) => sum + (Array.isArray(entry?.inspections) ? entry.inspections.length : 0),
          0,
        ),
      },
    });
  } catch (error) {
    console.error("Get Item Orders History Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch item order history",
      error: error.message,
    });
  }
};

exports.syncItemsFromOrders = async (req, res) => {
  try {
    const summary = await syncAllItemsFromOrdersAndQc();

    return res.status(200).json({
      success: true,
      message: "Items synced successfully from orders and QC records",
      summary,
    });
  } catch (error) {
    console.error("Sync Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to sync items from existing records",
      error: error.message,
    });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const lockedFields = [
      "code",
      "brand",
      "brand_name",
      "brands",
      "vendors",
      "pis_weight",
      "pis_item_LBH",
      "pis_box_LBH",
    ];
    const touchedLockedFields = lockedFields.filter((field) => hasOwn(payload, field));
    if (touchedLockedFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `These fields are read-only: ${touchedLockedFields.join(", ")}`,
      });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    let touched = false;
    const setPath = (path, value) => {
      item.set(path, value);
      touched = true;
    };

    if (hasOwn(payload, "name")) {
      setPath("name", normalizeTextField(payload.name));
    }

    if (hasOwn(payload, "description")) {
      setPath("description", normalizeTextField(payload.description));
    }

    if (payload?.inspected_weight && typeof payload.inspected_weight === "object") {
      if (hasOwn(payload.inspected_weight, "net")) {
        setPath(
          "inspected_weight.net",
          toNonNegativeNumber(payload.inspected_weight.net, "inspected_weight.net"),
        );
      }
      if (hasOwn(payload.inspected_weight, "gross")) {
        setPath(
          "inspected_weight.gross",
          toNonNegativeNumber(payload.inspected_weight.gross, "inspected_weight.gross"),
        );
      }
    }

    if (payload?.inspected_item_LBH && typeof payload.inspected_item_LBH === "object") {
      if (hasOwn(payload.inspected_item_LBH, "L")) {
        setPath(
          "inspected_item_LBH.L",
          toNonNegativeNumber(payload.inspected_item_LBH.L, "inspected_item_LBH.L"),
        );
      }
      if (hasOwn(payload.inspected_item_LBH, "B")) {
        setPath(
          "inspected_item_LBH.B",
          toNonNegativeNumber(payload.inspected_item_LBH.B, "inspected_item_LBH.B"),
        );
      }
      if (hasOwn(payload.inspected_item_LBH, "H")) {
        setPath(
          "inspected_item_LBH.H",
          toNonNegativeNumber(payload.inspected_item_LBH.H, "inspected_item_LBH.H"),
        );
      }
    }

    if (payload?.inspected_box_LBH && typeof payload.inspected_box_LBH === "object") {
      if (hasOwn(payload.inspected_box_LBH, "L")) {
        setPath(
          "inspected_box_LBH.L",
          toNonNegativeNumber(payload.inspected_box_LBH.L, "inspected_box_LBH.L"),
        );
      }
      if (hasOwn(payload.inspected_box_LBH, "B")) {
        setPath(
          "inspected_box_LBH.B",
          toNonNegativeNumber(payload.inspected_box_LBH.B, "inspected_box_LBH.B"),
        );
      }
      if (hasOwn(payload.inspected_box_LBH, "H")) {
        setPath(
          "inspected_box_LBH.H",
          toNonNegativeNumber(payload.inspected_box_LBH.H, "inspected_box_LBH.H"),
        );
      }
    }

    if (payload?.cbm && typeof payload.cbm === "object") {
      if (hasOwn(payload.cbm, "top")) {
        setPath("cbm.top", toNormalizedDecimalText(payload.cbm.top, "cbm.top"));
      }
      if (hasOwn(payload.cbm, "bottom")) {
        setPath("cbm.bottom", toNormalizedDecimalText(payload.cbm.bottom, "cbm.bottom"));
      }
      if (hasOwn(payload.cbm, "total")) {
        setPath("cbm.total", toNormalizedDecimalText(payload.cbm.total, "cbm.total"));
      }
      if (hasOwn(payload.cbm, "inspected_top")) {
        setPath(
          "cbm.inspected_top",
          toNormalizedDecimalText(payload.cbm.inspected_top, "cbm.inspected_top"),
        );
      }
      if (hasOwn(payload.cbm, "inspected_bottom")) {
        setPath(
          "cbm.inspected_bottom",
          toNormalizedDecimalText(payload.cbm.inspected_bottom, "cbm.inspected_bottom"),
        );
      }
      if (hasOwn(payload.cbm, "inspected_total")) {
        setPath(
          "cbm.inspected_total",
          toNormalizedDecimalText(payload.cbm.inspected_total, "cbm.inspected_total"),
        );
      }
    }

    if (payload?.qc && typeof payload.qc === "object") {
      if (hasOwn(payload.qc, "packed_size")) {
        setPath(
          "qc.packed_size",
          toBooleanValue(payload.qc.packed_size, "qc.packed_size"),
        );
      }
      if (hasOwn(payload.qc, "finishing")) {
        setPath("qc.finishing", toBooleanValue(payload.qc.finishing, "qc.finishing"));
      }
      if (hasOwn(payload.qc, "branding")) {
        setPath("qc.branding", toBooleanValue(payload.qc.branding, "qc.branding"));
      }
      if (hasOwn(payload.qc, "barcode")) {
        setPath("qc.barcode", toNonNegativeNumber(payload.qc.barcode, "qc.barcode"));
      }
      if (hasOwn(payload.qc, "last_inspected_date")) {
        setPath("qc.last_inspected_date", normalizeTextField(payload.qc.last_inspected_date));
      }

      if (payload.qc?.quantities && typeof payload.qc.quantities === "object") {
        if (hasOwn(payload.qc.quantities, "checked")) {
          setPath(
            "qc.quantities.checked",
            toNonNegativeNumber(payload.qc.quantities.checked, "qc.quantities.checked"),
          );
        }
        if (hasOwn(payload.qc.quantities, "passed")) {
          setPath(
            "qc.quantities.passed",
            toNonNegativeNumber(payload.qc.quantities.passed, "qc.quantities.passed"),
          );
        }
        if (hasOwn(payload.qc.quantities, "pending")) {
          setPath(
            "qc.quantities.pending",
            toNonNegativeNumber(payload.qc.quantities.pending, "qc.quantities.pending"),
          );
        }
      }
    }

    if (payload?.source && typeof payload.source === "object") {
      if (hasOwn(payload.source, "from_orders")) {
        setPath(
          "source.from_orders",
          toBooleanValue(payload.source.from_orders, "source.from_orders"),
        );
      }
      if (hasOwn(payload.source, "from_qc")) {
        setPath("source.from_qc", toBooleanValue(payload.source.from_qc, "source.from_qc"));
      }
    }

    if (touched) {
      applyCalculatedCbmTotals(item, setPath);
    }

    if (!touched) {
      return res.status(400).json({
        success: false,
        message: "No editable fields provided",
      });
    }

    await item.save();

    return res.status(200).json({
      success: true,
      message: "Item updated successfully",
      data: item.toObject(),
    });
  } catch (error) {
    console.error("Update Item Error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update item",
    });
  }
};

exports.updateItemPis = async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    let touched = false;
    const setPath = (path, value) => {
      item.set(path, value);
      touched = true;
    };

    if (payload?.pis_weight && typeof payload.pis_weight === "object") {
      if (hasOwn(payload.pis_weight, "net")) {
        setPath(
          "pis_weight.net",
          toNonNegativeNumber(payload.pis_weight.net, "pis_weight.net"),
        );
      }
      if (hasOwn(payload.pis_weight, "gross")) {
        setPath(
          "pis_weight.gross",
          toNonNegativeNumber(payload.pis_weight.gross, "pis_weight.gross"),
        );
      }
    }

    if (payload?.pis_item_LBH && typeof payload.pis_item_LBH === "object") {
      if (hasOwn(payload.pis_item_LBH, "L")) {
        setPath(
          "pis_item_LBH.L",
          toNonNegativeNumber(payload.pis_item_LBH.L, "pis_item_LBH.L"),
        );
      }
      if (hasOwn(payload.pis_item_LBH, "B")) {
        setPath(
          "pis_item_LBH.B",
          toNonNegativeNumber(payload.pis_item_LBH.B, "pis_item_LBH.B"),
        );
      }
      if (hasOwn(payload.pis_item_LBH, "H")) {
        setPath(
          "pis_item_LBH.H",
          toNonNegativeNumber(payload.pis_item_LBH.H, "pis_item_LBH.H"),
        );
      }
    }

    if (payload?.pis_box_LBH && typeof payload.pis_box_LBH === "object") {
      if (hasOwn(payload.pis_box_LBH, "L")) {
        setPath(
          "pis_box_LBH.L",
          toNonNegativeNumber(payload.pis_box_LBH.L, "pis_box_LBH.L"),
        );
      }
      if (hasOwn(payload.pis_box_LBH, "B")) {
        setPath(
          "pis_box_LBH.B",
          toNonNegativeNumber(payload.pis_box_LBH.B, "pis_box_LBH.B"),
        );
      }
      if (hasOwn(payload.pis_box_LBH, "H")) {
        setPath(
          "pis_box_LBH.H",
          toNonNegativeNumber(payload.pis_box_LBH.H, "pis_box_LBH.H"),
        );
      }
    }

    if (!touched) {
      return res.status(400).json({
        success: false,
        message: "No PIS fields provided",
      });
    }

    applyCalculatedCbmTotals(item, setPath);
    await item.save();

    return res.status(200).json({
      success: true,
      message: "PIS values updated successfully",
      data: item.toObject(),
    });
  } catch (error) {
    console.error("Update Item PIS Error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update PIS values",
    });
  }
};

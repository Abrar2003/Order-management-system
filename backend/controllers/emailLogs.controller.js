const mongoose = require("mongoose");

const EmailLogs = require("../models/emailLogs.model");
const Order = require("../models/order.model");
const Brand = require("../models/brand.model");

const DEFAULT_PAGE_LIMIT = 30;
const PAGE_LIMIT_OPTIONS = [7, 30, 50, 90];

const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(value || {}, key);

const normalizeText = (value = "") => String(value ?? "").trim();

const parsePositiveInt = (value, fallback = 1) => {
  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue < 1) {
    return fallback;
  }
  return parsedValue;
};

const parseLimit = (value) => {
  const parsedValue = parsePositiveInt(value, DEFAULT_PAGE_LIMIT);
  return PAGE_LIMIT_OPTIONS.includes(parsedValue) ? parsedValue : DEFAULT_PAGE_LIMIT;
};

const parseDateLike = (value) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ));
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ));
  }

  const asString = normalizeText(value);
  if (!asString) return null;

  const parseFromParts = (year, month, day) => {
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsed.getTime())) return null;
    if (
      parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() + 1 !== month
      || parsed.getUTCDate() !== day
    ) {
      return null;
    }
    return parsed;
  };

  const ymd = asString.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (ymd) {
    return parseFromParts(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }

  const dmySlash = asString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) {
    return parseFromParts(Number(dmySlash[3]), Number(dmySlash[2]), Number(dmySlash[1]));
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ));
};

const addUtcDays = (dateValue, daysToAdd = 0) => {
  const parsedDate = parseDateLike(dateValue);
  if (!parsedDate) return null;
  return new Date(Date.UTC(
    parsedDate.getUTCFullYear(),
    parsedDate.getUTCMonth(),
    parsedDate.getUTCDate() + Number(daysToAdd || 0),
  ));
};

const getUtcDateKey = (value) => {
  const parsedDate = parseDateLike(value);
  return parsedDate ? parsedDate.toISOString().slice(0, 10) : "";
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pickFirstOwn = (source, keys = []) => {
  for (const key of keys) {
    if (hasOwn(source, key)) {
      return source[key];
    }
  }

  return undefined;
};

const createOrderLookupKey = (orderId = "", brandName = "", vendorName = "") =>
  [
    normalizeText(orderId),
    normalizeText(brandName).toLowerCase(),
    normalizeText(vendorName).toLowerCase(),
  ].join("__");

const normalizeOptionList = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value).trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

const normalizeVendorInput = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return normalizeText(value.name ?? value.value ?? "");
  }

  return normalizeText(value);
};

const normalizeBrandInput = (payload) => {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      id: normalizeText(payload.id ?? payload._id ?? ""),
      name: normalizeText(payload.name ?? payload.label ?? ""),
    };
  }

  const raw = normalizeText(payload);
  if (!raw) {
    return { id: "", name: "" };
  }

  return mongoose.Types.ObjectId.isValid(raw)
    ? { id: raw, name: "" }
    : { id: "", name: raw };
};

const findBrandDoc = async (brandPayload) => {
  const brandInput = normalizeBrandInput(brandPayload);

  if (brandInput.id && mongoose.Types.ObjectId.isValid(brandInput.id)) {
    const brandById = await Brand.findById(brandInput.id).select("_id name").lean();
    if (brandById) {
      return brandById;
    }
  }

  if (brandInput.name) {
    const exactMatch =
      (await Brand.findOne({ name: brandInput.name }).select("_id name").lean())
      || (await Brand.findOne({
        name: { $regex: `^${escapeRegex(brandInput.name)}$`, $options: "i" },
      }).select("_id name").lean());

    if (exactMatch) {
      return exactMatch;
    }
  }

  return null;
};

const resolveEmailLogInput = async (payload = {}, currentLog = null) => {
  const hasOrderIdInput = hasOwn(payload, "order_id") || hasOwn(payload, "orderId");
  const hasBrandInput = hasOwn(payload, "brand") || hasOwn(payload, "brand_id") || hasOwn(payload, "brandId");
  const hasVendorInput = hasOwn(payload, "vendor") || hasOwn(payload, "vendor_name") || hasOwn(payload, "vendorName");
  const hasLogInput = hasOwn(payload, "log") || hasOwn(payload, "log_matter") || hasOwn(payload, "logMatter");
  const hasCreationDateInput = hasOwn(payload, "creation_date") || hasOwn(payload, "creationDate");

  const orderId = hasOrderIdInput
    ? normalizeText(pickFirstOwn(payload, ["order_id", "orderId"]))
    : normalizeText(currentLog?.order_id);
  const vendorName = hasVendorInput
    ? normalizeVendorInput(pickFirstOwn(payload, ["vendor", "vendor_name", "vendorName"]))
    : normalizeVendorInput(currentLog?.vendor?.name);
  const logText = hasLogInput
    ? normalizeText(pickFirstOwn(payload, ["log", "log_matter", "logMatter"]))
    : normalizeText(currentLog?.log);
  const creationDate = hasCreationDateInput
    ? parseDateLike(pickFirstOwn(payload, ["creation_date", "creationDate"]))
    : parseDateLike(currentLog?.creation_date);

  const rawBrandPayload = hasOwn(payload, "brand")
    ? payload.brand
    : (hasOwn(payload, "brand_id") || hasOwn(payload, "brandId")
      ? { id: pickFirstOwn(payload, ["brand_id", "brandId"]) }
      : currentLog?.brand);
  const brandDoc = await findBrandDoc(rawBrandPayload);

  if (!orderId) {
    return { error: "order_id is required" };
  }

  if (!brandDoc) {
    return { error: "A valid brand is required" };
  }

  if (!vendorName) {
    return { error: "vendor is required" };
  }

  if (!creationDate) {
    return { error: "creation_date is required" };
  }

  return {
    data: {
      order_id: orderId,
      brand: {
        id: brandDoc._id,
        name: normalizeText(brandDoc.name),
      },
      vendor: {
        name: vendorName,
      },
      log: logText,
      creation_date: creationDate,
    },
  };
};

const findMatchingOrder = async ({ order_id, brand, vendor }) => {
  const orderId = normalizeText(order_id);
  const brandName = normalizeText(brand?.name);
  const vendorName = normalizeText(vendor?.name);

  const exactOrder = await Order.findOne({
    order_id: orderId,
    brand: brandName,
    vendor: vendorName,
  }).select("_id order_id brand vendor").lean();

  if (exactOrder) {
    return { order: exactOrder, matchType: "exact" };
  }

  const orderById = await Order.findOne({ order_id: orderId })
    .select("_id order_id brand vendor")
    .lean();

  if (!orderById) {
    return { order: null, matchType: "missing" };
  }

  return { order: orderById, matchType: "order_id_only" };
};

const serializeEmailLogs = async (emailLogs) => {
  const rows = Array.isArray(emailLogs) ? emailLogs : [];
  if (rows.length === 0) {
    return [];
  }

  const orderIds = [...new Set(rows.map((row) => normalizeText(row?.order_id)).filter(Boolean))];
  const relatedOrders = orderIds.length > 0
    ? await Order.find({ order_id: { $in: orderIds } })
      .select("_id order_id brand vendor")
      .lean()
    : [];

  const orderMapByKey = new Map();
  const orderMapById = new Map();

  for (const order of relatedOrders) {
    const normalizedOrder = {
      _id: order?._id,
      order_id: normalizeText(order?.order_id),
      brand: normalizeText(order?.brand),
      vendor: normalizeText(order?.vendor),
    };

    if (!normalizedOrder.order_id) {
      continue;
    }

    const compoundKey = createOrderLookupKey(
      normalizedOrder.order_id,
      normalizedOrder.brand,
      normalizedOrder.vendor,
    );

    if (!orderMapByKey.has(compoundKey)) {
      orderMapByKey.set(compoundKey, normalizedOrder);
    }

    if (!orderMapById.has(normalizedOrder.order_id)) {
      orderMapById.set(normalizedOrder.order_id, normalizedOrder);
    }
  }

  return rows.map((row) => {
    const rowOrderId = normalizeText(row?.order_id);
    const rowBrandName = normalizeText(row?.brand?.name);
    const rowVendorName = normalizeText(row?.vendor?.name);
    const matchedOrder =
      orderMapByKey.get(createOrderLookupKey(rowOrderId, rowBrandName, rowVendorName))
      || orderMapById.get(rowOrderId);

    return {
      ...row,
      order_id_value: rowOrderId,
      order_id: matchedOrder
        ? {
          _id: matchedOrder._id,
          order_id: matchedOrder.order_id,
          brand: matchedOrder.brand,
          vendor: matchedOrder.vendor,
        }
        : {
          order_id: rowOrderId,
          brand: rowBrandName,
          vendor: rowVendorName,
        },
    };
  });
};

const loadEmailLogById = async (id) =>
  EmailLogs.findById(id).populate("created_by", "name email").lean();

const findExistingDateConflicts = async ({
  order_id,
  brandId,
  vendorName,
  dates = [],
  excludeId = "",
}) => {
  const normalizedDates = dates
    .map((dateValue) => parseDateLike(dateValue))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());

  if (normalizedDates.length === 0) {
    return [];
  }

  const requestedDateKeys = new Set(
    normalizedDates
      .map((dateValue) => getUtcDateKey(dateValue))
      .filter(Boolean),
  );
  const rangeStart = normalizedDates[0];
  const rangeEnd = addUtcDays(normalizedDates[normalizedDates.length - 1], 1);

  const query = {
    order_id: normalizeText(order_id),
    "brand.id": brandId,
    "vendor.name": normalizeText(vendorName),
    creation_date: {
      $gte: rangeStart,
      $lt: rangeEnd,
    },
  };

  if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
    query._id = { $ne: excludeId };
  }

  const existingLogs = await EmailLogs.find(query).select("creation_date").lean();
  return [...new Set(
    existingLogs
      .map((row) => getUtcDateKey(row?.creation_date))
      .filter((dateKey) => requestedDateKeys.has(dateKey)),
  )].sort();
};

/**
 * GET /email-logs
 * Get all email logs with optional search by order_id and filters by brand/vendor
 */
exports.getAllEmailLogs = async (req, res) => {
  try {
    const requestedPage = parsePositiveInt(req.query?.page, 1);
    const limit = parseLimit(req.query?.limit);
    const orderId = normalizeText(req.query?.order_id);
    const brand = normalizeText(req.query?.brand);
    const vendor = normalizeText(req.query?.vendor);

    const query = {};

    if (orderId) {
      query.order_id = orderId;
    }

    if (brand) {
      query["brand.name"] = brand;
    }

    if (vendor) {
      query["vendor.name"] = vendor;
    }

    const totalRecords = await EmailLogs.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
    const page = Math.min(requestedPage, totalPages);
    const skip = (page - 1) * limit;

    const emailLogs = await EmailLogs.find(query)
      .sort({ creation_date: 1 })
      .skip(skip)
      .limit(limit)
      .populate("created_by", "name email")
      .lean()
      .exec();
    const serializedLogs = await serializeEmailLogs(emailLogs);

    res.status(200).json({
      success: true,
      data: serializedLogs,
      pagination: {
        page,
        limit,
        totalPages,
        totalRecords,
      },
    });
  } catch (err) {
    console.error("Error fetching email logs:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch email logs",
    });
  }
};

/**
 * GET /email-logs/create/options
 * Get all brands and vendors available for creating a new email log
 */
exports.getCreateOptions = async (req, res) => {
  try {
    const [brandDocs, vendors] = await Promise.all([
      Brand.find({}, "_id name").sort({ name: 1 }).lean(),
      Order.distinct("vendor"),
    ]);

    const brands = (Array.isArray(brandDocs) ? brandDocs : [])
      .map((brand) => ({
        id: String(brand?._id || "").trim(),
        name: String(brand?.name || "").trim(),
      }))
      .filter((brand) => brand.id && brand.name)
      .sort((left, right) => left.name.localeCompare(right.name));

    res.status(200).json({
      success: true,
      data: {
        brands,
        vendors: normalizeOptionList(vendors),
      },
    });
  } catch (err) {
    console.error("Error fetching create options:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch email log create options",
    });
  }
};

/**
 * GET /email-logs/:order_id
 * Get email logs for a specific order
 */
exports.getEmailLogsByOrderId = async (req, res) => {
  try {
    const orderId = normalizeText(req.params?.order_id);
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "order_id is required",
      });
    }

    const emailLogs = await EmailLogs.find({ order_id: orderId })
      .sort({ creation_date: 1 })
      .populate("created_by", "name email")
      .lean()
      .exec();

    if (!emailLogs.length) {
      return res.status(404).json({
        success: false,
        message: "No email logs found for this order",
      });
    }

    res.status(200).json({
      success: true,
      data: await serializeEmailLogs(emailLogs),
    });
  } catch (err) {
    console.error("Error fetching email logs:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch email logs",
    });
  }
};

/**
 * POST /email-logs
 * Create a new email log
 */
exports.createEmailLog = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const resolvedInput = await resolveEmailLogInput(req.body || {});
    if (resolvedInput.error) {
      return res.status(400).json({
        success: false,
        message: resolvedInput.error,
      });
    }

    const { data } = resolvedInput;
    const { matchType } = await findMatchingOrder(data);

    if (matchType === "missing") {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (matchType !== "exact") {
      return res.status(400).json({
        success: false,
        message: "Selected PO number, brand, and vendor do not match an existing order",
      });
    }

    const creationDates = Array.from({ length: 7 }, (_, index) =>
      addUtcDays(data.creation_date, index)).filter(Boolean);
    const dateConflicts = await findExistingDateConflicts({
      order_id: data.order_id,
      brandId: data.brand.id,
      vendorName: data.vendor.name,
      dates: creationDates,
    });

    if (dateConflicts.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Email logs already exist for: ${dateConflicts.join(", ")}`,
      });
    }

    const createdLogs = await EmailLogs.insertMany(
      creationDates.map((creationDate) => ({
        order_id: data.order_id,
        brand: data.brand,
        vendor: data.vendor,
        log: "",
        creation_date: creationDate,
        created_by: userId,
      })),
    );
    const createdIds = createdLogs.map((row) => row?._id).filter(Boolean);
    const loadedLogs = await EmailLogs.find({ _id: { $in: createdIds } })
      .sort({ creation_date: 1 })
      .populate("created_by", "name email")
      .lean();
    const serializedLogs = await serializeEmailLogs(loadedLogs);

    res.status(201).json({
      success: true,
      message: `${serializedLogs.length} email logs created successfully`,
      data: serializedLogs,
    });
  } catch (err) {
    console.error("Error creating email log:", err);
    res.status(500).json({
      success: false,
      message: "Failed to create email log",
    });
  }
};

/**
 * PATCH /email-logs/:id
 * Update an existing email log
 */
exports.updateEmailLog = async (req, res) => {
  try {
    const id = normalizeText(req.params?.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email log id",
      });
    }

    const emailLog = await EmailLogs.findById(id);
    if (!emailLog) {
      return res.status(404).json({
        success: false,
        message: "Email log not found",
      });
    }

    const resolvedInput = await resolveEmailLogInput(req.body || {}, emailLog);
    if (resolvedInput.error) {
      return res.status(400).json({
        success: false,
        message: resolvedInput.error,
      });
    }

    const { data } = resolvedInput;
    const { matchType } = await findMatchingOrder(data);

    if (matchType === "missing") {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (matchType !== "exact") {
      return res.status(400).json({
        success: false,
        message: "Selected PO number, brand, and vendor do not match an existing order",
      });
    }

    const dateConflicts = await findExistingDateConflicts({
      order_id: data.order_id,
      brandId: data.brand.id,
      vendorName: data.vendor.name,
      dates: [data.creation_date],
      excludeId: id,
    });

    if (dateConflicts.length > 0) {
      return res.status(409).json({
        success: false,
        message: `An email log already exists for ${dateConflicts[0]}`,
      });
    }

    emailLog.order_id = data.order_id;
    emailLog.brand = data.brand;
    emailLog.vendor = data.vendor;
    emailLog.log = data.log;
    emailLog.creation_date = data.creation_date;

    await emailLog.save();

    const updatedLog = await loadEmailLogById(emailLog._id);
    const [serializedLog] = await serializeEmailLogs(updatedLog ? [updatedLog] : []);

    return res.status(200).json({
      success: true,
      message: "Email log updated successfully",
      data: serializedLog || null,
    });
  } catch (err) {
    console.error("Error updating email log:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update email log",
    });
  }
};

/**
 * GET /email-logs/filters/options
 * Get distinct brands and vendors for filter options
 */
exports.getFilterOptions = async (req, res) => {
  try {
    const brands = await EmailLogs.distinct("brand.name");
    const vendors = await EmailLogs.distinct("vendor.name");

    res.status(200).json({
      success: true,
      data: {
        brands: normalizeOptionList(brands),
        vendors: normalizeOptionList(vendors),
      },
    });
  } catch (err) {
    console.error("Error fetching filter options:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch filter options",
    });
  }
};

/**
 * DELETE /email-logs/:id
 * Delete an email log
 */
exports.deleteEmailLog = async (req, res) => {
  try {
    const { id } = req.params;

    const emailLog = await EmailLogs.findByIdAndDelete(id);

    if (!emailLog) {
      return res.status(404).json({
        success: false,
        message: "Email log not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Email log deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting email log:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete email log",
    });
  }
};

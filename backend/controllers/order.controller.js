const XLSX = require("xlsx");
const Order = require("../models/order.model");
const dateParser = require("../helpers/dateparsser");
const deleteFile = require("../helpers/fileCleanup");
const { syncOrderGroup } = require("../services/gcalSync");


const ORDER_STATUS_SEQUENCE = [
  "Pending",
  "Under Inspection",
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

const SHIPMENT_VISIBLE_STATUSES = [
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeFilterValue = (value) => {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  const lowered = cleaned.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return null;
  }
  return cleaned;
};

const parsePositiveInt = (value, fallback) => {
  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue < 1) {
    return fallback;
  }
  return parsedValue;
};

const normalizeDistinctValues = (values = []) =>
  [
    ...new Set(
      values.map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

const normalizeStatusList = (values = []) => {
  const normalized = normalizeDistinctValues(values);
  return normalized.sort((a, b) => {
    const aIndex = ORDER_STATUS_SEQUENCE.indexOf(a);
    const bIndex = ORDER_STATUS_SEQUENCE.indexOf(b);

    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
};

const buildOrderListMatch = ({
  brand,
  vendor,
  status,
  order,
  isDelayed = false,
  includeBrand = true,
  includeVendor = true,
  includeStatus = true,
  includeOrder = true,
} = {}) => {
  const match = {};
  const normalizedBrand = normalizeFilterValue(brand);
  const normalizedVendor = normalizeFilterValue(vendor);
  const normalizedStatus = normalizeFilterValue(status);
  const normalizedOrder = normalizeFilterValue(order);

  if (includeBrand && normalizedBrand) {
    match.brand = normalizedBrand;
  }

  if (includeVendor && normalizedVendor) {
    match.vendor = normalizedVendor;
  }

  if (includeStatus && normalizedStatus) {
    const loweredStatus = normalizedStatus.toLowerCase();

    if (loweredStatus === "pending") {
      match.status = { $ne: "Shipped" };
    } else if (loweredStatus !== "delayed") {
      match.status = normalizedStatus;
    }
  }

  if (includeOrder && normalizedOrder) {
    const escaped = escapeRegex(normalizedOrder);
    match.order_id = { $regex: escaped, $options: "i" };
  }

  if (isDelayed) {
    match.ETD = { $lt: new Date() };
    match.status = { $ne: "Shipped" };
  }

  return match;
};

const buildShipmentMatch = ({
  vendor,
  orderId,
  itemCode,
  includeVendor = true,
  includeOrderId = true,
  includeItemCode = true,
} = {}) => {
  const match = {
    status: { $in: SHIPMENT_VISIBLE_STATUSES },
  };

  const normalizedVendor = normalizeFilterValue(vendor);
  const normalizedOrderId = normalizeFilterValue(orderId);
  const normalizedItemCode = normalizeFilterValue(itemCode);

  if (includeVendor && normalizedVendor) {
    match.vendor = normalizedVendor;
  }

  if (includeOrderId && normalizedOrderId) {
    const escaped = escapeRegex(normalizedOrderId);
    match.order_id = { $regex: escaped, $options: "i" };
  }

  if (includeItemCode && normalizedItemCode) {
    const escaped = escapeRegex(normalizedItemCode);
    match["item.item_code"] = { $regex: escaped, $options: "i" };
  }

  return match;
};

// Upload Orders Controller
exports.uploadOrders = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    const normalizeValue = (value) => {
      if (value === undefined || value === null) return "";
      return String(value).trim();
    };
    const normalizeKey = (orderId, itemCode) =>
      `${normalizeValue(orderId)}__${normalizeValue(itemCode)}`;

    const duplicateEntries = [];
    const seenKeys = new Set();

    // Transform rows to Order schema (dedupe within file)
    const orders = sheetData
      .map((row) => {
        const orderId =
          row.PO !== undefined && row.PO !== null
            ? String(row.PO).trim()
            : row.PO;
        const itemCode =
          row.item_code !== undefined && row.item_code !== null
            ? String(row.item_code).trim()
            : row.item_code;
        const key = normalizeKey(orderId, itemCode);

        if (seenKeys.has(key)) {
          duplicateEntries.push({
            order_id: orderId,
            item_code: itemCode,
            reason: "duplicate_in_file",
          });
          return null;
        }

        seenKeys.add(key);

        return {
          order_id: orderId,
          item: {
            item_code: itemCode,
            description: row.description,
          },
          brand: row.brand,
          vendor: row.vendor,
          ETD: dateParser(row.ETD),
          order_date: dateParser(row.order_date),
          status: "Pending",
          quantity: row.quantity,
        };
      })
      .filter(Boolean);

    let newOrders = orders;

    if (orders.length > 0) {
      const existing = await Order.find({
        $or: orders.map((order) => ({
          order_id: order.order_id,
          "item.item_code": order.item.item_code,
        })),
      }).select("order_id item.item_code");

      const existingKeys = new Set(
        existing.map((order) =>
          normalizeKey(order.order_id, order.item.item_code),
        ),
      );

      newOrders = orders.filter((order) => {
        const key = normalizeKey(order.order_id, order.item.item_code);
        if (existingKeys.has(key)) {
          duplicateEntries.push({
            order_id: order.order_id,
            item_code: order.item.item_code,
            reason: "already_exists",
          });
          return false;
        }
        return true;
      });
    }

    if (newOrders.length > 0) {
      await Order.insertMany(newOrders);
    }
    if (newOrders.length > 0) {
      await Order.insertMany(newOrders);

      // sync unique groups
      const groups = new Map();
      for (const o of newOrders) {
        const k = `${o.order_id}__${o.brand}__${o.vendor}`;
        groups.set(k, {
          order_id: o.order_id,
          brand: o.brand,
          vendor: o.vendor,
        });
      }

      // run with small concurrency
      const arr = [...groups.values()];
      const limit = 5;

      for (let i = 0; i < arr.length; i += limit) {
        const batch = arr.slice(i, i + limit);
        await Promise.all(batch.map((g) => syncOrderGroup(g)));
      }
    }

    res.status(201).json({
      message:
        duplicateEntries.length > 0 && newOrders.length > 0
          ? "Orders uploaded with duplicates skipped"
          : newOrders.length > 0
            ? "Orders uploaded successfully"
            : "No new orders to upload",
      inserted_count: newOrders.length,
      duplicate_count: duplicateEntries.length,
      duplicate_entries: duplicateEntries,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Upload failed",
      error: error.message,
    });
  } finally {
    // Cleanup uploaded file
    deleteFile(req.file?.path);
  }
};

// Get Orders (Pagination + Sorting)
exports.getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, brand } = req.query;

    const skip = (page - 1) * limit;

    const orders = await Order.find(brand ? { brand } : {})
      .populate({
        path: "qc_record",
        populate: {
          path: "inspector",
          select: "name role",
        },
      })
      .sort({ order_id: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Order.countDocuments();

    res.json({
      data: orders,
      pagination: {
        page: Number(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// Get Order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.find({ order_id: req.params.id }).populate({
      path: "qc_record",
      populate: {
        path: "inspector",
        select: "name role",
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Not found" });
    }

    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getVendorSummaryByBrand = async (req, res) => {
  try {
    const { brand } = req.params;
    const today = new Date();

    const result = await Order.aggregate([
      // 1️⃣ Filter by brand
      {
        $match: { brand },
      },

      // 2️⃣ Group by vendor
      {
        $group: {
          _id: "$vendor",

          // DISTINCT order IDs
          orders: {
            $addToSet: "$order_id",
          },

          // DISTINCT delayed order IDs
          delayedOrders: {
            $addToSet: {
              $cond: [
                {
                  $and: [
                    { $lt: ["$ETD", today] },
                    { $ne: ["$status", "Finalized"] },
                  ],
                },
                "$order_id",
                "$$REMOVE",
              ],
            },
          },

          pendingOrders: {
            $addToSet: {
              $cond: [{ $ne: ["$status", "Shipped"] }, "$order_id", "$$REMOVE"],
            },
          },

          shippedOrders: {
            $addToSet: {
              $cond: [{ $eq: ["$status", "Shipped"] }, "$order_id", "$$REMOVE"],
            },
          },
        },
      },
      // 3️⃣ Shape final response
      {
        $project: {
          _id: 0,
          vendor: "$_id",
          orders: 1,
          delayedOrders: 1,

          // Optional counts
          totalOrders: { $size: "$orders" },
          totalDelayedOrders: { $size: "$delayedOrders" },
          totalPending: { $size: "$pendingOrders" },
          totalShipped: { $size: "$shippedOrders" },
        },
      },

      // 4️⃣ Optional sort
      {
        $sort: { totalDelayedOrders: -1 },
      },
    ]);

    if (!result.length) {
      return res.status(404).json({
        message: "No vendors found for this brand",
      });
    }

    res.status(200).json({
      message: "Distinct vendor orders retrieved successfully",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getOrdersByBrandAndStatus = async (req, res) => {
  try {
    const normalizeFilterValue = (value) => {
      if (value === undefined || value === null) return null;
      const cleaned = String(value).trim();
      if (!cleaned) return null;
      const lowered = cleaned.toLowerCase();
      if (lowered === "all" || lowered === "undefined" || lowered === "null") {
        return null;
      }
      return cleaned;
    };

    const brand = normalizeFilterValue(req.query.brand ?? req.params.brand);
    const vendor = normalizeFilterValue(req.query.vendor ?? req.params.vendor);
    const status = normalizeFilterValue(req.query.status ?? req.params.status);
    const { isDelayed } = req.query;

    const today = new Date();

    // base match filter
    const matchStage = {};

    if (brand) {
      matchStage.brand = brand;
    }

    if (vendor) {
      matchStage.vendor = vendor;
    }

    // status logic
    if (status) {
      if (status.toLowerCase() === "pending") {
        // Pending = anything NOT shipped
        matchStage.status = { $ne: "Shipped" };
      } else {
        matchStage.status = status;
      }
    }

    // 🚨 Delay logic
    if (isDelayed === "true") {
      matchStage.ETD = { $lt: today }; // ETD passed
      matchStage.status = { $ne: "Shipped" }; // not shipped
    }

    const orders = await Order.aggregate([
      // 1️⃣ Filter
      { $match: matchStage },

      // 2️⃣ Group by order_id
      {
        $group: {
          _id: "$order_id",
          items: { $sum: 1 },
          brand: { $first: "$brand" },
          vendor: { $first: "$vendor" },
          ETD: { $first: "$ETD" },
          order_date: { $first: "$order_date" },
          statuses: { $addToSet: "$status" },
        },
      },

      // 3️⃣ Shape output
      {
        $project: {
          _id: 0,
          order_id: "$_id",
          items: 1,
          brand: 1,
          vendor: 1,
          ETD: 1,
          order_date: 1,
          statuses: 1,
        },
      },

      // 4️⃣ Sort latest first
      { $sort: { order_date: -1 } },
    ]);

    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error("Get Orders Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
};

exports.getOrdersByFiltersDb = async (req, res) => {
  try {
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const status = req.query.status;
    const order = req.query.order ?? req.query.order_id;
    const isDelayed =
      String(req.query.isDelayed || "")
        .trim()
        .toLowerCase() === "true";

    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;

    const filterInput = {
      brand,
      vendor,
      status,
      order,
      isDelayed,
    };

    const matchStage = buildOrderListMatch(filterInput);

    const [result, vendorsRaw, brandsRaw, statusesRaw, orderIdsRaw] =
      await Promise.all([
        Order.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: "$order_id",
              items: { $sum: 1 },
              brand: { $first: "$brand" },
              vendor: { $first: "$vendor" },
              ETD: { $first: "$ETD" },
              order_date: { $first: "$order_date" },
              statuses: { $addToSet: "$status" },
            },
          },
          {
            $project: {
              _id: 0,
              order_id: "$_id",
              items: 1,
              brand: 1,
              vendor: 1,
              ETD: 1,
              order_date: 1,
              statuses: 1,
            },
          },
          { $sort: { order_date: -1, order_id: -1 } },
          {
            $facet: {
              data: [{ $skip: skip }, { $limit: limit }],
              totalCount: [{ $count: "count" }],
            },
          },
        ]),
        Order.distinct(
          "vendor",
          buildOrderListMatch({ ...filterInput, includeVendor: false }),
        ),
        Order.distinct(
          "brand",
          buildOrderListMatch({ ...filterInput, includeBrand: false }),
        ),
        Order.distinct(
          "status",
          buildOrderListMatch({ ...filterInput, includeStatus: false }),
        ),
        Order.distinct(
          "order_id",
          buildOrderListMatch({ ...filterInput, includeOrder: false }),
        ),
      ]);

    const data = result?.[0]?.data || [];
    const totalRecords = result?.[0]?.totalCount?.[0]?.count || 0;

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
        vendors: normalizeDistinctValues(vendorsRaw),
        brands: normalizeDistinctValues(brandsRaw),
        statuses: normalizeStatusList(statusesRaw),
        order_ids: normalizeDistinctValues(orderIdsRaw),
      },
    });
  } catch (error) {
    console.error("Get Orders By Filters DB Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch filtered orders",
      error: error.message,
    });
  }
};

exports.getOrdersByFilters = async (req, res) => {
  try {
    const normalizeFilterValue = (value) => {
      if (value === undefined || value === null) return null;
      const cleaned = String(value).trim();
      if (!cleaned) return null;
      const lowered = cleaned.toLowerCase();
      if (lowered === "all" || lowered === "undefined" || lowered === "null") {
        return null;
      }
      return cleaned;
    };

    const parsePositiveInt = (value, fallback) => {
      const parsedValue = Number.parseInt(value, 10);
      if (Number.isNaN(parsedValue) || parsedValue < 1) {
        return fallback;
      }
      return parsedValue;
    };

    const vendor = normalizeFilterValue(req.query.vendor);
    const brand = normalizeFilterValue(req.query.brand);
    const status = normalizeFilterValue(req.query.status);

    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 20);
    const skip = (page - 1) * limit;

    const matchStage = {};

    if (vendor) {
      matchStage.vendor = vendor;
    }

    if (brand) {
      matchStage.brand = brand;
    }

    if (status) {
      matchStage.status = status;
    }

    const [orders, totalRecords] = await Promise.all([
      Order.find(matchStage)
        .populate({
          path: "qc_record",
          populate: {
            path: "inspector",
            select: "name role",
          },
        })
        .sort({ order_date: -1, order_id: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Order.countDocuments(matchStage),
    ]);

    return res.status(200).json({
      success: true,
      data: orders,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
    });
  } catch (error) {
    console.error("Get Orders By Filters Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch filtered orders",
      error: error.message,
    });
  }
};

exports.getOrderSummary = async (req, res) => {
  try {
    const [vendors, brands] = await Promise.all([
      Order.distinct("vendor"),
      Order.distinct("brand"),
    ]);

    const normalizeList = (values) =>
      values
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0)
        .sort((a, b) => a.localeCompare(b));

    return res.status(200).json({
      vendors: normalizeList(vendors),
      brands: normalizeList(brands),
    });
  } catch (error) {
    console.error("Get Order Summary Error:", error);
    return res.status(500).json({
      message: "Failed to fetch order summary",
      error: error.message,
    });
  }
};

exports.getShipmentsDb = async (req, res) => {
  try {
    const vendor = req.query.vendor;
    const orderId = req.query.order_id ?? req.query.order;
    const itemCode = req.query.item_code;

    const filterInput = {
      vendor,
      orderId,
      itemCode,
    };

    const [orders, vendorsRaw, orderIdsRaw, itemCodesRaw] = await Promise.all([
      Order.find(buildShipmentMatch(filterInput))
        .select(
          "order_id item vendor status quantity shipment order_date updatedAt",
        )
        .sort({ order_date: -1, updatedAt: -1, order_id: -1 })
        .lean(),
      Order.distinct(
        "vendor",
        buildShipmentMatch({ ...filterInput, includeVendor: false }),
      ),
      Order.distinct(
        "order_id",
        buildShipmentMatch({ ...filterInput, includeOrderId: false }),
      ),
      Order.distinct(
        "item.item_code",
        buildShipmentMatch({ ...filterInput, includeItemCode: false }),
      ),
    ]);

    const data = orders.flatMap((order) => {
      const shipmentEntries = Array.isArray(order?.shipment)
        ? order.shipment
        : [];
      const parsedOrderQuantity = Number(order?.quantity);
      const normalizedOrderQuantity = Number.isFinite(parsedOrderQuantity)
        ? parsedOrderQuantity
        : 0;

      const baseRow = {
        _id: order?._id || null,
        order_id: order?.order_id || "",
        vendor: order?.vendor || "",
        item: {
          item_code: order?.item?.item_code || "",
          description: order?.item?.description || "",
        },
        item_code: order?.item?.item_code || "",
        description: order?.item?.description || "",
        order_quantity: normalizedOrderQuantity,
        shipment: shipmentEntries,
        status: order?.status || "",
      };

      if (shipmentEntries.length === 0) {
        return [
          {
            ...baseRow,
            shipment_id: null,
            stuffing_date: null,
            container: "",
            quantity: normalizedOrderQuantity,
            pending: normalizedOrderQuantity,
            remaining_remarks: "",
          },
        ];
      }

      return shipmentEntries.map((entry, index) => {
        const parsedShipmentQuantity = Number(entry?.quantity);
        const parsedPending = Number(entry?.pending);

        return {
          ...baseRow,
          shipment_id: entry?._id || `${order?._id || "order"}-${index}`,
          stuffing_date: entry?.stuffing_date || null,
          container: entry?.container || "",
          quantity: Number.isFinite(parsedShipmentQuantity)
            ? parsedShipmentQuantity
            : 0,
          pending: Number.isFinite(parsedPending) ? parsedPending : 0,
          remaining_remarks: entry?.remaining_remarks || "",
        };
      });
    });

    const summary = data.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row?.status === "Inspection Done") acc.inspectionDone += 1;
        if (row?.status === "Partial Shipped") acc.partialShipped += 1;
        if (row?.status === "Shipped") acc.shipped += 1;
        return acc;
      },
      {
        total: 0,
        inspectionDone: 0,
        partialShipped: 0,
        shipped: 0,
      },
    );

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
      summary,
      filters: {
        vendors: normalizeDistinctValues(vendorsRaw),
        order_ids: normalizeDistinctValues(orderIdsRaw),
        item_codes: normalizeDistinctValues(itemCodesRaw),
      },
    });
  } catch (error) {
    console.error("Get Shipments DB Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch shipment list",
      error: error.message,
    });
  }
};

exports.getShipments = async (req, res) => {
  try {
    const statusesToInclude = ["Inspection Done", "Partial Shipped", "Shipped"];

    const orders = await Order.find({
      status: { $in: statusesToInclude },
    })
      .select(
        "order_id item vendor status quantity shipment order_date updatedAt",
      )
      .sort({ order_date: -1, updatedAt: -1, order_id: -1 })
      .lean();

    const data = orders.flatMap((order) => {
      const shipmentEntries = Array.isArray(order?.shipment)
        ? order.shipment
        : [];
      const parsedOrderQuantity = Number(order?.quantity);
      const normalizedOrderQuantity = Number.isFinite(parsedOrderQuantity)
        ? parsedOrderQuantity
        : 0;

      const baseRow = {
        _id: order?._id || null,
        order_id: order?.order_id || "",
        vendor: order?.vendor || "",
        item: {
          item_code: order?.item?.item_code || "",
          description: order?.item?.description || "",
        },
        item_code: order?.item?.item_code || "",
        description: order?.item?.description || "",
        order_quantity: normalizedOrderQuantity,
        shipment: shipmentEntries,
        status: order?.status || "",
      };

      if (shipmentEntries.length === 0) {
        return [
          {
            ...baseRow,
            shipment_id: null,
            stuffing_date: null,
            container: "",
            quantity: normalizedOrderQuantity,
            pending: normalizedOrderQuantity,
            remaining_remarks: "",
          },
        ];
      }

      return shipmentEntries.map((entry, index) => {
        const parsedShipmentQuantity = Number(entry?.quantity);
        const parsedPending = Number(entry?.pending);

        return {
          ...baseRow,
          shipment_id: entry?._id || `${order?._id || "order"}-${index}`,
          stuffing_date: entry?.stuffing_date || null,
          container: entry?.container || "",
          quantity: Number.isFinite(parsedShipmentQuantity)
            ? parsedShipmentQuantity
            : 0,
          pending: Number.isFinite(parsedPending) ? parsedPending : 0,
          remaining_remarks: entry?.remaining_remarks || "",
        };
      });
    });

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Get Shipments Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch shipment list",
      error: error.message,
    });
  }
};

exports.finalizeOrder = async (req, res) => {
  try {
    const { stuffing_date, container, quantity, remarks } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!["Inspection Done", "Partial Shipped"].includes(order.status)) {
      return res.status(400).json({
        message: "Order can only be shipped after inspection is done",
      });
    }

    if (!stuffing_date || container === undefined || quantity === undefined) {
      return res.status(400).json({
        message: "stuffing_date, container and quantity are required",
      });
    }

    const parsedStuffingDate = new Date(stuffing_date);
    if (Number.isNaN(parsedStuffingDate.getTime())) {
      return res.status(400).json({ message: "Invalid stuffing date" });
    }

    const parsedContainer = String(container).trim();
    if (!parsedContainer) {
      return res.status(400).json({
        message: "container must be a valid non-empty string",
      });
    }

    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({
        message: "quantity must be a valid positive number",
      });
    }

    const shippedAlready = (order.shipment || []).reduce(
      (sum, entry) => sum + Number(entry?.quantity || 0),
      0,
    );

    const orderQuantity = Number(order.quantity || 0);
    const remainingQuantity = Math.max(0, orderQuantity - shippedAlready);
    const pending = Math.max(0, remainingQuantity - quantity);

    if (parsedQuantity > remainingQuantity) {
      return res.status(400).json({
        message: "shipping quantity cannot exceed remaining quantity",
      });
    }

    order.shipment = order.shipment || [];
    order.shipment.push({
      container: parsedContainer,
      stuffing_date: parsedStuffingDate,
      quantity: parsedQuantity,
      pending: pending,
      remaining_remarks: remarks,
    });

    const shippedAfter = shippedAlready + parsedQuantity;
    order.status =
      shippedAfter >= orderQuantity ? "Shipped" : "Partial Shipped";

    await order.save();

    return res.status(200).json({
      message: "Order shipment updated successfully",
      data: order,
      shipping_summary: {
        total_quantity: orderQuantity,
        shipped_quantity: shippedAfter,
        remaining_quantity: Math.max(0, orderQuantity - shippedAfter),
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to finalize order shipment",
      error: error.message,
    });
  }
};

const XLSX = require("xlsx");
const Order = require("../models/order.model");
const dateParser = require("../helpers/dateparsser");
const deleteFile = require("../helpers/fileCleanup");

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
          row.PO !== undefined && row.PO !== null ? String(row.PO).trim() : row.PO;
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
      .sort({ createdAt: -1 })
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
    const { brand, vendor, status } = req.params;
    const { isDelayed } = req.query;

    // validation
    if (!brand || !vendor) {
      return res.status(400).json({
        message: "Brand and Vendor are required",
      });
    }

    const today = new Date();

    // base match filter
    const matchStage = {
      brand,
      vendor,
    };

    // status logic
    if (status && status !== "all") {
      if (status.toLowerCase() === "pending") {
        // Pending = anything NOT shipped
        matchStage.status = { $ne: "Shipped" };
      } else {
        matchStage.status = status;
      }
    }

    // 🚨 Delay logic
    if (isDelayed === "true") {
      matchStage.ETD = { $lt: today };      // ETD passed
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

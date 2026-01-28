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
    const sheetData = XLSX.utils.sheet_to_json(
      workbook.Sheets[sheetName]
    );
    // Transform rows to Order schema
    const orders = sheetData.map((row) => ({
      order_id: row.PO,
      item: {
        item_code: row.item_code,
        description: row.description,
      },
      vendor: row.vendor,
      ETD: dateParser(row.ETD),
      order_date: dateParser(row.order_date),
      status: "Pending",
      quantity: row.quantity,
    }));

    await Order.insertMany(orders);

    res.status(201).json({
      message: "Orders uploaded successfully",
      count: orders.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Upload failed",
      error: error.message,
    });
  }
  finally {
    // Cleanup uploaded file
    deleteFile(req.file?.path);
  }
};

// Get Orders (Pagination + Sorting)
exports.getOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const sortField = req.query.sort || "createdAt";
    const sortOrder = req.query.order === "asc" ? 1 : -1;

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find()
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(),
    ]);

    res.status(200).json({
      data: orders,
      pagination: {
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Not found" });
    }

    res.status(200).json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

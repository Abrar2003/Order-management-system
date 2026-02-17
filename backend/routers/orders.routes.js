const express = require("express");
const upload = require("../config/multer.config");
const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  uploadOrders,
  getOrders,
  getOrdersByFiltersDb,
  getOrderById,
  getVendorSummaryByBrand,
  getOrdersByBrandAndStatus,
  getOrderSummary,
  getShipmentsDb,
  finalizeOrder,
} = require("../controllers/order.controller");

const router = express.Router();

router.post(
  "/upload-orders",
  authenticate,
  authorize("admin", "manager", "dev"),
  upload.single("file"),
  uploadOrders,
);

// List orders (pagination + sorting)
router.get("/", authenticate, authorize("admin", "manager", "QC", "dev"), getOrders);

// List order's brands and vendors
router.get("/brands-and-vendors", authenticate, getOrderSummary)

//get orders by brand and status
router.get("/brand/:brand/vendor/:vendor/status/:status", authenticate, getOrdersByBrandAndStatus);

// get orders with optional filters via query params
router.get("/filters", authenticate, getOrdersByFiltersDb);

// List shipped/partially shipped/inspection-done items with latest shipment details
router.get(
  "/shipments",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "Dev"),
  getShipmentsDb,
);

// Finalize shipping / add shipment entry
router.patch(
  "/finalize-order/:id",
  authenticate,
  authorize("admin", "manager", "dev"),
  finalizeOrder
);

// Get vendor summary by brand
router.get("/:brand/vendor-summary", authenticate, getVendorSummaryByBrand);

// Get order by ID   
router.get("/order-by-id/:id", getOrderById);

module.exports = router;

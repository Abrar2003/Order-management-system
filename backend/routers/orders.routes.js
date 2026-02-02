const express = require("express");
const upload = require("../config/multer.config");
const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  uploadOrders,
  getOrders,
  getOrderById,
  getVendorSummaryByBrand,
  getOrdersByBrandAndStatus,
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

// Get order by ID
router.get("/:id", getOrderById);

//get orders by brand and status
router.get("/brand/:brand/vendor/:vendor/status/:status", authenticate, getOrdersByBrandAndStatus);

// Get vendor summary by brand
router.get("/:brand/vendor-summary", authenticate, getVendorSummaryByBrand);

module.exports = router;

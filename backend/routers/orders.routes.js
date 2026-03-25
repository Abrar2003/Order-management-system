const express = require("express");
const upload = require("../config/multer.config");
const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  uploadOrders,
  createOrdersManually,
  rectifyPdfOrders,
  getUploadLogs,
  getOrderEditLogs,
  lookupPreviousOrder,
  getOrders,
  getPoStatusReport,
  getOrdersByFiltersDb,
  getOrderById,
  getVendorSummaryByBrand,
  getTodayEtdOrdersByBrand,
  getOrdersByBrandAndStatus,
  getOrderSummary,
  getShipmentsDb,
  exportShipmentsDb,
  getDelayedPoReport,
  exportDelayedPoReport,
  exportOrdersDb,
  editOrder,
  bulkUpdateRevisedEtd,
  editCompleteOrder,
  archiveOrder,
  getArchivedOrders,
  syncZeroQuantityOrdersArchive,
  finalizeOrder,
  getRevisedEtdHistory,
  reSync,
} = require("../controllers/order.controller");

const router = express.Router();

router.post(
  "/upload-orders",
  authenticate,
  authorize("admin", "manager", "dev"),
  upload.single("file"),
  uploadOrders,
);

router.post(
  "/manual-orders",
  authenticate,
  authorize("admin", "manager", "dev"),
  createOrdersManually,
);

router.post(
  "/rectify-pdf",
  authenticate,
  authorize("admin", "manager", "dev"),
  upload.single("file"),
  rectifyPdfOrders,
);

router.get(
  "/previous-order-check",
  authenticate,
  authorize("admin", "manager", "dev"),
  lookupPreviousOrder,
);

router.get(
  "/upload-logs",
  authenticate,
  authorize("admin", "manager", "dev"),
  getUploadLogs,
);

router.get(
  "/edit-logs",
  authenticate,
  authorize("admin", "manager", "dev"),
  getOrderEditLogs,
);

// List orders (pagination + sorting)
router.get(
  "/",
  authenticate,
  authorize("admin", "manager", "QC", "dev"),
  getOrders,
);

// List order's brands and vendors
router.get("/brands-and-vendors", authenticate, getOrderSummary);

//get orders by brand and status
router.get(
  "/brand/:brand/vendor/:vendor/status/:status",
  authenticate,
  getOrdersByBrandAndStatus,
);

// get orders with optional filters via query params
router.get("/filters", authenticate, getOrdersByFiltersDb);
router.get("/export", authenticate, exportOrdersDb);
router.get(
  "/po-status-report",
  authenticate,
  authorize("admin", "manager", "dev"),
  getPoStatusReport,
);
router.get(
  "/delayed-po-report",
  authenticate,
  authorize("admin", "manager", "QC", "dev"),
  getDelayedPoReport,
);
router.get(
  "/delayed-po-report/export",
  authenticate,
  authorize("admin", "manager", "QC", "dev"),
  exportDelayedPoReport,
);
router.get("/revised-etd-history", authenticate, getRevisedEtdHistory);

// List shipped/partially shipped/inspection-done items with latest shipment details
router.get(
  "/shipments/export",
  authenticate,
  authorize("admin", "manager", "QC", "dev"),
  exportShipmentsDb,
);

router.get(
  "/shipments",
  authenticate,
  authorize("admin", "manager", "QC", "dev"),
  getShipmentsDb,
);

// Finalize shipping / add shipment entry
router.patch(
  "/edit-order/:id",
  authenticate,
  authorize("admin"),
  editOrder,
);

router.patch(
  "/bulk-revised-etd",
  authenticate,
  authorize("admin"),
  bulkUpdateRevisedEtd,
);

router.patch(
  "/edit-complete-order/:id",
  authenticate,
  authorize("admin"),
  editCompleteOrder,
);

router.patch(
  "/archive-order/:id",
  authenticate,
  authorize("admin"),
  archiveOrder,
);

router.get(
  "/archived",
  authenticate,
  authorize("admin"),
  getArchivedOrders,
);

router.post(
  "/sync-zero-quantity-archive",
  authenticate,
  authorize("admin"),
  syncZeroQuantityOrdersArchive,
);

router.patch(
  "/finalize-order/:id",
  authenticate,
  authorize("admin", "manager", "dev"),
  finalizeOrder,
);

router.get("/today-etd-orders", authenticate, getTodayEtdOrdersByBrand);

// Get vendor summary by brand
router.get("/:brand/vendor-summary", authenticate, getVendorSummaryByBrand);
router.get("/:brand/today-etd-orders", authenticate, getTodayEtdOrdersByBrand);

// Get order by ID
router.get("/order-by-id/:id", authenticate, getOrderById);

// Resync the calendar
router.post(
  "/re-sync",
  authenticate,
  authorize("admin", "manager", "dev"),
  reSync,
);

module.exports = router;

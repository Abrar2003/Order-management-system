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
  getPackedGoods,
  getContainersDb,
  getShipmentsDb,
  exportShipmentsDb,
  getDelayedPoReport,
  getUpcomingEtdReport,
  exportDelayedPoReport,
  exportUpcomingEtdReport,
  exportOrdersDb,
  editOrder,
  bulkUpdateRevisedEtd,
  editCompleteOrder,
  archiveOrder,
  unarchiveOrder,
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
  authorize("admin", "manager", "dev", "user"),
  getUploadLogs,
);

router.get(
  "/edit-logs",
  authenticate,
  authorize("admin", "manager", "dev", "user"),
  getOrderEditLogs,
);

// List orders (pagination + sorting)
router.get(
  "/",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  getOrders,
);

// List order's brands and vendors
router.get("/brands-and-vendors", authenticate, authorize("admin", "manager", "QC", "dev", "user"), getOrderSummary);
router.get("/packed-goods", authenticate, authorize("admin", "manager", "QC", "dev", "user"), getPackedGoods);

//get orders by brand and status
router.get(
  "/brand/:brand/vendor/:vendor/status/:status",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  getOrdersByBrandAndStatus,
);

// get orders with optional filters via query params
router.get("/filters", authenticate, authorize("admin", "manager", "QC", "dev", "user"), getOrdersByFiltersDb);
router.get("/export", authenticate, authorize("admin", "manager", "QC", "dev", "user"), exportOrdersDb);
router.get(
  "/po-status-report",
  authenticate,
  authorize("admin", "manager", "dev", "user"),
  getPoStatusReport,
);
router.get(
  "/delayed-po-report",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  getDelayedPoReport,
);
router.get(
  "/upcoming-etd-report",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  getUpcomingEtdReport,
);
router.get(
  "/delayed-po-report/export",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  exportDelayedPoReport,
);
router.get(
  "/upcoming-etd-report/export",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  exportUpcomingEtdReport,
);
router.get("/revised-etd-history", authenticate, authorize("admin", "manager", "QC", "dev", "user"), getRevisedEtdHistory);

// List shipped/partially shipped/inspection-done items with latest shipment details
router.get(
  "/containers",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  getContainersDb,
);

router.get(
  "/shipments/export",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  exportShipmentsDb,
);

router.get(
  "/shipments",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
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

router.patch(
  "/unarchive-order/:id",
  authenticate,
  authorize("admin"),
  unarchiveOrder,
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

router.get("/today-etd-orders", authenticate, authorize("admin", "manager", "QC", "dev", "user"), getTodayEtdOrdersByBrand);

// Get vendor summary by brand
router.get("/:brand/vendor-summary", authenticate, authorize("admin", "manager", "QC", "dev", "user"), getVendorSummaryByBrand);
router.get("/:brand/today-etd-orders", authenticate, authorize("admin", "manager", "QC", "dev", "user"), getTodayEtdOrdersByBrand);

// Get order by ID
router.get("/order-by-id/:id", authenticate, authorize("admin", "manager", "QC", "dev", "user"), getOrderById);

// Resync the calendar
router.post(
  "/re-sync",
  authenticate,
  authorize("admin", "manager", "dev"),
  reSync,
);

module.exports = router;

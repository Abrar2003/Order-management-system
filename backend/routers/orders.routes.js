const express = require("express");
const upload = require("../config/multer.config");
const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  cacheRoute,
  invalidateCacheOnSuccess,
} = require("../middlewares/cache.middleware");
const {
  SHORT_CACHE_TTL,
  MEDIUM_CACHE_TTL,
} = require("../services/cache.service");
const {
  invalidateOrderCaches,
} = require("../services/cacheInvalidation.service");
const {
  uploadOrders,
  createOrdersManually,
  rectifyPdfOrders,
  getUploadLogs,
  getOrderEditLogs,
  lookupPreviousOrder,
  getOrders,
  getPoStatusReport,
  getPendingPoReport,
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
  checkShipmentRows,
  getDelayedPoReport,
  getUpcomingEtdReport,
  exportDelayedPoReport,
  exportPendingPoReport,
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
  recalculateTotalPoCbm,
  reSync,
} = require("../controllers/order.controller");

const router = express.Router();
const invalidateOrdersOnSuccess = invalidateCacheOnSuccess(invalidateOrderCaches);

router.post(
  "/upload-orders",
  authenticate,
  authorize("admin", "manager", "dev"),
  invalidateOrdersOnSuccess,
  upload.safeSingle("file"),
  uploadOrders,
);

router.post(
  "/manual-orders",
  authenticate,
  authorize("admin", "manager", "dev"),
  invalidateOrdersOnSuccess,
  createOrdersManually,
);

router.post(
  "/rectify-pdf",
  authenticate,
  authorize("admin", "manager", "dev"),
  invalidateOrdersOnSuccess,
  upload.safeSingle("file"),
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
  cacheRoute("orders", MEDIUM_CACHE_TTL),
  getUploadLogs,
);

router.get(
  "/edit-logs",
  authenticate,
  authorize("admin", "manager", "dev", "user"),
  cacheRoute("orders", MEDIUM_CACHE_TTL),
  getOrderEditLogs,
);

// List orders (pagination + sorting)
router.get(
  "/",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("orders", SHORT_CACHE_TTL),
  getOrders,
);

// List order's brands and vendors
router.get("/brands-and-vendors", authenticate, authorize("admin", "manager", "QC", "dev", "user"), cacheRoute("options", MEDIUM_CACHE_TTL), getOrderSummary);
router.get("/packed-goods", authenticate, authorize("admin", "manager", "QC", "dev", "user"), cacheRoute("orders", SHORT_CACHE_TTL), getPackedGoods);

//get orders by brand and status
router.get(
  "/brand/:brand/vendor/:vendor/status/:status",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("orders", SHORT_CACHE_TTL),
  getOrdersByBrandAndStatus,
);

// get orders with optional filters via query params
router.get("/filters", authenticate, authorize("admin", "manager", "QC", "dev", "user"), cacheRoute("orders", SHORT_CACHE_TTL), getOrdersByFiltersDb);
router.get("/export", authenticate, authorize("admin", "manager", "QC", "dev", "user"), exportOrdersDb);
router.get(
  "/po-status-report",
  authenticate,
  authorize("admin", "manager", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getPoStatusReport,
);
router.get(
  "/pending-po-report",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getPendingPoReport,
);
router.get(
  "/delayed-po-report",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getDelayedPoReport,
);
router.get(
  "/upcoming-etd-report",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getUpcomingEtdReport,
);
router.get(
  "/delayed-po-report/export",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  exportDelayedPoReport,
);
router.get(
  "/pending-po-report/export",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  exportPendingPoReport,
);
router.get(
  "/upcoming-etd-report/export",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  exportUpcomingEtdReport,
);
router.get("/revised-etd-history", authenticate, authorize("admin", "manager", "QC", "dev", "user"), cacheRoute("orders", SHORT_CACHE_TTL), getRevisedEtdHistory);

// List shipped/partially shipped/inspection-done items with latest shipment details
router.get(
  "/containers",
  authenticate,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("orders", SHORT_CACHE_TTL),
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
  cacheRoute("orders", SHORT_CACHE_TTL),
  getShipmentsDb,
);

router.patch(
  "/shipments/check",
  authenticate,
  authorize("admin", "manager", "dev"),
  invalidateOrdersOnSuccess,
  checkShipmentRows,
);

// Finalize shipping / add shipment entry
router.patch(
  "/edit-order/:id",
  authenticate,
  authorize("admin"),
  invalidateOrdersOnSuccess,
  editOrder,
);

router.patch(
  "/bulk-revised-etd",
  authenticate,
  authorize("admin"),
  invalidateOrdersOnSuccess,
  bulkUpdateRevisedEtd,
);

router.patch(
  "/edit-complete-order/:id",
  authenticate,
  authorize("admin"),
  invalidateOrdersOnSuccess,
  editCompleteOrder,
);

router.patch(
  "/archive-order/:id",
  authenticate,
  authorize("admin"),
  invalidateOrdersOnSuccess,
  archiveOrder,
);

router.patch(
  "/unarchive-order/:id",
  authenticate,
  authorize("admin"),
  invalidateOrdersOnSuccess,
  unarchiveOrder,
);

router.get(
  "/archived",
  authenticate,
  authorize("admin"),
  cacheRoute("orders", SHORT_CACHE_TTL),
  getArchivedOrders,
);

router.post(
  "/sync-zero-quantity-archive",
  authenticate,
  authorize("admin"),
  invalidateOrdersOnSuccess,
  syncZeroQuantityOrdersArchive,
);

router.patch(
  "/finalize-order/:id",
  authenticate,
  authorize("admin", "manager", "dev"),
  invalidateOrdersOnSuccess,
  finalizeOrder,
);

router.get("/today-etd-orders", authenticate, authorize("admin", "manager", "QC", "dev", "user"), cacheRoute("dashboard", SHORT_CACHE_TTL), getTodayEtdOrdersByBrand);

// Get vendor summary by brand
router.get("/:brand/vendor-summary", authenticate, authorize("admin", "manager", "QC", "dev", "user"), cacheRoute("dashboard", SHORT_CACHE_TTL), getVendorSummaryByBrand);
router.get("/:brand/today-etd-orders", authenticate, authorize("admin", "manager", "QC", "dev", "user"), cacheRoute("dashboard", SHORT_CACHE_TTL), getTodayEtdOrdersByBrand);

// Get order by ID
router.get("/order-by-id/:id", authenticate, authorize("admin", "manager", "QC", "dev", "user"), cacheRoute("orders", SHORT_CACHE_TTL), getOrderById);

router.post(
  "/recalculate-total-po-cbm",
  authenticate,
  authorize("admin", "manager", "dev"),
  invalidateOrdersOnSuccess,
  recalculateTotalPoCbm,
);

// Resync the calendar
router.post(
  "/re-sync",
  authenticate,
  authorize("admin", "manager", "dev"),
  invalidateOrdersOnSuccess,
  reSync,
);

module.exports = router;

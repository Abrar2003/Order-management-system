const express = require("express");
const upload = require("../config/multer.config");
const authenticate = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
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
  requirePermission("uploads", "upload"),
  invalidateOrdersOnSuccess,
  upload.safeSingle("file"),
  uploadOrders,
);

router.post(
  "/manual-orders",
  authenticate,
  requirePermission("orders", "create"),
  invalidateOrdersOnSuccess,
  createOrdersManually,
);

router.post(
  "/rectify-pdf",
  authenticate,
  requirePermission("uploads", "upload"),
  invalidateOrdersOnSuccess,
  upload.safeSingle("file"),
  rectifyPdfOrders,
);

router.get(
  "/previous-order-check",
  authenticate,
  requirePermission("orders", "view"),
  lookupPreviousOrder,
);

router.get(
  "/upload-logs",
  authenticate,
  requirePermission("uploads", "view"),
  cacheRoute("orders", MEDIUM_CACHE_TTL),
  getUploadLogs,
);

router.get(
  "/edit-logs",
  authenticate,
  requirePermission("orders", "view"),
  cacheRoute("orders", MEDIUM_CACHE_TTL),
  getOrderEditLogs,
);

// List orders (pagination + sorting)
router.get(
  "/",
  authenticate,
  requirePermission("orders", "view"),
  cacheRoute("orders", SHORT_CACHE_TTL),
  getOrders,
);

// List order's brands and vendors
router.get("/brands-and-vendors", authenticate, requirePermission("orders", "view"), cacheRoute("options", MEDIUM_CACHE_TTL), getOrderSummary);
router.get("/packed-goods", authenticate, requirePermission("orders", "view"), cacheRoute("orders", SHORT_CACHE_TTL), getPackedGoods);

//get orders by brand and status
router.get(
  "/brand/:brand/vendor/:vendor/status/:status",
  authenticate,
  requirePermission("orders", "view"),
  cacheRoute("orders", SHORT_CACHE_TTL),
  getOrdersByBrandAndStatus,
);

// get orders with optional filters via query params
router.get("/filters", authenticate, requirePermission("orders", "view"), cacheRoute("orders", SHORT_CACHE_TTL), getOrdersByFiltersDb);
router.get("/export", authenticate, requirePermission("orders", "export"), exportOrdersDb);
router.get(
  "/po-status-report",
  authenticate,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getPoStatusReport,
);
router.get(
  "/pending-po-report",
  authenticate,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getPendingPoReport,
);
router.get(
  "/delayed-po-report",
  authenticate,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getDelayedPoReport,
);
router.get(
  "/upcoming-etd-report",
  authenticate,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getUpcomingEtdReport,
);
router.get(
  "/delayed-po-report/export",
  authenticate,
  requirePermission("reports", "export"),
  exportDelayedPoReport,
);
router.get(
  "/pending-po-report/export",
  authenticate,
  requirePermission("reports", "export"),
  exportPendingPoReport,
);
router.get(
  "/upcoming-etd-report/export",
  authenticate,
  requirePermission("reports", "export"),
  exportUpcomingEtdReport,
);
router.get("/revised-etd-history", authenticate, requirePermission("orders", "view"), cacheRoute("orders", SHORT_CACHE_TTL), getRevisedEtdHistory);

// List shipped/partially shipped/inspection-done items with latest shipment details
router.get(
  "/containers",
  authenticate,
  requirePermission("containers", "view"),
  cacheRoute("orders", SHORT_CACHE_TTL),
  getContainersDb,
);

router.get(
  "/shipments/export",
  authenticate,
  requirePermission("shipments", "export"),
  exportShipmentsDb,
);

router.get(
  "/shipments",
  authenticate,
  requirePermission("shipments", "view"),
  cacheRoute("orders", SHORT_CACHE_TTL),
  getShipmentsDb,
);

router.patch(
  "/shipments/check",
  authenticate,
  requirePermission("shipments", "edit"),
  invalidateOrdersOnSuccess,
  checkShipmentRows,
);

// Finalize shipping / add shipment entry
router.patch(
  "/edit-order/:id",
  authenticate,
  requirePermission("orders", "edit"),
  invalidateOrdersOnSuccess,
  editOrder,
);

router.patch(
  "/bulk-revised-etd",
  authenticate,
  requirePermission("orders", "edit"),
  invalidateOrdersOnSuccess,
  bulkUpdateRevisedEtd,
);

router.patch(
  "/edit-complete-order/:id",
  authenticate,
  requirePermission("orders", "edit"),
  invalidateOrdersOnSuccess,
  editCompleteOrder,
);

router.patch(
  "/archive-order/:id",
  authenticate,
  requirePermission("orders", "delete"),
  invalidateOrdersOnSuccess,
  archiveOrder,
);

router.patch(
  "/unarchive-order/:id",
  authenticate,
  requirePermission("orders", "edit"),
  invalidateOrdersOnSuccess,
  unarchiveOrder,
);

router.get(
  "/archived",
  authenticate,
  requirePermission("orders", "view"),
  cacheRoute("orders", SHORT_CACHE_TTL),
  getArchivedOrders,
);

router.post(
  "/sync-zero-quantity-archive",
  authenticate,
  requirePermission("orders", "sync"),
  invalidateOrdersOnSuccess,
  syncZeroQuantityOrdersArchive,
);

router.patch(
  "/finalize-order/:id",
  authenticate,
  requirePermission("orders", "edit"),
  invalidateOrdersOnSuccess,
  finalizeOrder,
);

router.get("/today-etd-orders", authenticate, requirePermission("dashboard", "view"), cacheRoute("dashboard", SHORT_CACHE_TTL), getTodayEtdOrdersByBrand);

// Get vendor summary by brand
router.get("/:brand/vendor-summary", authenticate, requirePermission("dashboard", "view"), cacheRoute("dashboard", SHORT_CACHE_TTL), getVendorSummaryByBrand);
router.get("/:brand/today-etd-orders", authenticate, requirePermission("dashboard", "view"), cacheRoute("dashboard", SHORT_CACHE_TTL), getTodayEtdOrdersByBrand);

// Get order by ID
router.get("/order-by-id/:id", authenticate, requirePermission("orders", "view"), cacheRoute("orders", SHORT_CACHE_TTL), getOrderById);

router.post(
  "/recalculate-total-po-cbm",
  authenticate,
  requirePermission("orders", "sync"),
  invalidateOrdersOnSuccess,
  recalculateTotalPoCbm,
);

// Resync the calendar
router.post(
  "/re-sync",
  authenticate,
  requirePermission("calendar", "sync"),
  invalidateOrdersOnSuccess,
  reSync,
);

module.exports = router;

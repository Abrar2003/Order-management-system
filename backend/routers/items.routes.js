const express = require("express");
const upload = require("../config/multer.config");
const auth = require("../middlewares/auth.middleware");
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
  invalidateItemCaches,
} = require("../services/cacheInvalidation.service");
const {
  getItems,
  getPisDiffItems,
  getPisDiffCheckedReportPreview,
  exportPisDiffCheckedReport,
  getItemOrderPresence,
  getItemOrdersHistory,
  createItem,
  syncItemsFromOrders,
  updateItem,
  updateItemPis,
  getItemFileUrl,
  getItemPisFileUrl,
  uploadItemFile,
  uploadItemPisFile,
  deleteItemFile,
} = require("../controllers/item.controller");
const { getProductAnalytics } = require("../controllers/product.controller");

const router = express.Router();
const invalidateItemsOnSuccess = invalidateCacheOnSuccess(invalidateItemCaches);

router.get(
  "/",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getItems,
);

router.get(
  "/pis-diffs",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getPisDiffItems,
);

router.get(
  "/pis-diffs/export-preview",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getPisDiffCheckedReportPreview,
);

router.get(
  "/pis-diffs/export",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  exportPisDiffCheckedReport,
);

router.post(
  "/",
  auth,
  authorize("admin", "manager", "dev"),
  upload.safeSingle("pis_file"),
  invalidateItemsOnSuccess,
  createItem,
);

router.post(
  "/sync",
  auth,
  authorize("admin", "manager", "dev"),
  invalidateItemsOnSuccess,
  syncItemsFromOrders,
);

router.get(
  "/:itemCode/order-presence",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("items", SHORT_CACHE_TTL),
  getItemOrderPresence,
);

router.get(
  "/:itemCode/orders-history",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("items", SHORT_CACHE_TTL),
  getItemOrdersHistory,
);

router.get(
  "/:id/files/:fileType/url",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  getItemFileUrl,
);

router.get(
  "/:itemId/pis-file-url",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  getItemPisFileUrl,
);

router.get("/product-analytics", auth, authorize("admin", "manager", "dev", "user"), cacheRoute("analytics", MEDIUM_CACHE_TTL), getProductAnalytics);

router.patch(
  "/:id",
  auth,
  authorize("admin", "manager", "dev"),
  invalidateItemsOnSuccess,
  updateItem,
);

router.patch(
  "/:id/pis",
  auth,
  authorize("admin", "manager", "dev"),
  invalidateItemsOnSuccess,
  updateItemPis,
);

router.post(
  "/:itemId/pis-upload",
  auth,
  authorize("admin", "manager", "dev"),
  upload.safeSingle("file"),
  invalidateItemsOnSuccess,
  uploadItemPisFile,
);

router.post(
  "/:id/files",
  auth,
  authorize("admin", "manager"),
  upload.safeSingle("file"),
  invalidateItemsOnSuccess,
  uploadItemFile,
);

router.delete(
  "/:id/files/:fileType",
  auth,
  authorize("admin", "manager"),
  invalidateItemsOnSuccess,
  deleteItemFile,
);

module.exports = router;

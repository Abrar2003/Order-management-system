const express = require("express");
const upload = require("../config/multer.config");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  requireAdminOnlyPisEdit,
  requirePermission,
} = require("../middlewares/permission.middleware");
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
  getFinalPisCheckItems,
  getFinalPisCheckOptions,
  getFinalPisCheckReportPreview,
  exportFinalPisCheckReport,
  getProductDatabaseItems,
  updateProductDatabaseItem,
  checkProductDatabaseItem,
  approveProductDatabaseItem,
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

const requiresPisAdminForPayload = (req, res, next) => {
  const hasPisFile = Boolean(req.file);
  const hasPisFields = Object.keys(req.body || {}).some((key) =>
    String(key || "").toLowerCase().startsWith("pis"),
  );

  if (hasPisFile || hasPisFields) {
    return requireAdminOnlyPisEdit(req, res, next);
  }

  return next();
};

router.get(
  "/",
  auth,
  requirePermission("items", "view"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getItems,
);

router.get(
  "/pis-diffs",
  auth,
  requirePermission("pis", "view"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getPisDiffItems,
);

router.get(
  "/pis-diffs/export-preview",
  auth,
  requirePermission("pis", "export"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getPisDiffCheckedReportPreview,
);

router.get(
  "/pis-diffs/export",
  auth,
  requirePermission("pis", "export"),
  exportPisDiffCheckedReport,
);

router.get(
  "/final-pis-check",
  auth,
  requirePermission("pis", "view"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getFinalPisCheckItems,
);

router.get(
  "/final-pis-check/options",
  auth,
  requirePermission("pis", "view"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getFinalPisCheckOptions,
);

router.get(
  "/final-pis-check/export-preview",
  auth,
  requirePermission("pis", "export"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  getFinalPisCheckReportPreview,
);

router.get(
  "/final-pis-check/export",
  auth,
  requirePermission("pis", "export"),
  exportFinalPisCheckReport,
);

router.get(
  "/product-database",
  auth,
  requirePermission("product_database", "view"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getProductDatabaseItems,
);

router.patch(
  "/:id/product-database",
  auth,
  authorize("admin", "manager"),
  requirePermission("product_database", "edit"),
  invalidateItemsOnSuccess,
  updateProductDatabaseItem,
);

router.post(
  "/:id/product-database/check",
  auth,
  authorize("manager"),
  requirePermission("product_database", "approve"),
  invalidateItemsOnSuccess,
  checkProductDatabaseItem,
);

router.post(
  "/:id/product-database/approve",
  auth,
  authorize("admin"),
  requirePermission("product_database", "approve"),
  invalidateItemsOnSuccess,
  approveProductDatabaseItem,
);

router.post(
  "/",
  auth,
  requirePermission("items", "create"),
  upload.safeSingle("pis_file"),
  requiresPisAdminForPayload,
  invalidateItemsOnSuccess,
  createItem,
);

router.post(
  "/sync",
  auth,
  requirePermission("items", "sync"),
  invalidateItemsOnSuccess,
  syncItemsFromOrders,
);

router.get(
  "/:itemCode/order-presence",
  auth,
  requirePermission("items", "view"),
  cacheRoute("items", SHORT_CACHE_TTL),
  getItemOrderPresence,
);

router.get(
  "/:itemCode/orders-history",
  auth,
  requirePermission("items", "view"),
  cacheRoute("items", SHORT_CACHE_TTL),
  getItemOrdersHistory,
);

router.get(
  "/:id/files/:fileType/url",
  auth,
  requirePermission("images_documents", "view"),
  getItemFileUrl,
);

router.get(
  "/:itemId/pis-file-url",
  auth,
  requirePermission("pis", "view"),
  getItemPisFileUrl,
);

router.get("/product-analytics", auth, requirePermission("reports", "view"), cacheRoute("analytics", MEDIUM_CACHE_TTL), getProductAnalytics);

router.patch(
  "/:id",
  auth,
  requirePermission("items", "edit"),
  invalidateItemsOnSuccess,
  updateItem,
);

router.patch(
  "/:id/pis",
  auth,
  requireAdminOnlyPisEdit,
  requirePermission("pis", "edit"),
  invalidateItemsOnSuccess,
  updateItemPis,
);

router.post(
  "/:itemId/pis-upload",
  auth,
  requireAdminOnlyPisEdit,
  requirePermission("pis", "upload"),
  upload.safeSingle("file"),
  invalidateItemsOnSuccess,
  uploadItemPisFile,
);

router.post(
  "/:id/files",
  auth,
  requirePermission("images_documents", "upload"),
  upload.safeSingle("file"),
  invalidateItemsOnSuccess,
  uploadItemFile,
);

router.delete(
  "/:id/files/:fileType",
  auth,
  requirePermission("images_documents", "delete"),
  invalidateItemsOnSuccess,
  deleteItemFile,
);

module.exports = router;

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
  securityLog,
} = require("../middlewares/securityActivityLogger");
const { userHasPermission } = require("../services/permission.service");
const {
  getItems,
  getItemMasters,
  getPisDiffItems,
  getPisDiffCheckedReportPreview,
  exportPisDiffCheckedReport,
  getFinalPisCheckItems,
  getFinalPisCheckOptions,
  getFinalPisCheckReportPreview,
  exportFinalPisCheckReport,
  createFinalPisCheckComment,
  updateFinalPisCheckComment,
  deleteFinalPisCheckComment,
  getPisUpdateLogs,
  getProductDatabaseItems,
  getItemDatabaseItems,
  exportItemDatabaseItems,
  getItemDatabaseProductDetails,
  updateProductDatabaseItem,
  checkProductDatabaseItem,
  approveProductDatabaseItem,
  getItemDetails,
  getItemOrderPresence,
  getItemOrdersHistory,
  getPisInspectionMasterComparison,
  getPisInspectionMasterComparisonRecords,
  createItem,
  syncItemsFromOrders,
  updateItem,
  updateItemPis,
  syncAllProductDatabaseToPis,
  syncProductDatabaseToPis,
  getItemFileUrl,
  getItemPisFileUrl,
  uploadItemFile,
  uploadItemPisFile,
  deleteItemFile,
  getItemFormDraft,
  saveItemFormDraft,
  deleteItemFormDraft,
} = require("../controllers/item.controller");
const { getProductAnalytics } = require("../controllers/product.controller");

const router = express.Router();
const invalidateItemsOnSuccess = invalidateCacheOnSuccess(invalidateItemCaches);

const requirePisUpdateLogsView = async (req, res, next) => {
  try {
    const allowed = await Promise.any([
      userHasPermission(req.user, "pis", "view").then((value) => {
        if (!value) throw new Error("pis.view denied");
        return true;
      }),
      userHasPermission(req.user, "product_database", "view").then((value) => {
        if (!value) throw new Error("product_database.view denied");
        return true;
      }),
      userHasPermission(req.user, "items", "view").then((value) => {
        if (!value) throw new Error("items.view denied");
        return true;
      }),
    ]);

    if (allowed) return next();
    return res.status(403).json({
      message: "Permission denied: PIS, Product Database, or Items view is required.",
    });
  } catch {
    return res.status(403).json({
      message: "Permission denied: PIS, Product Database, or Items view is required.",
    });
  }
};

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
  "/masters",
  auth,
  requirePermission("items", "view"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getItemMasters,
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
  securityLog("export_excel", "pis_diff_report", {
    metadata: (req) => ({ filters: req.query || {} }),
  }),
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
  securityLog("export_excel", "final_pis_check_report", {
    metadata: (req) => ({ filters: req.query || {} }),
  }),
  exportFinalPisCheckReport,
);

router.post(
  "/final-pis-check/:code/comments",
  auth,
  requirePermission("pis", "view"),
  invalidateItemsOnSuccess,
  createFinalPisCheckComment,
);

router.put(
  "/final-pis-check/:code/comments/:commentId",
  auth,
  requirePermission("pis", "view"),
  invalidateItemsOnSuccess,
  updateFinalPisCheckComment,
);

router.delete(
  "/final-pis-check/:code/comments/:commentId",
  auth,
  requirePermission("pis", "view"),
  invalidateItemsOnSuccess,
  deleteFinalPisCheckComment,
);

router.get(
  "/product-database",
  auth,
  requirePermission("product_database", "view"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getProductDatabaseItems,
);

router.get(
  "/item-database",
  auth,
  requirePermission("product_database", "view"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getItemDatabaseItems,
);

router.get(
  "/item-database/export",
  auth,
  requirePermission("product_database", "view"),
  securityLog("export_excel", "item_database", {
    metadata: (req) => ({ filters: req.query || {} }),
  }),
  exportItemDatabaseItems,
);

router.get(
  "/item-database/:id",
  auth,
  requirePermission("product_database", "view"),
  cacheRoute("items", MEDIUM_CACHE_TTL),
  getItemDatabaseProductDetails,
);

router.get(
  "/pis-update-logs",
  auth,
  requirePisUpdateLogsView,
  getPisUpdateLogs,
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
  "/pis-inspection-master-comparison",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("items", SHORT_CACHE_TTL),
  getPisInspectionMasterComparisonRecords,
);

router.get(
  "/:code/pis-inspection-master-comparison",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("items", SHORT_CACHE_TTL),
  getPisInspectionMasterComparison,
);

router.get(
  "/:itemCode/order-presence",
  auth,
  requirePermission("items", "view"),
  cacheRoute("items", SHORT_CACHE_TTL),
  getItemOrderPresence,
);

router.get(
  "/:itemCode/details",
  auth,
  requirePermission("items", "view"),
  securityLog("view", "item", {
    resourceId: (req) => req.params.itemCode,
    metadata: () => ({ records: 1 }),
  }),
  cacheRoute("items", SHORT_CACHE_TTL),
  getItemDetails,
);

router.get(
  "/:itemCode/orders-history",
  auth,
  requirePermission("items", "view"),
  securityLog("view", "item_orders_history", {
    resourceId: (req) => req.params.itemCode,
    metadata: () => ({ records: 1 }),
  }),
  cacheRoute("items", SHORT_CACHE_TTL),
  getItemOrdersHistory,
);

router.get(
  "/:id/files/:fileType/url",
  auth,
  requirePermission("images_documents", "view"),
  securityLog("download_file", "item_file", {
    resourceId: (req) => req.params.id,
    metadata: (req) => ({ file_type: req.params.fileType }),
  }),
  getItemFileUrl,
);

router.get(
  "/:itemId/pis-file-url",
  auth,
  requirePermission("pis", "view"),
  securityLog("download_file", "pis_file", {
    resourceId: (req) => req.params.itemId,
  }),
  getItemPisFileUrl,
);

router.get("/product-analytics", auth, requirePermission("reports", "view"), cacheRoute("analytics", MEDIUM_CACHE_TTL), getProductAnalytics);

router.get(
  "/:id/form-draft",
  auth,
  requireAdminOnlyPisEdit,
  requirePermission("pis", "edit"),
  getItemFormDraft,
);

router.put(
  "/:id/form-draft",
  auth,
  requireAdminOnlyPisEdit,
  requirePermission("pis", "edit"),
  saveItemFormDraft,
);

router.delete(
  "/:id/form-draft",
  auth,
  requireAdminOnlyPisEdit,
  requirePermission("pis", "edit"),
  deleteItemFormDraft,
);

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
  "/pis/sync-product-database",
  auth,
  requireAdminOnlyPisEdit,
  requirePermission("pis", "edit"),
  invalidateItemsOnSuccess,
  syncAllProductDatabaseToPis,
);

router.post(
  "/:id/pis/sync-product-database",
  auth,
  requireAdminOnlyPisEdit,
  requirePermission("pis", "edit"),
  invalidateItemsOnSuccess,
  syncProductDatabaseToPis,
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

const express = require("express");
const router = express.Router();

const upload = require("../config/multer.config");
const qcImageAnyUpload = upload.qcImageAnyUpload;
const qcImageSingleUpload = upload.qcImageSingleUpload;
const auth = require("../middlewares/auth.middleware");
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
  invalidateQcCaches,
} = require("../services/cacheInvalidation.service");
const qcController = require("../controllers/qc.controller");
const invalidateQcOnSuccess = invalidateCacheOnSuccess(invalidateQcCaches);

// GET all QC
router.get(
  "/list",
  auth,
  requirePermission("qc", "view"),
  cacheRoute("qc", SHORT_CACHE_TTL),
  qcController.getQCList
);

// Align QC (manager/admin)
router.post(
  "/align-qc",
  auth,
  requirePermission("qc", "assign"),
  invalidateQcOnSuccess,
  qcController.alignQC
);

router.post(
  "/scan-barcode",
  auth,
  requirePermission("qc", "edit"),
  upload.safeSingle("file"),
  qcController.scanBarcodeUpload,
);

// Update QC (Inspector or Admin)
router.patch(
  "/update-qc/:id",
  auth,
  requirePermission("qc", "edit"),
  invalidateQcOnSuccess,
  qcController.updateQC
);

router.patch(
  "/goods-not-ready/:id",
  auth,
  requirePermission("qc", "edit"),
  invalidateQcOnSuccess,
  qcController.markGoodsNotReady
);

router.patch(
  "/reject-all/:id",
  auth,
  requirePermission("qc", "edit"),
  qcImageSingleUpload("image"),
  invalidateQcOnSuccess,
  qcController.rejectAllQc,
);

router.post(
  "/:id/transfer-request",
  auth,
  requirePermission("qc", "assign"),
  invalidateQcOnSuccess,
  qcController.transferQcRequest,
);

router.post(
  "/:id/images",
  auth,
  requirePermission("images_documents", "upload"),
  qcImageAnyUpload,
  invalidateQcOnSuccess,
  qcController.uploadQcImages,
);

router.post(
  "/:id/images/download",
  auth,
  requirePermission("qc", "view"),
  qcController.downloadQcImages,
);

router.delete(
  "/:id/images",
  auth,
  requirePermission("images_documents", "delete"),
  invalidateQcOnSuccess,
  qcController.deleteQcImages,
);

router.post(
  "/sync-item-details",
  auth,
  requirePermission("qc", "sync"),
  invalidateQcOnSuccess,
  qcController.syncQcDetailsFromItems,
);

router.post(
  "/sync-inspections",
  auth,
  requirePermission("inspections", "sync"),
  invalidateQcOnSuccess,
  qcController.syncInspectionStatuses,
);

router.get(
  "/daily-report",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getDailyReport
);

router.get(
  "/reports/inspectors",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getInspectorReports,
);

router.get(
  "/reports/vendors",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getVendorReports,
);

router.get(
  "/reports/weekly-summary",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getWeeklyOrderSummary,
);

router.get(
  "/reports/daily-summary",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getDailyOrderSummary,
);

router.get(
  "/export",
  auth,
  requirePermission("qc", "export"),
  qcController.exportQCList,
);

router.patch(
  "/:id/inspection-records",
  auth,
  requirePermission("inspections", "edit"),
  invalidateQcOnSuccess,
  qcController.editInspectionRecords,
);

router.get(
  "/:id/inspection-record/:recordId/transfer-target",
  auth,
  requirePermission("inspections", "assign"),
  cacheRoute("qc", SHORT_CACHE_TTL),
  qcController.lookupInspectionTransferTarget,
);

router.post(
  "/:id/inspection-record/:recordId/transfer",
  auth,
  requirePermission("inspections", "assign"),
  invalidateQcOnSuccess,
  qcController.transferInspectionRecord,
);

router.delete(
  "/:id/inspection-record/:recordId",
  auth,
  requirePermission("inspections", "delete"),
  invalidateQcOnSuccess,
  qcController.deleteInspectionRecord,
);

router.get(
  "/:id",
  auth,
  requirePermission("qc", "view"),
  cacheRoute("qc", SHORT_CACHE_TTL),
  qcController.getQCById
);

module.exports = router;

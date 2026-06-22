const express = require("express");
const router = express.Router();

const upload = require("../config/multer.config");
const qcImageAnyUpload = upload.qcImageAnyUpload;
const qcImageSingleUpload = upload.qcImageSingleUpload;
const goodsNotReadyImagesUpload = upload.goodsNotReadyImagesUpload;
const auth = require("../middlewares/auth.middleware");
const { requirePermission, requireCheckedEditAccess } = require("../middlewares/permission.middleware");
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
const {
  securityLog,
} = require("../middlewares/securityActivityLogger");
const qcController = require("../controllers/qc.controller");
const { renderHtmlPdf } = require("../controllers/pdf.controller");
const invalidateQcOnSuccess = invalidateCacheOnSuccess(invalidateQcCaches);

router.post(
  "/pdf/render",
  auth,
  requirePermission("qc", "view"),
  securityLog("export_pdf", "inspection_report", {
    metadata: (req) => ({ report_key: req.body?.reportKey || "" }),
  }),
  renderHtmlPdf,
);

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

router.get(
  "/:id/form-draft",
  auth,
  requirePermission("qc", "edit"),
  qcController.getQcFormDraft,
);

router.put(
  "/:id/form-draft",
  auth,
  requirePermission("qc", "edit"),
  qcController.saveQcFormDraft,
);

router.delete(
  "/:id/form-draft",
  auth,
  requirePermission("qc", "edit"),
  qcController.deleteQcFormDraft,
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
  "/:id/checked",
  auth,
  requireCheckedEditAccess,
  invalidateQcOnSuccess,
  qcController.updateQcCheckedStatus,
);

router.patch(
  "/goods-not-ready/:id",
  auth,
  requirePermission("qc", "edit"),
  goodsNotReadyImagesUpload("goods_not_ready_images"),
  securityLog("reject", "qc"),
  invalidateQcOnSuccess,
  qcController.markGoodsNotReady
);

router.patch(
  "/reject-all/:id",
  auth,
  requirePermission("qc", "edit"),
  qcImageSingleUpload("image"),
  securityLog("reject", "qc"),
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

router.get(
  "/:id/images/file",
  auth,
  requirePermission("qc", "view"),
  securityLog("download_file", "qc_image", {
    resourceId: (req) => req.params.id,
    metadata: (req) => ({
      image_id: req.query?.image_id || req.query?.imageId || req.query?.key || "",
    }),
  }),
  qcController.downloadQcImageFile,
);

router.post(
  "/:id/images/download",
  auth,
  requirePermission("qc", "view"),
  securityLog("download_file", "qc_images", {
    resourceId: (req) => req.params.id,
    metadata: (req) => ({
      requested_images: Array.isArray(req.body?.images) ? req.body.images.length : undefined,
    }),
  }),
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
  securityLog("export_excel", "qc", {
    metadata: (req) => ({ filters: req.query || {} }),
  }),
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
  securityLog("view", "inspection_transfer_target", {
    resourceId: (req) => req.params.recordId,
    metadata: (req) => ({ qc_id: req.params.id, records: 1 }),
  }),
  cacheRoute("qc", SHORT_CACHE_TTL),
  qcController.lookupInspectionTransferTarget,
);

router.post(
  "/:id/inspection-record/:recordId/transfer",
  auth,
  requirePermission("inspections", "assign"),
  securityLog("transfer", "inspection_record", {
    resourceId: (req) => req.params.recordId,
    metadata: (req) => ({
      qc_id: req.params.id,
      quantity: req.body?.quantity,
      target: req.body?.target_po || req.body?.targetOrder || req.body?.target_order_id,
    }),
  }),
  invalidateQcOnSuccess,
  qcController.transferInspectionRecord,
);

router.delete(
  "/:id/inspection-record/:recordId",
  auth,
  requirePermission("inspections", "delete"),
  securityLog("delete", "inspection_record", {
    resourceId: (req) => req.params.recordId,
    metadata: (req) => ({ qc_id: req.params.id }),
  }),
  invalidateQcOnSuccess,
  qcController.deleteInspectionRecord,
);

router.get(
  "/:id",
  auth,
  requirePermission("qc", "view"),
  securityLog("view", "qc", {
    resourceId: (req) => req.params.id,
    metadata: () => ({ records: 1 }),
  }),
  cacheRoute("qc", SHORT_CACHE_TTL),
  qcController.getQCById
);

module.exports = router;

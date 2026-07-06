const express = require("express");

const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const {
  invalidateCacheOnSuccess,
} = require("../middlewares/cache.middleware");
const {
  invalidateQcCaches,
} = require("../services/cacheInvalidation.service");
const {
  securityLog,
} = require("../middlewares/securityActivityLogger");
const controller = require("../controllers/qcImageDirectUpload.controller");

const router = express.Router();
const invalidateQcOnSuccess = invalidateCacheOnSuccess(invalidateQcCaches);

router.post(
  "/upload-session",
  auth,
  requirePermission("images_documents", "upload"),
  securityLog("upload_file", "qc_image_upload_session", {
    resourceId: (req) => req.body?.qc_id || req.body?.qcId || "",
    metadata: (req) => ({
      image_type: req.body?.image_type || req.body?.imageType || "qc_images",
      file_name: req.body?.file_name || req.body?.fileName || "",
    }),
  }),
  invalidateQcOnSuccess,
  controller.createUploadSession,
);

router.post(
  "/upload-session/:uploadId/complete",
  auth,
  requirePermission("images_documents", "upload"),
  securityLog("upload_file", "qc_image_upload_complete", {
    resourceId: (req) => req.params.uploadId,
  }),
  invalidateQcOnSuccess,
  controller.completeUploadSession,
);

router.post(
  "/upload-session/:uploadId/refresh",
  auth,
  requirePermission("images_documents", "upload"),
  controller.refreshUploadSession,
);

router.delete(
  "/upload-session/:uploadId",
  auth,
  requirePermission("images_documents", "upload"),
  invalidateQcOnSuccess,
  controller.abortUploadSession,
);

module.exports = router;

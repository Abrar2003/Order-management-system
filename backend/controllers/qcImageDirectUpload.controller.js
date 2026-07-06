const {
  abortUploadSession,
  completeUploadSession,
  createUploadSession,
  refreshUploadSession,
} = require("../services/qcImageDirectUpload.service");

const normalizeText = (value) => String(value ?? "").trim();

const sendServiceError = (res, error, fallbackMessage = "QC image upload failed") =>
  res.status(Number(error?.statusCode || 500)).json({
    success: false,
    message: error?.message || fallbackMessage,
  });

exports.createUploadSession = async (req, res) => {
  try {
    const result = await createUploadSession({
      user: req.user,
      qcId: normalizeText(req.body?.qc_id || req.body?.qcId),
      imageType: normalizeText(req.body?.image_type || req.body?.imageType || "qc_images"),
      fileName: normalizeText(req.body?.file_name || req.body?.fileName || req.body?.name),
      contentType: normalizeText(req.body?.content_type || req.body?.contentType || req.body?.type),
      sizeBytes: req.body?.size_bytes ?? req.body?.sizeBytes ?? req.body?.size,
      idempotencyKey: normalizeText(req.body?.idempotency_key || req.body?.idempotencyKey),
      uploadMode: normalizeText(req.body?.upload_mode || req.body?.uploadMode || "bulk"),
      comment: normalizeText(req.body?.comment),
    });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Create QC image upload session failed:", error);
    return sendServiceError(res, error, "Failed to create QC image upload session");
  }
};

exports.completeUploadSession = async (req, res) => {
  try {
    const result = await completeUploadSession({
      user: req.user,
      uploadId: normalizeText(req.params.uploadId),
    });

    return res.status(200).json({
      success: true,
      message: result.already_completed
        ? "QC image upload was already confirmed"
        : "QC image upload confirmed",
      data: result,
    });
  } catch (error) {
    console.error("Complete QC image upload session failed:", error);
    return sendServiceError(res, error, "Failed to confirm QC image upload");
  }
};

exports.refreshUploadSession = async (req, res) => {
  try {
    const result = await refreshUploadSession({
      user: req.user,
      uploadId: normalizeText(req.params.uploadId),
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Refresh QC image upload session failed:", error);
    return sendServiceError(res, error, "Failed to refresh QC image upload URL");
  }
};

exports.abortUploadSession = async (req, res) => {
  try {
    const result = await abortUploadSession({
      user: req.user,
      uploadId: normalizeText(req.params.uploadId),
    });

    return res.status(200).json({
      success: true,
      message: "QC image upload session cancelled",
      data: result,
    });
  } catch (error) {
    console.error("Abort QC image upload session failed:", error);
    return sendServiceError(res, error, "Failed to cancel QC image upload session");
  }
};

const {
  cancelImageUploadIntent,
  createImageUploadIntent,
} = require("../services/qcImageUploadIntent.service");

const normalizeText = (value) => String(value ?? "").trim();

const sendError = (res, error) =>
  res.status(Number(error?.statusCode || 500)).json({
    success: false,
    message: error?.message || "QC image upload intent failed",
  });

exports.create = async (req, res) => {
  try {
    const result = await createImageUploadIntent({
      user: req.user,
      qcId: normalizeText(req.params.id),
      operation: normalizeText(req.body?.operation),
      imageType: normalizeText(req.body?.image_type || req.body?.imageType),
      inspectionId: normalizeText(req.body?.inspection_id || req.body?.inspectionId),
      requestHistoryId: normalizeText(req.body?.request_history_id || req.body?.requestHistoryId),
      comment: normalizeText(req.body?.comment),
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.cancel = async (req, res) => {
  try {
    const result = await cancelImageUploadIntent({
      user: req.user,
      intentId: normalizeText(req.params.intentId),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
};
